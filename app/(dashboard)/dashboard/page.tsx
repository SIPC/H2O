"use client"

import { useEffect, useMemo, useState } from "react"
import { Line, LineChart, XAxis } from "recharts"

import { useConfirm } from "@/components/confirm-provider"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { cn, formatBytes } from "@/lib/utils"

import { Eye, EyeOff } from "lucide-react"

type TrafficBillingMode = "tx_rx" | "tx" | "rx"

type SubscriptionRow = {
  id: number
  plan_name: string
  traffic_limit_bytes: number
  traffic_billing_mode: TrafficBillingMode | null
  duration_days: number
  used_traffic_bytes: number
  start_time: string
  expire_time: string
  status: string
  renewal_anchor: string | null
  auto_renew: number
  renewal_period_days: number | null
}

const TRAFFIC_BILLING_LABEL_KEY: Record<TrafficBillingMode, string> = {
  tx_rx: "adminBasic.trafficBilling.txRx",
  tx: "adminBasic.trafficBilling.tx",
  rx: "adminBasic.trafficBilling.rx",
}

function normalizeTrafficBillingMode(
  value: string | null | undefined
): TrafficBillingMode {
  return value === "tx" || value === "rx" ? value : "tx_rx"
}

function trafficBillingModeKey(value: string | null | undefined) {
  return TRAFFIC_BILLING_LABEL_KEY[normalizeTrafficBillingMode(value)]
}

function nextRenewalDate(
  row: SubscriptionRow,
  t: (key: string, params?: Record<string, unknown>) => string,
  locale: string
): string | null {
  if (row.auto_renew !== 1 || !row.renewal_period_days) return null
  const anchor = new Date(row.renewal_anchor ?? row.start_time).getTime()
  if (!Number.isFinite(anchor)) return null
  const next = new Date(anchor + row.renewal_period_days * 24 * 60 * 60 * 1000)
  // 如果计算出的下次重置时间已过，说明还没有触发续订检查，显示 "即将重置"
  if (next.getTime() <= Date.now()) return t("userDashboard.renewal.resetSoon")
  return next.toLocaleDateString(locale)
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

const MONO_CHART_THEME = {
  light: "#171717",
  dark: "#ffffff",
} as const

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
  const { locale, t } = useI18n()
  const [rows, setRows] = useState<SubscriptionRow[]>([])
  const [sub, setSub] = useState<SubUrls | null>(null)
  const [loading, setLoading] = useState(true)
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

  const totalChartConfig = useMemo<ChartConfig>(
    () => ({
      totalBytes: {
        label: t("userDashboard.chart.todayUsage"),
        theme: MONO_CHART_THEME,
      },
    }),
    [t]
  )

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
    void fetchDashboardData()
      .then(applyDashboardData)
      .finally(() => setLoading(false))
  }, [])

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 浏览器拒绝剪贴板访问时引导用户手动复制 readOnly 输入框里的内容
      await alert({
        title: t("userDashboard.copyFailed.title"),
        description: t("userDashboard.copyFailed.description"),
      })
    }
  }

  async function resetToken() {
    const ok = await confirm({
      title: t("userDashboard.resetToken.confirmTitle"),
      description: t("userDashboard.resetToken.confirmDescription"),
      confirmText: t("common.reset"),
      variant: "destructive",
    })
    if (!ok) return

    const response = await fetch("/api/user/self/reset-token", {
      method: "POST",
    })
    const json = await response.json()
    if (!response.ok || !json.ok) {
      await alert({
        title: t("userDashboard.resetToken.failedTitle"),
        description: json?.error?.message ?? t("common.retryLater"),
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

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
        <div>
          <h1 className="text-2xl font-bold">{t("userDashboard.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("userDashboard.description")}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
          <Card className="overflow-hidden border-border/70">
            <CardContent className="p-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-3 h-10 w-40" />
              <Skeleton className="mt-4 h-2 w-full" />
            </CardContent>
          </Card>
          <Card className="overflow-hidden border-border/70">
            <CardContent className="p-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-3 h-10 w-40" />
              <Skeleton className="mt-4 h-14 w-full" />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="p-4 pb-1">
            <Skeleton className="h-5 w-24" />
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <Skeleton className="h-4 w-72 max-w-full" />
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-1">
            <Skeleton className="h-5 w-24" />
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-5 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold">{t("userDashboard.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("userDashboard.description")}
        </p>
      </div>

      {/* 第一行：剩余流量 + 今日流量 */}
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        {/* 剩余流量卡 */}
        <Card className="overflow-hidden border-border/70">
          <CardContent className="flex h-full flex-col p-4">
            <p className="text-sm text-muted-foreground">
              {t("userDashboard.remainingTraffic")}
            </p>
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
                  {t("userDashboard.usedSummary", {
                    used: formatBytes(traffic.used),
                    percent: (100 - traffic.percent).toFixed(1),
                  })}
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
                <p className="text-xs text-muted-foreground">
                  {t("userDashboard.noValidSubscription")}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* 今日流量卡 */}
        <Card className="overflow-hidden border-border/70">
          <CardContent className="relative flex h-full flex-col p-4">
            <p className="text-sm text-muted-foreground">
              {t("userDashboard.todayTraffic")}
            </p>
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
                <p className="mb-2 text-xs text-muted-foreground">
                  {t("userDashboard.previousDay")}
                </p>
                <div className="mt-auto">
                  <ChartContainer
                    config={totalChartConfig}
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
                <p className="text-xs text-muted-foreground">
                  {t("userDashboard.noValidSubscription")}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 第二行：订阅链接 */}
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            {t("userDashboard.subscriptionLink.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="relative space-y-2 p-4 pt-0">
          <p className="text-xs text-muted-foreground">
            {t("userDashboard.subscriptionLink.description")}
          </p>
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
                aria-label={t(
                  "userDashboard.subscriptionLink.toggleVisibility"
                )}
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
                {copied
                  ? t("userDashboard.subscriptionLink.copied")
                  : t("userDashboard.subscriptionLink.copy")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void resetToken()}
              >
                {t("userDashboard.subscriptionLink.reset")}
              </Button>
            </div>
          </div>
          {!hasValidSub ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-md border bg-background/80 px-4 py-2 text-center text-sm shadow-sm backdrop-blur">
                <p className="font-medium">
                  {t("userDashboard.subscriptionLink.noValidTitle")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("userDashboard.subscriptionLink.noValidDescription")}
                </p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* 第三行：我的订阅表格 */}
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            {t("userDashboard.table.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>{t("userDashboard.table.id")}</TH>
                <TH>{t("userDashboard.table.plan")}</TH>
                <TH>{t("userDashboard.table.trafficLimit")}</TH>
                <TH>{t("userDashboard.table.usedTraffic")}</TH>
                <TH>{t("userDashboard.table.billingMode")}</TH>
                <TH>{t("userDashboard.table.resetTime")}</TH>
                <TH>{t("userDashboard.table.status")}</TH>
                <TH>{t("userDashboard.table.expiresAt")}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => {
                const nextRenew = nextRenewalDate(row, t, locale)
                return (
                  <TR key={row.id}>
                    <TD>{row.id}</TD>
                    <TD>{row.plan_name}</TD>
                    <TD>{formatBytes(row.traffic_limit_bytes)}</TD>
                    <TD>{formatBytes(row.used_traffic_bytes)}</TD>
                    <TD>
                      <Badge className="border bg-transparent text-foreground">
                        {t(trafficBillingModeKey(row.traffic_billing_mode))}
                      </Badge>
                    </TD>
                    <TD className="text-xs">
                      {nextRenew ? (
                        <span
                          title={t("userDashboard.renewal.title", {
                            days: row.renewal_period_days,
                          })}
                        >
                          {t("userDashboard.renewal.schedule", {
                            days: row.renewal_period_days,
                            next: nextRenew,
                          })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TD>
                    <TD>
                      <Badge
                        className={
                          row.status === "active"
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : row.status === "blocked"
                              ? "bg-destructive/15 text-destructive"
                              : "bg-muted text-muted-foreground"
                        }
                      >
                        {row.status === "active"
                          ? t("adminBasic.status.enabled")
                          : row.status === "blocked"
                            ? t("adminBasic.status.blocked")
                            : t("adminBasic.status.expired")}
                      </Badge>
                    </TD>
                    <TD>
                      {new Date(row.expire_time).getFullYear() >= 9999
                        ? "—"
                        : new Date(row.expire_time).toLocaleString(locale)}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
