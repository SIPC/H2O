import { localizedJson } from "@/lib/i18n/api-response"

import { requireAdmin } from "@/lib/auth"
import { writeAdminEvent } from "@/lib/logs-db"
import {
  getSubscriptionRuleConfig,
  setSubscriptionRuleConfig,
  validateSubscriptionRuleConfig,
} from "@/lib/subscription/rule-config"
import { getClientIp } from "@/lib/turnstile"

function jsonError(
  request: Request,
  code: string,
  message: string,
  status: number
) {
  return localizedJson(
    request,
    { ok: false, error: { code, message } },
    { status }
  )
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  return localizedJson(request, { ok: true, data: getSubscriptionRuleConfig() })
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
    return jsonError(request, "INVALID_PAYLOAD", validation.error, 400)
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

  return localizedJson(request, { ok: true, data: validation.config })
}
