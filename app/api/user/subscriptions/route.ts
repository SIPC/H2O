import { NextResponse } from "next/server"

import { requireUser } from "@/lib/auth"
import { getDb } from "@/lib/db"

export async function GET(request: Request) {
  const auth = requireUser(request)
  if (!auth.ok) return auth.response

  const db = getDb()
  const rows = db
    .prepare(
      `SELECT s.id, s.start_time, s.expire_time, s.used_traffic_bytes, s.status,
              p.name AS plan_name, p.traffic_limit_bytes, p.duration_days
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = ?
       ORDER BY s.expire_time DESC`
    )
    .all(auth.user.id)

  return NextResponse.json({ ok: true, data: rows })
}
