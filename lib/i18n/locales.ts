export const LOCALES = ["zh-CN", "en-US"] as const

export type Locale = (typeof LOCALES)[number]
export type UserLocalePreference = Locale | "inherit"

export const DEFAULT_LOCALE: Locale = "zh-CN"
export const LOCALE_COOKIE = "h2o_locale"

export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
}

export const USER_LOCALE_LABELS: Record<UserLocalePreference, string> = {
  inherit: "跟随站点",
  ...LOCALE_LABELS,
}

export function isLocale(value: unknown): value is Locale {
  return value === "zh-CN" || value === "en-US"
}

export function isUserLocalePreference(
  value: unknown
): value is UserLocalePreference {
  return value === "inherit" || isLocale(value)
}

export function normalizeLocale(value: unknown): Locale | null {
  if (isLocale(value)) return value
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase().replace("_", "-")
  if (
    normalized === "zh" ||
    normalized === "zh-cn" ||
    normalized === "zh-hans"
  ) {
    return "zh-CN"
  }
  if (normalized === "en" || normalized === "en-us" || normalized === "en-gb") {
    return "en-US"
  }
  return null
}

export function pickLocaleFromAcceptLanguage(
  header: string | null
): Locale | null {
  if (!header) return null
  const candidates = header
    .split(",")
    .map((part) => part.trim().split(";")[0])
    .filter(Boolean)

  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate)
    if (locale) return locale
  }

  return null
}
