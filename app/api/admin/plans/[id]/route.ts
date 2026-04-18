import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"

type UpdatePlanBody = {
  name?: string
  trafficLimitBytes?: number
  durationDays?: number
  nodeIds?: number[]
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const { id } = await params
  const planId = Number(id)

  if (!Number.isInteger(planId) || planId <= 0) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_ID", message: "套餐ID不合法" } },
      { status: 400 },
    )
  }

  const body = (await request.json()) as UpdatePlanBody
  const updates: string[] = []
  const values: Array<string | number> = []

  if (typeof body.name === "string" && body.name.trim()) {
    updates.push("name = ?")
    values.push(body.name.trim())
  }

  if (typeof body.trafficLimitBytes === "number") {
    if (body.trafficLimitBytes < 0 || !Number.isFinite(body.trafficLimitBytes)) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_TRAFFIC", message: "流量上限不合法" } },
        { status: 400 },
      )
    }
    updates.push("traffic_limit_bytes = ?")
    values.push(Math.floor(body.trafficLimitBytes))
  }

  if (typeof body.durationDays === "number") {
    if (body.durationDays <= 0 || !Number.isFinite(body.durationDays)) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_DURATION", message: "时长不合法" } },
        { status: 400 },
      )
    }
    updates.push("duration_days = ?")
    values.push(Math.floor(body.durationDays))
  }

  const hasScalarChanges = updates.length > 0
  const hasNodeChanges = Array.isArray(body.nodeIds)

  if (!hasScalarChanges && !hasNodeChanges) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_PAYLOAD", message: "没有可更新字段" } },
      { status: 400 },
    )
  }

  const db = getDb()

  try {
    // 套餐基础字段 + 节点关联一次事务，避免部分成功
    db.exec("BEGIN")

    if (hasScalarChanges) {
      const result = db
        .prepare(`UPDATE plans SET ${updates.join(", ")} WHERE id = ?`)
        .run(...values, planId)

      if (result.changes === 0) {
        db.exec("ROLLBACK")
        return NextResponse.json(
          { ok: false, error: { code: "NOT_FOUND", message: "套餐不存在" } },
          { status: 404 },
        )
      }
    }

    if (hasNodeChanges) {
      db.prepare(`DELETE FROM plan_nodes WHERE plan_id = ?`).run(planId)
      const insertNode = db.prepare(`INSERT INTO plan_nodes(plan_id, node_id) VALUES (?, ?)`)
      for (const nodeId of body.nodeIds ?? []) {
        insertNode.run(planId, nodeId)
      }
    }

    db.exec("COMMIT")
    return NextResponse.json({ ok: true, data: { id: planId } })
  } catch {
    db.exec("ROLLBACK")
    return NextResponse.json(
      { ok: false, error: { code: "UPDATE_FAILED", message: "套餐更新失败" } },
      { status: 400 },
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const { id } = await params
  const planId = Number(id)

  if (!Number.isInteger(planId) || planId <= 0) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_ID", message: "套餐ID不合法" } },
      { status: 400 },
    )
  }

  const db = getDb()

  // 有订阅引用该套餐时外键约束会阻止删除
  const used = db
    .prepare(`SELECT COUNT(*) AS c FROM subscriptions WHERE plan_id = ?`)
    .get(planId) as { c: number } | undefined

  if (used && used.c > 0) {
    return NextResponse.json(
      { ok: false, error: { code: "PLAN_IN_USE", message: "仍有订阅关联该套餐，无法删除" } },
      { status: 400 },
    )
  }

  try {
    const result = db.prepare(`DELETE FROM plans WHERE id = ?`).run(planId)

    if (result.changes === 0) {
      return NextResponse.json(
        { ok: false, error: { code: "NOT_FOUND", message: "套餐不存在" } },
        { status: 404 },
      )
    }

    return NextResponse.json({ ok: true, data: { id: planId } })
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "DELETE_FAILED", message: "套餐删除失败" } },
      { status: 400 },
    )
  }
}
