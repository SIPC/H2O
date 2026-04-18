import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { writeAdminEvent } from "@/lib/logs-db"
import { getClientIp } from "@/lib/turnstile"

type CreatePlanBody = {
  name?: string
  trafficLimitBytes?: number
  durationDays?: number
  nodeIds?: number[]
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const db = getDb()
  const plans = db
    .prepare(
      `SELECT p.id, p.name, p.traffic_limit_bytes, p.duration_days,
              GROUP_CONCAT(pn.node_id) AS node_ids
       FROM plans p
       LEFT JOIN plan_nodes pn ON pn.plan_id = p.id
       GROUP BY p.id
       ORDER BY p.id DESC`
    )
    .all()

  return NextResponse.json({ ok: true, data: plans })
}

export async function POST(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const body = (await request.json()) as CreatePlanBody

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
    return NextResponse.json(
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
        `INSERT INTO plans(name, traffic_limit_bytes, duration_days) VALUES (?, ?, ?)`
      )
      .run(body.name, body.trafficLimitBytes, body.durationDays)

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
        durationDays: body.durationDays,
        nodeCount: body.nodeIds.length,
      },
    })

    return NextResponse.json({
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
    return NextResponse.json(
      { ok: false, error: { code: "CREATE_FAILED", message: "套餐创建失败" } },
      { status: 400 }
    )
  }
}
