import { NextResponse } from "next/server"

import { getDb } from "@/lib/db"
import { writeEventLog } from "@/lib/logs-db"
import { hashPassword } from "@/lib/password"
import { createUserAuthToken } from "@/lib/tokens"
import { getClientIp } from "@/lib/turnstile"

type BootstrapAdminBody = {
  username?: string
  password?: string
}

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const body = (await request.json().catch(() => ({}))) as BootstrapAdminBody

  if (!body.username || !body.password || body.password.length < 6) {
    writeEventLog({
      event: "BOOTSTRAP_ADMIN",
      user_id: null,
      username: body.username ?? null,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: "用户名或密码不合法" },
      },
      { status: 400 }
    )
  }

  const db = getDb()
  const exists = db
    .prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`)
    .get() as { id: number } | undefined

  if (exists) {
    writeEventLog({
      event: "BOOTSTRAP_ADMIN",
      user_id: null,
      username: body.username,
      ip,
      success: false,
      reason: "ADMIN_EXISTS",
    })
    return NextResponse.json(
      { ok: false, error: { code: "ADMIN_EXISTS", message: "管理员已存在" } },
      { status: 400 }
    )
  }

  try {
    const result = db
      .prepare(
        `INSERT INTO users(username, password_hash, auth_token, role, status, updated_at)
         VALUES (?, ?, ?, 'admin', 'active', datetime('now'))`
      )
      .run(body.username, hashPassword(body.password), createUserAuthToken())

    const newUserId = Number(result.lastInsertRowid)
    writeEventLog({
      event: "BOOTSTRAP_ADMIN",
      user_id: newUserId,
      username: body.username,
      ip,
      success: true,
      reason: "OK",
    })

    return NextResponse.json({
      ok: true,
      data: {
        user: {
          id: newUserId,
          username: body.username,
          role: "admin",
        },
      },
    })
  } catch {
    writeEventLog({
      event: "BOOTSTRAP_ADMIN",
      user_id: null,
      username: body.username,
      ip,
      success: false,
      reason: "CREATE_FAILED",
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "CREATE_FAILED", message: "管理员创建失败" },
      },
      { status: 400 }
    )
  }
}
