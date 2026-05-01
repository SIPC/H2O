import { NextResponse } from "next/server"

import { getDb } from "@/lib/db"
import { writeAuthLog } from "@/lib/logs-db"
import { getSetting, SETTING_KEYS } from "@/lib/settings"

// agent 每次上报的 payload 结构
type TrafficPayload = {
  traffic?: Record<string, { tx?: number; rx?: number }>
  online?: Record<string, number>
}

// 校验上报体里每个用户的 tx/rx 是否为合法非负数
function normalizeTraffic(
  input: TrafficPayload["traffic"]
): Map<string, { tx: number; rx: number }> | null {
  const out = new Map<string, { tx: number; rx: number }>()
  if (!input || typeof input !== "object") return out
  for (const [username, stat] of Object.entries(input)) {
    if (!stat || typeof stat !== "object") return null
    const tx = stat.tx
    const rx = stat.rx
    if (
      typeof tx !== "number" ||
      typeof rx !== "number" ||
      !Number.isFinite(tx) ||
      !Number.isFinite(rx) ||
      tx < 0 ||
      rx < 0
    ) {
      return null
    }
    out.set(username, { tx: Math.floor(tx), rx: Math.floor(rx) })
  }
  return out
}

// 校验 online 映射格式
function normalizeOnline(
  input: TrafficPayload["online"]
): Map<string, number> | null {
  const out = new Map<string, number>()
  if (!input || typeof input !== "object") return out
  for (const [username, count] of Object.entries(input)) {
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
      return null
    }
    out.set(username, Math.floor(count))
  }
  return out
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ authPath: string }> }
) {
  const { authPath } = await params
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null

  let body: TrafficPayload
  try {
    body = (await request.json()) as TrafficPayload
  } catch {
    writeAuthLog({
      node_id: null,
      node_name: authPath,
      user_id: null,
      username: null,
      ip,
      success: false,
      reason: "BAD_PAYLOAD",
    })
    return NextResponse.json(
      { ok: false, error: { code: "BAD_PAYLOAD", message: "请求体不合法" } },
      { status: 400 }
    )
  }

  const traffic = normalizeTraffic(body.traffic)
  const online = normalizeOnline(body.online)
  if (traffic === null || online === null) {
    writeAuthLog({
      node_id: null,
      node_name: authPath,
      user_id: null,
      username: null,
      ip,
      success: false,
      reason: "BAD_PAYLOAD",
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "BAD_PAYLOAD", message: "上报字段类型不合法" },
      },
      { status: 400 }
    )
  }

  const db = getDb()

  // 统计历史保留天数（1~365），用于自动清理小时趋势表
  const rawRetentionDays = getSetting<number>(
    SETTING_KEYS.statsRetentionDays,
    30
  )
  const retentionDays =
    Number.isInteger(rawRetentionDays) &&
    rawRetentionDays >= 1 &&
    rawRetentionDays <= 365
      ? rawRetentionDays
      : 30

  // 只要 authPath 匹配某个节点就视为合法 agent（复用 Hy2 回调的信任模型）
  // 不受节点禁用状态影响，节点被禁用一样可以上报状态
  const node = db
    .prepare(`SELECT id, name, status FROM nodes WHERE auth_path = ? LIMIT 1`)
    .get(authPath) as { id: number; name: string; status: string } | undefined

  if (!node) {
    writeAuthLog({
      node_id: null,
      node_name: authPath,
      user_id: null,
      username: null,
      ip,
      success: false,
      reason: "NO_NODE",
    })
    return NextResponse.json(
      { ok: false, error: { code: "NO_NODE", message: "未知节点" } },
      { status: 404 }
    )
  }

  let processed = 0
  let skipped = 0
  let blocked = 0
  let hourlyTxDelta = 0
  let hourlyRxDelta = 0

  try {
    db.exec("BEGIN")

    const selectUser = db.prepare(
      `SELECT id, username, status FROM users WHERE username = ? LIMIT 1`
    )
    const selectSub = db.prepare(
      `SELECT s.id, s.used_traffic_bytes, p.traffic_limit_bytes
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       JOIN plan_nodes pn ON pn.plan_id = p.id
       WHERE s.user_id = ?
         AND s.status = 'active'
         AND s.expire_time > datetime('now')
         AND pn.node_id = ?
       ORDER BY s.expire_time DESC
       LIMIT 1`
    )
    const selectLast = db.prepare(
      `SELECT last_tx_bytes, last_rx_bytes
       FROM node_user_traffic
       WHERE node_id = ? AND user_id = ?
       LIMIT 1`
    )
    const upsertLast = db.prepare(
      `INSERT INTO node_user_traffic(node_id, user_id, last_tx_bytes, last_rx_bytes, last_updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(node_id, user_id) DO UPDATE SET
         last_tx_bytes = excluded.last_tx_bytes,
         last_rx_bytes = excluded.last_rx_bytes,
         last_updated_at = datetime('now')`
    )
    const updateSubUsage = db.prepare(
      `UPDATE subscriptions SET used_traffic_bytes = ? WHERE id = ?`
    )
    const blockSub = db.prepare(
      `UPDATE subscriptions SET used_traffic_bytes = ?, status = 'blocked' WHERE id = ?`
    )
    const upsertHourlyStats = db.prepare(
      `INSERT INTO traffic_hourly_stats(bucket_date, bucket_hour, tx_bytes, rx_bytes, updated_at)
       VALUES (
         date('now', 'localtime'),
         CAST(strftime('%H', 'now', 'localtime') AS INTEGER),
         ?,
         ?,
         datetime('now')
       )
       ON CONFLICT(bucket_date, bucket_hour) DO UPDATE SET
         tx_bytes = tx_bytes + excluded.tx_bytes,
         rx_bytes = rx_bytes + excluded.rx_bytes,
         updated_at = datetime('now')`
    )
    const upsertNodeHourly = db.prepare(
      `INSERT INTO node_hourly_traffic(node_id, bucket_date, bucket_hour, tx_bytes, rx_bytes, updated_at)
       VALUES (
         ?,
         date('now', 'localtime'),
         CAST(strftime('%H', 'now', 'localtime') AS INTEGER),
         ?,
         ?,
         datetime('now')
       )
       ON CONFLICT(node_id, bucket_date, bucket_hour) DO UPDATE SET
         tx_bytes = tx_bytes + excluded.tx_bytes,
         rx_bytes = rx_bytes + excluded.rx_bytes,
         updated_at = datetime('now')`
    )
    const upsertSubscriptionHourly = db.prepare(
      `INSERT INTO subscription_hourly_traffic(subscription_id, bucket_date, bucket_hour, tx_bytes, rx_bytes, updated_at)
       VALUES (
         ?,
         date('now', 'localtime'),
         CAST(strftime('%H', 'now', 'localtime') AS INTEGER),
         ?,
         ?,
         datetime('now')
       )
       ON CONFLICT(subscription_id, bucket_date, bucket_hour) DO UPDATE SET
         tx_bytes = tx_bytes + excluded.tx_bytes,
         rx_bytes = rx_bytes + excluded.rx_bytes,
         updated_at = datetime('now')`
    )

    const retentionModifier = `-${retentionDays} day`
    const cleanupTrafficHourly = db.prepare(
      `DELETE FROM traffic_hourly_stats
       WHERE bucket_date < date('now', 'localtime', ?)`
    )
    const cleanupNodeHourly = db.prepare(
      `DELETE FROM node_hourly_traffic
       WHERE bucket_date < date('now', 'localtime', ?)`
    )
    const cleanupSubscriptionHourly = db.prepare(
      `DELETE FROM subscription_hourly_traffic
       WHERE bucket_date < date('now', 'localtime', ?)`
    )

    // ── 续订检查：在流量累加前，对所有开启自动续订的活跃 / 被封订阅执行周期重置 ──
    const pendingRenewalSubs = db
      .prepare(
        `SELECT s.id, s.used_traffic_bytes, s.status,
                s.renewal_anchor, s.start_time,
                p.renewal_period_days
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
         WHERE p.auto_renew = 1
           AND p.renewal_period_days > 0
           AND s.status IN ('active', 'blocked')
           AND s.expire_time > datetime('now')`
      )
      .all() as Array<{
      id: number
      used_traffic_bytes: number
      status: string
      renewal_anchor: string | null
      start_time: string
      renewal_period_days: number
    }>

    const renewSub = db.prepare(
      `UPDATE subscriptions
       SET used_traffic_bytes = 0, status = 'active', renewal_anchor = ?
       WHERE id = ?`
    )

    for (const sub of pendingRenewalSubs) {
      const anchor = sub.renewal_anchor ?? sub.start_time
      const anchorTime = new Date(anchor).getTime()
      if (!Number.isFinite(anchorTime)) continue

      const elapsedDays = (Date.now() - anchorTime) / (1000 * 60 * 60 * 24)
      if (elapsedDays < sub.renewal_period_days) continue

      const cycles = Math.floor(elapsedDays / sub.renewal_period_days)
      const newAnchor = new Date(
        anchorTime + cycles * sub.renewal_period_days * 24 * 60 * 60 * 1000
      ).toISOString()

      renewSub.run(newAnchor, sub.id)
    }

    for (const [username, stat] of traffic) {
      const user = selectUser.get(username) as
        | { id: number; username: string; status: "active" | "disabled" }
        | undefined

      if (!user) {
        skipped++
        writeAuthLog({
          node_id: node.id,
          node_name: node.name,
          user_id: null,
          username,
          ip,
          success: false,
          reason: "NO_USER",
        })
        continue
      }

      if (user.status !== "active") {
        skipped++
        writeAuthLog({
          node_id: node.id,
          node_name: node.name,
          user_id: user.id,
          username: user.username,
          ip,
          success: false,
          reason: "USER_DISABLED",
        })
        continue
      }

      const activeSub = selectSub.get(user.id, node.id) as
        | {
            id: number
            used_traffic_bytes: number
            traffic_limit_bytes: number
          }
        | undefined

      if (!activeSub) {
        skipped++
        writeAuthLog({
          node_id: node.id,
          node_name: node.name,
          user_id: user.id,
          username: user.username,
          ip,
          success: false,
          reason: "NO_SUB",
        })
        // 仍需更新 last 值，避免下次用户订阅恢复后历史流量被重复计入
        upsertLast.run(node.id, user.id, stat.tx, stat.rx)
        continue
      }

      const last = selectLast.get(node.id, user.id) as
        | { last_tx_bytes: number; last_rx_bytes: number }
        | undefined

      const lastTx = last?.last_tx_bytes ?? 0
      const lastRx = last?.last_rx_bytes ?? 0

      // Hy2 重启会导致 /traffic 计数归零：分别对 tx/rx 做差值，若回退则按当前累计值记增量
      const deltaTx = stat.tx < lastTx ? stat.tx : stat.tx - lastTx
      const deltaRx = stat.rx < lastRx ? stat.rx : stat.rx - lastRx
      const delta = deltaTx + deltaRx
      const nextUsage = activeSub.used_traffic_bytes + delta

      if (nextUsage > activeSub.traffic_limit_bytes) {
        blockSub.run(nextUsage, activeSub.id)
        if (delta > 0) {
          hourlyTxDelta += deltaTx
          hourlyRxDelta += deltaRx
          upsertSubscriptionHourly.run(activeSub.id, deltaTx, deltaRx)
        }
        blocked++
        writeAuthLog({
          node_id: node.id,
          node_name: node.name,
          user_id: user.id,
          username: user.username,
          ip,
          success: false,
          reason: "TRAFFIC_EXCEEDED",
        })
      } else if (delta > 0) {
        updateSubUsage.run(nextUsage, activeSub.id)
        hourlyTxDelta += deltaTx
        hourlyRxDelta += deltaRx
        upsertSubscriptionHourly.run(activeSub.id, deltaTx, deltaRx)
        processed++
      } else {
        processed++
      }

      upsertLast.run(node.id, user.id, stat.tx, stat.rx)
    }

    // 汇总到“今日小时桶”全局 + 节点维度流量统计
    if (hourlyTxDelta > 0 || hourlyRxDelta > 0) {
      upsertHourlyStats.run(hourlyTxDelta, hourlyRxDelta)
      upsertNodeHourly.run(node.id, hourlyTxDelta, hourlyRxDelta)
    }

    // 节点心跳与在线/流量快照
    const onlineObj: Record<string, number> = {}
    for (const [k, v] of online) onlineObj[k] = v
    const trafficObj: Record<string, { tx: number; rx: number }> = {}
    for (const [k, v] of traffic) trafficObj[k] = v

    db.prepare(
      `INSERT INTO node_stats(node_id, last_report_at, online_count, online_snapshot, traffic_snapshot)
       VALUES (?, datetime('now'), ?, ?, ?)
       ON CONFLICT(node_id) DO UPDATE SET
         last_report_at = datetime('now'),
         online_count = excluded.online_count,
         online_snapshot = excluded.online_snapshot,
         traffic_snapshot = excluded.traffic_snapshot`
    ).run(
      node.id,
      online.size,
      JSON.stringify(onlineObj),
      JSON.stringify(trafficObj)
    )

    // 清理超出保留期的小时趋势统计
    cleanupTrafficHourly.run(retentionModifier)
    cleanupNodeHourly.run(retentionModifier)
    cleanupSubscriptionHourly.run(retentionModifier)

    db.exec("COMMIT")
  } catch {
    db.exec("ROLLBACK")
    writeAuthLog({
      node_id: node.id,
      node_name: node.name,
      user_id: null,
      username: null,
      ip,
      success: false,
      reason: "BAD_PAYLOAD",
    })
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL", message: "处理失败" } },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    data: { processed, skipped, blocked },
  })
}
