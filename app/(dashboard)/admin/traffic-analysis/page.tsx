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

const TX_SPARK_CONFIG = {
  txBytes: {
    label: "出站",
    theme: { light: "#8b5cf6", dark: "#a78bfa" },
  },
} satisfies ChartConfig

const RX_SPARK_CONFIG = {
  rxBytes: {
    label: "入站",
    theme: { light: "#3b82f6", dark: "#60a5fa" },
  },
} satisfies ChartConfig

const TOTAL_SPARK_CONFIG = {
  totalBytes: {
    label: "总量",
    theme: { light: "#171717", dark: "#ffffff" },
  },
} satisfies ChartConfig

const DAILY_TREND_CONFIG = {
  txBytes: {
    label: "出站",
    theme: { light: "#8b5cf6", dark: "#a78bfa" },
  },
  rxBytes: {
    label: "入站",
    theme: { light: "#3b82f6", dark: "#60a5fa" },
  },
  totalBytes: {
    label: "总量",
    theme: { light: "#171717", dark: "#ffffff" },
  },
} satisfies ChartConfig

const RANK_BAR_CONFIG = {
  txBytes: {
    label: "出站",
    theme: { light: "#8b5cf6", dark: "#a78bfa" },
  },
  rxBytes: {
    label: "入站",
    theme: { light: "#3b82f6", dark: "#60a5fa" },
  },
} satisfies ChartConfig

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

function metricLabel(name: unknown): string {
  const value = String(name)

  if (value === "txBytes") return "出站"
  if (value === "rxBytes") return "入站"
  if (value === "totalBytes") return "总量"

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
        <span className="truncate">{metricLabel(name)}</span>
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
  range: DateRange
): Promise<AnalysisFetchResult> {
  try {
    const params = new URLSearchParams({ from: range.from, to: range.to })
    const res = await fetch(`/api/admin/traffic/analysis?${params}`)
    const json = await res.json()

    if (!json.ok) {
      return {
        ok: false,
        message: json.error?.message ?? "请求失败",
      }
    }

    return { ok: true, data: json.data as AnalysisData }
  } catch {
    return { ok: false, message: "网络错误" }
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
                  formatter={renderBytesTooltip}
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
  const shouldAnimate = data.some((item) => item.totalBytes > 0)

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>每日流量趋势</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          出站、入站与总量按日展示
        </p>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={DAILY_TREND_CONFIG}
          className="aspect-auto h-80 w-full"
        >
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
                  formatter={renderBytesTooltip}
                />
              }
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="txBytes"
              name="出站"
              stroke="var(--color-txBytes)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={shouldAnimate && animate}
            />
            <Line
              type="monotone"
              dataKey="rxBytes"
              name="入站"
              stroke="var(--color-rxBytes)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={shouldAnimate && animate}
            />
            <Line
              type="monotone"
              dataKey="totalBytes"
              name="总量"
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
  const shouldAnimate = data.length > 0

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>Top {nodeNames.size} 节点每日趋势</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          按总流量排序展示 Top 节点的每日趋势
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
                  formatter={renderBytesTooltip}
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
  const chartHeight = Math.max(260, data.length * 38 + 96)

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={RANK_BAR_CONFIG}
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
                  formatter={renderBytesTooltip}
                />
              }
            />
            <Legend />
            <Bar
              dataKey="txBytes"
              name="出站"
              stackId="traffic"
              fill="var(--color-txBytes)"
              radius={[4, 0, 0, 4]}
            />
            <Bar
              dataKey="rxBytes"
              name="入站"
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
  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>节点流量明细</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          按总流量降序排列，包含出入站拆分与占比
        </p>
      </CardHeader>
      <CardContent>
        <Table className="min-w-190">
          <THead>
            <TR>
              <TH>排名</TH>
              <TH>节点</TH>
              <TH className="text-right">出站</TH>
              <TH className="text-right">入站</TH>
              <TH className="text-right">总量</TH>
              <TH className="text-right">占比</TH>
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
  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>用户流量明细</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          按用户订阅汇总流量，按总量降序排列
        </p>
      </CardHeader>
      <CardContent>
        <Table className="min-w-190">
          <THead>
            <TR>
              <TH>排名</TH>
              <TH>用户</TH>
              <TH className="text-right">出站</TH>
              <TH className="text-right">入站</TH>
              <TH className="text-right">总量</TH>
              <TH className="text-right">占比</TH>
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
  return (
    <Card className="border-dashed border-border/70">
      <CardContent className="flex min-h-52 flex-col items-center justify-center p-8 text-center">
        <div className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          {rangeLabel}
        </div>
        <h2 className="mt-4 text-lg font-semibold">暂无流量数据</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          所选时间范围内暂无流量统计。请调整日期范围或检查 Agent 上报状态。
        </p>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  主页面                                                               */
/* ------------------------------------------------------------------ */

export default function TrafficAnalysisPage() {
  const defaultRange = useMemo(() => quickRange(7), [])
  const requestIdRef = useRef(0)

  const [fromDate, setFromDate] = useState(defaultRange.from)
  const [toDate, setToDate] = useState(defaultRange.to)
  const [data, setData] = useState<AnalysisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [lastUpdatedAt, setLastUpdatedAt] = useState("")
  const [shouldAnimate, setShouldAnimate] = useState(true)

  const requestAnalysis = useCallback(async (range: DateRange) => {
    const from = range.from.trim()
    const to = range.to.trim()

    if (!from || !to) {
      setError("请选择完整日期范围")
      return
    }

    if (from > to) {
      setError("起始日期不能晚于结束日期")
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError("")

    try {
      const result = await loadAnalysisData({ from, to })

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

      setError("网络错误")
      setData(null)
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    void loadAnalysisData(defaultRange)
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
  }, [defaultRange])

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
    ? `${data.from} 至 ${data.to}`
    : `${fromDate || "-"} 至 ${toDate || "-"}`
  const rangeDays = summary?.days ?? getInclusiveDayCount(fromDate, toDate)
  const isUpdating = loading && Boolean(data)

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">流量分析</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            按日期范围查看全局、节点、用户流量统计
            {isUpdating && (
              <span className="ml-2 text-blue-600 dark:text-blue-400">
                · 更新中…
              </span>
            )}
          </p>
        </div>
        <div className="hidden text-right text-xs text-muted-foreground sm:block">
          <p>{rangeDays || "-"} 天</p>
          <p>
            {data
              ? `${data.byNode.length} 个节点 · ${data.byUser.length} 个用户`
              : "等待数据"}
          </p>
        </div>
      </div>

      <Card className="border-border/70">
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="grid gap-3 sm:grid-cols-2 md:max-w-md">
            <div className="space-y-1.5">
              <Label htmlFor="from">起始日期</Label>
              <Input
                id="from"
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">结束日期</Label>
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
              const label = days === 1 ? "今天" : `近 ${days} 天`

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
              {loading ? "加载中…" : "查询"}
            </Button>
          </div>

          <div className="text-xs text-muted-foreground lg:col-span-2">
            当前范围：{rangeLabel}
            {lastUpdatedAt ? ` · 最近更新 ${lastUpdatedAt}` : ""}
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
              title="总出站流量"
              totalBytes={data.totalTxBytes}
              data={dailyChartData}
              dataKey="txBytes"
              config={TX_SPARK_CONFIG}
              subtitle={`${rangeLabel} · 占总量 ${summary.txShare}%`}
              animate={shouldAnimate}
            />
            <TrafficSparkCard
              title="总入站流量"
              totalBytes={data.totalRxBytes}
              data={dailyChartData}
              dataKey="rxBytes"
              config={RX_SPARK_CONFIG}
              subtitle={`${rangeLabel} · 占总量 ${summary.rxShare}%`}
              animate={shouldAnimate}
            />
            <TrafficSparkCard
              title="总流量"
              totalBytes={data.totalBytes}
              data={dailyChartData}
              dataKey="totalBytes"
              config={TOTAL_SPARK_CONFIG}
              subtitle={`${summary.days} 天 · 日均 ${formatBytes(summary.averageDailyBytes)}`}
              animate={shouldAnimate}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <InsightCard
              title="日均流量"
              value={formatBytes(summary.averageDailyBytes)}
              description={`按 ${summary.days} 天统计周期计算`}
            />
            <InsightCard
              title="峰值日期"
              value={summary.peakDay?.date ?? "-"}
              description={
                summary.peakDay
                  ? `当天 ${formatBytes(summary.peakDay.totalBytes)}`
                  : "暂无峰值"
              }
              className="text-violet-600 dark:text-violet-400"
            />
            <InsightCard
              title="最高节点"
              value={summary.topNode?.nodeName ?? "-"}
              description={
                summary.topNode
                  ? `${formatBytes(summary.topNode.totalBytes)} · ${formatPercent(
                      summary.topNode.totalBytes,
                      data.totalBytes
                    )}%`
                  : "暂无节点数据"
              }
              className="text-blue-600 dark:text-blue-400"
            />
            <InsightCard
              title="最高用户"
              value={summary.topUser?.username ?? "-"}
              description={
                summary.topUser
                  ? `${formatBytes(summary.topUser.totalBytes)} · ${formatPercent(
                      summary.topUser.totalBytes,
                      data.totalBytes
                    )}%`
                  : "暂无用户数据"
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
                title={`节点流量排行 Top ${nodeBarData.length}`}
                description="按节点总流量降序展示出站 / 入站构成"
                data={nodeBarData}
              />
            )}
            {userBarData.length > 0 && (
              <StackedBarComparisonCard
                title={`用户流量排行 Top ${userBarData.length}`}
                description="按用户总流量降序展示出站 / 入站构成"
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
