import { localizedJson } from "@/lib/i18n/api-response"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { writeAdminEvent } from "@/lib/logs-db"
import { isPlanTrafficBillingMode } from "@/lib/plan-traffic"
import { getClientIp } from "@/lib/turnstile"

type CreatePlanBody = {
  name?: string
  trafficLimitBytes?: number
  trafficBillingMode?: string
  durationDays?: number
  upMbps?: number
  downMbps?: number
  nodeIds?: number[]
  autoRenew?: boolean
  renewalPeriodDays?: number
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const db = getDb()
  const plans = db
    .prepare(
      `SELECT p.id, p.name, p.traffic_limit_bytes, p.traffic_billing_mode, p.duration_days,
              p.up_mbps, p.down_mbps, p.auto_renew, p.renewal_period_days,
              GROUP_CONCAT(pn.node_id) AS node_ids
       FROM plans p
       LEFT JOIN plan_nodes pn ON pn.plan_id = p.id
       GROUP BY p.id
       ORDER BY p.id DESC`
    )
    .all()

  return localizedJson(request, { ok: true, data: plans })
}

export async function POST(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const body = (await request.json()) as CreatePlanBody

  const trafficBillingMode = body.trafficBillingMode ?? "tx_rx"
  if (!isPlanTrafficBillingMode(trafficBillingMode)) {
    writeAdminEvent({
      event: "PLAN_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_TRAFFIC",
      detail: { name: body.name ?? null, trafficBillingMode },
    })
    return localizedJson(
      request,
      {
        ok: false,
        error: { code: "INVALID_TRAFFIC", message: "流量计费方式不合法" },
      },
      { status: 400 }
    )
  }

  // 限速字段可选，缺省视为 0（不限速）
  const upMbps =
    typeof body.upMbps === "number" &&
    Number.isFinite(body.upMbps) &&
    body.upMbps >= 0
      ? Math.floor(body.upMbps)
      : 0
  const downMbps =
    typeof body.downMbps === "number" &&
    Number.isFinite(body.downMbps) &&
    body.downMbps >= 0
      ? Math.floor(body.downMbps)
      : 0

  // 自动续订字段
  const autoRenew = body.autoRenew === true ? 1 : 0
  const renewalPeriodDays =
    autoRenew === 1 &&
    typeof body.renewalPeriodDays === "number" &&
    Number.isInteger(body.renewalPeriodDays) &&
    body.renewalPeriodDays > 0
      ? body.renewalPeriodDays
      : null

  // 开启续订但未提供合法周期
  if (autoRenew === 1 && renewalPeriodDays === null) {
    writeAdminEvent({
      event: "PLAN_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { name: body.name ?? null },
    })
    return localizedJson(
      request,
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

  if (
    !body.name ||
    typeof body.trafficLimitBytes !== "number" ||
    typeof body.durationDays !== "number" ||
    !Array.isArray(body.nodeIds)
  ) {
    writeAdminEvent({
      event: "PLAN_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { name: body.name ?? null },
    })
    return localizedJson(
      request,
      { ok: false, error: { code: "INVALID_PAYLOAD", message: "参数不完整" } },
      { status: 400 }
    )
  }

  const db = getDb()

  try {
    // 套餐与可用节点一次事务写入，避免部分成功
    db.exec("BEGIN")

    const planRes = db
      .prepare(
        `INSERT INTO plans(name, traffic_limit_bytes, traffic_billing_mode, duration_days, up_mbps, down_mbps, auto_renew, renewal_period_days)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        body.name,
        body.trafficLimitBytes,
        trafficBillingMode,
        body.durationDays,
        upMbps,
        downMbps,
        autoRenew,
        renewalPeriodDays
      )

    const planId = Number(planRes.lastInsertRowid)
    const insertPlanNode = db.prepare(
      `INSERT INTO plan_nodes(plan_id, node_id) VALUES (?, ?)`
    )

    for (const nodeId of body.nodeIds) {
      insertPlanNode.run(planId, nodeId)
    }

    db.exec("COMMIT")

    writeAdminEvent({
      event: "PLAN_CREATE",
      actor: auth.user,
      ip,
      success: true,
      reason: "OK",
      detail: {
        planId,
        name: body.name,
        trafficLimitBytes: body.trafficLimitBytes,
        trafficBillingMode,
        durationDays: body.durationDays,
        upMbps,
        downMbps,
        nodeCount: body.nodeIds.length,
        autoRenew,
        renewalPeriodDays,
      },
    })

    return localizedJson(request, {
      ok: true,
      data: { id: planId, name: body.name },
    })
  } catch {
    db.exec("ROLLBACK")
    writeAdminEvent({
      event: "PLAN_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "CREATE_FAILED",
      detail: { name: body.name },
    })
    return localizedJson(
      request,
      { ok: false, error: { code: "CREATE_FAILED", message: "套餐创建失败" } },
      { status: 400 }
    )
  }
}
