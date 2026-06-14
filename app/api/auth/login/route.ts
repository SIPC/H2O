import { localizedJson } from "@/lib/i18n/api-response"

import { createSession, setSessionCookie } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { normalizeLocale } from "@/lib/i18n/locales"
import {
  getResolvedLocaleForPreference,
  setLocaleCookie,
} from "@/lib/i18n/server"
import { writeEventLog } from "@/lib/logs-db"
import { verifyPassword } from "@/lib/password"
import { getSetting, SETTING_KEYS } from "@/lib/settings"
import { getClientIp, verifyTurnstile } from "@/lib/turnstile"

type LoginBody = {
  username?: string
  password?: string
  turnstileToken?: string
}

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const body = (await request.json().catch(() => ({}))) as LoginBody

  if (!body || typeof body !== "object" || !body.username || !body.password) {
    writeEventLog({
      event: "LOGIN",
      user_id: null,
      username: body?.username ?? null,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
    })
    return localizedJson(
      request,
      { ok: false, error: { code: "INVALID_PAYLOAD", message: "参数不完整" } },
      { status: 400 }
    )
  }

  const turnstile = await verifyTurnstile(body.turnstileToken, ip)
  if (!turnstile.ok) {
    writeEventLog({
      event: "LOGIN",
      user_id: null,
      username: body.username,
      ip,
      success: false,
      reason: turnstile.code,
    })
    return localizedJson(
      request,
      {
        ok: false,
        error: { code: turnstile.code, message: turnstile.message },
      },
      { status: 400 }
    )
  }

  const db = getDb()
  const user = db
    .prepare(
      `SELECT id, username, password_hash, role, status, preferred_locale
       FROM users
       WHERE username = ?
       LIMIT 1`
    )
    .get(body.username) as
    | {
        id: number
        username: string
        password_hash: string
        role: "user" | "admin"
        status: "active" | "disabled"
        preferred_locale: string | null
      }
    | undefined

  if (!user) {
    writeEventLog({
      event: "LOGIN",
      user_id: null,
      username: body.username,
      ip,
      success: false,
      reason: "NO_USER",
    })
    return localizedJson(
      request,
      {
        ok: false,
        error: { code: "INVALID_CREDENTIALS", message: "用户名或密码错误" },
      },
      { status: 401 }
    )
  }

  if (user.status !== "active") {
    writeEventLog({
      event: "LOGIN",
      user_id: user.id,
      username: user.username,
      ip,
      success: false,
      reason: "USER_DISABLED",
    })
    return localizedJson(
      request,
      {
        ok: false,
        error: { code: "INVALID_CREDENTIALS", message: "用户名或密码错误" },
      },
      { status: 401 }
    )
  }

  if (!verifyPassword(body.password, user.password_hash)) {
    writeEventLog({
      event: "LOGIN",
      user_id: user.id,
      username: user.username,
      ip,
      success: false,
      reason: "BAD_PASSWORD",
    })
    return localizedJson(
      request,
      {
        ok: false,
        error: { code: "INVALID_CREDENTIALS", message: "用户名或密码错误" },
      },
      { status: 401 }
    )
  }

  // 登录总开关关闭时仅放行 admin，避免把管理员锁在外面
  if (
    !getSetting<boolean>(SETTING_KEYS.loginEnabled, true) &&
    user.role !== "admin"
  ) {
    writeEventLog({
      event: "LOGIN",
      user_id: user.id,
      username: user.username,
      ip,
      success: false,
      reason: "LOGIN_DISABLED",
    })
    return localizedJson(
      request,
      { ok: false, error: { code: "LOGIN_DISABLED", message: "登录已关闭" } },
      { status: 403 }
    )
  }

  const session = createSession(user.id)
  db.prepare(
    `UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).run(user.id)

  writeEventLog({
    event: "LOGIN",
    user_id: user.id,
    username: user.username,
    ip,
    success: true,
    reason: "OK",
    detail: JSON.stringify({ role: user.role }),
  })

  const resolvedLocale =
    normalizeLocale(user.preferred_locale) ??
    getResolvedLocaleForPreference("inherit")
  const response = localizedJson(request, {
    ok: true,
    data: {
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        preferredLocale: user.preferred_locale ?? "inherit",
        resolvedLocale,
      },
    },
  })

  setSessionCookie(response, session.token, session.expiresAt)
  setLocaleCookie(response, resolvedLocale)
  return response
}
