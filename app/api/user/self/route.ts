import { localizedJson } from "@/lib/i18n/api-response"

import { requireUser } from "@/lib/auth"
import { resolveLocaleFromRequest } from "@/lib/i18n/server"

export async function GET(request: Request) {
  const auth = requireUser(request)
  if (!auth.ok) return auth.response

  return localizedJson(request, {
    ok: true,
    data: {
      id: auth.user.id,
      username: auth.user.username,
      role: auth.user.role,
      status: auth.user.status,
      preferredLocale: auth.user.preferred_locale ?? "inherit",
      resolvedLocale: resolveLocaleFromRequest(request),
    },
  })
}
