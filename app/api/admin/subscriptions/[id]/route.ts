import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"

type UpdateSubscriptionBody = {
  status?: "active" | "expired" | "blocked"
  expireTime?: string
  usedTrafficBytes?: number
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const { id } = await params
  const subId = Number(id)

  if (!Number.isInteger(subId) || subId <= 0) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_ID", message: "订阅ID不合法" } },
      { status: 400 },
    )
  }

  const body = (await request.json()) as UpdateSubscriptionBody
  const updates: string[] = []
  const values: Array<string | number> = []

  if (body.status) {
    if (!["active", "expired", "blocked"].includes(body.status)) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_STATUS", message: "状态不合法" } },
        { status: 400 },
      )
    }
    updates.push("status = ?")
    values.push(body.status)
  }

  if (body.expireTime) {
    const expireDate = new Date(body.expireTime)
    if (Number.isNaN(expireDate.getTime())) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_EXPIRE", message: "到期时间不合法" } },
        { status: 400 },
      )
    }
    updates.push("expire_time = ?")
    values.push(expireDate.toISOString())
  }

  if (typeof body.usedTrafficBytes === "number") {
    if (body.usedTrafficBytes < 0 || !Number.isFinite(body.usedTrafficBytes)) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_TRAFFIC", message: "已用流量不合法" } },
        { status: 400 },
      )
    }
    updates.push("used_traffic_bytes = ?")
    values.push(Math.floor(body.usedTrafficBytes))
  }

  if (updates.length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_PAYLOAD", message: "没有可更新字段" } },
      { status: 400 },
    )
  }

  values.push(subId)

  const db = getDb()
  const result = db
    .prepare(`UPDATE subscriptions SET ${updates.join(", ")} WHERE id = ?`)
    .run(...values)

  if (result.changes === 0) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "订阅不存在" } },
      { status: 404 },
    )
  }

  return NextResponse.json({ ok: true, data: { id: subId } })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const { id } = await params
  const subId = Number(id)

  if (!Number.isInteger(subId) || subId <= 0) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_ID", message: "订阅ID不合法" } },
      { status: 400 },
    )
  }

  const db = getDb()
  const result = db.prepare(`DELETE FROM subscriptions WHERE id = ?`).run(subId)

  if (result.changes === 0) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "订阅不存在" } },
      { status: 404 },
    )
  }

  return NextResponse.json({ ok: true, data: { id: subId } })
}
