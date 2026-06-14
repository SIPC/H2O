"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts"

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
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { cn, formatBytes } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/*  类型                                                                */
/* ------------------------------------------------------------------ */

type DailyPoint = {
  date: string
  txBytes: number
  rxBytes: number
  totalBytes: number
}

type DailyChartPoint = DailyPoint & {
  label: string
}

type NodeItem = {
  nodeId: number
  nodeName: string
  txBytes: number
  rxBytes: number
  totalBytes: number
}

type UserItem = {
  userId: number
  username: string
  txBytes: number
  rxBytes: number
  totalBytes: number
}

type DailyNodePoint = {
  nodeId: number
  nodeName: string
  date: string
  txBytes: number
  rxBytes: number
  totalBytes: number
}

type AnalysisData = {
  from: string
  to: string
  totalTxBytes: number
  totalRxBytes: number
  totalBytes: number
  daily: DailyPoint[]
  byNode: NodeItem[]
  byUser: UserItem[]
  dailyByNode: DailyNodePoint[]
}

type DateRange = {
  from: string
  to: string
}

type RankBarPoint = {
  rank: number
  label: string
  subLabel: string
  txBytes: number
  rxBytes: number
  totalBytes: number
}

/* ------------------------------------------------------------------ */
/*  图表配置                                                             */
/* ------------------------------------------------------------------ */

const TRAFFIC_COLORS = {
  txBytes: { light: "#8b5cf6", dark: "#a78bfa" },
  rxBytes: { light: "#3b82f6", dark: "#60a5fa" },
  totalBytes: { light: "#171717", dark: "#ffffff" },
} as const

type TFunction = (key: string, params?: Record<string, unknown>) => string

function makeTrafficConfig(
  t: TFunction,
  keys: Array<"txBytes" | "rxBytes" | "totalBytes">
): ChartConfig {
  const labelKeys = {
    txBytes: "routing.common.tx",
    rxBytes: "routing.common.rx",
    totalBytes: "routing.common.total",
  } as const

  return Object.fromEntries(
    keys.map((key) => [
      key,
      {
        label: t(labelKeys[key]),
        theme: TRAFFIC_COLORS[key],
      },
    ])
  ) as ChartConfig
}

const NODE_COLORS = [
  "#2563eb",
  "#16a34a",
  "#ea580c",
  "#9333ea",
  "#dc2626",
  "#0891b2",
  "#ca8a04",
  "#db2777",
  "#4f46e5",
  "#059669",
]

const DAY_MS = 24 * 60 * 60 * 1000
const QUICK_RANGES = [1, 7, 30, 90] as const

/* ------------------------------------------------------------------ */
/*  工具函数                                                             */
/* ------------------------------------------------------------------ */

function localDateStr(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function quickRange(days: number): DateRange {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - days + 1)
  return { from: localDateStr(from), to: localDateStr(now) }
}

function parseLocalDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null

  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null

  return date
}

function getDateRange(from: string, to: string): string[] {
  const start = parseLocalDate(from)
  const end = parseLocalDate(to)
  if (!start || !end || start > end) return []

  const dates: string[] = []
  const cursor = new Date(start)
  let guard = 0

  while (cursor <= end && guard < 3660) {
    dates.push(localDateStr(cursor))
    cursor.setDate(cursor.getDate() + 1)
    guard += 1
  }

  return dates
}

function getInclusiveDayCount(from: string, to: string): number {
  const start = parseLocalDate(from)
  const end = parseLocalDate(to)
  if (!start || !end || start > end) return 0

  return Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1)
}

function fillDailyRange(
  from: string,
  to: string,
  daily: DailyPoint[]
): DailyPoint[] {
  const dateMap = new Map(daily.map((item) => [item.date, item]))
  const dates = getDateRange(from, to)

  if (dates.length === 0) return daily

  return dates.map((date) => {
    const found = dateMap.get(date)
    if (found) return found

    return {
      date,
      txBytes: 0,
      rxBytes: 0,
      totalBytes: 0,
    }
  })
}

function formatDateTick(date: string): string {
  return date.slice(5)
}

function formatPercent(part: number, total: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) {
    return "0.0"
  }

  return ((part / total) * 100).toFixed(1)
}

function percentNumber(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0
  return Math.min(100, Math.max(0, (part / total) * 100))
}

function truncateLabel(value: string, max = 10): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}

function metricLabel(name: unknown, t: TFunction): string {
  const value = String(name)

  if (value === "txBytes") return t("routing.common.tx")
  if (value === "rxBytes") return t("routing.common.rx")
  if (value === "totalBytes") return t("routing.common.total")

  return value
}

function tooltipDateLabel(payload: unknown, fallback: unknown): string {
  if (Array.isArray(payload)) {
    const first = payload[0] as { payload?: { date?: unknown } } | undefined
    if (typeof first?.payload?.date === "string") return first.payload.date
  }

  return String(fallback)
}

function rankTooltipLabel(payload: unknown, fallback: unknown): string {
  if (Array.isArray(payload)) {
    const first = payload[0] as
      | { payload?: { rank?: unknown; label?: unknown; subLabel?: unknown } }
      | undefined
    const rank = first?.payload?.rank
    const label = first?.payload?.label
    const subLabel = first?.payload?.subLabel

    if (typeof label === "string") {
      const prefix = typeof rank === "number" ? `#${rank} ` : ""
      const suffix = typeof subLabel === "string" ? ` · ${subLabel}` : ""
      return `${prefix}${label}${suffix}`
    }
  }

  return String(fallback)
}

function renderBytesTooltip(
  t: TFunction,
  value: unknown,
  name: unknown,
  item?: { color?: unknown }
) {
  const color = typeof item?.color === "string" ? item.color : undefined

  return (
    <div className="flex min-w-40 flex-1 items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        {color && (
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="truncate">{metricLabel(name, t)}</span>
      </span>
      <span className="font-mono font-medium text-foreground tabular-nums">
        {formatBytes(Number(value))}
      </span>
    </div>
  )
}

function pivotDailyByNode(
  data: DailyNodePoint[],
  metric: "txBytes" | "rxBytes" | "totalBytes",
  from: string,
  to: string,
  nodes: NodeItem[]
) {
  const nodeNames = new Map(nodes.map((node) => [node.nodeId, node.nodeName]))
  const nodeIds = new Set(nodeNames.keys())
  const rows = getDateRange(from, to).map<Record<string, number | string>>(
    (date) => {
      const row: Record<string, number | string> = {
        date,
        label: formatDateTick(date),
      }

      for (const id of nodeIds) {
        row[`node_${id}`] = 0
      }

      return row
    }
  )
  const rowMap = new Map(rows.map((row) => [String(row.date), row]))

  for (const row of data) {
    if (!nodeIds.has(row.nodeId)) continue

    const entry = rowMap.get(row.date)
    if (!entry) continue

    entry[`node_${row.nodeId}`] = row[metric]
  }

  return { rows, nodeNames }
}

type AnalysisFetchResult =
  | { ok: true; data: AnalysisData }
  | { ok: false; message: string }

async function loadAnalysisData(
  range: DateRange,
  t: TFunction
): Promise<AnalysisFetchResult> {
  try {
    const params = new URLSearchParams({ from: range.from, to: range.to })
    const res = await fetch(`/api/admin/traffic/analysis?${params}`)
    const json = await res.json()

    if (!json.ok) {
      return {
        ok: false,
        message: json.error?.message ?? t("routing.common.requestFailed"),
      }
    }

    return { ok: true, data: json.data as AnalysisData }
  } catch {
    return { ok: false, message: t("routing.common.networkError") }
  }
}

/* ------------------------------------------------------------------ */
/*  子组件                                                              */
/* ------------------------------------------------------------------ */

const TrafficSparkCard = memo(function TrafficSparkCard({
  title,
  totalBytes,
  data,
  dataKey,
  config,
  subtitle,
  animate,
}: {
  title: string
  totalBytes: number
  data: DailyChartPoint[]
  dataKey: "txBytes" | "rxBytes" | "totalBytes"
  config: ChartConfig
  subtitle: string
  animate: boolean
}) {
  const { t } = useI18n()
  const shouldAnimate = data.some((item) => item[dataKey] > 0)

  return (
    <Card className="overflow-hidden border-border/70">
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="mt-1 mb-1 text-[40px] leading-none font-semibold tracking-tight tabular-nums">
          {formatBytes(totalBytes)}
        </p>
        <p className="mb-2 text-xs text-muted-foreground">{subtitle}</p>

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
                  labelFormatter={(value, payload) =>
                    tooltipDateLabel(payload, value)
                  }
                  formatter={(value, name, item) =>
                    renderBytesTooltip(t, value, name, item)
                  }
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
              isAnimationActive={shouldAnimate && animate}
              animationBegin={0}
              animationDuration={700}
              animationEasing="linear"
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
})

function InsightCard({
  title,
  value,
  description,
  className,
}: {
  title: string
  value: string
  description: string
  className?: string
}) {
  return (
    <Card className="border-border/70">
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p
          className={cn(
            "mt-1 text-2xl leading-none font-semibold tabular-nums",
            className
          )}
        >
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

function DailyTrafficTrendCard({
  data,
  animate,
}: {
  data: DailyChartPoint[]
  animate: boolean
}) {
  const { t } = useI18n()
  const shouldAnimate = data.some((item) => item.totalBytes > 0)
  const config = useMemo(
    () => makeTrafficConfig(t, ["txBytes", "rxBytes", "totalBytes"]),
    [t]
  )

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>{t("routing.trafficAnalysis.dailyTrendTitle")}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("routing.trafficAnalysis.dailyTrendDescription")}
        </p>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-80 w-full">
          <LineChart
            accessibilityLayer
            data={data}
            margin={{ top: 14, right: 18, left: 4, bottom: 4 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              minTickGap={18}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={(value) => formatBytes(Number(value))}
              tickLine={false}
              axisLine={false}
              width={72}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  indicator="dot"
                  labelFormatter={(value, payload) =>
                    tooltipDateLabel(payload, value)
                  }
                  formatter={(value, name, item) =>
                    renderBytesTooltip(t, value, name, item)
                  }
                />
              }
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="txBytes"
              name={t("routing.common.tx")}
              stroke="var(--color-txBytes)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={shouldAnimate && animate}
            />
            <Line
              type="monotone"
              dataKey="rxBytes"
              name={t("routing.common.rx")}
              stroke="var(--color-rxBytes)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={shouldAnimate && animate}
            />
            <Line
              type="monotone"
              dataKey="totalBytes"
              name={t("routing.common.total")}
              stroke="var(--color-totalBytes)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={shouldAnimate && animate}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function NodeTrendCard({
  data,
  nodeNames,
  config,
  animate,
}: {
  data: Record<string, number | string>[]
  nodeNames: Map<number, string>
  config: ChartConfig
  animate: boolean
}) {
  const { t } = useI18n()
  const shouldAnimate = data.length > 0

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>
          {t("routing.trafficAnalysis.nodeTrendTitle", {
            count: nodeNames.size,
          })}
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("routing.trafficAnalysis.nodeTrendDescription")}
        </p>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-75 w-full">
          <LineChart
            accessibilityLayer
            data={data}
            margin={{ top: 12, right: 18, left: 4, bottom: 4 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              minTickGap={18}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={(value) => formatBytes(Number(value))}
              tickLine={false}
              axisLine={false}
              width={72}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  indicator="dot"
                  labelFormatter={(value, payload) =>
                    tooltipDateLabel(payload, value)
                  }
                  formatter={(value, name, item) =>
                    renderBytesTooltip(t, value, name, item)
                  }
                />
              }
            />
            <Legend />
            {Array.from(nodeNames.entries()).map(([id, name], index) => (
              <Line
                key={id}
                type="monotone"
                dataKey={`node_${id}`}
                name={name}
                stroke={NODE_COLORS[index % NODE_COLORS.length]}
                strokeWidth={2.2}
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={shouldAnimate && animate}
                animationBegin={0}
                animationDuration={700}
                animationEasing="linear"
              />
            ))}
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function StackedBarComparisonCard({
  title,
  description,
  data,
}: {
  title: string
  description: string
  data: RankBarPoint[]
}) {
  const { t } = useI18n()
  const chartHeight = Math.max(260, data.length * 38 + 96)
  const config = useMemo(
    () => makeTrafficConfig(t, ["txBytes", "rxBytes"]),
    [t]
  )

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={config}
          className="aspect-auto w-full"
          style={{ height: chartHeight }}
        >
          <BarChart
            accessibilityLayer
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 22, left: 8, bottom: 8 }}
          >
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="label"
              width={96}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => truncateLabel(String(value), 9)}
            />
            <ChartTooltip
              cursor={{ fill: "var(--muted)" }}
              content={
                <ChartTooltipContent
                  indicator="dot"
                  labelFormatter={(value, payload) =>
                    rankTooltipLabel(payload, value)
                  }
                  formatter={(value, name, item) =>
                    renderBytesTooltip(t, value, name, item)
                  }
                />
              }
            />
            <Legend />
            <Bar
              dataKey="txBytes"
              name={t("routing.common.tx")}
              stackId="traffic"
              fill="var(--color-txBytes)"
              radius={[4, 0, 0, 4]}
            />
            <Bar
              dataKey="rxBytes"
              name={t("routing.common.rx")}
              stackId="traffic"
              fill="var(--color-rxBytes)"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function PercentCell({
  value,
  total,
  className,
}: {
  value: number
  total: number
  className?: string
}) {
  const percent = percentNumber(value, total)

  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full bg-primary", className)}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="w-12 text-right font-medium tabular-nums">
        {percent.toFixed(1)}%
      </span>
    </div>
  )
}

function NodeDetailTable({
  rows,
  totalBytes,
}: {
  rows: NodeItem[]
  totalBytes: number
}) {
  const { t } = useI18n()

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>{t("routing.trafficAnalysis.nodeDetailTitle")}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("routing.trafficAnalysis.nodeDetailDescription")}
        </p>
      </CardHeader>
      <CardContent>
        <Table className="min-w-190">
          <THead>
            <TR>
              <TH>{t("routing.trafficAnalysis.rank")}</TH>
              <TH>{t("routing.trafficAnalysis.node")}</TH>
              <TH className="text-right">{t("routing.common.tx")}</TH>
              <TH className="text-right">{t("routing.common.rx")}</TH>
              <TH className="text-right">{t("routing.common.total")}</TH>
              <TH className="text-right">
                {t("routing.trafficAnalysis.share")}
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((node, index) => (
              <TR key={node.nodeId}>
                <TD className="text-muted-foreground">#{index + 1}</TD>
                <TD>
                  <div className="font-medium">{node.nodeName}</div>
                  <div className="text-xs text-muted-foreground">
                    ID {node.nodeId}
                  </div>
                </TD>
                <TD className="text-right tabular-nums">
                  {formatBytes(node.txBytes)}
                </TD>
                <TD className="text-right tabular-nums">
                  {formatBytes(node.rxBytes)}
                </TD>
                <TD className="text-right font-semibold tabular-nums">
                  {formatBytes(node.totalBytes)}
                </TD>
                <TD>
                  <PercentCell value={node.totalBytes} total={totalBytes} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function UserDetailTable({
  rows,
  totalBytes,
}: {
  rows: UserItem[]
  totalBytes: number
}) {
  const { t } = useI18n()

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>{t("routing.trafficAnalysis.userDetailTitle")}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("routing.trafficAnalysis.userDetailDescription")}
        </p>
      </CardHeader>
      <CardContent>
        <Table className="min-w-190">
          <THead>
            <TR>
              <TH>{t("routing.trafficAnalysis.rank")}</TH>
              <TH>{t("routing.trafficAnalysis.user")}</TH>
              <TH className="text-right">{t("routing.common.tx")}</TH>
              <TH className="text-right">{t("routing.common.rx")}</TH>
              <TH className="text-right">{t("routing.common.total")}</TH>
              <TH className="text-right">
                {t("routing.trafficAnalysis.share")}
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((user, index) => (
              <TR key={user.userId}>
                <TD className="text-muted-foreground">#{index + 1}</TD>
                <TD>
                  <div className="font-medium">{user.username}</div>
                  <div className="text-xs text-muted-foreground">
                    ID {user.userId}
                  </div>
                </TD>
                <TD className="text-right tabular-nums">
                  {formatBytes(user.txBytes)}
                </TD>
                <TD className="text-right tabular-nums">
                  {formatBytes(user.rxBytes)}
                </TD>
                <TD className="text-right font-semibold tabular-nums">
                  {formatBytes(user.totalBytes)}
                </TD>
                <TD>
                  <PercentCell
                    value={user.totalBytes}
                    total={totalBytes}
                    className="bg-emerald-500"
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function LoadingState() {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} className="border-border/70">
            <CardContent className="p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-3 h-9 w-36" />
              <Skeleton className="mt-4 h-16 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="border-border/70">
        <CardContent className="p-4">
          <Skeleton className="h-80 w-full" />
        </CardContent>
      </Card>
    </>
  )
}

function EmptyState({ rangeLabel }: { rangeLabel: string }) {
  const { t } = useI18n()

  return (
    <Card className="border-dashed border-border/70">
      <CardContent className="flex min-h-52 flex-col items-center justify-center p-8 text-center">
        <div className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          {rangeLabel}
        </div>
        <h2 className="mt-4 text-lg font-semibold">
          {t("routing.trafficAnalysis.emptyTitle")}
        </h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {t("routing.trafficAnalysis.emptyDescription")}
        </p>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  主页面                                                               */
/* ------------------------------------------------------------------ */

export default function TrafficAnalysisPage() {
  const { t } = useI18n()
  const defaultRange = useMemo(() => quickRange(7), [])
  const requestIdRef = useRef(0)

  const [fromDate, setFromDate] = useState(defaultRange.from)
  const [toDate, setToDate] = useState(defaultRange.to)
  const [data, setData] = useState<AnalysisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [lastUpdatedAt, setLastUpdatedAt] = useState("")
  const [shouldAnimate, setShouldAnimate] = useState(true)

  const requestAnalysis = useCallback(
    async (range: DateRange) => {
      const from = range.from.trim()
      const to = range.to.trim()

      if (!from || !to) {
        setError(t("routing.trafficAnalysis.completeDateRangeRequired"))
        return
      }

      if (from > to) {
        setError(t("routing.trafficAnalysis.invalidDateRange"))
        return
      }

      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setLoading(true)
      setError("")

      try {
        const result = await loadAnalysisData({ from, to }, t)

        if (requestId !== requestIdRef.current) return

        if (!result.ok) {
          setError(result.message)
          setData(null)
          return
        }

        setData(result.data)
        setLastUpdatedAt(
          new Date().toLocaleTimeString("zh-CN", {
            hour12: false,
          })
        )
      } catch {
        if (requestId !== requestIdRef.current) return

        setError(t("routing.common.networkError"))
        setData(null)
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    },
    [t]
  )

  useEffect(() => {
    let mounted = true
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    void loadAnalysisData(defaultRange, t)
      .then((result) => {
        if (!mounted || requestId !== requestIdRef.current) return

        if (!result.ok) {
          setError(result.message)
          setData(null)
          return
        }

        setData(result.data)
        setLastUpdatedAt(
          new Date().toLocaleTimeString("zh-CN", {
            hour12: false,
          })
        )
      })
      .finally(() => {
        if (mounted && requestId === requestIdRef.current) {
          setLoading(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [defaultRange, t])

  useEffect(() => {
    if (!data || !shouldAnimate) return

    const timer = window.setTimeout(() => setShouldAnimate(false), 900)
    return () => window.clearTimeout(timer)
  }, [data, shouldAnimate])

  const runCurrentQuery = useCallback(() => {
    void requestAnalysis({ from: fromDate, to: toDate })
  }, [fromDate, requestAnalysis, toDate])

  const setQuick = useCallback(
    (days: number) => {
      const range = quickRange(days)
      setFromDate(range.from)
      setToDate(range.to)
      void requestAnalysis(range)
    },
    [requestAnalysis]
  )

  const dailySeries = useMemo(
    () => (data ? fillDailyRange(data.from, data.to, data.daily) : []),
    [data]
  )

  const dailyChartData = useMemo<DailyChartPoint[]>(
    () =>
      dailySeries.map((item) => ({
        ...item,
        label: formatDateTick(item.date),
      })),
    [dailySeries]
  )

  const hasData = Boolean(
    data &&
    (data.totalBytes > 0 || data.byNode.length > 0 || data.byUser.length > 0)
  )

  const summary = useMemo(() => {
    if (!data) return null

    const days = Math.max(
      1,
      dailySeries.length || getInclusiveDayCount(data.from, data.to)
    )
    const peakDay = dailySeries.reduce<DailyPoint | null>((best, item) => {
      if (!best || item.totalBytes > best.totalBytes) return item
      return best
    }, null)

    return {
      days,
      averageDailyBytes: data.totalBytes / days,
      peakDay,
      topNode: data.byNode[0] ?? null,
      topUser: data.byUser[0] ?? null,
      txShare: formatPercent(data.totalTxBytes, data.totalBytes),
      rxShare: formatPercent(data.totalRxBytes, data.totalBytes),
    }
  }, [data, dailySeries])

  const nodeTrendNodes = useMemo(() => data?.byNode.slice(0, 6) ?? [], [data])

  const nodeTrendPivot = useMemo(
    () =>
      data
        ? pivotDailyByNode(
            data.dailyByNode,
            "totalBytes",
            data.from,
            data.to,
            nodeTrendNodes
          )
        : null,
    [data, nodeTrendNodes]
  )

  const nodeTrendConfig = useMemo(() => {
    if (!nodeTrendPivot) return null

    const config: Record<string, { label: string; color: string }> = {}
    let index = 0

    for (const [id, name] of nodeTrendPivot.nodeNames) {
      config[`node_${id}`] = {
        label: name,
        color: NODE_COLORS[index % NODE_COLORS.length],
      }
      index += 1
    }

    return config as ChartConfig
  }, [nodeTrendPivot])

  const nodeBarData = useMemo<RankBarPoint[]>(
    () =>
      data?.byNode.slice(0, 10).map((node, index) => ({
        rank: index + 1,
        label: node.nodeName,
        subLabel: `ID ${node.nodeId}`,
        txBytes: node.txBytes,
        rxBytes: node.rxBytes,
        totalBytes: node.totalBytes,
      })) ?? [],
    [data]
  )

  const userBarData = useMemo<RankBarPoint[]>(
    () =>
      data?.byUser.slice(0, 10).map((user, index) => ({
        rank: index + 1,
        label: user.username,
        subLabel: `ID ${user.userId}`,
        txBytes: user.txBytes,
        rxBytes: user.rxBytes,
        totalBytes: user.totalBytes,
      })) ?? [],
    [data]
  )

  const rangeLabel = data
    ? t("routing.trafficAnalysis.rangeLabel", {
        from: data.from,
        to: data.to,
      })
    : t("routing.trafficAnalysis.rangeLabel", {
        from: fromDate || "-",
        to: toDate || "-",
      })
  const rangeDays = summary?.days ?? getInclusiveDayCount(fromDate, toDate)
  const isUpdating = loading && Boolean(data)

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {t("routing.trafficAnalysis.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("routing.trafficAnalysis.description")}
            {isUpdating && (
              <span className="ml-2 text-blue-600 dark:text-blue-400">
                · {t("routing.common.updating")}
              </span>
            )}
          </p>
        </div>
        <div className="hidden text-right text-xs text-muted-foreground sm:block">
          <p>{t("routing.common.days", { count: rangeDays || "-" })}</p>
          <p>
            {data
              ? t("routing.trafficAnalysis.nodeUserCount", {
                  nodes: data.byNode.length,
                  users: data.byUser.length,
                })
              : t("routing.trafficAnalysis.waitingData")}
          </p>
        </div>
      </div>

      <Card className="border-border/70">
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="grid gap-3 sm:grid-cols-2 md:max-w-md">
            <div className="space-y-1.5">
              <Label htmlFor="from">
                {t("routing.trafficAnalysis.fromDate")}
              </Label>
              <Input
                id="from"
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">{t("routing.trafficAnalysis.toDate")}</Label>
              <Input
                id="to"
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {QUICK_RANGES.map((days) => {
              const range = quickRange(days)
              const active = fromDate === range.from && toDate === range.to
              const label =
                days === 1
                  ? t("routing.common.today")
                  : t("routing.common.recentDays", { days })

              return (
                <Button
                  key={days}
                  type="button"
                  variant={active ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setQuick(days)}
                  disabled={loading}
                >
                  {label}
                </Button>
              )
            })}
            <Button
              type="button"
              onClick={runCurrentQuery}
              disabled={loading || !fromDate || !toDate}
            >
              {loading
                ? t("routing.common.loading")
                : t("routing.common.query")}
            </Button>
          </div>

          <div className="text-xs text-muted-foreground lg:col-span-2">
            {t("routing.trafficAnalysis.currentRange", { range: rangeLabel })}
            {lastUpdatedAt
              ? ` · ${t("routing.trafficAnalysis.lastUpdated", {
                  time: lastUpdatedAt,
                })}`
              : ""}
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      {loading && !data && <LoadingState />}

      {!loading && data && !hasData && <EmptyState rangeLabel={rangeLabel} />}

      {data && hasData && summary && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <TrafficSparkCard
              title={t("routing.trafficAnalysis.totalTxTraffic")}
              totalBytes={data.totalTxBytes}
              data={dailyChartData}
              dataKey="txBytes"
              config={makeTrafficConfig(t, ["txBytes"])}
              subtitle={t("routing.trafficAnalysis.shareOfTotal", {
                range: rangeLabel,
                share: summary.txShare,
              })}
              animate={shouldAnimate}
            />
            <TrafficSparkCard
              title={t("routing.trafficAnalysis.totalRxTraffic")}
              totalBytes={data.totalRxBytes}
              data={dailyChartData}
              dataKey="rxBytes"
              config={makeTrafficConfig(t, ["rxBytes"])}
              subtitle={t("routing.trafficAnalysis.shareOfTotal", {
                range: rangeLabel,
                share: summary.rxShare,
              })}
              animate={shouldAnimate}
            />
            <TrafficSparkCard
              title={t("routing.trafficAnalysis.totalTraffic")}
              totalBytes={data.totalBytes}
              data={dailyChartData}
              dataKey="totalBytes"
              config={makeTrafficConfig(t, ["totalBytes"])}
              subtitle={t("routing.trafficAnalysis.dailyAverageSubtitle", {
                days: summary.days,
                average: formatBytes(summary.averageDailyBytes),
              })}
              animate={shouldAnimate}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <InsightCard
              title={t("routing.trafficAnalysis.dailyAverage")}
              value={formatBytes(summary.averageDailyBytes)}
              description={t(
                "routing.trafficAnalysis.dailyAverageDescription",
                {
                  days: summary.days,
                }
              )}
            />
            <InsightCard
              title={t("routing.trafficAnalysis.peakDay")}
              value={summary.peakDay?.date ?? "-"}
              description={
                summary.peakDay
                  ? t("routing.trafficAnalysis.peakDayDescription", {
                      traffic: formatBytes(summary.peakDay.totalBytes),
                    })
                  : t("routing.trafficAnalysis.noPeak")
              }
              className="text-violet-600 dark:text-violet-400"
            />
            <InsightCard
              title={t("routing.trafficAnalysis.topNode")}
              value={summary.topNode?.nodeName ?? "-"}
              description={
                summary.topNode
                  ? `${formatBytes(summary.topNode.totalBytes)} · ${formatPercent(
                      summary.topNode.totalBytes,
                      data.totalBytes
                    )}%`
                  : t("routing.trafficAnalysis.noNodeData")
              }
              className="text-blue-600 dark:text-blue-400"
            />
            <InsightCard
              title={t("routing.trafficAnalysis.topUser")}
              value={summary.topUser?.username ?? "-"}
              description={
                summary.topUser
                  ? `${formatBytes(summary.topUser.totalBytes)} · ${formatPercent(
                      summary.topUser.totalBytes,
                      data.totalBytes
                    )}%`
                  : t("routing.trafficAnalysis.noUserData")
              }
              className="text-emerald-600 dark:text-emerald-400"
            />
          </div>

          <DailyTrafficTrendCard
            data={dailyChartData}
            animate={shouldAnimate}
          />

          {nodeTrendPivot &&
            nodeTrendConfig &&
            nodeTrendPivot.nodeNames.size > 0 && (
              <NodeTrendCard
                data={nodeTrendPivot.rows}
                nodeNames={nodeTrendPivot.nodeNames}
                config={nodeTrendConfig}
                animate={shouldAnimate}
              />
            )}

          <div className="grid gap-4 xl:grid-cols-2">
            {nodeBarData.length > 0 && (
              <StackedBarComparisonCard
                title={t("routing.trafficAnalysis.nodeRankingTitle", {
                  count: nodeBarData.length,
                })}
                description={t(
                  "routing.trafficAnalysis.nodeRankingDescription"
                )}
                data={nodeBarData}
              />
            )}
            {userBarData.length > 0 && (
              <StackedBarComparisonCard
                title={t("routing.trafficAnalysis.userRankingTitle", {
                  count: userBarData.length,
                })}
                description={t(
                  "routing.trafficAnalysis.userRankingDescription"
                )}
                data={userBarData}
              />
            )}
          </div>

          <div className="grid gap-4">
            {data.byNode.length > 0 && (
              <NodeDetailTable
                rows={data.byNode}
                totalBytes={data.totalBytes}
              />
            )}
            {data.byUser.length > 0 && (
              <UserDetailTable
                rows={data.byUser}
                totalBytes={data.totalBytes}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
