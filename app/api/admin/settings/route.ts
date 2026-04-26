import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { writeAdminEvent } from "@/lib/logs-db"
import {
  getAllSettings,
  setSetting,
  SETTING_DEFAULTS,
  SETTING_KEYS,
  type SettingKey,
} from "@/lib/settings"
import { getClientIp } from "@/lib/turnstile"

// 审计日志里不应出现的敏感 key：只记录是否改动，不记录明文
const SENSITIVE_KEYS = new Set<SettingKey>([
  SETTING_KEYS.turnstileSecretKey,
  SETTING_KEYS.agentBundleUrl,
])

const STATS_RETENTION_DAYS_MIN = 1
const STATS_RETENTION_DAYS_MAX = 365

function maskChanges(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_KEYS.has(key as SettingKey)) {
      out[key] =
        typeof value === "string" && value.length > 0 ? "[SET]" : "[CLEARED]"
    } else {
      out[key] = value
    }
  }
  return out
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  return NextResponse.json({ ok: true, data: getAllSettings() })
}

export async function PATCH(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const body = (await request.json()) as Record<string, unknown>
  if (!body || typeof body !== "object") {
    writeAdminEvent({
      event: "SETTINGS_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: "请求体格式不合法" },
      },
      { status: 400 }
    )
  }

  // 仅接受白名单 key；按每项默认值类型（boolean 或 string）校验请求值
  for (const key of Object.keys(body)) {
    if (!(key in SETTING_DEFAULTS)) {
      writeAdminEvent({
        event: "SETTINGS_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "UNKNOWN_KEY",
        detail: { key },
      })
      return NextResponse.json(
        {
          ok: false,
          error: { code: "UNKNOWN_KEY", message: `未知设置项: ${key}` },
        },
        { status: 400 }
      )
    }
    const expected = typeof SETTING_DEFAULTS[key as SettingKey]
    if (typeof body[key] !== expected) {
      writeAdminEvent({
        event: "SETTINGS_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "INVALID_PAYLOAD",
        detail: { key },
      })
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: `${key} 必须是 ${expected} 类型`,
          },
        },
        { status: 400 }
      )
    }

    if (key === SETTING_KEYS.statsRetentionDays) {
      const value = body[key]
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < STATS_RETENTION_DAYS_MIN ||
        value > STATS_RETENTION_DAYS_MAX
      ) {
        writeAdminEvent({
          event: "SETTINGS_UPDATE",
          actor: auth.user,
          ip,
          success: false,
          reason: "INVALID_PAYLOAD",
          detail: { key, value },
        })
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "INVALID_PAYLOAD",
              message: `${key} 必须是 ${STATS_RETENTION_DAYS_MIN}~${STATS_RETENTION_DAYS_MAX} 的整数`,
            },
          },
          { status: 400 }
        )
      }
    }
  }

  for (const [key, value] of Object.entries(body)) {
    // 字符串值写入前 trim，避免前后空格导致 Turnstile 校验失败
    const normalized = typeof value === "string" ? value.trim() : value
    setSetting(key as SettingKey, normalized)
  }

  writeAdminEvent({
    event: "SETTINGS_UPDATE",
    actor: auth.user,
    ip,
    success: true,
    reason: "OK",
    // 记录改了哪些 key；敏感 key 只记 [SET]/[CLEARED]，不落明文
    detail: { changes: maskChanges(body) },
  })

  return NextResponse.json({ ok: true, data: getAllSettings() })
}
