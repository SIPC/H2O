"use client"

import { useEffect, useState } from "react"
import { Line, LineChart, XAxis } from "recharts"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { cn, formatBytes } from "@/lib/utils"

type SessionUser = {
  id: number
  username: string
  role: "user" | "admin"
}

type AdminOverview = {
  users: number
  nodes: number
  plans: number
  subscriptions: number
}

type TrafficHour = {
  hour: number
  label: string
  bucketDate: string
  txBytes: number
  rxBytes: number
}

type TrafficOverview = {
  date: string
  currentLocalHour: number
  todayTxBytes: number
  todayRxBytes: number
  hourly: TrafficHour[]
}

type VersionCheckData = {
  currentVersion: string
}

type TrendResult = {
  percent: number | null
  direction: "up" | "down" | "flat"
}

const TX_CHART_CONFIG = {
  txBytes: {
    label: "今日总出",
    theme: {
      light: "#ffffff",
      dark: "#ffffff",
    },
  },
} satisfies ChartConfig

const RX_CHART_CONFIG = {
  rxBytes: {
    label: "今日总入",
    theme: {
      light: "#ffffff",
      dark: "#ffffff",
    },
  },
} satisfies ChartConfig

function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0
  return Math.min(23, Math.max(0, Math.floor(hour)))
}

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
  }))
}

function normalizeHourly(input: unknown): TrafficHour[] {
  if (!Array.isArray(input)) return buildEmptyHourly()

  const out: TrafficHour[] = []

  for (const item of input) {
    if (!item || typeof item !== "object") continue
    const row = item as Partial<TrafficHour>

    if (typeof row.hour !== "number" || !Number.isFinite(row.hour)) continue
    const hour = clampHour(row.hour)

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
      txBytes:
        typeof row.txBytes === "number" && Number.isFinite(row.txBytes)
          ? Math.max(0, Math.floor(row.txBytes))
          : 0,
      rxBytes:
        typeof row.rxBytes === "number" && Number.isFinite(row.rxBytes)
          ? Math.max(0, Math.floor(row.rxBytes))
          : 0,
    })
  }

  return out.length > 0 ? out : buildEmptyHourly()
}

// 趋势：最近 1 小时 vs 前 1 小时，样本不足或基线为 0 则不显示百分比
function calculateTrend(
  data: TrafficHour[],
  key: "txBytes" | "rxBytes"
): TrendResult {
  const WINDOW = 1
  if (data.length < WINDOW * 2) return { percent: null, direction: "flat" }

  const recent = data
    .slice(-WINDOW)
    .reduce(
      (sum, item) => sum + (key === "txBytes" ? item.txBytes : item.rxBytes),
      0
    )
  const previous = data
    .slice(-WINDOW * 2, -WINDOW)
    .reduce(
      (sum, item) => sum + (key === "txBytes" ? item.txBytes : item.rxBytes),
      0
    )

  if (previous <= 0) return { percent: null, direction: "flat" }

  const diff = ((recent - previous) / previous) * 100
  if (Math.abs(diff) < 0.1) return { percent: 0, direction: "flat" }

  return {
    percent: Math.abs(diff),
    direction: diff > 0 ? "up" : "down",
  }
}

function TrafficSparkCard({
  title,
  totalBytes,
  data,
  dataKey,
  config,
  date,
}: {
  title: string
  totalBytes: number
  data: TrafficHour[]
  dataKey: "txBytes" | "rxBytes"
  config: ChartConfig
  date: string
}) {
  const trend = calculateTrend(data, dataKey)
  const shouldAnimate = data.length > 0

  const trendClass =
    trend.direction === "down"
      ? "text-red-500"
      : trend.direction === "up"
        ? "text-emerald-500"
        : "text-muted-foreground"

  const trendText =
    trend.percent === null
      ? "—"
      : trend.direction === "flat"
        ? "→ 0.0%"
        : `${trend.direction === "up" ? "↑" : "↓"} ${trend.percent.toFixed(1)}%`

  return (
    <Card className="overflow-hidden border-border/70">
      <CardContent className="p-4">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="mt-1 text-[40px] leading-none font-semibold tracking-tight tabular-nums">
              {formatBytes(totalBytes)}
            </p>
          </div>
          <p
            className={cn(
              "mt-1 text-sm font-semibold tabular-nums",
              trendClass
            )}
          >
            {trendText}
          </p>
        </div>

        <p className="mb-2 text-xs text-muted-foreground">较前 1 小时</p>

        <ChartContainer config={config} className="aspect-auto h-14 w-full">
          <LineChart
            accessibilityLayer
            data={data}
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
                      typeof payload?.[0]?.payload?.bucketDate === "string" &&
                      payload[0].payload.bucketDate.trim()
                        ? payload[0].payload.bucketDate
                        : date
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
              dataKey={dataKey}
              stroke={`var(--color-${dataKey})`}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={shouldAnimate}
              animationBegin={0}
              animationDuration={700}
              animationEasing="linear"
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

export default function AdminPage() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [overview, setOverview] = useState<AdminOverview>({
    users: 0,
    nodes: 0,
    plans: 0,
    subscriptions: 0,
  })
  const [traffic, setTraffic] = useState<TrafficOverview>({
    date: "",
    currentLocalHour: 0,
    todayTxBytes: 0,
    todayRxBytes: 0,
    hourly: [],
  })
  const [panelVersion, setPanelVersion] = useState("-")

  useEffect(() => {
    let mounted = true

    void (async () => {
      const [
        sessionRes,
        usersRes,
        nodesRes,
        plansRes,
        subsRes,
        trafficRes,
        versionRes,
      ] = await Promise.all([
        fetch("/api/auth/session"),
        fetch("/api/admin/users"),
        fetch("/api/admin/nodes"),
        fetch("/api/admin/plans"),
        fetch("/api/admin/subscriptions"),
        fetch("/api/admin/traffic/overview"),
        fetch("/api/admin/version-check"),
      ])

      const sessionJson = await sessionRes.json()
      const usersJson = await usersRes.json()
      const nodesJson = await nodesRes.json()
      const plansJson = await plansRes.json()
      const subsJson = await subsRes.json()
      const trafficJson = await trafficRes.json()
      const versionJson = await versionRes.json()

      if (!mounted) return

      if (sessionJson?.ok) setUser(sessionJson.data.user)

      if (versionJson?.ok) {
        const data = versionJson.data as VersionCheckData
        if (
          typeof data.currentVersion === "string" &&
          data.currentVersion.trim()
        ) {
          setPanelVersion(data.currentVersion)
        }
      }

      setOverview({
        users: usersJson?.ok ? usersJson.data.length : 0,
        nodes: nodesJson?.ok ? nodesJson.data.length : 0,
        plans: plansJson?.ok ? plansJson.data.length : 0,
        subscriptions: subsJson?.ok ? subsJson.data.length : 0,
      })

      if (trafficJson?.ok) {
        setTraffic({
          date:
            typeof trafficJson.data.date === "string"
              ? trafficJson.data.date
              : "",
          currentLocalHour:
            typeof trafficJson.data.currentLocalHour === "number"
              ? clampHour(trafficJson.data.currentLocalHour)
              : 0,
          todayTxBytes:
            typeof trafficJson.data.todayTxBytes === "number"
              ? Math.max(0, Math.floor(trafficJson.data.todayTxBytes))
              : 0,
          todayRxBytes:
            typeof trafficJson.data.todayRxBytes === "number"
              ? Math.max(0, Math.floor(trafficJson.data.todayRxBytes))
              : 0,
          hourly: normalizeHourly(trafficJson.data.hourly),
        })
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  const tooltipDate = traffic.date || getLocalDateString()

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>管理概览</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm">
          <span>当前用户：{user?.username ?? "-"}</span>
          <Badge>{user?.role ?? "admin"}</Badge>
          <span className="ml-auto text-muted-foreground">v{panelVersion}</span>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">用户数</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {overview.users}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">节点数</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {overview.nodes}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">套餐数</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {overview.plans}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">订阅数</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {overview.subscriptions}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TrafficSparkCard
          title="今日总出"
          totalBytes={traffic.todayTxBytes}
          data={traffic.hourly}
          dataKey="txBytes"
          config={TX_CHART_CONFIG}
          date={tooltipDate}
        />
        <TrafficSparkCard
          title="今日总入"
          totalBytes={traffic.todayRxBytes}
          data={traffic.hourly}
          dataKey="rxBytes"
          config={RX_CHART_CONFIG}
          date={tooltipDate}
        />
      </div>
    </div>
  )
}
