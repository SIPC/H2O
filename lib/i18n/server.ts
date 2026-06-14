import { createHash } from "node:crypto"

import { cookies, headers } from "next/headers"
import type { NextResponse } from "next/server"

import { getDb } from "@/lib/db"
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  type Locale,
  normalizeLocale,
  pickLocaleFromAcceptLanguage,
} from "@/lib/i18n/locales"
import { getSetting, SETTING_KEYS } from "@/lib/settings"

const SESSION_COOKIE = "h2o_session"

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function parseCookieHeader(header: string | null) {
  const out = new Map<string, string>()
  if (!header) return out

  for (const item of header.split(";")) {
    const [rawName, ...rawValue] = item.trim().split("=")
    if (!rawName || rawValue.length === 0) continue

    const value = rawValue.join("=")
    try {
      out.set(rawName, decodeURIComponent(value))
    } catch {
      out.set(rawName, value)
    }
  }

  return out
}

function cookieSecure() {
  if (process.env.H2O_SECURE_COOKIE === "false") return false
  return process.env.NODE_ENV === "production"
}

function getGlobalLocale(): Locale {
  return (
    normalizeLocale(
      getSetting<string>(SETTING_KEYS.uiLanguage, DEFAULT_LOCALE)
    ) ?? DEFAULT_LOCALE
  )
}

function getSessionLocaleByToken(token: string | null): {
  authenticated: boolean
  preferredLocale: Locale | null
} {
  if (!token) return { authenticated: false, preferredLocale: null }

  const db = getDb()
  const tokenHash = sha256(token)
  const row = db
    .prepare(
      `SELECT u.preferred_locale
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.session_token_hash = ?
         AND s.revoked_at IS NULL
         AND datetime(s.expires_at) > datetime('now')
         AND u.status = 'active'
       LIMIT 1`
    )
    .get(tokenHash) as { preferred_locale: string | null } | undefined

  if (!row) return { authenticated: false, preferredLocale: null }
  return {
    authenticated: true,
    preferredLocale: normalizeLocale(row.preferred_locale),
  }
}

export function resolveLocaleFromRequest(request: Request): Locale {
  const cookieHeader = request.headers.get("cookie")
  const cookieMap = parseCookieHeader(cookieHeader)
  const sessionLocale = getSessionLocaleByToken(
    cookieMap.get(SESSION_COOKIE) ?? null
  )
  if (sessionLocale.authenticated) {
    return sessionLocale.preferredLocale ?? getGlobalLocale()
  }

  const cookieLocale = normalizeLocale(cookieMap.get(LOCALE_COOKIE))
  if (cookieLocale) return cookieLocale

  const globalLocale = getGlobalLocale()
  if (globalLocale) return globalLocale

  return (
    pickLocaleFromAcceptLanguage(request.headers.get("accept-language")) ??
    DEFAULT_LOCALE
  )
}

export async function resolveServerLocale(): Promise<Locale> {
  const cookieStore = await cookies()
  const headerStore = await headers()

  const sessionLocale = getSessionLocaleByToken(
    cookieStore.get(SESSION_COOKIE)?.value ?? null
  )
  if (sessionLocale.authenticated) {
    return sessionLocale.preferredLocale ?? getGlobalLocale()
  }

  const cookieLocale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value)
  if (cookieLocale) return cookieLocale

  const globalLocale = getGlobalLocale()
  if (globalLocale) return globalLocale

  return (
    pickLocaleFromAcceptLanguage(headerStore.get("accept-language")) ??
    DEFAULT_LOCALE
  )
}

export function setLocaleCookie(response: NextResponse, locale: Locale) {
  response.cookies.set({
    name: LOCALE_COOKIE,
    value: locale,
    httpOnly: false,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })
}

export function getResolvedLocaleForPreference(
  preferredLocale: Locale | "inherit"
): Locale {
  if (preferredLocale !== "inherit") return preferredLocale
  return getGlobalLocale()
}
