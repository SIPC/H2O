import { NextResponse } from "next/server"

import { createSession, setSessionCookie } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { verifyPassword } from "@/lib/password"
import { getClientIp, verifyTurnstile } from "@/lib/turnstile"

type LoginBody = {
  username?: string
  password?: string
  turnstileToken?: string
}

export async function POST(request: Request) {
  const body = (await request.json()) as LoginBody
  if (!body.username || !body.password) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_PAYLOAD", message: "参数不完整" } },
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
  const user = db
    .prepare(
      `SELECT id, username, password_hash, role, status
       FROM users
       WHERE username = ?
       LIMIT 1`,
    )
    .get(body.username) as
    | { id: number; username: string; password_hash: string; role: "user" | "admin"; status: "active" | "disabled" }
    | undefined

  if (!user || user.status !== "active" || !verifyPassword(body.password, user.password_hash)) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_CREDENTIALS", message: "用户名或密码错误" } },
      { status: 401 },
    )
  }

  const session = createSession(user.id)
  db.prepare(`UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(user.id)

  const response = NextResponse.json({
    ok: true,
    data: { user: { id: user.id, username: user.username, role: user.role } },
  })

  setSessionCookie(response, session.token, session.expiresAt)
  return response
}
