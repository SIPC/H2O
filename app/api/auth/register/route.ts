import { NextResponse } from "next/server"

import { getDb } from "@/lib/db"
import { hashPassword } from "@/lib/password"
import { createUserAuthToken } from "@/lib/tokens"
import { getClientIp, verifyTurnstile } from "@/lib/turnstile"

type RegisterBody = {
  username?: string
  password?: string
  turnstileToken?: string
}

export async function POST(request: Request) {
  const body = (await request.json()) as RegisterBody

  if (!body.username || !body.password || body.password.length < 6) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_PAYLOAD", message: "用户名或密码不合法" } },
      { status: 400 },
    )
  }

  const turnstile = await verifyTurnstile(body.turnstileToken, getClientIp(request))
  if (!turnstile.ok) {
    return NextResponse.json(
      { ok: false, error: { code: turnstile.code, message: turnstile.message } },
      { status: 400 },
    )
  }

  const db = getDb()

  try {
    const result = db
      .prepare(
        `INSERT INTO users(username, password_hash, auth_token, role, status, updated_at)
         VALUES (?, ?, ?, 'user', 'active', datetime('now'))`,
      )
      .run(body.username, hashPassword(body.password), createUserAuthToken())

    return NextResponse.json({
      ok: true,
      data: {
        user: {
          id: Number(result.lastInsertRowid),
          username: body.username,
          role: "user",
        },
      },
    })
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "USER_EXISTS", message: "用户名已存在" } },
      { status: 400 },
    )
  }
}
