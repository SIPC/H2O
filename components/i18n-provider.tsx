"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  type Locale,
  type UserLocalePreference,
  isLocale,
} from "@/lib/i18n/locales"
import {
  getMessage,
  interpolate,
  type TranslationKey,
} from "@/lib/i18n/messages"

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: TranslationKey, params?: Record<string, unknown>) => string
  setUserLocalePreference: (
    preference: UserLocalePreference
  ) => Promise<{ ok: boolean; message?: string }>
}

const I18nContext = createContext<I18nContextValue | null>(null)
let activeLocale: Locale = DEFAULT_LOCALE

export function tr(key: TranslationKey, params?: Record<string, unknown>) {
  return interpolate(getMessage(activeLocale, key), params)
}

function setLocaleCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
}

export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode
  initialLocale?: Locale
}) {
  const router = useRouter()
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  useEffect(() => {
    activeLocale = locale
  }, [locale])

  const setLocale = useCallback(
    (next: Locale) => {
      activeLocale = next
      setLocaleState(next)
      setLocaleCookie(next)
      document.documentElement.lang = next
      router.refresh()
    },
    [router]
  )

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, unknown>) =>
      interpolate(getMessage(locale, key), params),
    [locale]
  )

  const setUserLocalePreference = useCallback(
    async (preference: UserLocalePreference) => {
      const response = await fetch("/api/user/self/language", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preferredLocale: preference }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) {
        return {
          ok: false,
          message: json?.error?.message ?? t("common.retryLater"),
        }
      }

      const next = json.data?.resolvedLocale
      if (isLocale(next)) {
        activeLocale = next
        setLocaleState(next)
        setLocaleCookie(next)
        document.documentElement.lang = next
      }
      router.refresh()
      return { ok: true }
    },
    [router, t]
  )

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t, setUserLocalePreference }),
    [locale, setLocale, setUserLocalePreference, t]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useI18n must be used within I18nProvider")
  return ctx
}

export function T({
  k,
  params,
}: {
  k: TranslationKey
  params?: Record<string, unknown>
}) {
  const { t } = useI18n()
  return <>{t(k, params)}</>
}
