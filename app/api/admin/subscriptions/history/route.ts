import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"

type HistoryRow = {
  subscription_id: number
  bucket_hour: number
  tx_bytes: number
  rx_bytes: number
}

type HourPoint = {
  hour: number
  label: string
  txBytes: number
  rxBytes: number
}

const MAX_IDS = 200
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function buildEmptyHourly(): HourPoint[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: String(hour).padStart(2, "0"),
    txBytes: 0,
    rxBytes: 0,
  }))
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

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const url = new URL(request.url)

  // ids: 逗号分隔的订阅 ID 列表，如 ?ids=12,13,22
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

  // date: 可选 yyyy-mm-dd，默认按服务器本地时区“今天”
  const dateParam = url.searchParams.get("date")?.trim() ?? ""
  if (dateParam && !DATE_RE.test(dateParam)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_DATE",
          message: "date 参数格式不合法，应为 yyyy-mm-dd",
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

  const date = dateParam || nowRow?.local_date || ""
  const currentLocalHour =
    typeof nowRow?.local_hour === "number" && Number.isFinite(nowRow.local_hour)
      ? Math.min(23, Math.max(0, Math.floor(nowRow.local_hour)))
      : 0

  const placeholders = ids.map(() => "?").join(", ")
  const rows = db
    .prepare(
      `SELECT subscription_id, bucket_hour, tx_bytes, rx_bytes
       FROM subscription_hourly_traffic
       WHERE bucket_date = ?
         AND subscription_id IN (${placeholders})
       ORDER BY subscription_id ASC, bucket_hour ASC`
    )
    .all(date, ...ids) as HistoryRow[]

  const hourlyById = new Map<number, HourPoint[]>()
  for (const id of ids) hourlyById.set(id, buildEmptyHourly())

  for (const row of rows) {
    const hourly = hourlyById.get(row.subscription_id)
    if (!hourly) continue
    if (
      !Number.isFinite(row.bucket_hour) ||
      row.bucket_hour < 0 ||
      row.bucket_hour > 23
    ) {
      continue
    }

    const hour = Math.floor(row.bucket_hour)
    hourly[hour] = {
      hour,
      label: String(hour).padStart(2, "0"),
      txBytes: Math.max(0, Math.floor(row.tx_bytes ?? 0)),
      rxBytes: Math.max(0, Math.floor(row.rx_bytes ?? 0)),
    }
  }

  const items = ids.map((subscriptionId) => {
    const hourly = hourlyById.get(subscriptionId) ?? buildEmptyHourly()
    const todayTxBytes = hourly.reduce((sum, p) => sum + p.txBytes, 0)
    const todayRxBytes = hourly.reduce((sum, p) => sum + p.rxBytes, 0)
    return {
      subscriptionId,
      todayTxBytes,
      todayRxBytes,
      hourly,
    }
  })

  return NextResponse.json({
    ok: true,
    data: {
      date,
      currentLocalHour,
      items,
    },
  })
}
