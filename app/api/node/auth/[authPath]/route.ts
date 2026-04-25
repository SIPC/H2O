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
  { params }: { params: Promise<{ authPath: string }> }
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

  // tx 是 Hy2 传来的下行速率（字节/秒），仅握手时触发一次，不用于计费
  // 流量统计由 agent 通过 Traffic Stats API 完成

  const db = getDb()

  // 1) 先校验节点路径是否合法且节点启用
  const node = db
    .prepare(
      `SELECT id, name FROM nodes WHERE auth_path = ? AND status = 'enabled' LIMIT 1`
    )
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
    .prepare(
      `SELECT id, username, status FROM users WHERE auth_token = ? LIMIT 1`
    )
    .get(body.auth) as
    | { id: number; username: string; status: "active" | "disabled" }
    | undefined

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

  // 3) 校验订阅状态、到期时间和节点权限（仅认证，不计费）
  const activeSub = db
    .prepare(
      `SELECT s.id
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       JOIN plan_nodes pn ON pn.plan_id = p.id
       WHERE s.user_id = ?
         AND s.status = 'active'
         AND s.expire_time > datetime('now')
         AND pn.node_id = ?
       ORDER BY s.expire_time DESC
       LIMIT 1`
    )
    .get(user.id, node.id) as { id: number } | undefined

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
