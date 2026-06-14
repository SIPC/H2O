"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { useI18n } from "@/components/i18n-provider"
import { LanguageSwitcher } from "@/components/language-switcher"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function InitPage() {
  const router = useRouter()
  const { t } = useI18n()
  const [username, setUsername] = useState("admin")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError("")
    setSuccess("")

    const response = await fetch("/api/auth/bootstrap-admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    })

    const json = await response.json()
    setLoading(false)

    if (!response.ok || !json.ok) {
      setError(json?.error?.message ?? t("init.failed"))
      return
    }

    setSuccess(t("init.success"))
  }

  return (
    <div className="relative mx-auto flex min-h-svh max-w-md items-center p-6">
      <LanguageSwitcher className="absolute top-4 right-4" />
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("init.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username">{t("init.adminUsername")}</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("init.adminPassword")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {success ? (
              <p className="text-sm text-green-600">{success}</p>
            ) : null}

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? t("init.initializing") : t("init.title")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/login")}
              >
                {t("auth.goLogin")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
