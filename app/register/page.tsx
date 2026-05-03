"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { TurnstileWidget } from "@/components/turnstile-widget"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

export default function RegisterPage() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [turnstileToken, setTurnstileToken] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [registrationEnabled, setRegistrationEnabled] = useState<
    boolean | null
  >(null)
  // site key 从 /api/settings/public 读，空串表示未配置
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("")

  const turnstileRequired = Boolean(turnstileSiteKey)

  useEffect(() => {
    let mounted = true

    void (async () => {
      const response = await fetch("/api/settings/public")
      const json = await response.json()
      if (!mounted) return
      setRegistrationEnabled(
        json?.ok ? json.data.registration_enabled !== false : true
      )
      if (json?.ok && typeof json.data.turnstile_site_key === "string") {
        setTurnstileSiteKey(json.data.turnstile_site_key)
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

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, turnstileToken }),
    })

    const json = await response.json()
    setLoading(false)

    if (!response.ok || !json.ok) {
      setError(json?.error?.message ?? "注册失败")
      setTurnstileToken("")
      return
    }

    router.push("/login")
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-md items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>注册</CardTitle>
        </CardHeader>
        <CardContent>
          {registrationEnabled === null ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-8 w-16" />
              </div>
            </div>
          ) : registrationEnabled === false ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                当前站点已关闭注册。
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/login")}
              >
                去登录
              </Button>
            </div>
          ) : (
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
                <Label htmlFor="password">密码（至少 6 位）</Label>
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
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  disabled={loading || (turnstileRequired && !turnstileToken)}
                >
                  {loading ? "注册中..." : "注册"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push("/login")}
                >
                  去登录
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
