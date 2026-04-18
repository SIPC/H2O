"use client"

import { useEffect, useMemo, useState } from "react"

import { useConfirm } from "@/components/confirm-provider"
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

// 把字节数格式化为自适应单位
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  let value = bytes
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  const decimals = idx === 0 ? 0 : value >= 100 ? 1 : 2
  return `${value.toFixed(decimals)} ${units[idx]}`
}

export default function DashboardPage() {
  const { confirm, alert } = useConfirm()
  const [rows, setRows] = useState<SubscriptionRow[]>([])
  const [sub, setSub] = useState<SubUrls | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  // 数据到达时一起记录"参考当前时间"，避免在 render 里调 Date.now（React 19 purity 规则）
  const [referenceNow, setReferenceNow] = useState<number | null>(null)

  // 以"active 且未过期"为有效订阅口径（与订阅链接后端聚合一致）
  const validSubs = useMemo(() => {
    if (referenceNow === null) return []
    return rows.filter(
      (row) =>
        row.status === "active" &&
        new Date(row.expire_time).getTime() > referenceNow
    )
  }, [rows, referenceNow])

  const hasValidSub = validSubs.length > 0

  const traffic = useMemo(() => {
    const total = validSubs.reduce(
      (sum, row) => sum + row.traffic_limit_bytes,
      0
    )
    const used = validSubs.reduce((sum, row) => sum + row.used_traffic_bytes, 0)
    const remaining = Math.max(0, total - used)
    const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0
    return { total, used, remaining, percent }
  }, [validSubs])

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
      setReferenceNow(Date.now())
    })()

    return () => {
      mounted = false
    }
  }, [])

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      window.setTimeout(
        () => setCopiedKey((current) => (current === key ? null : current)),
        1500
      )
    } catch {
      // 浏览器拒绝剪贴板访问时引导用户手动复制 readOnly 输入框里的内容
      await alert({
        title: "复制失败",
        description: "浏览器拒绝了剪贴板访问，请在输入框中手动选中并复制。",
      })
    }
  }

  async function resetToken() {
    const ok = await confirm({
      title: "重置节点登录 Key？",
      description: "当前订阅链接会立即失效，已连接的节点需要重新导入。",
      confirmText: "重置",
      variant: "destructive",
    })
    if (!ok) return

    const response = await fetch("/api/user/self/reset-token", {
      method: "POST",
    })
    const json = await response.json()
    if (!response.ok || !json.ok) {
      await alert({
        title: "重置失败",
        description: json?.error?.message ?? "请稍后重试",
        variant: "destructive",
      })
      return
    }
    await loadSub()
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        {/* 流量卡：展示剩余/总流量与使用率 */}
        <Card>
          <CardHeader>
            <CardTitle>流量</CardTitle>
            <p className="text-xs text-muted-foreground">所有有效订阅合计</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {hasValidSub ? (
              <>
                <div>
                  <div className="text-2xl font-semibold tracking-tight">
                    {formatBytes(traffic.remaining)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    剩余 / 总 {formatBytes(traffic.total)}
                  </p>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${traffic.percent}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  已用 {formatBytes(traffic.used)}（{traffic.percent.toFixed(1)}
                  %）
                </p>
              </>
            ) : (
              <>
                <div>
                  <div className="text-2xl font-semibold tracking-tight text-muted-foreground">
                    —
                  </div>
                  <p className="text-xs text-muted-foreground">暂无有效订阅</p>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted" />
              </>
            )}
          </CardContent>
        </Card>

        {/* 订阅链接卡：无有效订阅时仅 CardContent 模糊 + 遮罩提示，标题保持清晰 */}
        <Card>
          <CardHeader>
            <CardTitle>订阅链接</CardTitle>
            <p className="text-xs text-muted-foreground">
              将下方订阅链接导入 Hysteria2 客户端（NekoBox、v2rayN
              等），即可自动拉取节点。
            </p>
          </CardHeader>
          <CardContent className="relative">
            <div
              aria-hidden={!hasValidSub}
              className={
                hasValidSub
                  ? "flex flex-col gap-3"
                  : "pointer-events-none flex flex-col gap-3 blur-sm select-none"
              }
            >
              <div className="space-y-1">
                <Label>订阅链接（base64，推荐）</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={sub?.url ?? ""}
                    className="min-w-0 flex-1 font-mono text-xs"
                  />
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
                  <Input
                    readOnly
                    value={sub?.urlPlain ?? ""}
                    className="min-w-0 flex-1 font-mono text-xs"
                  />
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
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <p className="text-xs text-muted-foreground">
                  链接中包含节点登录 Key。若泄露请立即重置。
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void resetToken()}
                >
                  重置链接 / 登录Key
                </Button>
              </div>
            </div>
            {!hasValidSub ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-md border bg-background/80 px-4 py-2 text-center text-sm shadow-sm backdrop-blur">
                  <p className="font-medium">当前暂无有效订阅</p>
                  <p className="text-xs text-muted-foreground">
                    请联系管理员开通套餐后再使用订阅链接
                  </p>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

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
                  <TD>{formatBytes(row.traffic_limit_bytes)}</TD>
                  <TD>{formatBytes(row.used_traffic_bytes)}</TD>
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
