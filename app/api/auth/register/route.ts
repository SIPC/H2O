import { localizedJson } from "@/lib/i18n/api-response"

import { getDb } from "@/lib/db"
import { writeEventLog } from "@/lib/logs-db"
import { hashPassword } from "@/lib/password"
import { getSetting, SETTING_KEYS } from "@/lib/settings"
import { createUserAuthToken } from "@/lib/tokens"
import { getClientIp, verifyTurnstile } from "@/lib/turnstile"

type RegisterBody = {
  username?: string
  password?: string
  turnstileToken?: string
}

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const body = (await request.json().catch(() => ({}))) as RegisterBody

  // 注册总开关关闭时直接拒绝
  if (!getSetting<boolean>(SETTING_KEYS.registrationEnabled, true)) {
    writeEventLog({
      event: "REGISTER",
      user_id: null,
      username: body.username ?? null,
      ip,
      success: false,
      reason: "REGISTRATION_DISABLED",
    })
    return localizedJson(
      request,
      {
        ok: false,
        error: { code: "REGISTRATION_DISABLED", message: "注册已关闭" },
      },
      { status: 403 }
    )
  }

  if (!body.username || !body.password || body.password.length < 6) {
    writeEventLog({
      event: "REGISTER",
      user_id: null,
      username: body.username ?? null,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
    })
    return localizedJson(
      request,
      {
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: "用户名或密码不合法" },
      },
      { status: 400 }
    )
  }

  const turnstile = await verifyTurnstile(body.turnstileToken, ip)
  if (!turnstile.ok) {
    writeEventLog({
      event: "REGISTER",
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
  // 根据设置决定新用户初始状态：关闭时创建为 disabled 等管理员审核
  const defaultActive = getSetting<boolean>(
    SETTING_KEYS.newUserDefaultActive,
    true
  )
  const status = defaultActive ? "active" : "disabled"

  try {
    const result = db
      .prepare(
        `INSERT INTO users(username, password_hash, auth_token, role, status, updated_at)
         VALUES (?, ?, ?, 'user', ?, datetime('now'))`
      )
      .run(
        body.username,
        hashPassword(body.password),
        createUserAuthToken(),
        status
      )

    const newUserId = Number(result.lastInsertRowid)
    writeEventLog({
      event: "REGISTER",
      user_id: newUserId,
      username: body.username,
      ip,
      success: true,
      reason: "OK",
      detail: JSON.stringify({ status }),
    })

    return localizedJson(request, {
      ok: true,
      data: {
        user: {
          id: newUserId,
          username: body.username,
          role: "user",
          status,
        },
      },
    })
  } catch {
    writeEventLog({
      event: "REGISTER",
      user_id: null,
      username: body.username,
      ip,
      success: false,
      reason: "USER_EXISTS",
    })
    return localizedJson(
      request,
      { ok: false, error: { code: "USER_EXISTS", message: "用户名已存在" } },
      { status: 400 }
    )
  }
}
