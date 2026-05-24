import { NextResponse } from "next/server"

import {
  buildNodeDesiredConfig,
  detectOrigin,
  markTimedOutAgentTasks,
} from "@/lib/agent-control"
import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const { id } = await params
  const nodeId = Number(id)
  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    return jsonError("INVALID_ID", "节点ID不合法", 400)
  }

  const db = getDb()
  const node = db
    .prepare(
      `SELECT id, name, auth_path, agent_control_enabled, agent_config_revision,
              agent_desired_config_hash, agent_last_config_built_at,
              agent_interval, agent_auto_update_enabled, hy2_auto_update_enabled
       FROM nodes
       WHERE id = ?
       LIMIT 1`
    )
    .get(nodeId) as
    | {
        id: number
        name: string
        auth_path: string
        agent_control_enabled: 0 | 1 | null
        agent_config_revision: number | null
        agent_desired_config_hash: string | null
        agent_last_config_built_at: string | null
        agent_interval: number | null
        agent_auto_update_enabled: 0 | 1 | null
        hy2_auto_update_enabled: 0 | 1 | null
      }
    | undefined

  if (!node) return jsonError("NOT_FOUND", "节点不存在", 404)

  const desired = buildNodeDesiredConfig({
    nodeId,
    panelUrl: detectOrigin(request),
    database: db,
  })

  const state = db
    .prepare(`SELECT * FROM node_agent_state WHERE node_id = ? LIMIT 1`)
    .get(nodeId)

  markTimedOutAgentTasks({ database: db, nodeId })

  const recentTasks = db
    .prepare(
      `SELECT id, type, status, payload, result, error,
              created_by, created_at, claimed_at, lease_expires_at,
              finished_at, updated_at
       FROM node_agent_tasks
       WHERE node_id = ?
       ORDER BY id DESC
       LIMIT 10`
    )
    .all(nodeId)

  return NextResponse.json({
    ok: true,
    data: {
      node: {
        id: node.id,
        name: node.name,
        auth_path: node.auth_path,
        agent_control_enabled: node.agent_control_enabled !== 0,
        agent_config_revision: node.agent_config_revision ?? 1,
        agent_desired_config_hash:
          desired?.hy2ConfigHash ?? node.agent_desired_config_hash,
        agent_last_config_built_at: node.agent_last_config_built_at,
        agent_interval: node.agent_interval ?? 120,
        agent_auto_update_enabled: node.agent_auto_update_enabled !== 0,
        hy2_auto_update_enabled: node.hy2_auto_update_enabled !== 0,
      },
      desired_config: desired
        ? {
            revision: desired.revision,
            hash: desired.hy2ConfigHash,
            config_path: desired.configPath,
            service_name: desired.serviceName,
            meta: desired.meta,
          }
        : null,
      state,
      recent_tasks: recentTasks,
    },
  })
}
