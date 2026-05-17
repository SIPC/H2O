import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import {
  bumpNodesForRoutingChange,
  findAclReferenceErrorsForOutboundProfile,
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

function parseId(id: string) {
  const profileId = Number(id)
  return Number.isInteger(profileId) && profileId > 0 ? profileId : null
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
  if (!profileId) return jsonError("INVALID_ID", "出站配置 ID 不合法", 400)

  const body = (await request.json()) as OutboundProfileBody
  const updates: string[] = []
  const values: Array<string | number | null> = []
  const changedFields: string[] = []

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

  const db = getDb()
  let outboundCount: number | null = null
  if (body.config !== undefined) {
    const validation = validateOutboundProfileConfig(body.config)
    if (!validation.ok) {
      writeAdminEvent({
        event: "OUTBOUND_PROFILE_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "INVALID_PAYLOAD",
        detail: { profileId, error: validation.error },
      })
      return jsonError("INVALID_PAYLOAD", validation.error, 400)
    }

    const aclReferenceErrors = findAclReferenceErrorsForOutboundProfile({
      database: db,
      outboundProfileId: profileId,
      nextOutboundConfig: validation.config,
    })
    if (aclReferenceErrors.length > 0) {
      const message = `无法保存：${aclReferenceErrors[0]}`
      writeAdminEvent({
        event: "OUTBOUND_PROFILE_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "INVALID_PAYLOAD",
        detail: { profileId, error: message },
      })
      return jsonError("INVALID_PAYLOAD", message, 400)
    }

    updates.push("config = ?", "config_hash = ?")
    values.push(JSON.stringify(validation.config), validation.hash)
    changedFields.push("config")
    outboundCount = validation.config.outbounds.length
  }

  if (updates.length === 0) {
    writeAdminEvent({
      event: "OUTBOUND_PROFILE_UPDATE",
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
      .prepare(`UPDATE outbound_profiles SET ${updates.join(", ")} WHERE id = ?`)
      .run(...values, profileId)

    if (result.changes === 0) {
      db.exec("ROLLBACK")
      writeAdminEvent({
        event: "OUTBOUND_PROFILE_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "NOT_FOUND",
        detail: { profileId },
      })
      return jsonError("NOT_FOUND", "出站配置不存在", 404)
    }

    const affectedNodeIds = body.config !== undefined
      ? bumpNodesForRoutingChange({
          database: db,
          outboundProfileId: profileId,
        })
      : []

    db.exec("COMMIT")

    const target = db
      .prepare(`SELECT name FROM outbound_profiles WHERE id = ? LIMIT 1`)
      .get(profileId) as { name: string } | undefined

    writeAdminEvent({
      event: "OUTBOUND_PROFILE_UPDATE",
      actor: auth.user,
      ip,
      success: true,
      reason: "OK",
      detail: {
        profileId,
        name: target?.name ?? null,
        fields: changedFields,
        outboundCount,
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
      event: "OUTBOUND_PROFILE_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "UPDATE_FAILED",
      detail: { profileId },
    })
    return jsonError("UPDATE_FAILED", "出站配置更新失败", 400)
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
  if (!profileId) return jsonError("INVALID_ID", "出站配置 ID 不合法", 400)

  const db = getDb()
  const target = db
    .prepare(`SELECT name FROM outbound_profiles WHERE id = ? LIMIT 1`)
    .get(profileId) as { name: string } | undefined

  const used = db
    .prepare(`SELECT COUNT(*) AS c FROM acl_profiles WHERE outbound_profile_id = ?`)
    .get(profileId) as { c: number } | undefined
  if (used && used.c > 0) {
    writeAdminEvent({
      event: "OUTBOUND_PROFILE_DELETE",
      actor: auth.user,
      ip,
      success: false,
      reason: "PROFILE_IN_USE",
      detail: { profileId, name: target?.name ?? null, usedBy: used.c },
    })
    return jsonError(
      "PROFILE_IN_USE",
      "仍有 ACL 策略引用该出站配置，无法删除",
      400
    )
  }

  try {
    const result = db.prepare(`DELETE FROM outbound_profiles WHERE id = ?`).run(profileId)
    if (result.changes === 0) {
      writeAdminEvent({
        event: "OUTBOUND_PROFILE_DELETE",
        actor: auth.user,
        ip,
        success: false,
        reason: "NOT_FOUND",
        detail: { profileId },
      })
      return jsonError("NOT_FOUND", "出站配置不存在", 404)
    }

    writeAdminEvent({
      event: "OUTBOUND_PROFILE_DELETE",
      actor: auth.user,
      ip,
      success: true,
      reason: "OK",
      detail: { profileId, name: target?.name ?? null },
    })
    return NextResponse.json({ ok: true, data: { id: profileId } })
  } catch {
    writeAdminEvent({
      event: "OUTBOUND_PROFILE_DELETE",
      actor: auth.user,
      ip,
      success: false,
      reason: "DELETE_FAILED",
      detail: { profileId },
    })
    return jsonError("DELETE_FAILED", "出站配置删除失败", 400)
  }
}
