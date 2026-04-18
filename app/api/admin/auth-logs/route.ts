import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getLogsDb } from "@/lib/logs-db"

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const successParam = url.searchParams.get("success")
  const username = url.searchParams.get("username")?.trim()
  const nodeName = url.searchParams.get("nodeName")?.trim()

  // 按条件拼 WHERE，全部可选，不带参数即返回最近 500 条
  const conditions: string[] = []
  const values: Array<string | number> = []

  if (successParam === "1" || successParam === "0") {
    conditions.push("success = ?")
    values.push(Number(successParam))
  }

  if (username) {
    conditions.push("username LIKE ?")
    values.push(`%${username}%`)
  }

  if (nodeName) {
    conditions.push("node_name LIKE ?")
    values.push(`%${nodeName}%`)
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""

  const db = getLogsDb()
  const rows = db
    .prepare(
      `SELECT id, created_at, node_id, node_name, user_id, username, ip, success, reason
       FROM auth_logs
       ${whereClause}
       ORDER BY id DESC
       LIMIT 500`,
    )
    .all(...values)

  return NextResponse.json({ ok: true, data: rows })
}
