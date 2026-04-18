import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"

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
       ORDER BY s.id DESC`,
    )
    .all()

  return NextResponse.json({ ok: true, data: rows })
}

export async function POST(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const body = (await request.json()) as CreateSubscriptionBody

  if (typeof body.userId !== "number" || typeof body.planId !== "number") {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_PAYLOAD", message: "参数不完整" } },
      { status: 400 },
    )
  }

  const db = getDb()

  const startTime = body.startTime ?? new Date().toISOString()

  const plan = db
    .prepare(`SELECT duration_days FROM plans WHERE id = ? LIMIT 1`)
    .get(body.planId) as { duration_days: number } | undefined

  if (!plan) {
    return NextResponse.json(
      { ok: false, error: { code: "PLAN_NOT_FOUND", message: "套餐不存在" } },
      { status: 400 },
    )
  }

  // 到期时间由开始时间 + 套餐天数计算
  const expire = new Date(startTime)
  expire.setDate(expire.getDate() + plan.duration_days)

  try {
    const result = db
      .prepare(
        `INSERT INTO subscriptions(user_id, plan_id, start_time, expire_time, used_traffic_bytes, status)
         VALUES (?, ?, ?, ?, 0, 'active')`,
      )
      .run(body.userId, body.planId, startTime, expire.toISOString())

    return NextResponse.json({
      ok: true,
      data: {
        id: Number(result.lastInsertRowid),
        userId: body.userId,
        planId: body.planId,
        startTime,
        expireTime: expire.toISOString(),
      },
    })
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "CREATE_FAILED", message: "订阅创建失败" } },
      { status: 400 },
    )
  }
}
