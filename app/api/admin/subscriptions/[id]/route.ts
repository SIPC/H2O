import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { writeAdminEvent } from "@/lib/logs-db"
import { getClientIp } from "@/lib/turnstile"

type UpdateSubscriptionBody = {
  status?: "active" | "expired" | "blocked"
  expireTime?: string
  usedTrafficBytes?: number
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const { id } = await params
  const subId = Number(id)

  if (!Number.isInteger(subId) || subId <= 0) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_ID", message: "订阅ID不合法" } },
      { status: 400 }
    )
  }

  const body = (await request.json()) as UpdateSubscriptionBody
  const updates: string[] = []
  const values: Array<string | number> = []
  const changedFields: string[] = []

  if (body.status) {
    if (!["active", "expired", "blocked"].includes(body.status)) {
      writeAdminEvent({
        event: "SUBSCRIPTION_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "INVALID_STATUS",
        detail: { subscriptionId: subId },
      })
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_STATUS", message: "状态不合法" } },
        { status: 400 }
      )
    }
    updates.push("status = ?")
    values.push(body.status)
    changedFields.push("status")
  }

  if (body.expireTime) {
    const expireDate = new Date(body.expireTime)
    if (Number.isNaN(expireDate.getTime())) {
      writeAdminEvent({
        event: "SUBSCRIPTION_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "INVALID_EXPIRE",
        detail: { subscriptionId: subId },
      })
      return NextResponse.json(
        {
          ok: false,
          error: { code: "INVALID_EXPIRE", message: "到期时间不合法" },
        },
        { status: 400 }
      )
    }
    updates.push("expire_time = ?")
    values.push(expireDate.toISOString())
    changedFields.push("expire_time")
  }

  if (typeof body.usedTrafficBytes === "number") {
    if (body.usedTrafficBytes < 0 || !Number.isFinite(body.usedTrafficBytes)) {
      writeAdminEvent({
        event: "SUBSCRIPTION_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "INVALID_TRAFFIC",
        detail: { subscriptionId: subId },
      })
      return NextResponse.json(
        {
          ok: false,
          error: { code: "INVALID_TRAFFIC", message: "已用流量不合法" },
        },
        { status: 400 }
      )
    }
    updates.push("used_traffic_bytes = ?")
    values.push(Math.floor(body.usedTrafficBytes))
    changedFields.push("used_traffic_bytes")
  }

  if (updates.length === 0) {
    writeAdminEvent({
      event: "SUBSCRIPTION_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { subscriptionId: subId },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: "没有可更新字段" },
      },
      { status: 400 }
    )
  }

  values.push(subId)

  const db = getDb()
  const result = db
    .prepare(`UPDATE subscriptions SET ${updates.join(", ")} WHERE id = ?`)
    .run(...values)

  if (result.changes === 0) {
    writeAdminEvent({
      event: "SUBSCRIPTION_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "NOT_FOUND",
      detail: { subscriptionId: subId },
    })
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "订阅不存在" } },
      { status: 404 }
    )
  }

  writeAdminEvent({
    event: "SUBSCRIPTION_UPDATE",
    actor: auth.user,
    ip,
    success: true,
    reason: "OK",
    detail: { subscriptionId: subId, fields: changedFields },
  })

  return NextResponse.json({ ok: true, data: { id: subId } })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const { id } = await params
  const subId = Number(id)

  if (!Number.isInteger(subId) || subId <= 0) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_ID", message: "订阅ID不合法" } },
      { status: 400 }
    )
  }

  const db = getDb()
  // 先查出关联的用户/套餐用于日志
  const target = db
    .prepare(
      `SELECT s.user_id, u.username, s.plan_id, p.name AS plan_name
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       JOIN plans p ON p.id = s.plan_id
       WHERE s.id = ? LIMIT 1`
    )
    .get(subId) as
    | {
        user_id: number
        username: string
        plan_id: number
        plan_name: string
      }
    | undefined

  const result = db.prepare(`DELETE FROM subscriptions WHERE id = ?`).run(subId)

  if (result.changes === 0) {
    writeAdminEvent({
      event: "SUBSCRIPTION_DELETE",
      actor: auth.user,
      ip,
      success: false,
      reason: "NOT_FOUND",
      detail: { subscriptionId: subId },
    })
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "订阅不存在" } },
      { status: 404 }
    )
  }

  writeAdminEvent({
    event: "SUBSCRIPTION_DELETE",
    actor: auth.user,
    ip,
    success: true,
    reason: "OK",
    detail: {
      subscriptionId: subId,
      targetUserId: target?.user_id ?? null,
      targetUsername: target?.username ?? null,
      planId: target?.plan_id ?? null,
      planName: target?.plan_name ?? null,
    },
  })

  return NextResponse.json({ ok: true, data: { id: subId } })
}
