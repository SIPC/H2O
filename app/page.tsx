"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

type PublicSettings = {
  registration_enabled: boolean
  login_enabled: boolean
}

const DEFAULTS: PublicSettings = {
  registration_enabled: true,
  login_enabled: true,
}

export default function Page() {
  const [settings, setSettings] = useState<PublicSettings>(DEFAULTS)

  useEffect(() => {
    let mounted = true

    void (async () => {
      const response = await fetch("/api/settings/public")
      const json = await response.json()
      if (mounted && json?.ok) {
        setSettings({ ...DEFAULTS, ...json.data })
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="flex min-h-svh p-6">
      <div className="flex max-w-2xl min-w-0 flex-col gap-4 text-sm leading-loose">
        <div>
          <h1 className="font-medium">H2O</h1>
          <p>企业内网使用</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {settings.login_enabled ? (
            <Button asChild>
              <Link href="/login">登录</Link>
            </Button>
          ) : null}
          {settings.registration_enabled ? (
            <Button asChild variant="outline">
              <Link href="/register">注册</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
