import { localizedJson } from "@/lib/i18n/api-response"

import { requireAdmin } from "@/lib/auth"
import {
  cleanupExpiredLogsBySetting,
  getLogsDb,
  maskAuthPath,
} from "@/lib/logs-db"

// 分页参数上限，防止一次拉太多
const MAX_PAGE_SIZE = 200
const DEFAULT_PAGE_SIZE = 50

type AgentTrafficReportRow = {
  id: number
  created_at: string
  node_id: number | null
  node_name: string | null
  auth_path: string
  ip: string | null
  success: 0 | 1
  reason: string
  reported_users: number
  online_count: number
  total_tx_bytes: number
  total_rx_bytes: number
  delta_tx_bytes: number
  delta_rx_bytes: number
  agent_version: string | null
  detail: string | null
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  cleanupExpiredLogsBySetting(true)

  const url = new URL(request.url)
  const successParam = url.searchParams.get("success")
  const username = url.searchParams.get("username")?.trim()
  const nodeName = url.searchParams.get("nodeName")?.trim()
  const reason = url.searchParams.get("reason")?.trim()

  // 按条件拼 WHERE，全部可选；username 走明细表 EXISTS 避免 report 重复计数
  const conditions: string[] = []
  const values: Array<string | number> = []

  if (successParam === "1" || successParam === "0") {
    conditions.push("r.success = ?")
    values.push(Number(successParam))
  }

  if (username) {
    conditions.push(
      `EXISTS (
        SELECT 1 FROM agent_traffic_user_logs ul
        WHERE ul.report_id = r.id AND ul.username LIKE ?
      )`
    )
    values.push(`%${username}%`)
  }

  if (nodeName) {
    conditions.push("r.node_name LIKE ?")
    values.push(`%${nodeName}%`)
  }

  if (reason && reason !== "all") {
    conditions.push("r.reason = ?")
    values.push(reason)
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
    .prepare(`SELECT COUNT(*) AS c FROM agent_traffic_reports r ${whereClause}`)
    .get(...values) as { c: number } | undefined
  const total = countRow?.c ?? 0

  const rows = db
    .prepare(
      `SELECT id, created_at, node_id, node_name, auth_path, ip, success, reason,
              reported_users, online_count, total_tx_bytes, total_rx_bytes,
              delta_tx_bytes, delta_rx_bytes, agent_version, detail
       FROM agent_traffic_reports r
       ${whereClause}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...values, pageSize, offset) as AgentTrafficReportRow[]

  return localizedJson(request, {
    ok: true,
    data: {
      rows: rows.map((row) => ({
        ...row,
        auth_path: maskAuthPath(row.auth_path),
      })),
      total,
      page,
      pageSize,
    },
  })
}
