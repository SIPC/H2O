import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"

type RollingRow = {
  idx: number
  bucket_date: string
  bucket_hour: number
  tx_bytes: number | null
  rx_bytes: number | null
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const db = getDb()

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

  // 滚动 24 小时序列（从最早到最新），跨天时自动衔接昨天与今天
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
         nht.tx_bytes AS tx_bytes,
         nht.rx_bytes AS rx_bytes
       FROM seq
       LEFT JOIN traffic_hourly_stats nht
         ON nht.bucket_date = date('now', 'localtime', printf('-%d hours', 23 - seq.i))
        AND nht.bucket_hour = CAST(
          strftime('%H', 'now', 'localtime', printf('-%d hours', 23 - seq.i))
          AS INTEGER
        )
       ORDER BY seq.i ASC`
    )
    .all() as RollingRow[]

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

  // 今日累计（用于顶部总量数字）
  const todaySum = db
    .prepare(
      `SELECT
         COALESCE(SUM(tx_bytes), 0) AS tx,
         COALESCE(SUM(rx_bytes), 0) AS rx
       FROM traffic_hourly_stats
       WHERE bucket_date = date('now', 'localtime')`
    )
    .get() as { tx: number; rx: number } | undefined

  const todayTxBytes =
    typeof todaySum?.tx === "number" && Number.isFinite(todaySum.tx)
      ? Math.max(0, Math.floor(todaySum.tx))
      : 0
  const todayRxBytes =
    typeof todaySum?.rx === "number" && Number.isFinite(todaySum.rx)
      ? Math.max(0, Math.floor(todaySum.rx))
      : 0

  return NextResponse.json({
    ok: true,
    data: {
      date: localDate,
      localHour,
      // 兼容旧前端：旧逻辑会按 currentLocalHour 截断，固定为 23 可始终显示完整 24 点
      currentLocalHour: 23,
      currentRollingIndex: 23,
      windowHours: 24,
      todayTxBytes,
      todayRxBytes,
      hourly,
    },
  })
}
