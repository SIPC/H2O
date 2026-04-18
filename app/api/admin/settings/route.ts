import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { writeAdminEvent } from "@/lib/logs-db"
import {
  getAllSettings,
  setSetting,
  SETTING_DEFAULTS,
  type SettingKey,
} from "@/lib/settings"
import { getClientIp } from "@/lib/turnstile"

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

  // 仅接受白名单 key；每项当前都是布尔类型，校验类型再写入
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
    if (typeof body[key] !== "boolean") {
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
          error: { code: "INVALID_PAYLOAD", message: `${key} 必须是布尔值` },
        },
        { status: 400 }
      )
    }
  }

  for (const [key, value] of Object.entries(body)) {
    setSetting(key as SettingKey, value)
  }

  writeAdminEvent({
    event: "SETTINGS_UPDATE",
    actor: auth.user,
    ip,
    success: true,
    reason: "OK",
    // 记录改了哪些 key 及其新值，便于审计
    detail: { changes: body },
  })

  return NextResponse.json({ ok: true, data: getAllSettings() })
}
