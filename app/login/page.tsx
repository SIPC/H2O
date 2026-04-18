"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { TurnstileWidget, isTurnstileClientEnabled } from "@/components/turnstile-widget"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [turnstileToken, setTurnstileToken] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const turnstileRequired = isTurnstileClientEnabled()

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
              <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
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
              onVerify={setTurnstileToken}
              onExpire={() => setTurnstileToken("")}
              onError={() => setTurnstileToken("")}
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={loading || (turnstileRequired && !turnstileToken)}>
                {loading ? "登录中..." : "登录"}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push("/register")}>
                去注册
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
