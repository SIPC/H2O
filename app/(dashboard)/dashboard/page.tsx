"use client"

import { useEffect, useMemo, useState } from "react"
import { Line, LineChart, XAxis } from "recharts"

import { useConfirm } from "@/components/confirm-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

import { Input } from "@/components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { cn, formatBytes } from "@/lib/utils"

import { Eye, EyeOff } from "lucide-react"

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
}

type TrafficHour = {
  hour: number
  label: string
  bucketDate: string
  txBytes: number
  rxBytes: number
  totalBytes: number
}

type TrafficOverview = {
  date: string
  todayTxBytes: number
  todayRxBytes: number
  yesterdayTxBytes: number
  yesterdayRxBytes: number
  hourly: TrafficHour[]
}

const TOTAL_CHART_CONFIG = {
  totalBytes: {
    label: "今日用量",
    theme: {
      light: "#171717",
      dark: "#ffffff",
    },
  },
} satisfies ChartConfig

function getLocalDateString(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function getPreviousDateString(dateString: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return dateString
  const d = new Date(`${dateString}T00:00:00`)
  if (Number.isNaN(d.getTime())) return dateString
  d.setDate(d.getDate() - 1)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function buildEmptyHourly(): TrafficHour[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: String(hour).padStart(2, "0"),
    bucketDate: "",
    txBytes: 0,
    rxBytes: 0,
    totalBytes: 0,
  }))
}

function normalizeHourly(input: unknown): TrafficHour[] {
  if (!Array.isArray(input)) return buildEmptyHourly()
  const out: TrafficHour[] = []
  for (const item of input) {
    if (!item || typeof item !== "object") continue
    const row = item as Partial<TrafficHour>
    if (typeof row.hour !== "number" || !Number.isFinite(row.hour)) continue
    const hour = Math.min(23, Math.max(0, Math.floor(row.hour)))
    const tx =
      typeof row.txBytes === "number" && Number.isFinite(row.txBytes)
        ? Math.max(0, Math.floor(row.txBytes))
        : 0
    const rx =
      typeof row.rxBytes === "number" && Number.isFinite(row.rxBytes)
        ? Math.max(0, Math.floor(row.rxBytes))
        : 0
    out.push({
      hour,
      label:
        typeof row.label === "string" && row.label.trim()
          ? row.label
          : String(hour).padStart(2, "0"),
      bucketDate:
        typeof row.bucketDate === "string" && row.bucketDate.trim()
          ? row.bucketDate
          : "",
      txBytes: tx,
      rxBytes: rx,
      totalBytes: tx + rx,
    })
  }
  return out.length > 0 ? out : buildEmptyHourly()
}

async function fetchDashboardData() {
  const res = await fetch("/api/user/dashboard")
  const json = await res.json()
  if (!json?.ok) return null
  return json.data as {
    subscriptionPath?: string
    subscriptions?: SubscriptionRow[]
    traffic?: {
      date: string
      todayTxBytes: number
      todayRxBytes: number
      yesterdayTxBytes: number
      yesterdayRxBytes: number
      hourly: unknown
    }
  }
}

export default function DashboardPage() {
  const { confirm, alert } = useConfirm()
  const [rows, setRows] = useState<SubscriptionRow[]>([])
  const [sub, setSub] = useState<SubUrls | null>(null)
  const [copied, setCopied] = useState(false)
  const [urlMasked, setUrlMasked] = useState(true)
  // 数据到达时一起记录"参考当前时间"，避免在 render 里调 Date.now（React 19 purity 规则）
  const [referenceNow, setReferenceNow] = useState<number | null>(null)
  const [trafficOverview, setTrafficOverview] = useState<TrafficOverview>({
    date: "",
    todayTxBytes: 0,
    todayRxBytes: 0,
    yesterdayTxBytes: 0,
    yesterdayRxBytes: 0,
    hourly: [],
  })

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
    const percent = total > 0 ? Math.min(100, (remaining / total) * 100) : 0
    return { total, used, remaining, percent }
  }, [validSubs])

  function applyDashboardData(
    d: Awaited<ReturnType<typeof fetchDashboardData>>
  ) {
    if (!d) return
    if (Array.isArray(d.subscriptions)) setRows(d.subscriptions)
    if (typeof d.subscriptionPath === "string") {
      setSub({ url: `${window.location.origin}${d.subscriptionPath}` })
    }
    setReferenceNow(Date.now())
    if (d.traffic) {
      const t = d.traffic
      setTrafficOverview({
        date: typeof t.date === "string" ? t.date : "",
        todayTxBytes:
          typeof t.todayTxBytes === "number"
            ? Math.max(0, Math.floor(t.todayTxBytes))
            : 0,
        todayRxBytes:
          typeof t.todayRxBytes === "number"
            ? Math.max(0, Math.floor(t.todayRxBytes))
            : 0,
        yesterdayTxBytes:
          typeof t.yesterdayTxBytes === "number"
            ? Math.max(0, Math.floor(t.yesterdayTxBytes))
            : 0,
        yesterdayRxBytes:
          typeof t.yesterdayRxBytes === "number"
            ? Math.max(0, Math.floor(t.yesterdayRxBytes))
            : 0,
        hourly: normalizeHourly(t.hourly),
      })
    }
  }

  useEffect(() => {
    void fetchDashboardData().then(applyDashboardData)
  }, [])

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
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
    await fetchDashboardData().then(applyDashboardData)
  }

  // 今日流量趋势数据
  const todayTotal = trafficOverview.todayTxBytes + trafficOverview.todayRxBytes
  const yesterdayTotal =
    trafficOverview.yesterdayTxBytes + trafficOverview.yesterdayRxBytes
  const tooltipDate = trafficOverview.date || getLocalDateString()

  let trendText = "—"
  let trendClass = "text-muted-foreground"
  if (yesterdayTotal > 0) {
    const diff = ((todayTotal - yesterdayTotal) / yesterdayTotal) * 100
    if (Math.abs(diff) < 0.1) {
      trendText = "→ 0.0%"
    } else if (diff > 0) {
      trendText = `↑ ${diff.toFixed(1)}%`
      trendClass = "text-emerald-500"
    } else {
      trendText = `↓ ${Math.abs(diff).toFixed(1)}%`
      trendClass = "text-red-500"
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      {/* 第一行：剩余流量 + 今日流量 */}
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        {/* 剩余流量卡 */}
        <Card className="overflow-hidden border-border/70">
          <CardContent className="flex h-full flex-col p-4">
            <p className="text-sm text-muted-foreground">剩余流量</p>
            {hasValidSub ? (
              <>
                <div className="mb-1 flex items-baseline gap-1.5">
                  <p className="mt-1 text-[40px] leading-none font-semibold tracking-tight tabular-nums">
                    {formatBytes(traffic.remaining)}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    / {formatBytes(traffic.total)}
                  </p>
                </div>
                <p className="mb-2 text-xs text-muted-foreground">
                  {`已用 ${formatBytes(traffic.used)}（${(100 - traffic.percent).toFixed(1)}%）`}
                </p>
                <div className="mt-auto h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${traffic.percent}%` }}
                  />
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-[40px] leading-none font-semibold tracking-tight text-muted-foreground">
                  —
                </p>
                <p className="text-xs text-muted-foreground">暂无有效订阅</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* 今日流量卡 */}
        <Card className="overflow-hidden border-border/70">
          <CardContent className="relative flex h-full flex-col p-4">
            <p className="text-sm text-muted-foreground">今日流量</p>
            {hasValidSub ? (
              <>
                <p
                  className={cn(
                    "absolute top-4 right-4 text-sm font-semibold tabular-nums",
                    trendClass
                  )}
                >
                  {trendText}
                </p>
                <p className="mt-1 mb-1 text-[40px] leading-none font-semibold tracking-tight tabular-nums">
                  {formatBytes(todayTotal)}
                </p>
                <p className="mb-2 text-xs text-muted-foreground">较前一天</p>
                <div className="mt-auto">
                  <ChartContainer
                    config={TOTAL_CHART_CONFIG}
                    className="aspect-auto h-14 w-full"
                  >
                    <LineChart
                      accessibilityLayer
                      data={trafficOverview.hourly}
                      margin={{ top: 6, right: 0, left: 0, bottom: 0 }}
                    >
                      <XAxis dataKey="label" hide />
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent
                            indicator="dot"
                            labelFormatter={(value, payload) => {
                              const pointDate =
                                typeof payload?.[0]?.payload?.bucketDate ===
                                  "string" &&
                                payload[0].payload.bucketDate.trim()
                                  ? payload[0].payload.bucketDate
                                  : tooltipDate
                              const fallbackLabel = payload?.[0]?.payload?.label
                              const fallbackHour = payload?.[0]?.payload?.hour
                              const hourLabel =
                                typeof value === "string" && value.trim()
                                  ? value
                                  : typeof fallbackLabel === "string" &&
                                      fallbackLabel.trim()
                                    ? fallbackLabel
                                    : typeof fallbackHour === "number" &&
                                        Number.isFinite(fallbackHour)
                                      ? String(fallbackHour).padStart(2, "0")
                                      : "00"

                              const normalizedHour = hourLabel.padStart(2, "0")
                              if (normalizedHour === "00") {
                                return `${getPreviousDateString(pointDate)} 24:00`
                              }
                              return `${pointDate} ${normalizedHour}:00`
                            }}
                            formatter={(value) => formatBytes(Number(value))}
                          />
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="totalBytes"
                        stroke="var(--color-totalBytes)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 3 }}
                        isAnimationActive={trafficOverview.hourly.length > 0}
                        animationBegin={0}
                        animationDuration={700}
                        animationEasing="linear"
                      />
                    </LineChart>
                  </ChartContainer>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-[40px] leading-none font-semibold tracking-tight text-muted-foreground">
                  —
                </p>
                <p className="text-xs text-muted-foreground">暂无有效订阅</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 第二行：订阅链接 */}
      <Card>
        <CardHeader className="p-4 pb-0">
          <CardTitle className="text-base">订阅链接</CardTitle>
          <p className="text-xs text-muted-foreground">
            Clash Verge / Nekobox / v2rayN 等主流客户端均可直接导入
          </p>
        </CardHeader>
        <CardContent className="relative p-4">
          <div
            aria-hidden={!hasValidSub}
            className={
              hasValidSub
                ? "flex flex-col gap-2"
                : "pointer-events-none flex flex-col gap-2 blur-sm select-none"
            }
          >
            <div className="flex gap-2">
              <Input
                readOnly
                value={sub?.url ?? ""}
                className={cn(
                  "min-w-0 flex-1 font-mono text-xs",
                  urlMasked && "blur-sm"
                )}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setUrlMasked((v) => !v)}
              >
                {urlMasked ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!sub}
                onClick={() => sub && void copy(sub.url)}
              >
                {copied ? "已复制" : "复制"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void resetToken()}
              >
                重置
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

      {/* 第三行：我的订阅表格 */}
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
