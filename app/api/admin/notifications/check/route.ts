import { localizedJson } from "@/lib/i18n/api-response"

import { requireAdmin } from "@/lib/auth"
import { runNotificationChecks } from "@/lib/notifications"

export async function POST(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const result = await runNotificationChecks()
  return localizedJson(request, { ok: true, data: result })
}
