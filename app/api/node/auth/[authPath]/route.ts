import { NextResponse } from "next/server"

import { getDb } from "@/lib/db"
import { writeAuthLog } from "@/lib/logs-db"

type AuthPayload = {
  addr?: string
  auth?: string
  tx?: number
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ authPath: string }> },
) {
  const { authPath } = await params
  const body = (await request.json()) as AuthPayload
  const ip = typeof body.addr === "string" ? body.addr : null

  // 参数缺失或类型非法，记一条 BAD_PAYLOAD
  if (!body.auth || typeof body.auth !== "string") {
    writeAuthLog({
      node_id: null,
      node_name: authPath,
      user_id: null,
      username: null,
      ip,
      success: false,
      reason: "BAD_PAYLOAD",
    })
    return NextResponse.json({ ok: false, id: "" }, { status: 400 })
  }

  if (typeof body.tx !== "number" || body.tx < 0 || !Number.isFinite(body.tx)) {
    writeAuthLog({
      node_id: null,
      node_name: authPath,
      user_id: null,
      username: null,
      ip,
      success: false,
      reason: "BAD_PAYLOAD",
    })
    return NextResponse.json({ ok: false, id: "" }, { status: 400 })
  }

  const db = getDb()

  // 1) 先校验节点路径是否合法且节点启用
  const node = db
    .prepare(`SELECT id, name FROM nodes WHERE auth_path = ? AND status = 'enabled' LIMIT 1`)
    .get(authPath) as { id: number; name: string } | undefined

  if (!node) {
    writeAuthLog({
      node_id: null,
      node_name: authPath,
      user_id: null,
      username: null,
      ip,
      success: false,
      reason: "NO_NODE",
    })
    return NextResponse.json({ ok: false, id: "" })
  }

  // 2) 用用户 token 匹配用户，同时校验账号状态
  const user = db
    .prepare(`SELECT id, username, status FROM users WHERE auth_token = ? LIMIT 1`)
    .get(body.auth) as { id: number; username: string; status: "active" | "disabled" } | undefined

  if (!user) {
    writeAuthLog({
      node_id: node.id,
      node_name: node.name,
      user_id: null,
      username: null,
      ip,
      success: false,
      reason: "NO_USER",
    })
    return NextResponse.json({ ok: false, id: "" })
  }

  if (user.status !== "active") {
    writeAuthLog({
      node_id: node.id,
      node_name: node.name,
      user_id: user.id,
      username: user.username,
      ip,
      success: false,
      reason: "USER_DISABLED",
    })
    return NextResponse.json({ ok: false, id: "" })
  }

  // 3) 校验订阅状态、到期时间和节点权限
  const activeSub = db
    .prepare(
      `SELECT s.id, s.used_traffic_bytes, p.traffic_limit_bytes
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       JOIN plan_nodes pn ON pn.plan_id = p.id
       WHERE s.user_id = ?
         AND s.status = 'active'
         AND s.expire_time > datetime('now')
         AND pn.node_id = ?
       ORDER BY s.expire_time DESC
       LIMIT 1`,
    )
    .get(user.id, node.id) as
    | { id: number; used_traffic_bytes: number; traffic_limit_bytes: number }
    | undefined

  if (!activeSub) {
    writeAuthLog({
      node_id: node.id,
      node_name: node.name,
      user_id: user.id,
      username: user.username,
      ip,
      success: false,
      reason: "NO_SUB",
    })
    return NextResponse.json({ ok: false, id: "" })
  }

  // 4) 按上报 tx 累加流量
  const nextUsage = activeSub.used_traffic_bytes + Math.floor(body.tx)

  if (nextUsage > activeSub.traffic_limit_bytes) {
    db.prepare(`UPDATE subscriptions SET status = 'blocked' WHERE id = ?`).run(activeSub.id)
    writeAuthLog({
      node_id: node.id,
      node_name: node.name,
      user_id: user.id,
      username: user.username,
      ip,
      success: false,
      reason: "TRAFFIC_EXCEEDED",
    })
    return NextResponse.json({ ok: false, id: "" })
  }

  db.prepare(`UPDATE subscriptions SET used_traffic_bytes = ? WHERE id = ?`).run(nextUsage, activeSub.id)

  writeAuthLog({
    node_id: node.id,
    node_name: node.name,
    user_id: user.id,
    username: user.username,
    ip,
    success: true,
    reason: "OK",
  })
  return NextResponse.json({ ok: true, id: user.username })
}
