import { localizedJson } from "@/lib/i18n/api-response"

import { isAgentTaskType, markTimedOutAgentTasks } from "@/lib/agent-control"
import { AGENT_TASK_TIMEOUT_ERROR } from "@/lib/agent-task-timeout"
import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"

const MAX_PAGE_SIZE = 200
const DEFAULT_PAGE_SIZE = 50

const VALID_STATUSES = new Set([
  "queued",
  "claimed",
  "succeeded",
  "failed",
  "cancelled",
  "timeout",
])

type AgentTaskRow = {
  id: number
  node_id: number
  node_name: string | null
  type: string
  payload: string | null
  status: string
  result: string | null
  error: string | null
  created_by: number | null
  created_by_username: string | null
  created_at: string
  claimed_at: string | null
  lease_expires_at: string | null
  finished_at: string | null
  updated_at: string
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const status = url.searchParams.get("status")?.trim()
  const type = url.searchParams.get("type")?.trim()
  const nodeName = url.searchParams.get("nodeName")?.trim()

  const conditions: string[] = []
  const values: Array<string | number> = []

  if (status && status !== "all" && VALID_STATUSES.has(status)) {
    if (status === "timeout") {
      conditions.push("t.status = 'failed' AND t.error = ?")
      values.push(AGENT_TASK_TIMEOUT_ERROR)
    } else {
      conditions.push("t.status = ?")
      values.push(status)
    }
  }

  if (type && type !== "all" && isAgentTaskType(type)) {
    conditions.push("t.type = ?")
    values.push(type)
  }

  if (nodeName) {
    conditions.push("n.name LIKE ?")
    values.push(`%${nodeName}%`)
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

  const db = getDb()
  markTimedOutAgentTasks({ database: db })

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM node_agent_tasks t
       LEFT JOIN nodes n ON n.id = t.node_id
       ${whereClause}`
    )
    .get(...values) as { c: number } | undefined
  const total = countRow?.c ?? 0

  const rows = db
    .prepare(
      `SELECT t.id, t.node_id, n.name AS node_name, t.type, t.payload, t.status,
              t.result, t.error, t.created_by, u.username AS created_by_username,
              t.created_at, t.claimed_at, t.lease_expires_at,
              t.finished_at, t.updated_at
       FROM node_agent_tasks t
       LEFT JOIN nodes n ON n.id = t.node_id
       LEFT JOIN users u ON u.id = t.created_by
       ${whereClause}
       ORDER BY t.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...values, pageSize, offset) as AgentTaskRow[]

  return localizedJson(request, {
    ok: true,
    data: { rows, total, page, pageSize },
  })
}
