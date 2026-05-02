import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { cleanupExpiredLogsBySetting, getLogsDb } from "@/lib/logs-db"

// 分页参数上限，防止一次拉太多
const MAX_PAGE_SIZE = 200
const DEFAULT_PAGE_SIZE = 50

// 白名单事件类型，非白名单值当作无筛选
const VALID_EVENTS = new Set([
  "LOGIN",
  "REGISTER",
  "LOGOUT",
  "RESET_TOKEN_SELF",
  "RESET_TOKEN_ADMIN",
  "BOOTSTRAP_ADMIN",
  "USER_CREATE",
  "USER_UPDATE",
  "USER_DELETE",
  "NODE_CREATE",
  "NODE_UPDATE",
  "NODE_DELETE",
  "PLAN_CREATE",
  "PLAN_UPDATE",
  "PLAN_DELETE",
  "SUBSCRIPTION_CREATE",
  "SUBSCRIPTION_UPDATE",
  "SUBSCRIPTION_DELETE",
  "SUBSCRIPTION_FETCH",
  "SETTINGS_UPDATE",
])

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  cleanupExpiredLogsBySetting(true)

  const url = new URL(request.url)
  const successParam = url.searchParams.get("success")
  const username = url.searchParams.get("username")?.trim()
  const eventParam = url.searchParams.get("event")?.trim()

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

  if (eventParam && VALID_EVENTS.has(eventParam)) {
    conditions.push("event = ?")
    values.push(eventParam)
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : ""

  // 解析分页：page 从 1 起，非法值回落为默认
  const pageRaw = Number(url.searchParams.get("page") ?? "1")
  const pageSizeRaw = Number(
    url.searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE
  )
  const pageSize = Number.isFinite(pageSizeRaw)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSizeRaw)))
    : DEFAULT_PAGE_SIZE
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1
  const offset = (page - 1) * pageSize

  const db = getLogsDb()
  const countRow = db
    .prepare(`SELECT COUNT(*) AS c FROM event_logs ${whereClause}`)
    .get(...values) as { c: number } | undefined
  const total = countRow?.c ?? 0

  const rows = db
    .prepare(
      `SELECT id, created_at, event, user_id, username, ip, success, reason, detail
       FROM event_logs
       ${whereClause}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...values, pageSize, offset)

  return NextResponse.json({ ok: true, data: { rows, total, page, pageSize } })
}
