import { localizedJson } from "@/lib/i18n/api-response"

import { createAgentSecret } from "@/lib/agent-control"
import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { writeAdminEvent } from "@/lib/logs-db"
import { getClientIp } from "@/lib/turnstile"

function jsonError(
  request: Request,
  code: string,
  message: string,
  status: number
) {
  return localizedJson(
    request,
    { ok: false, error: { code, message } },
    { status }
  )
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const { id } = await params
  const nodeId = Number(id)
  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    return jsonError(request, "INVALID_ID", "节点ID不合法", 400)
  }

  const db = getDb()
  const node = db
    .prepare(`SELECT id, name FROM nodes WHERE id = ? LIMIT 1`)
    .get(nodeId) as { id: number; name: string } | undefined
  if (!node) return jsonError(request, "NOT_FOUND", "节点不存在", 404)

  const agentSecret = createAgentSecret()
  db.prepare(
    `UPDATE nodes
     SET agent_secret = ?
     WHERE id = ?`
  ).run(agentSecret, nodeId)

  writeAdminEvent({
    event: "AGENT_SECRET_ROTATE",
    actor: auth.user,
    ip,
    success: true,
    reason: "OK",
    detail: { nodeId, nodeName: node.name },
  })

  return localizedJson(request, { ok: true, data: { id: nodeId } })
}
