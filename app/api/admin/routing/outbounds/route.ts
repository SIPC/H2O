import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import {
  bumpNodesForRoutingChange,
  validateOutboundProfileConfig,
} from "@/lib/hysteria-routing"
import { writeAdminEvent } from "@/lib/logs-db"
import { getClientIp } from "@/lib/turnstile"

type OutboundProfileBody = {
  name?: string
  remark?: string | null
  config?: unknown
}

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const db = getDb()
  const rows = db
    .prepare(
      `SELECT op.id, op.name, op.remark, op.config, op.revision,
              op.config_hash, op.created_at, op.updated_at,
              COUNT(DISTINCT ap.id) AS acl_count,
              COUNT(DISTINCT nab.node_id) AS bound_node_count
       FROM outbound_profiles op
       LEFT JOIN acl_profiles ap ON ap.outbound_profile_id = op.id
       LEFT JOIN node_acl_bindings nab ON nab.acl_profile_id = ap.id
       GROUP BY op.id
       ORDER BY op.id DESC`
    )
    .all()

  return NextResponse.json({ ok: true, data: rows })
}

export async function POST(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const body = (await request.json()) as OutboundProfileBody
  const name = body.name?.trim() ?? ""
  const remark = body.remark?.trim() || null

  if (!name || body.config === undefined) {
    writeAdminEvent({
      event: "OUTBOUND_PROFILE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { name: name || null },
    })
    return jsonError("INVALID_PAYLOAD", "参数不完整", 400)
  }

  const validation = validateOutboundProfileConfig(body.config)
  if (!validation.ok) {
    writeAdminEvent({
      event: "OUTBOUND_PROFILE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { name, error: validation.error },
    })
    return jsonError("INVALID_PAYLOAD", validation.error, 400)
  }

  const db = getDb()
  try {
    db.exec("BEGIN")
    const result = db
      .prepare(
        `INSERT INTO outbound_profiles(name, remark, config, config_hash)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        name,
        remark,
        JSON.stringify(validation.config),
        validation.hash
      )
    const profileId = Number(result.lastInsertRowid)
    const affectedNodeIds = bumpNodesForRoutingChange({
      database: db,
      outboundProfileId: profileId,
    })
    db.exec("COMMIT")

    writeAdminEvent({
      event: "OUTBOUND_PROFILE_CREATE",
      actor: auth.user,
      ip,
      success: true,
      reason: "OK",
      detail: {
        profileId,
        name,
        outboundCount: validation.config.outbounds.length,
        affectedNodeIds,
      },
    })

    return NextResponse.json({ ok: true, data: { id: profileId, name } })
  } catch {
    try {
      db.exec("ROLLBACK")
    } catch {
      // 事务未开启或已结束
    }
    writeAdminEvent({
      event: "OUTBOUND_PROFILE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "CREATE_FAILED",
      detail: { name },
    })
    return jsonError("CREATE_FAILED", "出站配置创建失败", 400)
  }
}
