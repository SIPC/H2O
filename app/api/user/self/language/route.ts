import { localizedJson } from "@/lib/i18n/api-response"

import { requireUser } from "@/lib/auth"
import { getDb } from "@/lib/db"
import {
  type Locale,
  type UserLocalePreference,
  isUserLocalePreference,
} from "@/lib/i18n/locales"
import {
  getResolvedLocaleForPreference,
  setLocaleCookie,
} from "@/lib/i18n/server"

type UpdateLanguageBody = {
  preferredLocale?: unknown
}

export async function PATCH(request: Request) {
  const auth = requireUser(request)
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return localizedJson(
      request,
      {
        ok: false,
        error: { code: "INVALID_LOCALE", message: "语言设置不合法" },
      },
      { status: 400 }
    )
  }

  const preferredLocale = (body as UpdateLanguageBody).preferredLocale

  if (!isUserLocalePreference(preferredLocale)) {
    return localizedJson(
      request,
      {
        ok: false,
        error: { code: "INVALID_LOCALE", message: "语言设置不合法" },
      },
      { status: 400 }
    )
  }

  const value: Locale | null =
    preferredLocale === "inherit" ? null : preferredLocale
  const db = getDb()
  db.prepare(
    `UPDATE users SET preferred_locale = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(value, auth.user.id)

  const resolvedLocale = getResolvedLocaleForPreference(preferredLocale)
  const response = localizedJson(request, {
    ok: true,
    data: {
      preferredLocale: preferredLocale as UserLocalePreference,
      resolvedLocale,
    },
  })
  setLocaleCookie(response, resolvedLocale)
  return response
}
