import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { hashPassword } from "@/lib/password"
import { createUserAuthToken } from "@/lib/tokens"

type UpdateUserBody = {
  status?: "active" | "disabled"
  role?: "user" | "admin"
  newPassword?: string
  resetAuthToken?: boolean
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const { id } = await params
  const userId = Number(id)

  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_ID", message: "用户ID不合法" } },
      { status: 400 },
    )
  }

  const body = (await request.json()) as UpdateUserBody
  const updates: string[] = []
  const values: Array<string | number> = []

  if (body.status) {
    updates.push("status = ?")
    values.push(body.status)
  }

  if (body.role) {
    updates.push("role = ?")
    values.push(body.role)
  }

  if (body.newPassword) {
    if (body.newPassword.length < 6) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_PASSWORD", message: "密码至少 6 位" } },
        { status: 400 },
      )
    }

    updates.push("password_hash = ?")
    values.push(hashPassword(body.newPassword))
  }

  if (body.resetAuthToken === true) {
    // 轮换节点登录 Key，同时订阅链接随之失效
    updates.push("auth_token = ?")
    values.push(createUserAuthToken())
  }

  if (updates.length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_PAYLOAD", message: "没有可更新字段" } },
      { status: 400 },
    )
  }

  updates.push("updated_at = datetime('now')")
  values.push(userId)

  const db = getDb()
  const result = db
    .prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
    .run(...values)

  if (result.changes === 0) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "用户不存在" } },
      { status: 404 },
    )
  }

  return NextResponse.json({ ok: true, data: { id: userId } })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const { id } = await params
  const userId = Number(id)

  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_ID", message: "用户ID不合法" } },
      { status: 400 },
    )
  }

  // 防止 admin 删除自己
  if (auth.user.id === userId) {
    return NextResponse.json(
      { ok: false, error: { code: "CANNOT_DELETE_SELF", message: "不能删除当前登录用户" } },
      { status: 400 },
    )
  }

  const db = getDb()

  // sessions/subscriptions 均 ON DELETE CASCADE；auth_logs 冗余用户名，不受影响
  try {
    const result = db.prepare(`DELETE FROM users WHERE id = ?`).run(userId)

    if (result.changes === 0) {
      return NextResponse.json(
        { ok: false, error: { code: "NOT_FOUND", message: "用户不存在" } },
        { status: 404 },
      )
    }

    return NextResponse.json({ ok: true, data: { id: userId } })
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "DELETE_FAILED", message: "用户删除失败" } },
      { status: 400 },
    )
  }
}
