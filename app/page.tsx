"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { useI18n } from "@/components/i18n-provider"
import { LanguageSwitcher } from "@/components/language-switcher"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

type PublicSettings = {
  registration_enabled: boolean
  login_enabled: boolean
}

const DEFAULTS: PublicSettings = {
  registration_enabled: true,
  login_enabled: true,
}

export default function Page() {
  const { t } = useI18n()
  const [settings, setSettings] = useState<PublicSettings>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let mounted = true

    void (async () => {
      try {
        const response = await fetch("/api/settings/public")
        const json = await response.json()
        if (mounted && json?.ok) {
          setSettings({ ...DEFAULTS, ...json.data })
        }
      } finally {
        if (mounted) setLoaded(true)
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="relative flex min-h-svh p-6">
      <LanguageSwitcher className="absolute top-4 right-4" />
      <div className="flex max-w-2xl min-w-0 flex-col gap-4 text-sm leading-loose">
        <div>
          <h1 className="font-medium">{t("app.name")}</h1>
          <p>{t("app.description")}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {!loaded ? (
            <>
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-16" />
            </>
          ) : (
            <>
              {settings.login_enabled ? (
                <Button asChild>
                  <Link href="/login">{t("auth.login")}</Link>
                </Button>
              ) : null}
              {settings.registration_enabled ? (
                <Button asChild variant="outline">
                  <Link href="/register">{t("auth.register")}</Link>
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
