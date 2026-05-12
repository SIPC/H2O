import { NextResponse } from "next/server"

import { isAgentTaskType } from "@/lib/agent-control"
import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { writeAdminEvent } from "@/lib/logs-db"
import { getClientIp } from "@/lib/turnstile"

type CreateTaskBody = {
  type?: unknown
  payload?: unknown
}

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

function parseNodeId(id: string) {
  const nodeId = Number(id)
  return Number.isInteger(nodeId) && nodeId > 0 ? nodeId : null
}

function safePayload(input: unknown) {
  if (input === undefined || input === null) return null
  try {
    const raw = JSON.stringify(input)
    if (raw.length > 16384) return false
    return raw
  } catch {
    return false
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const { id } = await params
  const nodeId = parseNodeId(id)
  if (!nodeId) return jsonError("INVALID_ID", "节点ID不合法", 400)

  const db = getDb()
  const node = db
    .prepare(`SELECT id FROM nodes WHERE id = ? LIMIT 1`)
    .get(nodeId) as { id: number } | undefined
  if (!node) return jsonError("NOT_FOUND", "节点不存在", 404)

  const rows = db
    .prepare(
      `SELECT id, node_id, type, payload, status, result, error, created_by,
              created_at, claimed_at, lease_expires_at, finished_at, updated_at
       FROM node_agent_tasks
       WHERE node_id = ?
       ORDER BY id DESC
       LIMIT 50`
    )
    .all(nodeId)

  return NextResponse.json({ ok: true, data: rows })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const { id } = await params
  const nodeId = parseNodeId(id)
  if (!nodeId) return jsonError("INVALID_ID", "节点ID不合法", 400)

  let body: CreateTaskBody
  try {
    body = (await request.json()) as CreateTaskBody
  } catch {
    return jsonError("INVALID_PAYLOAD", "请求体不合法", 400)
  }

  if (!isAgentTaskType(body.type)) {
    writeAdminEvent({
      event: "AGENT_TASK_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { nodeId, type: body.type ?? null },
    })
    return jsonError("INVALID_PAYLOAD", "任务类型不支持", 400)
  }

  if (body.type === "HY2_LOGS" || body.type === "AGENT_LOGS") {
    const lines =
      typeof body.payload === "object" && body.payload !== null
        ? (body.payload as { lines?: unknown }).lines
        : undefined
    if (
      lines !== undefined &&
      (typeof lines !== "number" ||
        !Number.isInteger(lines) ||
        lines < 1 ||
        lines > 500)
    ) {
      return jsonError("INVALID_PAYLOAD", "日志行数必须在 1~500 之间", 400)
    }
  }

  const payload = safePayload(body.payload)
  if (payload === false) {
    return jsonError("INVALID_PAYLOAD", "任务参数过大", 400)
  }

  const db = getDb()
  const node = db
    .prepare(`SELECT id, name FROM nodes WHERE id = ? LIMIT 1`)
    .get(nodeId) as { id: number; name: string } | undefined
  if (!node) return jsonError("NOT_FOUND", "节点不存在", 404)

  const result = db
    .prepare(
      `INSERT INTO node_agent_tasks(node_id, type, payload, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'queued', ?, datetime('now'), datetime('now'))`
    )
    .run(nodeId, body.type, payload, auth.user.id)

  const taskId = Number(result.lastInsertRowid)
  writeAdminEvent({
    event: "AGENT_TASK_CREATE",
    actor: auth.user,
    ip,
    success: true,
    reason: "OK",
    detail: { nodeId, nodeName: node.name, taskId, type: body.type },
  })

  return NextResponse.json({
    ok: true,
    data: { id: taskId, node_id: nodeId, type: body.type, status: "queued" },
  })
}
