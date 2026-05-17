import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import {
  bumpNodesForRoutingChange,
  validateAclProfileConfig,
  validateOutboundProfileConfig,
} from "@/lib/hysteria-routing"
import type { HysteriaOutboundProfileConfig } from "@/lib/hysteria-routing-types"
import { writeAdminEvent } from "@/lib/logs-db"
import { getClientIp } from "@/lib/turnstile"

type AclProfileBody = {
  name?: string
  remark?: string | null
  outboundProfileId?: number | null
  config?: unknown
}

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

function getOutboundConfig(
  db: ReturnType<typeof getDb>,
  outboundProfileId: number | null | undefined
):
  | { ok: true; config: HysteriaOutboundProfileConfig | null }
  | { ok: false; error: string; code: string; status: number } {
  if (outboundProfileId == null) return { ok: true, config: null }
  if (!Number.isInteger(outboundProfileId) || outboundProfileId <= 0) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      error: "出站配置 ID 不合法",
      status: 400,
    }
  }

  const row = db
    .prepare(`SELECT config FROM outbound_profiles WHERE id = ? LIMIT 1`)
    .get(outboundProfileId) as { config: string } | undefined
  if (!row) {
    return {
      ok: false,
      code: "NOT_FOUND",
      error: "出站配置不存在",
      status: 404,
    }
  }

  const validation = validateOutboundProfileConfig(row.config)
  if (!validation.ok) {
    return {
      ok: false,
      code: "INVALID_PAYLOAD",
      error: `出站配置无效：${validation.error}`,
      status: 400,
    }
  }

  return { ok: true, config: validation.config }
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const db = getDb()
  const rows = db
    .prepare(
      `SELECT ap.id, ap.name, ap.remark, ap.outbound_profile_id, ap.config,
              ap.revision, ap.config_hash, ap.created_at, ap.updated_at,
              op.name AS outbound_profile_name,
              COUNT(DISTINCT nab.node_id) AS bound_node_count,
              GROUP_CONCAT(nab.node_id) AS bound_node_ids
       FROM acl_profiles ap
       LEFT JOIN outbound_profiles op ON op.id = ap.outbound_profile_id
       LEFT JOIN node_acl_bindings nab ON nab.acl_profile_id = ap.id
       GROUP BY ap.id
       ORDER BY ap.id DESC`
    )
    .all()

  return NextResponse.json({ ok: true, data: rows })
}

export async function POST(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const body = (await request.json()) as AclProfileBody
  const name = body.name?.trim() ?? ""
  const remark = body.remark?.trim() || null
  const outboundProfileId = body.outboundProfileId ?? null

  if (!name || body.config === undefined) {
    writeAdminEvent({
      event: "ACL_PROFILE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { name: name || null },
    })
    return jsonError("INVALID_PAYLOAD", "参数不完整", 400)
  }

  const db = getDb()
  const outboundResult = getOutboundConfig(db, outboundProfileId)
  if (!outboundResult.ok) {
    writeAdminEvent({
      event: "ACL_PROFILE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: outboundResult.code,
      detail: { name, outboundProfileId },
    })
    return jsonError(outboundResult.code, outboundResult.error, outboundResult.status)
  }

  const validation = validateAclProfileConfig(body.config, outboundResult.config)
  if (!validation.ok) {
    writeAdminEvent({
      event: "ACL_PROFILE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { name, error: validation.error },
    })
    return jsonError("INVALID_PAYLOAD", validation.error, 400)
  }

  try {
    db.exec("BEGIN")
    const result = db
      .prepare(
        `INSERT INTO acl_profiles(name, remark, outbound_profile_id, config, config_hash)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        name,
        remark,
        outboundProfileId,
        JSON.stringify(validation.config),
        validation.hash
      )
    const profileId = Number(result.lastInsertRowid)
    const affectedNodeIds = bumpNodesForRoutingChange({
      database: db,
      aclProfileId: profileId,
    })
    db.exec("COMMIT")

    writeAdminEvent({
      event: "ACL_PROFILE_CREATE",
      actor: auth.user,
      ip,
      success: true,
      reason: "OK",
      detail: {
        profileId,
        name,
        outboundProfileId,
        ruleCount: validation.config.rules.length,
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
      event: "ACL_PROFILE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "CREATE_FAILED",
      detail: { name },
    })
    return jsonError("CREATE_FAILED", "ACL 策略创建失败", 400)
  }
}
