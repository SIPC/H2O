"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"

type SubscriptionRow = {
  id: number
  plan_name: string
  traffic_limit_bytes: number
  duration_days: number
  used_traffic_bytes: number
  start_time: string
  expire_time: string
  status: string
}

type SubUrls = {
  url: string
  urlPlain: string
}

export default function DashboardPage() {
  const [rows, setRows] = useState<SubscriptionRow[]>([])
  const [sub, setSub] = useState<SubUrls | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  async function loadSub() {
    const response = await fetch("/api/user/subscription")
    const json = await response.json()
    if (json?.ok) setSub(json.data)
  }

  useEffect(() => {
    let mounted = true

    void (async () => {
      const [subsRes, subRes] = await Promise.all([
        fetch("/api/user/subscriptions"),
        fetch("/api/user/subscription"),
      ])
      const subsJson = await subsRes.json()
      const subJson = await subRes.json()
      if (!mounted) return
      if (subsJson?.ok) setRows(subsJson.data)
      if (subJson?.ok) setSub(subJson.data)
    })()

    return () => {
      mounted = false
    }
  }, [])

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500)
    } catch {
      window.prompt("复制失败，请手动复制：", value)
    }
  }

  async function resetToken() {
    if (!window.confirm("重置节点登录 Key？当前订阅链接会立即失效，已连接的节点需要重新导入。")) return
    const response = await fetch("/api/user/self/reset-token", { method: "POST" })
    const json = await response.json()
    if (!response.ok || !json.ok) {
      window.alert(json?.error?.message ?? "重置失败")
      return
    }
    await loadSub()
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>订阅链接</CardTitle>
          <p className="text-xs text-muted-foreground">
            将下方订阅链接导入 Hysteria2 客户端（NekoBox、v2rayN 等），即可自动拉取节点。
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="space-y-1">
            <Label>订阅链接（base64，推荐）</Label>
            <div className="flex gap-2">
              <Input readOnly value={sub?.url ?? ""} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                disabled={!sub}
                onClick={() => sub && void copy(sub.url, "base64")}
              >
                {copiedKey === "base64" ? "已复制" : "复制"}
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label>订阅链接（明文）</Label>
            <div className="flex gap-2">
              <Input readOnly value={sub?.urlPlain ?? ""} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                disabled={!sub}
                onClick={() => sub && void copy(sub.urlPlain, "plain")}
              >
                {copiedKey === "plain" ? "已复制" : "复制"}
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted-foreground">
              链接中包含节点登录 Key。若泄露请立即重置。
            </p>
            <Button type="button" variant="outline" onClick={() => void resetToken()}>
              重置链接 / 登录Key
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>我的订阅</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>ID</TH>
                <TH>套餐</TH>
                <TH>流量上限</TH>
                <TH>已用流量</TH>
                <TH>状态</TH>
                <TH>到期时间</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id}>
                  <TD>{row.id}</TD>
                  <TD>{row.plan_name}</TD>
                  <TD>{row.traffic_limit_bytes}</TD>
                  <TD>{row.used_traffic_bytes}</TD>
                  <TD>{row.status}</TD>
                  <TD>{new Date(row.expire_time).toLocaleString()}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
