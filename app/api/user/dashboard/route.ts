import { localizedJson } from "@/lib/i18n/api-response"

import { requireUser } from "@/lib/auth"
import { getDb } from "@/lib/db"

type RollingRow = {
  idx: number
  bucket_date: string
  bucket_hour: number
  tx_bytes: number | null
  rx_bytes: number | null
}

// 合并 dashboard 页面所需的全部数据为单次请求
export async function GET(request: Request) {
  const auth = requireUser(request)
  if (!auth.ok) return auth.response

  const db = getDb()

  // --- 订阅路径 ---
  const userRow = db
    .prepare(`SELECT auth_token FROM users WHERE id = ? LIMIT 1`)
    .get(auth.user.id) as { auth_token: string } | undefined

  if (!userRow) {
    return localizedJson(
      request,
      { ok: false, error: { code: "NOT_FOUND", message: "用户不存在" } },
      { status: 404 }
    )
  }

  // --- 订阅列表（含续订信息） ---
  const subscriptions = db
    .prepare(
      `SELECT s.id, s.start_time, s.expire_time, s.used_traffic_bytes, s.status,
              s.renewal_anchor, p.name AS plan_name, p.traffic_limit_bytes,
              p.traffic_billing_mode, p.duration_days, p.auto_renew, p.renewal_period_days
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = ?
       ORDER BY s.expire_time DESC`
    )
    .all(auth.user.id)

  // --- 流量概览 ---
  const nowRow = db
    .prepare(
      `SELECT
         date('now', 'localtime') AS local_date,
         CAST(strftime('%H', 'now', 'localtime') AS INTEGER) AS local_hour`
    )
    .get() as { local_date: string; local_hour: number } | undefined

  const localDate = nowRow?.local_date ?? ""
  const localHour =
    typeof nowRow?.local_hour === "number" && Number.isFinite(nowRow.local_hour)
      ? Math.min(23, Math.max(0, Math.floor(nowRow.local_hour)))
      : 0

  const rollingRows = db
    .prepare(
      `WITH RECURSIVE seq(i) AS (
         SELECT 0
         UNION ALL
         SELECT i + 1 FROM seq WHERE i < 23
       )
       SELECT
         seq.i AS idx,
         date('now', 'localtime', printf('-%d hours', 23 - seq.i)) AS bucket_date,
         CAST(
           strftime('%H', 'now', 'localtime', printf('-%d hours', 23 - seq.i))
           AS INTEGER
         ) AS bucket_hour,
         agg.tx_bytes AS tx_bytes,
         agg.rx_bytes AS rx_bytes
       FROM seq
       LEFT JOIN (
         SELECT
           sht.bucket_date,
           sht.bucket_hour,
           SUM(sht.tx_bytes) AS tx_bytes,
           SUM(sht.rx_bytes) AS rx_bytes
         FROM subscription_hourly_traffic sht
         JOIN subscriptions s ON s.id = sht.subscription_id
         WHERE s.user_id = ?
         GROUP BY sht.bucket_date, sht.bucket_hour
       ) agg
         ON agg.bucket_date = date('now', 'localtime', printf('-%d hours', 23 - seq.i))
        AND agg.bucket_hour = CAST(
          strftime('%H', 'now', 'localtime', printf('-%d hours', 23 - seq.i))
          AS INTEGER
        )
       ORDER BY seq.i ASC`
    )
    .all(auth.user.id) as RollingRow[]

  const hourly = rollingRows.map((row) => {
    const hour =
      typeof row.bucket_hour === "number" && Number.isFinite(row.bucket_hour)
        ? Math.min(23, Math.max(0, Math.floor(row.bucket_hour)))
        : 0

    const txBytes =
      typeof row.tx_bytes === "number" && Number.isFinite(row.tx_bytes)
        ? Math.max(0, Math.floor(row.tx_bytes))
        : 0
    const rxBytes =
      typeof row.rx_bytes === "number" && Number.isFinite(row.rx_bytes)
        ? Math.max(0, Math.floor(row.rx_bytes))
        : 0

    return {
      index:
        typeof row.idx === "number" && Number.isFinite(row.idx)
          ? Math.min(23, Math.max(0, Math.floor(row.idx)))
          : 0,
      bucketDate: row.bucket_date ?? "",
      hour,
      label: String(hour).padStart(2, "0"),
      txBytes,
      rxBytes,
    }
  })

  const todaySum = db
    .prepare(
      `SELECT
         COALESCE(SUM(sht.tx_bytes), 0) AS tx,
         COALESCE(SUM(sht.rx_bytes), 0) AS rx
       FROM subscription_hourly_traffic sht
       JOIN subscriptions s ON s.id = sht.subscription_id
       WHERE s.user_id = ?
         AND sht.bucket_date = date('now', 'localtime')`
    )
    .get(auth.user.id) as { tx: number; rx: number } | undefined

  const todayTxBytes =
    typeof todaySum?.tx === "number" && Number.isFinite(todaySum.tx)
      ? Math.max(0, Math.floor(todaySum.tx))
      : 0
  const todayRxBytes =
    typeof todaySum?.rx === "number" && Number.isFinite(todaySum.rx)
      ? Math.max(0, Math.floor(todaySum.rx))
      : 0

  const yesterdaySum = db
    .prepare(
      `SELECT
         COALESCE(SUM(sht.tx_bytes), 0) AS tx,
         COALESCE(SUM(sht.rx_bytes), 0) AS rx
       FROM subscription_hourly_traffic sht
       JOIN subscriptions s ON s.id = sht.subscription_id
       WHERE s.user_id = ?
         AND sht.bucket_date = date('now', 'localtime', '-1 day')`
    )
    .get(auth.user.id) as { tx: number; rx: number } | undefined

  const yesterdayTxBytes =
    typeof yesterdaySum?.tx === "number" && Number.isFinite(yesterdaySum.tx)
      ? Math.max(0, Math.floor(yesterdaySum.tx))
      : 0
  const yesterdayRxBytes =
    typeof yesterdaySum?.rx === "number" && Number.isFinite(yesterdaySum.rx)
      ? Math.max(0, Math.floor(yesterdaySum.rx))
      : 0

  return localizedJson(request, {
    ok: true,
    data: {
      subscriptionPath: `/api/sub?token=${encodeURIComponent(userRow.auth_token)}`,
      subscriptions,
      traffic: {
        date: localDate,
        localHour,
        todayTxBytes,
        todayRxBytes,
        yesterdayTxBytes,
        yesterdayRxBytes,
        hourly,
      },
    },
  })
}
