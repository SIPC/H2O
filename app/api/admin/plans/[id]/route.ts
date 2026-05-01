import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { writeAdminEvent } from "@/lib/logs-db"
import { getClientIp } from "@/lib/turnstile"

type UpdatePlanBody = {
  name?: string
  trafficLimitBytes?: number
  durationDays?: number
  upMbps?: number
  downMbps?: number
  nodeIds?: number[]
  autoRenew?: boolean
  renewalPeriodDays?: number
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const { id } = await params
  const planId = Number(id)

  if (!Number.isInteger(planId) || planId <= 0) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_ID", message: "套餐ID不合法" } },
      { status: 400 }
    )
  }

  const body = (await request.json()) as UpdatePlanBody
  const updates: string[] = []
  const values: Array<string | number> = []
  const changedFields: string[] = []

  if (typeof body.name === "string" && body.name.trim()) {
    updates.push("name = ?")
    values.push(body.name.trim())
    changedFields.push("name")
  }

  if (typeof body.trafficLimitBytes === "number") {
    if (
      body.trafficLimitBytes < 0 ||
      !Number.isFinite(body.trafficLimitBytes)
    ) {
      writeAdminEvent({
        event: "PLAN_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "INVALID_TRAFFIC",
        detail: { planId },
      })
      return NextResponse.json(
        {
          ok: false,
          error: { code: "INVALID_TRAFFIC", message: "流量上限不合法" },
        },
        { status: 400 }
      )
    }
    updates.push("traffic_limit_bytes = ?")
    values.push(Math.floor(body.trafficLimitBytes))
    changedFields.push("traffic_limit_bytes")
  }

  if (typeof body.durationDays === "number") {
    if (body.durationDays < 0 || !Number.isFinite(body.durationDays)) {
      // 0 表示永久，负数非法
      writeAdminEvent({
        event: "PLAN_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "INVALID_DURATION",
        detail: { planId },
      })
      return NextResponse.json(
        {
          ok: false,
          error: { code: "INVALID_DURATION", message: "时长不合法" },
        },
        { status: 400 }
      )
    }
    updates.push("duration_days = ?")
    values.push(Math.floor(body.durationDays))
    changedFields.push("duration_days")
  }

  // 限速字段：0 表示不限速；负数 / NaN 视为非法
  for (const [key, col] of [
    ["upMbps", "up_mbps"],
    ["downMbps", "down_mbps"],
  ] as const) {
    const raw = body[key]
    if (typeof raw === "number") {
      if (raw < 0 || !Number.isFinite(raw)) {
        writeAdminEvent({
          event: "PLAN_UPDATE",
          actor: auth.user,
          ip,
          success: false,
          reason: "INVALID_SPEED",
          detail: { planId, field: col },
        })
        return NextResponse.json(
          {
            ok: false,
            error: { code: "INVALID_SPEED", message: "限速数值不合法" },
          },
          { status: 400 }
        )
      }
      updates.push(`${col} = ?`)
      values.push(Math.floor(raw))
      changedFields.push(col)
    }
  }

  // 自动续订字段
  if (typeof body.autoRenew === "boolean") {
    const autoRenewVal = body.autoRenew ? 1 : 0
    updates.push("auto_renew = ?")
    values.push(autoRenewVal)
    changedFields.push("auto_renew")

    if (autoRenewVal === 1) {
      if (
        typeof body.renewalPeriodDays !== "number" ||
        !Number.isInteger(body.renewalPeriodDays) ||
        body.renewalPeriodDays <= 0
      ) {
        writeAdminEvent({
          event: "PLAN_UPDATE",
          actor: auth.user,
          ip,
          success: false,
          reason: "INVALID_PAYLOAD",
          detail: { planId },
        })
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "INVALID_PAYLOAD",
              message: "开启自动续订时必须提供合法的续订周期（正整数天数）",
            },
          },
          { status: 400 }
        )
      }
      updates.push("renewal_period_days = ?")
      values.push(body.renewalPeriodDays)
      changedFields.push("renewal_period_days")
    } else {
      // 关闭续订时清除周期
      updates.push("renewal_period_days = NULL")
    }
  } else if (typeof body.renewalPeriodDays === "number") {
    // 单独更新周期（套餐已开启续订的情况）
    if (
      !Number.isInteger(body.renewalPeriodDays) ||
      body.renewalPeriodDays <= 0
    ) {
      writeAdminEvent({
        event: "PLAN_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "INVALID_PAYLOAD",
        detail: { planId },
      })
      return NextResponse.json(
        {
          ok: false,
          error: { code: "INVALID_PAYLOAD", message: "续订周期必须为正整数" },
        },
        { status: 400 }
      )
    }
    updates.push("renewal_period_days = ?")
    values.push(body.renewalPeriodDays)
    changedFields.push("renewal_period_days")
  }

  const hasScalarChanges = updates.length > 0
  const hasNodeChanges = Array.isArray(body.nodeIds)

  if (!hasScalarChanges && !hasNodeChanges) {
    writeAdminEvent({
      event: "PLAN_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { planId },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: "没有可更新字段" },
      },
      { status: 400 }
    )
  }

  if (hasNodeChanges) changedFields.push("node_ids")

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
        writeAdminEvent({
          event: "PLAN_UPDATE",
          actor: auth.user,
          ip,
          success: false,
          reason: "NOT_FOUND",
          detail: { planId },
        })
        return NextResponse.json(
          { ok: false, error: { code: "NOT_FOUND", message: "套餐不存在" } },
          { status: 404 }
        )
      }
    }

    if (hasNodeChanges) {
      db.prepare(`DELETE FROM plan_nodes WHERE plan_id = ?`).run(planId)
      const insertNode = db.prepare(
        `INSERT INTO plan_nodes(plan_id, node_id) VALUES (?, ?)`
      )
      for (const nodeId of body.nodeIds ?? []) {
        insertNode.run(planId, nodeId)
      }
    }

    db.exec("COMMIT")

    const target = db
      .prepare(`SELECT name FROM plans WHERE id = ? LIMIT 1`)
      .get(planId) as { name: string } | undefined
    writeAdminEvent({
      event: "PLAN_UPDATE",
      actor: auth.user,
      ip,
      success: true,
      reason: "OK",
      detail: {
        planId,
        planName: target?.name ?? null,
        fields: changedFields,
      },
    })

    return NextResponse.json({ ok: true, data: { id: planId } })
  } catch {
    db.exec("ROLLBACK")
    writeAdminEvent({
      event: "PLAN_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "UPDATE_FAILED",
      detail: { planId },
    })
    return NextResponse.json(
      { ok: false, error: { code: "UPDATE_FAILED", message: "套餐更新失败" } },
      { status: 400 }
    )
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
  const planId = Number(id)

  if (!Number.isInteger(planId) || planId <= 0) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_ID", message: "套餐ID不合法" } },
      { status: 400 }
    )
  }

  const db = getDb()
  const target = db
    .prepare(`SELECT name FROM plans WHERE id = ? LIMIT 1`)
    .get(planId) as { name: string } | undefined

  // 有订阅引用该套餐时外键约束会阻止删除
  const used = db
    .prepare(`SELECT COUNT(*) AS c FROM subscriptions WHERE plan_id = ?`)
    .get(planId) as { c: number } | undefined

  if (used && used.c > 0) {
    writeAdminEvent({
      event: "PLAN_DELETE",
      actor: auth.user,
      ip,
      success: false,
      reason: "PLAN_IN_USE",
      detail: { planId, planName: target?.name ?? null, usedBy: used.c },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "PLAN_IN_USE", message: "仍有订阅关联该套餐，无法删除" },
      },
      { status: 400 }
    )
  }

  try {
    const result = db.prepare(`DELETE FROM plans WHERE id = ?`).run(planId)

    if (result.changes === 0) {
      writeAdminEvent({
        event: "PLAN_DELETE",
        actor: auth.user,
        ip,
        success: false,
        reason: "NOT_FOUND",
        detail: { planId },
      })
      return NextResponse.json(
        { ok: false, error: { code: "NOT_FOUND", message: "套餐不存在" } },
        { status: 404 }
      )
    }

    writeAdminEvent({
      event: "PLAN_DELETE",
      actor: auth.user,
      ip,
      success: true,
      reason: "OK",
      detail: { planId, planName: target?.name ?? null },
    })
    return NextResponse.json({ ok: true, data: { id: planId } })
  } catch {
    writeAdminEvent({
      event: "PLAN_DELETE",
      actor: auth.user,
      ip,
      success: false,
      reason: "DELETE_FAILED",
      detail: { planId },
    })
    return NextResponse.json(
      { ok: false, error: { code: "DELETE_FAILED", message: "套餐删除失败" } },
      { status: 400 }
    )
  }
}
