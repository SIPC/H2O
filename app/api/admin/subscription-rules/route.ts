import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { writeAdminEvent } from "@/lib/logs-db"
import {
  getSubscriptionRuleConfig,
  setSubscriptionRuleConfig,
  validateSubscriptionRuleConfig,
} from "@/lib/subscription/rule-config"
import { getClientIp } from "@/lib/turnstile"

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  return NextResponse.json({ ok: true, data: getSubscriptionRuleConfig() })
}

export async function PATCH(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const body = (await request.json()) as unknown
  const validation = validateSubscriptionRuleConfig(body)

  if (!validation.ok) {
    writeAdminEvent({
      event: "SETTINGS_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "SUBSCRIPTION_RULES_INVALID",
      detail: { error: validation.error },
    })
    return jsonError("INVALID_PAYLOAD", validation.error, 400)
  }

  setSubscriptionRuleConfig(validation.config)

  writeAdminEvent({
    event: "SETTINGS_UPDATE",
    actor: auth.user,
    ip,
    success: true,
    reason: "SUBSCRIPTION_RULES_UPDATE",
    detail: {
      enabled: validation.config.enabled,
      mode: validation.config.mode,
      finalTarget: validation.config.finalTarget,
      policyGroupCount: validation.config.policyGroups.length,
      ruleCount: validation.config.rules.length,
      remoteRuleSetCount: validation.config.remoteRuleSets.length,
    },
  })

  return NextResponse.json({ ok: true, data: validation.config })
}
