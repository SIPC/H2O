"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { TurnstileWidget } from "@/components/turnstile-widget"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [turnstileToken, setTurnstileToken] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [registrationEnabled, setRegistrationEnabled] = useState(true)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  // site key 从 /api/settings/public 读，空串表示未配置
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("")

  const turnstileRequired = Boolean(turnstileSiteKey)

  useEffect(() => {
    let mounted = true

    void (async () => {
      try {
        const response = await fetch("/api/settings/public")
        const json = await response.json()
        if (mounted && json?.ok) {
          setRegistrationEnabled(json.data.registration_enabled !== false)
          if (typeof json.data.turnstile_site_key === "string") {
            setTurnstileSiteKey(json.data.turnstile_site_key)
          }
        }
      } finally {
        if (mounted) setSettingsLoaded(true)
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (turnstileRequired && !turnstileToken) {
      setError("请先完成人机验证")
      return
    }

    setLoading(true)
    setError("")

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, turnstileToken }),
    })

    const json = await response.json()
    setLoading(false)

    if (!response.ok || !json.ok) {
      setError(json?.error?.message ?? "登录失败")
      // 校验失败后强制重新验证
      setTurnstileToken("")
      return
    }

    if (json.data.user.role === "admin") {
      router.push("/admin")
      return
    }

    router.push("/dashboard")
  }

  if (!settingsLoaded) {
    return (
      <div className="mx-auto flex min-h-svh max-w-md items-center p-6">
        <Card className="w-full">
          <CardHeader>
            <Skeleton className="h-6 w-16" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-16" />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-md items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>登录</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <TurnstileWidget
              siteKey={turnstileSiteKey}
              onVerify={setTurnstileToken}
              onExpire={() => setTurnstileToken("")}
              onError={() => setTurnstileToken("")}
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                disabled={loading || (turnstileRequired && !turnstileToken)}
              >
                {loading ? "登录中..." : "登录"}
              </Button>
              {registrationEnabled ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push("/register")}
                >
                  去注册
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
