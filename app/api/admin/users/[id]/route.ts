import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { writeAdminEvent } from "@/lib/logs-db"
import { hashPassword } from "@/lib/password"
import { createUserAuthToken } from "@/lib/tokens"
import { getClientIp } from "@/lib/turnstile"

type UpdateUserBody = {
  status?: "active" | "disabled"
  role?: "user" | "admin"
  newPassword?: string
  resetAuthToken?: boolean
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const { id } = await params
  const userId = Number(id)

  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_ID", message: "用户ID不合法" } },
      { status: 400 }
    )
  }

  const body = (await request.json()) as UpdateUserBody

  // 自我保护：不允许 admin 把自己降级为 user 或禁用自己，避免把系统最后一个 admin 锁出去
  if (auth.user.id === userId) {
    if (body.role && body.role !== "admin") {
      writeAdminEvent({
        event: "USER_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "SELF_DEMOTE_FORBIDDEN",
        detail: { targetUserId: userId },
      })
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "SELF_DEMOTE_FORBIDDEN",
            message: "不能把当前登录的管理员降级",
          },
        },
        { status: 400 }
      )
    }
    if (body.status === "disabled") {
      writeAdminEvent({
        event: "USER_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "SELF_DISABLE_FORBIDDEN",
        detail: { targetUserId: userId },
      })
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "SELF_DISABLE_FORBIDDEN",
            message: "不能禁用当前登录的管理员",
          },
        },
        { status: 400 }
      )
    }
  }

  const updates: string[] = []
  const values: Array<string | number> = []
  // 收集本次改动的字段名，用于日志 detail
  const changedFields: string[] = []

  if (body.status) {
    updates.push("status = ?")
    values.push(body.status)
    changedFields.push("status")
  }

  if (body.role) {
    updates.push("role = ?")
    values.push(body.role)
    changedFields.push("role")
  }

  if (body.newPassword) {
    if (body.newPassword.length < 6) {
      writeAdminEvent({
        event: "USER_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "INVALID_PASSWORD",
        detail: { targetUserId: userId },
      })
      return NextResponse.json(
        {
          ok: false,
          error: { code: "INVALID_PASSWORD", message: "密码至少 6 位" },
        },
        { status: 400 }
      )
    }

    updates.push("password_hash = ?")
    values.push(hashPassword(body.newPassword))
    changedFields.push("password")
  }

  if (body.resetAuthToken === true) {
    // 轮换节点登录 Key，同时订阅链接随之失效
    updates.push("auth_token = ?")
    values.push(createUserAuthToken())
  }

  if (updates.length === 0) {
    writeAdminEvent({
      event: "USER_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { targetUserId: userId },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: "没有可更新字段" },
      },
      { status: 400 }
    )
  }

  updates.push("updated_at = datetime('now')")
  values.push(userId)

  const db = getDb()
  const result = db
    .prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
    .run(...values)

  if (result.changes === 0) {
    writeAdminEvent({
      event: "USER_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "NOT_FOUND",
      detail: { targetUserId: userId },
    })
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "用户不存在" } },
      { status: 404 }
    )
  }

  // 读一次目标用户名，方便两类日志都带上人类可读字段
  const target = db
    .prepare(`SELECT username FROM users WHERE id = ? LIMIT 1`)
    .get(userId) as { username: string } | undefined

  // 密码或角色变动后，撤销该用户所有未失效的 session：
  // 防止已偷走 cookie 的攻击者在密码重置 / 降级后继续持有会话
  const shouldRevokeSessions =
    Boolean(body.newPassword) || Boolean(body.role)
  if (shouldRevokeSessions) {
    db.prepare(
      `UPDATE sessions SET revoked_at = datetime('now')
       WHERE user_id = ? AND revoked_at IS NULL`
    ).run(userId)
  }

  // admin 重置用户节点登录 Key 是高危操作，单独记一条 RESET_TOKEN_ADMIN
  if (body.resetAuthToken === true) {
    writeAdminEvent({
      event: "RESET_TOKEN_ADMIN",
      actor: auth.user,
      ip,
      success: true,
      reason: "OK",
      detail: {
        targetUserId: userId,
        targetUsername: target?.username ?? null,
      },
    })
  }

  // 其他字段改动合并记一条 USER_UPDATE（只有 resetAuthToken 时不再重复记）
  if (changedFields.length > 0) {
    writeAdminEvent({
      event: "USER_UPDATE",
      actor: auth.user,
      ip,
      success: true,
      reason: "OK",
      detail: {
        targetUserId: userId,
        targetUsername: target?.username ?? null,
        fields: changedFields,
      },
    })
  }

  return NextResponse.json({ ok: true, data: { id: userId } })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const { id } = await params
  const userId = Number(id)

  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_ID", message: "用户ID不合法" } },
      { status: 400 }
    )
  }

  // 防止 admin 删除自己
  if (auth.user.id === userId) {
    writeAdminEvent({
      event: "USER_DELETE",
      actor: auth.user,
      ip,
      success: false,
      reason: "CANNOT_DELETE_SELF",
      detail: { targetUserId: userId },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "CANNOT_DELETE_SELF", message: "不能删除当前登录用户" },
      },
      { status: 400 }
    )
  }

  const db = getDb()
  // 先查出用户名用于日志记录，删除后就拿不到了
  const target = db
    .prepare(`SELECT username FROM users WHERE id = ? LIMIT 1`)
    .get(userId) as { username: string } | undefined

  // sessions/subscriptions 均 ON DELETE CASCADE；auth_logs 冗余用户名，不受影响
  try {
    const result = db.prepare(`DELETE FROM users WHERE id = ?`).run(userId)

    if (result.changes === 0) {
      writeAdminEvent({
        event: "USER_DELETE",
        actor: auth.user,
        ip,
        success: false,
        reason: "NOT_FOUND",
        detail: { targetUserId: userId },
      })
      return NextResponse.json(
        { ok: false, error: { code: "NOT_FOUND", message: "用户不存在" } },
        { status: 404 }
      )
    }

    writeAdminEvent({
      event: "USER_DELETE",
      actor: auth.user,
      ip,
      success: true,
      reason: "OK",
      detail: {
        targetUserId: userId,
        targetUsername: target?.username ?? null,
      },
    })
    return NextResponse.json({ ok: true, data: { id: userId } })
  } catch {
    writeAdminEvent({
      event: "USER_DELETE",
      actor: auth.user,
      ip,
      success: false,
      reason: "DELETE_FAILED",
      detail: { targetUserId: userId },
    })
    return NextResponse.json(
      { ok: false, error: { code: "DELETE_FAILED", message: "用户删除失败" } },
      { status: 400 }
    )
  }
}
