import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"

type HourlyRow = {
  bucket_hour: number
  tx_bytes: number
  rx_bytes: number
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const db = getDb()

  const todayRow = db.prepare(`SELECT date('now', 'localtime') AS d`).get() as
    | { d: string }
    | undefined
  const date = todayRow?.d ?? ""

  const hourRow = db
    .prepare(`SELECT CAST(strftime('%H', 'now', 'localtime') AS INTEGER) AS h`)
    .get() as { h: number } | undefined
  const currentLocalHour =
    typeof hourRow?.h === "number" && Number.isFinite(hourRow.h)
      ? Math.min(23, Math.max(0, Math.floor(hourRow.h)))
      : 0

  const rows = db
    .prepare(
      `SELECT bucket_hour, tx_bytes, rx_bytes
       FROM traffic_hourly_stats
       WHERE bucket_date = date('now', 'localtime')
       ORDER BY bucket_hour ASC`
    )
    .all() as HourlyRow[]

  const hourlyMap = new Map<number, { txBytes: number; rxBytes: number }>()
  for (const row of rows) {
    if (
      Number.isFinite(row.bucket_hour) &&
      row.bucket_hour >= 0 &&
      row.bucket_hour <= 23
    ) {
      hourlyMap.set(row.bucket_hour, {
        txBytes: Math.max(0, Math.floor(row.tx_bytes ?? 0)),
        rxBytes: Math.max(0, Math.floor(row.rx_bytes ?? 0)),
      })
    }
  }

  let todayTxBytes = 0
  let todayRxBytes = 0

  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const stat = hourlyMap.get(hour) ?? { txBytes: 0, rxBytes: 0 }
    todayTxBytes += stat.txBytes
    todayRxBytes += stat.rxBytes

    return {
      hour,
      label: String(hour).padStart(2, "0"),
      txBytes: stat.txBytes,
      rxBytes: stat.rxBytes,
    }
  })

  return NextResponse.json({
    ok: true,
    data: {
      date,
      currentLocalHour,
      todayTxBytes,
      todayRxBytes,
      hourly,
    },
  })
}
