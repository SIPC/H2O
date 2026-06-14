import { localizedJson } from "@/lib/i18n/api-response"

import { requireAdmin } from "@/lib/auth"
import { cleanupExpiredLogsBySetting, getLogsDb } from "@/lib/logs-db"

const MAX_PAGE_SIZE = 200
const DEFAULT_PAGE_SIZE = 50

const VALID_CHANNELS = new Set(["telegram", "system"])
const VALID_LEVELS = new Set(["info", "success", "warning", "error"])
const VALID_EVENTS = new Set([
  "NODE_STATUS",
  "HY2_STATUS",
  "SUBSCRIPTION_TRAFFIC_EXCEEDED",
  "HOST_TRAFFIC_EXCEEDED",
  "AGENT_TASK_FAILED",
  "TEST",
])

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  cleanupExpiredLogsBySetting(true)

  const url = new URL(request.url)
  const channel = url.searchParams.get("channel")?.trim()
  const level = url.searchParams.get("level")?.trim()
  const event = url.searchParams.get("event")?.trim()
  const successParam = url.searchParams.get("success")
  const query = url.searchParams.get("q")?.trim().slice(0, 128)

  const conditions: string[] = []
  const values: Array<string | number> = []

  if (channel && VALID_CHANNELS.has(channel)) {
    conditions.push("channel = ?")
    values.push(channel)
  }

  if (level && VALID_LEVELS.has(level)) {
    conditions.push("level = ?")
    values.push(level)
  }

  if (event && VALID_EVENTS.has(event)) {
    conditions.push("event = ?")
    values.push(event)
  }

  if (successParam === "1" || successParam === "0") {
    conditions.push("success = ?")
    values.push(Number(successParam))
  }

  if (query) {
    const like = `%${query}%`
    conditions.push(
      `(title LIKE ? OR message LIKE ? OR target LIKE ? OR subject_type LIKE ? OR subject_id LIKE ? OR reason LIKE ?)`
    )
    values.push(like, like, like, like, like, like)
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : ""

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
    .prepare(`SELECT COUNT(*) AS c FROM notification_logs ${whereClause}`)
    .get(...values) as { c: number } | undefined
  const total = countRow?.c ?? 0

  const rows = db
    .prepare(
      `SELECT id, created_at, channel, event, level, title, message, target,
              subject_type, subject_id, success, reason, detail
       FROM notification_logs
       ${whereClause}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...values, pageSize, offset)

  return localizedJson(request, {
    ok: true,
    data: { rows, total, page, pageSize },
  })
}
