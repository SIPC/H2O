import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { writeAdminEvent } from "@/lib/logs-db"
import { getClientIp } from "@/lib/turnstile"

type CreateSubscriptionBody = {
  userId?: number
  planId?: number
  startTime?: string
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const db = getDb()
  const rows = db
    .prepare(
      `SELECT s.id, s.user_id, s.plan_id, s.start_time, s.expire_time, s.used_traffic_bytes, s.status,
              u.username, p.name AS plan_name, p.traffic_limit_bytes
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       JOIN plans p ON p.id = s.plan_id
       ORDER BY s.id DESC`
    )
    .all()

  return NextResponse.json({ ok: true, data: rows })
}

export async function POST(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const body = (await request.json()) as CreateSubscriptionBody

  if (typeof body.userId !== "number" || typeof body.planId !== "number") {
    writeAdminEvent({
      event: "SUBSCRIPTION_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { userId: body.userId ?? null, planId: body.planId ?? null },
    })
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_PAYLOAD", message: "参数不完整" } },
      { status: 400 }
    )
  }

  const db = getDb()

  const startTime = body.startTime ?? new Date().toISOString()

  const plan = db
    .prepare(`SELECT duration_days FROM plans WHERE id = ? LIMIT 1`)
    .get(body.planId) as { duration_days: number } | undefined

  if (!plan) {
    writeAdminEvent({
      event: "SUBSCRIPTION_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "PLAN_NOT_FOUND",
      detail: { userId: body.userId, planId: body.planId },
    })
    return NextResponse.json(
      { ok: false, error: { code: "PLAN_NOT_FOUND", message: "套餐不存在" } },
      { status: 400 }
    )
  }

  // 到期时间由开始时间 + 套餐天数计算，duration_days=0 表示永久
  const expire =
    plan.duration_days === 0
      ? new Date("9999-12-31T23:59:59.000Z")
      : (() => {
          const d = new Date(startTime)
          d.setDate(d.getDate() + plan.duration_days)
          return d
        })()

  try {
    const result = db
      .prepare(
        `INSERT INTO subscriptions(user_id, plan_id, start_time, expire_time, used_traffic_bytes, status, renewal_anchor)
         VALUES (?, ?, ?, ?, 0, 'active', ?)`
      )
      .run(body.userId, body.planId, startTime, expire.toISOString(), startTime)

    const newSubId = Number(result.lastInsertRowid)
    writeAdminEvent({
      event: "SUBSCRIPTION_CREATE",
      actor: auth.user,
      ip,
      success: true,
      reason: "OK",
      detail: {
        subscriptionId: newSubId,
        userId: body.userId,
        planId: body.planId,
        expireTime: expire.toISOString(),
      },
    })

    return NextResponse.json({
      ok: true,
      data: {
        id: newSubId,
        userId: body.userId,
        planId: body.planId,
        startTime,
        expireTime: expire.toISOString(),
      },
    })
  } catch {
    writeAdminEvent({
      event: "SUBSCRIPTION_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "CREATE_FAILED",
      detail: { userId: body.userId, planId: body.planId },
    })
    return NextResponse.json(
      { ok: false, error: { code: "CREATE_FAILED", message: "订阅创建失败" } },
      { status: 400 }
    )
  }
}
