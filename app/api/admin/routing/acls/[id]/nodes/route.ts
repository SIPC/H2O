import { localizedJson } from "@/lib/i18n/api-response"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { bumpNodesForRoutingChange } from "@/lib/hysteria-routing"
import { writeAdminEvent } from "@/lib/logs-db"
import { getClientIp } from "@/lib/turnstile"

type BindingBody = {
  nodeIds?: unknown
}

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

function parseId(id: string) {
  const profileId = Number(id)
  return Number.isInteger(profileId) && profileId > 0 ? profileId : null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const { id } = await params
  const profileId = parseId(id)
  if (!profileId)
    return jsonError(request, "INVALID_ID", "ACL 策略 ID 不合法", 400)

  const db = getDb()
  const profile = db
    .prepare(`SELECT id, name FROM acl_profiles WHERE id = ? LIMIT 1`)
    .get(profileId) as { id: number; name: string } | undefined
  if (!profile) return jsonError(request, "NOT_FOUND", "ACL 策略不存在", 404)

  const nodes = db
    .prepare(
      `SELECT n.id, n.name, n.ip, n.status,
              nab.acl_profile_id,
              ap.name AS acl_profile_name
       FROM nodes n
       LEFT JOIN node_acl_bindings nab ON nab.node_id = n.id
       LEFT JOIN acl_profiles ap ON ap.id = nab.acl_profile_id
       ORDER BY n.sort_order ASC, n.id ASC`
    )
    .all()

  return localizedJson(request, { ok: true, data: { profile, nodes } })
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const { id } = await params
  const profileId = parseId(id)
  if (!profileId)
    return jsonError(request, "INVALID_ID", "ACL 策略 ID 不合法", 400)

  const body = (await request.json()) as BindingBody
  if (
    !Array.isArray(body.nodeIds) ||
    body.nodeIds.some((id) => !Number.isInteger(id) || id <= 0) ||
    new Set(body.nodeIds).size !== body.nodeIds.length
  ) {
    writeAdminEvent({
      event: "ACL_NODE_BINDING_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { profileId },
    })
    return jsonError(request, "INVALID_PAYLOAD", "节点绑定参数不合法", 400)
  }

  const nodeIds = body.nodeIds as number[]
  const db = getDb()
  const profile = db
    .prepare(`SELECT id, name FROM acl_profiles WHERE id = ? LIMIT 1`)
    .get(profileId) as { id: number; name: string } | undefined
  if (!profile) {
    writeAdminEvent({
      event: "ACL_NODE_BINDING_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "NOT_FOUND",
      detail: { profileId },
    })
    return jsonError(request, "NOT_FOUND", "ACL 策略不存在", 404)
  }

  if (nodeIds.length > 0) {
    const placeholders = nodeIds.map(() => "?").join(",")
    const rows = db
      .prepare(`SELECT id FROM nodes WHERE id IN (${placeholders})`)
      .all(...nodeIds) as Array<{ id: number }>
    const existing = new Set(rows.map((row) => row.id))
    if (existing.size !== nodeIds.length) {
      writeAdminEvent({
        event: "ACL_NODE_BINDING_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "NOT_FOUND",
        detail: {
          profileId,
          missingIds: nodeIds.filter((nodeId) => !existing.has(nodeId)),
        },
      })
      return jsonError(request, "NOT_FOUND", "部分节点不存在", 404)
    }
  }

  try {
    db.exec("BEGIN")

    const previousRows = db
      .prepare(
        `SELECT node_id
         FROM node_acl_bindings
         WHERE acl_profile_id = ?
            OR node_id IN (${nodeIds.length > 0 ? nodeIds.map(() => "?").join(",") : "NULL"})`
      )
      .all(profileId, ...nodeIds) as Array<{ node_id: number }>
    const previousNodeIds = previousRows.map((row) => row.node_id)

    db.prepare(`DELETE FROM node_acl_bindings WHERE acl_profile_id = ?`).run(
      profileId
    )

    if (nodeIds.length > 0) {
      const placeholders = nodeIds.map(() => "?").join(",")
      db.prepare(
        `DELETE FROM node_acl_bindings WHERE node_id IN (${placeholders})`
      ).run(...nodeIds)
    }

    const insert = db.prepare(
      `INSERT INTO node_acl_bindings(node_id, acl_profile_id, updated_at)
       VALUES (?, ?, datetime('now'))`
    )
    for (const nodeId of nodeIds) insert.run(nodeId, profileId)

    const affectedNodeIds = bumpNodesForRoutingChange({
      database: db,
      nodeIds: Array.from(new Set([...previousNodeIds, ...nodeIds])),
    })

    db.exec("COMMIT")

    writeAdminEvent({
      event: "ACL_NODE_BINDING_UPDATE",
      actor: auth.user,
      ip,
      success: true,
      reason: "OK",
      detail: {
        profileId,
        profileName: profile.name,
        nodeIds,
        affectedNodeIds,
      },
    })

    return localizedJson(request, { ok: true, data: { profileId, nodeIds } })
  } catch {
    try {
      db.exec("ROLLBACK")
    } catch {
      // 事务未开启或已结束
    }
    writeAdminEvent({
      event: "ACL_NODE_BINDING_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "UPDATE_FAILED",
      detail: { profileId },
    })
    return jsonError(request, "UPDATE_FAILED", "ACL 节点绑定保存失败", 400)
  }
}
