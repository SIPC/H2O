import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"

type RollingRow = {
  node_id: number
  idx: number
  bucket_date: string
  bucket_hour: number
  tx_bytes: number | null
  rx_bytes: number | null
}

type TodayAggRow = {
  node_id: number
  tx: number
  rx: number
}

type HourPoint = {
  index: number
  bucketDate: string
  hour: number
  label: string
  txBytes: number
  rxBytes: number
  totalBytes: number
}

const MAX_IDS = 200

function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0
  return Math.min(23, Math.max(0, Math.floor(hour)))
}

function parseIds(raw: string | null): number[] | null {
  if (!raw) return null

  const uniq = new Set<number>()
  for (const part of raw.split(",")) {
    const n = Number(part.trim())
    if (!Number.isInteger(n) || n <= 0) return null
    uniq.add(n)
  }

  const ids = Array.from(uniq)
  if (ids.length === 0 || ids.length > MAX_IDS) return null
  return ids
}

// 兜底：极端异常时返回本地时区的滚动 24 小时空序列
function buildFallbackRolling(): HourPoint[] {
  const out: HourPoint[] = []
  const now = new Date()

  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getTime() - (23 - i) * 3600 * 1000)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    const hour = d.getHours()

    out.push({
      index: i,
      bucketDate: `${year}-${month}-${day}`,
      hour,
      label: String(hour).padStart(2, "0"),
      txBytes: 0,
      rxBytes: 0,
      totalBytes: 0,
    })
  }

  return out
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const ids = parseIds(url.searchParams.get("ids"))

  if (!ids) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_PAYLOAD",
          message: `ids 参数不合法（1~${MAX_IDS} 个正整数）`,
        },
      },
      { status: 400 }
    )
  }

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
      ? clampHour(nowRow.local_hour)
      : 0

  const valuesSql = ids.map(() => "(?)").join(", ")
  const inSql = ids.map(() => "?").join(", ")

  // 返回滚动 24 小时（最早 -> 最新），跨天自动拼接
  const rollingRows = db
    .prepare(
      `WITH RECURSIVE seq(i) AS (
         SELECT 0
         UNION ALL
         SELECT i + 1 FROM seq WHERE i < 23
       ),
       node_ids(id) AS (
         VALUES ${valuesSql}
       )
       SELECT
         node_ids.id AS node_id,
         seq.i AS idx,
         date('now', 'localtime', printf('-%d hours', 23 - seq.i)) AS bucket_date,
         CAST(
           strftime('%H', 'now', 'localtime', printf('-%d hours', 23 - seq.i))
           AS INTEGER
         ) AS bucket_hour,
         nht.tx_bytes AS tx_bytes,
         nht.rx_bytes AS rx_bytes
       FROM node_ids
       CROSS JOIN seq
       LEFT JOIN node_hourly_traffic nht
         ON nht.node_id = node_ids.id
        AND nht.bucket_date = date('now', 'localtime', printf('-%d hours', 23 - seq.i))
        AND nht.bucket_hour = CAST(
          strftime('%H', 'now', 'localtime', printf('-%d hours', 23 - seq.i))
          AS INTEGER
        )
       ORDER BY node_ids.id ASC, seq.i ASC`
    )
    .all(...ids) as RollingRow[]

  // 今日累计（卡片数字/统计用途）
  const todayRows = db
    .prepare(
      `SELECT
         node_id,
         COALESCE(SUM(tx_bytes), 0) AS tx,
         COALESCE(SUM(rx_bytes), 0) AS rx
       FROM node_hourly_traffic
       WHERE bucket_date = date('now', 'localtime')
         AND node_id IN (${inSql})
       GROUP BY node_id`
    )
    .all(...ids) as TodayAggRow[]

  const todayByNode = new Map<number, { tx: number; rx: number }>()
  for (const row of todayRows) {
    todayByNode.set(row.node_id, {
      tx: Math.max(0, Math.floor(row.tx ?? 0)),
      rx: Math.max(0, Math.floor(row.rx ?? 0)),
    })
  }

  const hourlyByNode = new Map<number, HourPoint[]>()
  for (const id of ids) hourlyByNode.set(id, [])

  for (const row of rollingRows) {
    const list = hourlyByNode.get(row.node_id)
    if (!list) continue

    const idx =
      typeof row.idx === "number" && Number.isFinite(row.idx)
        ? Math.min(23, Math.max(0, Math.floor(row.idx)))
        : 0
    const hour =
      typeof row.bucket_hour === "number" && Number.isFinite(row.bucket_hour)
        ? clampHour(row.bucket_hour)
        : 0
    const txBytes =
      typeof row.tx_bytes === "number" && Number.isFinite(row.tx_bytes)
        ? Math.max(0, Math.floor(row.tx_bytes))
        : 0
    const rxBytes =
      typeof row.rx_bytes === "number" && Number.isFinite(row.rx_bytes)
        ? Math.max(0, Math.floor(row.rx_bytes))
        : 0

    list.push({
      index: idx,
      bucketDate: row.bucket_date ?? "",
      hour,
      label: String(hour).padStart(2, "0"),
      txBytes,
      rxBytes,
      totalBytes: txBytes + rxBytes,
    })
  }

  const items = ids.map((nodeId) => {
    const rolling = hourlyByNode.get(nodeId) ?? []
    const hourly = rolling.length === 24 ? rolling : buildFallbackRolling()
    const today = todayByNode.get(nodeId) ?? { tx: 0, rx: 0 }

    return {
      nodeId,
      todayTxBytes: today.tx,
      todayRxBytes: today.rx,
      todayTotalBytes: today.tx + today.rx,
      hourly,
    }
  })

  return NextResponse.json({
    ok: true,
    data: {
      date: localDate,
      localHour,
      // 兼容旧前端字段：固定 23，避免“按小时截断”导致跨天只剩 1 个点
      currentLocalHour: 23,
      currentRollingIndex: 23,
      windowHours: 24,
      items,
    },
  })
}
