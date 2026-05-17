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

function parseId(id: string) {
  const profileId = Number(id)
  return Number.isInteger(profileId) && profileId > 0 ? profileId : null
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const { id } = await params
  const profileId = parseId(id)
  if (!profileId) return jsonError("INVALID_ID", "ACL 策略 ID 不合法", 400)

  const body = (await request.json()) as AclProfileBody
  const updates: string[] = []
  const values: Array<string | number | null> = []
  const changedFields: string[] = []
  const db = getDb()

  const current = db
    .prepare(`SELECT outbound_profile_id, config FROM acl_profiles WHERE id = ? LIMIT 1`)
    .get(profileId) as
    | { outbound_profile_id: number | null; config: string }
    | undefined

  if (!current) {
    writeAdminEvent({
      event: "ACL_PROFILE_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "NOT_FOUND",
      detail: { profileId },
    })
    return jsonError("NOT_FOUND", "ACL 策略不存在", 404)
  }

  if (typeof body.name === "string" && body.name.trim()) {
    updates.push("name = ?")
    values.push(body.name.trim())
    changedFields.push("name")
  }

  if (body.remark !== undefined) {
    updates.push("remark = ?")
    values.push(body.remark?.trim() || null)
    changedFields.push("remark")
  }

  const nextOutboundProfileId =
    body.outboundProfileId !== undefined
      ? body.outboundProfileId
      : current.outbound_profile_id

  if (body.outboundProfileId !== undefined) {
    updates.push("outbound_profile_id = ?")
    values.push(body.outboundProfileId ?? null)
    changedFields.push("outbound_profile_id")
  }

  let ruleCount: number | null = null
  if (body.config !== undefined || body.outboundProfileId !== undefined) {
    const outboundResult = getOutboundConfig(db, nextOutboundProfileId)
    if (!outboundResult.ok) {
      writeAdminEvent({
        event: "ACL_PROFILE_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: outboundResult.code,
        detail: { profileId, outboundProfileId: nextOutboundProfileId },
      })
      return jsonError(outboundResult.code, outboundResult.error, outboundResult.status)
    }

    const configInput = body.config !== undefined ? body.config : current.config
    const validation = validateAclProfileConfig(configInput, outboundResult.config)
    if (!validation.ok) {
      writeAdminEvent({
        event: "ACL_PROFILE_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "INVALID_PAYLOAD",
        detail: { profileId, error: validation.error },
      })
      return jsonError("INVALID_PAYLOAD", validation.error, 400)
    }

    updates.push("config = ?", "config_hash = ?")
    values.push(JSON.stringify(validation.config), validation.hash)
    if (body.config !== undefined) changedFields.push("config")
    ruleCount = validation.config.rules.length
  }

  if (updates.length === 0) {
    writeAdminEvent({
      event: "ACL_PROFILE_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { profileId },
    })
    return jsonError("INVALID_PAYLOAD", "没有可更新字段", 400)
  }

  updates.push("revision = revision + 1", "updated_at = datetime('now')")

  try {
    db.exec("BEGIN")
    const result = db
      .prepare(`UPDATE acl_profiles SET ${updates.join(", ")} WHERE id = ?`)
      .run(...values, profileId)

    if (result.changes === 0) {
      db.exec("ROLLBACK")
      writeAdminEvent({
        event: "ACL_PROFILE_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "NOT_FOUND",
        detail: { profileId },
      })
      return jsonError("NOT_FOUND", "ACL 策略不存在", 404)
    }

    const affectedNodeIds = bumpNodesForRoutingChange({
      database: db,
      aclProfileId: profileId,
    })

    db.exec("COMMIT")

    const target = db
      .prepare(`SELECT name FROM acl_profiles WHERE id = ? LIMIT 1`)
      .get(profileId) as { name: string } | undefined

    writeAdminEvent({
      event: "ACL_PROFILE_UPDATE",
      actor: auth.user,
      ip,
      success: true,
      reason: "OK",
      detail: {
        profileId,
        name: target?.name ?? null,
        fields: changedFields,
        outboundProfileId: nextOutboundProfileId,
        ruleCount,
        affectedNodeIds,
      },
    })

    return NextResponse.json({ ok: true, data: { id: profileId } })
  } catch {
    try {
      db.exec("ROLLBACK")
    } catch {
      // 事务未开启或已结束
    }
    writeAdminEvent({
      event: "ACL_PROFILE_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "UPDATE_FAILED",
      detail: { profileId },
    })
    return jsonError("UPDATE_FAILED", "ACL 策略更新失败", 400)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const { id } = await params
  const profileId = parseId(id)
  if (!profileId) return jsonError("INVALID_ID", "ACL 策略 ID 不合法", 400)

  const db = getDb()
  const target = db
    .prepare(`SELECT name FROM acl_profiles WHERE id = ? LIMIT 1`)
    .get(profileId) as { name: string } | undefined

  try {
    db.exec("BEGIN")
    const boundRows = db
      .prepare(`SELECT node_id FROM node_acl_bindings WHERE acl_profile_id = ?`)
      .all(profileId) as Array<{ node_id: number }>
    const affectedNodeIds = boundRows.map((row) => row.node_id)
    db.prepare(`DELETE FROM node_acl_bindings WHERE acl_profile_id = ?`).run(profileId)
    const result = db.prepare(`DELETE FROM acl_profiles WHERE id = ?`).run(profileId)

    if (result.changes === 0) {
      db.exec("ROLLBACK")
      writeAdminEvent({
        event: "ACL_PROFILE_DELETE",
        actor: auth.user,
        ip,
        success: false,
        reason: "NOT_FOUND",
        detail: { profileId },
      })
      return jsonError("NOT_FOUND", "ACL 策略不存在", 404)
    }

    bumpNodesForRoutingChange({ database: db, nodeIds: affectedNodeIds })
    db.exec("COMMIT")

    writeAdminEvent({
      event: "ACL_PROFILE_DELETE",
      actor: auth.user,
      ip,
      success: true,
      reason: "OK",
      detail: { profileId, name: target?.name ?? null, affectedNodeIds },
    })
    return NextResponse.json({ ok: true, data: { id: profileId } })
  } catch {
    try {
      db.exec("ROLLBACK")
    } catch {
      // 事务未开启或已结束
    }
    writeAdminEvent({
      event: "ACL_PROFILE_DELETE",
      actor: auth.user,
      ip,
      success: false,
      reason: "DELETE_FAILED",
      detail: { profileId },
    })
    return jsonError("DELETE_FAILED", "ACL 策略删除失败", 400)
  }
}
