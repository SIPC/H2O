import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import {
  cleanupExpiredLogsBySetting,
  getLogsDb,
  maskAuthPath,
} from "@/lib/logs-db"

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

type AgentTrafficUserLogRow = {
  id: number
  report_id: number
  created_at: string
  node_id: number | null
  node_name: string | null
  user_id: number | null
  username: string
  reported_tx_bytes: number
  reported_rx_bytes: number
  last_tx_bytes: number | null
  last_rx_bytes: number | null
  delta_tx_bytes: number
  delta_rx_bytes: number
  online_count: number
  subscription_id: number | null
  success: 0 | 1
  reason: string
  detail: string | null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  cleanupExpiredLogsBySetting(true)

  const { id } = await params
  const reportId = Number(id)
  if (!Number.isInteger(reportId) || reportId <= 0) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_ID", message: "上报日志ID不合法" } },
      { status: 400 }
    )
  }

  const db = getLogsDb()
  const report = db
    .prepare(
      `SELECT id, created_at, node_id, node_name, auth_path, ip, success, reason,
              reported_users, online_count, total_tx_bytes, total_rx_bytes,
              delta_tx_bytes, delta_rx_bytes, agent_version, detail
       FROM agent_traffic_reports
       WHERE id = ?
       LIMIT 1`
    )
    .get(reportId) as AgentTrafficReportRow | undefined

  if (!report) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "上报日志不存在" } },
      { status: 404 }
    )
  }

  const userLogs = db
    .prepare(
      `SELECT id, report_id, created_at, node_id, node_name, user_id, username,
              reported_tx_bytes, reported_rx_bytes, last_tx_bytes, last_rx_bytes,
              delta_tx_bytes, delta_rx_bytes, online_count, subscription_id,
              success, reason, detail
       FROM agent_traffic_user_logs
       WHERE report_id = ?
       ORDER BY id ASC`
    )
    .all(reportId) as AgentTrafficUserLogRow[]

  return NextResponse.json({
    ok: true,
    data: {
      report: { ...report, auth_path: maskAuthPath(report.auth_path) },
      userLogs,
    },
  })
}
