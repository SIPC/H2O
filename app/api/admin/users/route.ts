import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { writeAdminEvent } from "@/lib/logs-db"
import { hashPassword, isPasswordHash } from "@/lib/password"
import { createUserAuthToken } from "@/lib/tokens"
import { getClientIp } from "@/lib/turnstile"

type CreateUserBody = {
  username?: string
  password?: string
  passwordHash?: string
  authToken?: string
  role?: "user" | "admin"
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, username, role, status, auth_token, created_at, updated_at, last_login_at
       FROM users
       ORDER BY id DESC`
    )
    .all()

  return NextResponse.json({ ok: true, data: rows })
}

export async function POST(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const body = (await request.json().catch(() => ({}))) as CreateUserBody

  if (
    !body ||
    typeof body !== "object" ||
    !body.username ||
    (!body.password && !body.passwordHash)
  ) {
    writeAdminEvent({
      event: "USER_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { targetUsername: body?.username ?? null },
    })
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_PAYLOAD", message: "参数不完整" } },
      { status: 400 }
    )
  }

  if (body.role && body.role !== "user" && body.role !== "admin") {
    writeAdminEvent({
      event: "USER_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { targetUsername: body.username, role: body.role },
    })
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_PAYLOAD", message: "角色不合法" } },
      { status: 400 }
    )
  }

  if (body.password && body.password.length < 6) {
    writeAdminEvent({
      event: "USER_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PASSWORD",
      detail: { targetUsername: body.username },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PASSWORD", message: "密码至少 6 位" },
      },
      { status: 400 }
    )
  }

  if (body.passwordHash && !isPasswordHash(body.passwordHash)) {
    writeAdminEvent({
      event: "USER_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PASSWORD",
      detail: { targetUsername: body.username },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PASSWORD", message: "密码哈希不合法" },
      },
      { status: 400 }
    )
  }

  if (body.authToken && !/^[a-f0-9]{48}$/i.test(body.authToken)) {
    writeAdminEvent({
      event: "USER_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { targetUsername: body.username },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: "认证 Key 不合法" },
      },
      { status: 400 }
    )
  }

  const role = body.role ?? "user"
  const passwordHash =
    body.passwordHash ?? hashPassword(body.password as string)
  const authToken = body.authToken ?? createUserAuthToken()
  const db = getDb()

  try {
    const result = db
      .prepare(
        `INSERT INTO users(username, password_hash, auth_token, role, status, updated_at)
         VALUES (?, ?, ?, ?, 'active', datetime('now'))`
      )
      .run(body.username, passwordHash, authToken, role)

    const newUserId = Number(result.lastInsertRowid)
    writeAdminEvent({
      event: "USER_CREATE",
      actor: auth.user,
      ip,
      success: true,
      reason: "OK",
      detail: { targetUserId: newUserId, targetUsername: body.username, role },
    })

    return NextResponse.json({
      ok: true,
      data: {
        id: newUserId,
        username: body.username,
        role,
      },
    })
  } catch {
    writeAdminEvent({
      event: "USER_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "CREATE_FAILED",
      detail: { targetUsername: body.username },
    })
    return NextResponse.json(
      { ok: false, error: { code: "CREATE_FAILED", message: "用户创建失败" } },
      { status: 400 }
    )
  }
}
