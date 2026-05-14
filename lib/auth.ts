import { createHash, randomBytes } from "node:crypto"

import { NextResponse } from "next/server"

import { getDb } from "@/lib/db"

const SESSION_COOKIE = "h2o_session"
const SESSION_TTL_DAYS = 14

export type SessionUser = {
  id: number
  username: string
  role: "user" | "admin"
  status: "active" | "disabled"
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function getSessionTokenHashFromRequest(request: Request) {
  const token = readSessionTokenFromRequest(request)
  return token ? sha256(token) : null
}

function cookieSecure() {
  // 纯 IP+端口（HTTP）部署时设 H2O_SECURE_COOKIE=false，否则 cookie 无法存储
  if (process.env.H2O_SECURE_COOKIE === "false") return false
  return process.env.NODE_ENV === "production"
}

function readSessionTokenFromRequest(request: Request) {
  const cookie = request.headers.get("cookie")
  if (!cookie) return null

  const token = cookie
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(`${SESSION_COOKIE}=`.length)

  if (!token) return null
  return decodeURIComponent(token)
}

// 生成并持久化 session，返回明文 token 用于写 cookie
export function createSession(userId: number) {
  const token = randomBytes(32).toString("hex")
  const tokenHash = sha256(token)

  const expires = new Date()
  expires.setDate(expires.getDate() + SESSION_TTL_DAYS)

  const db = getDb()
  db.prepare(
    `INSERT INTO sessions(user_id, session_token_hash, expires_at, last_seen_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).run(userId, tokenHash, expires.toISOString())

  return { token, expiresAt: expires }
}

// 从请求里解析 session 对应用户
export function getSessionUser(request: Request) {
  const token = readSessionTokenFromRequest(request)
  if (!token) return null

  const tokenHash = sha256(token)
  const db = getDb()

  const row = db
    .prepare(
      `SELECT u.id, u.username, u.role, u.status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.session_token_hash = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > datetime('now')
       LIMIT 1`
    )
    .get(tokenHash) as SessionUser | undefined

  if (!row || row.status !== "active") return null

  db.prepare(
    `UPDATE sessions SET last_seen_at = datetime('now') WHERE session_token_hash = ?`
  ).run(tokenHash)
  return row
}

export function requireUser(request: Request) {
  const user = getSessionUser(request)
  if (!user) {
    const response = NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "请先登录" } },
      { status: 401 }
    )
    clearSessionCookie(response)
    return { ok: false as const, response }
  }

  return { ok: true as const, user }
}

export function requireAdmin(request: Request) {
  const auth = requireUser(request)
  if (!auth.ok) return auth
  if (auth.user.role !== "admin") {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: { code: "FORBIDDEN", message: "需要管理员权限" } },
        { status: 403 }
      ),
    }
  }

  return { ok: true as const, user: auth.user }
}

// 在响应上设置 HttpOnly 会话 cookie
export function setSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date
) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  })
}

// 清理会话 cookie
export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  })
}

// 注销当前会话
export function revokeSessionByRequest(request: Request) {
  const token = readSessionTokenFromRequest(request)
  if (!token) return

  const tokenHash = sha256(token)
  const db = getDb()
  db.prepare(
    `UPDATE sessions SET revoked_at = datetime('now') WHERE session_token_hash = ?`
  ).run(tokenHash)
}
