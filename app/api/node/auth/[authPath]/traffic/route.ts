import { localizedJson } from "@/lib/i18n/api-response"

import { getDb } from "@/lib/db"
import {
  addNodeHostTrafficUsage,
  ensureNodeHostTrafficPeriod,
} from "@/lib/node-traffic-quota"
import {
  maskAuthPath,
  type AgentTrafficReportLogFields,
  type AgentTrafficUserLogFields,
  writeAgentTrafficLogs,
  writeAuthLog,
} from "@/lib/logs-db"
import {
  enqueueHostTrafficExceededNotification,
  enqueueSubscriptionTrafficExceededNotification,
  markNotificationState,
  processNotificationOutboxSafely,
} from "@/lib/notifications"
import { getBillableTrafficBytes } from "@/lib/plan-traffic"
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body"
import { getSetting, SETTING_KEYS } from "@/lib/settings"

const MAX_TRAFFIC_REPORT_BODY_BYTES = 5 * 1024 * 1024

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

function getTrafficTotals(traffic: Map<string, { tx: number; rx: number }>) {
  let totalTxBytes = 0
  let totalRxBytes = 0
  for (const stat of traffic.values()) {
    totalTxBytes += stat.tx
    totalRxBytes += stat.rx
  }
  return { totalTxBytes, totalRxBytes }
}

function getOnlineCount(online: Map<string, number>) {
  let count = 0
  for (const onlineCount of online.values()) count += onlineCount
  return count
}

function stringifyDetail(detail: Record<string, unknown>) {
  return JSON.stringify(detail)
}

function parseTrafficSnapshot(
  value: string | null | undefined
): Map<string, { tx: number; rx: number }> {
  const out = new Map<string, { tx: number; rx: number }>()
  if (!value) return out

  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return out
    }

    for (const [username, stat] of Object.entries(parsed)) {
      if (!stat || typeof stat !== "object") continue
      const tx = (stat as { tx?: unknown }).tx
      const rx = (stat as { rx?: unknown }).rx
      if (
        typeof tx !== "number" ||
        typeof rx !== "number" ||
        !Number.isFinite(tx) ||
        !Number.isFinite(rx) ||
        tx < 0 ||
        rx < 0
      ) {
        continue
      }
      out.set(username, { tx: Math.floor(tx), rx: Math.floor(rx) })
    }
  } catch {
    return out
  }

  return out
}

function getCounterDelta(current: number, last: number) {
  return current < last ? current : current - last
}

// 日志写入失败不影响 Agent 上报主流程
function writeAgentTrafficLogsSafely(params: {
  report: AgentTrafficReportLogFields
  userLogs?: AgentTrafficUserLogFields[]
}) {
  try {
    writeAgentTrafficLogs(params.report, params.userLogs ?? [])
  } catch {
    // 忽略日志库异常，避免影响业务库流量结算
  }
}

function writeAuthLogSafely(fields: Parameters<typeof writeAuthLog>[0]) {
  try {
    writeAuthLog(fields)
  } catch {
    // 忽略日志库异常，避免影响 Agent 上报主流程
  }
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

  const maskedAuthPath = maskAuthPath(authPath)
  const db = getDb()

  // 只要 authPath 匹配某个节点就视为合法 agent（复用 Hy2 回调的信任模型）
  // 不受节点禁用状态影响，节点被禁用一样可以上报状态
  const node = db
    .prepare(`SELECT id, name, status FROM nodes WHERE auth_path = ? LIMIT 1`)
    .get(authPath) as { id: number; name: string; status: string } | undefined

  if (!node) {
    writeAuthLogSafely({
      node_id: null,
      node_name: maskedAuthPath,
      user_id: null,
      username: null,
      ip,
      success: false,
      reason: "NO_NODE",
    })
    writeAgentTrafficLogsSafely({
      report: {
        node_id: null,
        node_name: null,
        auth_path: authPath,
        ip,
        success: false,
        reason: "NO_NODE",
        reported_users: 0,
        online_count: 0,
        total_tx_bytes: 0,
        total_rx_bytes: 0,
        delta_tx_bytes: 0,
        delta_rx_bytes: 0,
      },
    })
    return localizedJson(
      request,
      { ok: false, error: { code: "NO_NODE", message: "未知节点" } },
      { status: 404 }
    )
  }

  let body: TrafficPayload
  try {
    body = await readJsonWithLimit<TrafficPayload>(
      request,
      MAX_TRAFFIC_REPORT_BODY_BYTES
    )
  } catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError
    const detailError = tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON"
    writeAuthLogSafely({
      node_id: node.id,
      node_name: node.name,
      user_id: null,
      username: null,
      ip,
      success: false,
      reason: "BAD_PAYLOAD",
    })
    writeAgentTrafficLogsSafely({
      report: {
        node_id: node.id,
        node_name: node.name,
        auth_path: authPath,
        ip,
        success: false,
        reason: "BAD_PAYLOAD",
        reported_users: 0,
        online_count: 0,
        total_tx_bytes: 0,
        total_rx_bytes: 0,
        delta_tx_bytes: 0,
        delta_rx_bytes: 0,
        detail: stringifyDetail({ error: detailError }),
      },
    })
    return localizedJson(
      request,
      {
        ok: false,
        error: {
          code: "BAD_PAYLOAD",
          message: tooLarge ? "请求体过大" : "请求体不合法",
        },
      },
      { status: tooLarge ? 413 : 400 }
    )
  }

  const traffic = normalizeTraffic(body.traffic)
  const online = normalizeOnline(body.online)
  if (traffic === null || online === null) {
    writeAuthLogSafely({
      node_id: node.id,
      node_name: node.name,
      user_id: null,
      username: null,
      ip,
      success: false,
      reason: "BAD_PAYLOAD",
    })
    writeAgentTrafficLogsSafely({
      report: {
        node_id: node.id,
        node_name: node.name,
        auth_path: authPath,
        ip,
        success: false,
        reason: "BAD_PAYLOAD",
        reported_users: 0,
        online_count: 0,
        total_tx_bytes: 0,
        total_rx_bytes: 0,
        delta_tx_bytes: 0,
        delta_rx_bytes: 0,
        detail: stringifyDetail({ error: "INVALID_FIELD_TYPE" }),
      },
    })
    return localizedJson(
      request,
      {
        ok: false,
        error: { code: "BAD_PAYLOAD", message: "上报字段类型不合法" },
      },
      { status: 400 }
    )
  }

  const { totalTxBytes, totalRxBytes } = getTrafficTotals(traffic)
  const totalOnlineCount = getOnlineCount(online)

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

  const agentUserLogs: AgentTrafficUserLogFields[] = []
  let processed = 0
  let skipped = 0
  let blocked = 0
  let subscriptionTxDelta = 0
  let subscriptionRxDelta = 0
  let nodeTxDelta = 0
  let nodeRxDelta = 0
  let nodeDeltaUsers = 0
  let nodeCounterResetUsers = 0
  let nodeSnapshotFallbackUsers = 0

  try {
    db.exec("BEGIN")

    const previousSnapshotRow = db
      .prepare(
        `SELECT traffic_snapshot
         FROM node_stats
         WHERE node_id = ?
         LIMIT 1`
      )
      .get(node.id) as { traffic_snapshot: string | null } | undefined
    const previousSnapshot = parseTrafficSnapshot(
      previousSnapshotRow?.traffic_snapshot
    )
    const selectReportedLast = db.prepare(
      `SELECT last_tx_bytes, last_rx_bytes
       FROM node_reported_user_traffic
       WHERE node_id = ? AND username = ?
       LIMIT 1`
    )
    const upsertReportedLast = db.prepare(
      `INSERT INTO node_reported_user_traffic(node_id, username, last_tx_bytes, last_rx_bytes, last_updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(node_id, username) DO UPDATE SET
         last_tx_bytes = excluded.last_tx_bytes,
         last_rx_bytes = excluded.last_rx_bytes,
         last_updated_at = datetime('now')`
    )

    for (const [username, stat] of traffic) {
      const reportedLast = selectReportedLast.get(node.id, username) as
        | { last_tx_bytes: number; last_rx_bytes: number }
        | undefined
      const fallbackStat = previousSnapshot.get(username)
      const lastTx = reportedLast?.last_tx_bytes ?? fallbackStat?.tx ?? 0
      const lastRx = reportedLast?.last_rx_bytes ?? fallbackStat?.rx ?? 0
      const deltaTx = getCounterDelta(stat.tx, lastTx)
      const deltaRx = getCounterDelta(stat.rx, lastRx)

      if (!reportedLast && fallbackStat) nodeSnapshotFallbackUsers++
      if (
        (reportedLast || fallbackStat) &&
        (stat.tx < lastTx || stat.rx < lastRx)
      ) {
        nodeCounterResetUsers++
      }
      if (deltaTx > 0 || deltaRx > 0) {
        nodeDeltaUsers++
        nodeTxDelta += deltaTx
        nodeRxDelta += deltaRx
      }

      upsertReportedLast.run(node.id, username, stat.tx, stat.rx)
    }

    const selectUser = db.prepare(
      `SELECT id, username, status FROM users WHERE username = ? LIMIT 1`
    )
    const selectSub = db.prepare(
      `SELECT s.id, s.used_traffic_bytes, p.traffic_limit_bytes, p.traffic_billing_mode
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       JOIN plan_nodes pn ON pn.plan_id = p.id
       WHERE s.user_id = ?
         AND s.status = 'active'
         AND datetime(s.expire_time) > datetime('now')
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
           AND datetime(s.expire_time) > datetime('now')`
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
      markNotificationState(db, {
        event: "SUBSCRIPTION_TRAFFIC_EXCEEDED",
        subjectType: "subscription",
        subjectId: sub.id,
        state: "ok",
        detail: {
          subscription_id: sub.id,
          renewal_anchor: newAnchor,
        },
      })
    }

    for (const [username, stat] of traffic) {
      const user = selectUser.get(username) as
        | { id: number; username: string; status: "active" | "disabled" }
        | undefined

      if (!user) {
        skipped++
        agentUserLogs.push({
          node_id: node.id,
          node_name: node.name,
          user_id: null,
          username,
          reported_tx_bytes: stat.tx,
          reported_rx_bytes: stat.rx,
          last_tx_bytes: null,
          last_rx_bytes: null,
          delta_tx_bytes: 0,
          delta_rx_bytes: 0,
          online_count: online.get(username) ?? 0,
          subscription_id: null,
          success: false,
          reason: "NO_USER",
        })
        writeAuthLogSafely({
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
        const last = selectLast.get(node.id, user.id) as
          | { last_tx_bytes: number; last_rx_bytes: number }
          | undefined
        const lastTx = last?.last_tx_bytes ?? 0
        const lastRx = last?.last_rx_bytes ?? 0
        const ignoredDeltaTx = getCounterDelta(stat.tx, lastTx)
        const ignoredDeltaRx = getCounterDelta(stat.rx, lastRx)
        const counterReset = stat.tx < lastTx || stat.rx < lastRx
        skipped++
        agentUserLogs.push({
          node_id: node.id,
          node_name: node.name,
          user_id: user.id,
          username: user.username,
          reported_tx_bytes: stat.tx,
          reported_rx_bytes: stat.rx,
          last_tx_bytes: last ? lastTx : null,
          last_rx_bytes: last ? lastRx : null,
          delta_tx_bytes: 0,
          delta_rx_bytes: 0,
          online_count: online.get(username) ?? 0,
          subscription_id: null,
          success: false,
          reason: "USER_DISABLED",
          detail: stringifyDetail({
            discarded_delta_tx_bytes: ignoredDeltaTx,
            discarded_delta_rx_bytes: ignoredDeltaRx,
            counter_reset: counterReset,
          }),
        })
        writeAuthLogSafely({
          node_id: node.id,
          node_name: node.name,
          user_id: user.id,
          username: user.username,
          ip,
          success: false,
          reason: "USER_DISABLED",
        })
        upsertLast.run(node.id, user.id, stat.tx, stat.rx)
        continue
      }

      const activeSub = selectSub.get(user.id, node.id) as
        | {
            id: number
            used_traffic_bytes: number
            traffic_limit_bytes: number
            traffic_billing_mode: string | null
          }
        | undefined

      const last = selectLast.get(node.id, user.id) as
        | { last_tx_bytes: number; last_rx_bytes: number }
        | undefined

      const lastTx = last?.last_tx_bytes ?? 0
      const lastRx = last?.last_rx_bytes ?? 0
      const counterReset = stat.tx < lastTx || stat.rx < lastRx

      if (!activeSub) {
        const ignoredDeltaTx = getCounterDelta(stat.tx, lastTx)
        const ignoredDeltaRx = getCounterDelta(stat.rx, lastRx)
        skipped++
        agentUserLogs.push({
          node_id: node.id,
          node_name: node.name,
          user_id: user.id,
          username: user.username,
          reported_tx_bytes: stat.tx,
          reported_rx_bytes: stat.rx,
          last_tx_bytes: last ? lastTx : null,
          last_rx_bytes: last ? lastRx : null,
          delta_tx_bytes: 0,
          delta_rx_bytes: 0,
          online_count: online.get(username) ?? 0,
          subscription_id: null,
          success: false,
          reason: "NO_SUB",
          detail: stringifyDetail({
            discarded_delta_tx_bytes: ignoredDeltaTx,
            discarded_delta_rx_bytes: ignoredDeltaRx,
            counter_reset: counterReset,
          }),
        })
        writeAuthLogSafely({
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

      // Hy2 重启会导致 /traffic 计数归零：分别对 tx/rx 做差值，若回退则按当前累计值记增量
      const deltaTx = getCounterDelta(stat.tx, lastTx)
      const deltaRx = getCounterDelta(stat.rx, lastRx)
      const delta = deltaTx + deltaRx
      const billableDelta = getBillableTrafficBytes(
        activeSub.traffic_billing_mode,
        deltaTx,
        deltaRx
      )
      const nextUsage = activeSub.used_traffic_bytes + billableDelta

      const baseUserLog = {
        node_id: node.id,
        node_name: node.name,
        user_id: user.id,
        username: user.username,
        reported_tx_bytes: stat.tx,
        reported_rx_bytes: stat.rx,
        last_tx_bytes: last ? lastTx : null,
        last_rx_bytes: last ? lastRx : null,
        delta_tx_bytes: deltaTx,
        delta_rx_bytes: deltaRx,
        online_count: online.get(username) ?? 0,
        subscription_id: activeSub.id,
      }

      if (nextUsage > activeSub.traffic_limit_bytes) {
        blockSub.run(nextUsage, activeSub.id)
        if (delta > 0) {
          subscriptionTxDelta += deltaTx
          subscriptionRxDelta += deltaRx
          upsertSubscriptionHourly.run(activeSub.id, deltaTx, deltaRx)
        }
        blocked++
        agentUserLogs.push({
          ...baseUserLog,
          success: false,
          reason: "TRAFFIC_EXCEEDED",
          detail: stringifyDetail({
            used_traffic_bytes: activeSub.used_traffic_bytes,
            next_usage_bytes: nextUsage,
            traffic_limit_bytes: activeSub.traffic_limit_bytes,
            traffic_billing_mode: activeSub.traffic_billing_mode ?? "tx_rx",
            billable_delta_bytes: billableDelta,
            counter_reset: counterReset,
          }),
        })
        writeAuthLogSafely({
          node_id: node.id,
          node_name: node.name,
          user_id: user.id,
          username: user.username,
          ip,
          success: false,
          reason: "TRAFFIC_EXCEEDED",
        })
        if (activeSub.used_traffic_bytes <= activeSub.traffic_limit_bytes) {
          markNotificationState(db, {
            event: "SUBSCRIPTION_TRAFFIC_EXCEEDED",
            subjectType: "subscription",
            subjectId: activeSub.id,
            state: "ok",
            detail: {
              subscription_id: activeSub.id,
              used_traffic_bytes: activeSub.used_traffic_bytes,
              traffic_limit_bytes: activeSub.traffic_limit_bytes,
            },
          })
        }
        enqueueSubscriptionTrafficExceededNotification(db, {
          nodeId: node.id,
          nodeName: node.name,
          userId: user.id,
          username: user.username,
          subscriptionId: activeSub.id,
          usedBytes: activeSub.used_traffic_bytes,
          nextUsageBytes: nextUsage,
          limitBytes: activeSub.traffic_limit_bytes,
          billableDeltaBytes: billableDelta,
          billingMode: activeSub.traffic_billing_mode,
        })
      } else if (delta > 0) {
        updateSubUsage.run(nextUsage, activeSub.id)
        subscriptionTxDelta += deltaTx
        subscriptionRxDelta += deltaRx
        upsertSubscriptionHourly.run(activeSub.id, deltaTx, deltaRx)
        processed++
        agentUserLogs.push({
          ...baseUserLog,
          success: true,
          reason: "OK",
          detail: counterReset
            ? stringifyDetail({ counter_reset: true })
            : null,
        })
      } else {
        processed++
        agentUserLogs.push({
          ...baseUserLog,
          success: true,
          reason: "OK",
          detail: counterReset
            ? stringifyDetail({ counter_reset: true })
            : null,
        })
      }

      upsertLast.run(node.id, user.id, stat.tx, stat.rx)
    }

    // 全局/节点/宿主机统计按 Agent 原始快照差值累计，避免漏掉无订阅或已封禁但仍在跑的真实节点流量。
    // 订阅用量仍只在上面的有效订阅分支中按套餐计费口径累计。
    if (nodeTxDelta > 0 || nodeRxDelta > 0) {
      upsertHourlyStats.run(nodeTxDelta, nodeRxDelta)
      upsertNodeHourly.run(node.id, nodeTxDelta, nodeRxDelta)
      const hostUsage = addNodeHostTrafficUsage(
        db,
        node.id,
        nodeTxDelta,
        nodeRxDelta
      )
      if (hostUsage?.crossedLimit) {
        markNotificationState(db, {
          event: "HOST_TRAFFIC_EXCEEDED",
          subjectType: "node_host_traffic",
          subjectId: node.id,
          state: "ok",
          detail: {
            node_id: node.id,
            node_name: node.name,
            host_traffic_used_bytes: hostUsage.beforeUsedBytes,
            host_traffic_limit_bytes: hostUsage.limitBytes,
          },
        })
        enqueueHostTrafficExceededNotification(db, {
          nodeId: node.id,
          nodeName: node.name,
          usedBytes: hostUsage.beforeUsedBytes,
          nextUsageBytes: hostUsage.afterUsedBytes,
          limitBytes: hostUsage.limitBytes,
          deltaBytes: hostUsage.deltaBytes,
          billingMode: hostUsage.billingMode,
        })
      } else if (
        hostUsage &&
        hostUsage.limitBytes > 0 &&
        !hostUsage.overLimit
      ) {
        markNotificationState(db, {
          event: "HOST_TRAFFIC_EXCEEDED",
          subjectType: "node_host_traffic",
          subjectId: node.id,
          state: "ok",
          detail: {
            node_id: node.id,
            node_name: node.name,
            host_traffic_used_bytes: hostUsage.afterUsedBytes,
            host_traffic_limit_bytes: hostUsage.limitBytes,
          },
        })
      }
    } else {
      ensureNodeHostTrafficPeriod(db, node.id)
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
      totalOnlineCount,
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
    writeAuthLogSafely({
      node_id: node.id,
      node_name: node.name,
      user_id: null,
      username: null,
      ip,
      success: false,
      reason: "BAD_PAYLOAD",
    })
    writeAgentTrafficLogsSafely({
      report: {
        node_id: node.id,
        node_name: node.name,
        auth_path: authPath,
        ip,
        success: false,
        reason: "INTERNAL",
        reported_users: traffic.size,
        online_count: totalOnlineCount,
        total_tx_bytes: totalTxBytes,
        total_rx_bytes: totalRxBytes,
        delta_tx_bytes: 0,
        delta_rx_bytes: 0,
      },
    })
    return localizedJson(
      request,
      { ok: false, error: { code: "INTERNAL", message: "处理失败" } },
      { status: 500 }
    )
  }

  writeAgentTrafficLogsSafely({
    report: {
      node_id: node.id,
      node_name: node.name,
      auth_path: authPath,
      ip,
      success: true,
      reason: "OK",
      reported_users: traffic.size,
      online_count: totalOnlineCount,
      total_tx_bytes: totalTxBytes,
      total_rx_bytes: totalRxBytes,
      delta_tx_bytes: nodeTxDelta,
      delta_rx_bytes: nodeRxDelta,
      detail: stringifyDetail({
        processed,
        skipped,
        blocked,
        node_delta_users: nodeDeltaUsers,
        node_counter_reset_users: nodeCounterResetUsers,
        node_snapshot_fallback_users: nodeSnapshotFallbackUsers,
        subscription_delta_tx_bytes: subscriptionTxDelta,
        subscription_delta_rx_bytes: subscriptionRxDelta,
      }),
    },
    userLogs: agentUserLogs,
  })

  void processNotificationOutboxSafely(db)

  return localizedJson(request, {
    ok: true,
    data: { processed, skipped, blocked },
  })
}
