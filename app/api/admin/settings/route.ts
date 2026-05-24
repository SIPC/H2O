import { NextResponse } from "next/server"

import { getSessionTokenHashFromRequest, requireAdmin } from "@/lib/auth"
import { cleanupExpiredLogsBySetting, writeAdminEvent } from "@/lib/logs-db"
import {
  getAllSettings,
  SENSITIVE_SETTING_KEYS,
  setSetting,
  SETTING_DEFAULTS,
  SETTING_KEYS,
  type SettingKey,
} from "@/lib/settings"
import {
  createTurnstileSettingsProof,
  getClientIp,
  verifyTurnstileSettingsProof,
  verifyTurnstileToken,
} from "@/lib/turnstile"

// 审计日志里不应出现的敏感 key：只记录是否改动，不记录明文
const SENSITIVE_KEYS = new Set<SettingKey>(SENSITIVE_SETTING_KEYS)

const STATS_RETENTION_DAYS_MIN = 1
const STATS_RETENTION_DAYS_MAX = 365
const TURNSTILE_VERIFY_TOKEN_FIELD = "turnstileVerifyToken"
const TURNSTILE_VERIFY_SITE_KEY_FIELD = "turnstileVerifySiteKey"
const TURNSTILE_VERIFY_SECRET_KEY_FIELD = "turnstileVerifySecretKey"
const TURNSTILE_VERIFY_PROOF_FIELD = "turnstileVerifyProof"
const INTERNAL_SETTING_FIELDS = new Set([
  TURNSTILE_VERIFY_TOKEN_FIELD,
  TURNSTILE_VERIFY_SITE_KEY_FIELD,
  TURNSTILE_VERIFY_SECRET_KEY_FIELD,
  TURNSTILE_VERIFY_PROOF_FIELD,
])

function maskChanges(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (INTERNAL_SETTING_FIELDS.has(key)) continue
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

export async function POST(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const sessionHash = getSessionTokenHashFromRequest(request)
  const body = (await request.json()) as Record<string, unknown>
  const siteKey =
    typeof body[TURNSTILE_VERIFY_SITE_KEY_FIELD] === "string"
      ? body[TURNSTILE_VERIFY_SITE_KEY_FIELD].trim()
      : ""
  const secretKey =
    typeof body[TURNSTILE_VERIFY_SECRET_KEY_FIELD] === "string"
      ? body[TURNSTILE_VERIFY_SECRET_KEY_FIELD].trim()
      : ""
  const token = body[TURNSTILE_VERIFY_TOKEN_FIELD]

  if (!sessionHash || !siteKey || !secretKey || typeof token !== "string") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_PAYLOAD",
          message: "请填写完整 key 并完成人机验证",
        },
      },
      { status: 400 }
    )
  }

  const verified = await verifyTurnstileToken(secretKey, token, ip)
  if (!verified.ok) {
    return NextResponse.json(
      { ok: false, error: { code: verified.code, message: verified.message } },
      { status: 400 }
    )
  }

  return NextResponse.json({
    ok: true,
    data: {
      proof: createTurnstileSettingsProof(siteKey, secretKey, sessionHash),
    },
  })
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
    if (INTERNAL_SETTING_FIELDS.has(key)) continue
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
    const settingKey = key as keyof typeof SETTING_DEFAULTS
    const expected = typeof SETTING_DEFAULTS[settingKey]
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

    if (settingKey === SETTING_KEYS.statsRetentionDays) {
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

  const currentSettings = getAllSettings()
  const currentTurnstileSiteKey = String(
    currentSettings[SETTING_KEYS.turnstileSiteKey] ?? ""
  ).trim()
  const currentTurnstileSecretKey = String(
    currentSettings[SETTING_KEYS.turnstileSecretKey] ?? ""
  ).trim()
  const rawNextTurnstileSiteKey = body[SETTING_KEYS.turnstileSiteKey]
  const rawNextTurnstileSecretKey = body[SETTING_KEYS.turnstileSecretKey]
  const nextTurnstileSiteKey =
    typeof rawNextTurnstileSiteKey === "string"
      ? rawNextTurnstileSiteKey.trim()
      : currentTurnstileSiteKey
  const nextTurnstileSecretKey =
    typeof rawNextTurnstileSecretKey === "string"
      ? rawNextTurnstileSecretKey.trim()
      : currentTurnstileSecretKey
  const turnstileChanged =
    nextTurnstileSiteKey !== currentTurnstileSiteKey ||
    nextTurnstileSecretKey !== currentTurnstileSecretKey

  if (turnstileChanged) {
    const nextSite = nextTurnstileSiteKey
    const nextSecret = nextTurnstileSecretKey
    if ((nextSite && !nextSecret) || (!nextSite && nextSecret)) {
      writeAdminEvent({
        event: "SETTINGS_UPDATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "TURNSTILE_MISCONFIGURED",
        detail: { key: "turnstile" },
      })
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "TURNSTILE_MISCONFIGURED",
            message: "Turnstile Site Key 和 Secret Key 必须同时填写或同时留空",
          },
        },
        { status: 400 }
      )
    }

    if (nextSite && nextSecret) {
      const sessionHash = getSessionTokenHashFromRequest(request)
      const proofValid =
        sessionHash &&
        verifyTurnstileSettingsProof(
          body[TURNSTILE_VERIFY_PROOF_FIELD],
          nextSite,
          nextSecret,
          sessionHash
        )
      if (!proofValid) {
        writeAdminEvent({
          event: "SETTINGS_UPDATE",
          actor: auth.user,
          ip,
          success: false,
          reason: "TURNSTILE_FAILED",
          detail: { key: "turnstile" },
        })
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "TURNSTILE_FAILED",
              message: "请先完成 Turnstile 配置测试验证",
            },
          },
          { status: 400 }
        )
      }
    }
  }

  for (const [key, value] of Object.entries(body)) {
    if (INTERNAL_SETTING_FIELDS.has(key)) continue
    // 字符串值写入前 trim，避免 Turnstile 校验失败
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
  cleanupExpiredLogsBySetting(true)

  return NextResponse.json({ ok: true, data: getAllSettings() })
}
