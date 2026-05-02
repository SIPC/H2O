"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
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

import { Badge } from "@/components/ui/badge"
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
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { formatBytes } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/*  类型                                                                */
/* ------------------------------------------------------------------ */

type DailyPoint = {
  date: string
  txBytes: number
  rxBytes: number
  totalBytes: number
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

/* ------------------------------------------------------------------ */
/*  图表配置                                                             */
/* ------------------------------------------------------------------ */

const TX_SPARK_CONFIG = {
  txBytes: {
    label: "总出",
    theme: { light: "#171717", dark: "#ffffff" },
  },
} satisfies ChartConfig

const RX_SPARK_CONFIG = {
  rxBytes: {
    label: "总入",
    theme: { light: "#171717", dark: "#ffffff" },
  },
} satisfies ChartConfig

const TOTAL_SPARK_CONFIG = {
  totalBytes: {
    label: "总量",
    theme: { light: "#171717", dark: "#ffffff" },
  },
} satisfies ChartConfig

const NODE_BAR_CONFIG = {
  出站: { label: "出站", theme: { light: "#2563eb", dark: "#60a5fa" } },
  入站: { label: "入站", theme: { light: "#16a34a", dark: "#4ade80" } },
} satisfies ChartConfig

const USER_BAR_CONFIG = {
  出站: { label: "出站", theme: { light: "#2563eb", dark: "#60a5fa" } },
  入站: { label: "入站", theme: { light: "#16a34a", dark: "#4ade80" } },
} satisfies ChartConfig

/* ------------------------------------------------------------------ */
/*  工具函数                                                             */
/* ------------------------------------------------------------------ */

function localDateStr(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function quickRange(days: number): { from: string; to: string } {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - days + 1)
  return { from: localDateStr(from), to: localDateStr(now) }
}

function pivotDailyByNode(
  data: DailyNodePoint[],
  metric: "txBytes" | "rxBytes" | "totalBytes"
) {
  const dateMap = new Map<string, Record<string, number | string>>()
  const nodeNames = new Map<number, string>()

  for (const row of data) {
    nodeNames.set(row.nodeId, row.nodeName)
    if (!dateMap.has(row.date)) {
      dateMap.set(row.date, { date: row.date })
    }
    const entry = dateMap.get(row.date)!
    entry[`node_${row.nodeId}`] = row[metric]
  }

  const rows = Array.from(dateMap.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  )

  return { rows, nodeNames }
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

/* ------------------------------------------------------------------ */
/*  子组件：汇总卡片（与 admin 页 TrafficSparkCard 同风格）                */
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
  data: Record<string, string | number>[]
  dataKey: string
  config: ChartConfig
  subtitle: string
  animate: boolean
}) {
  const shouldAnimate = data.length > 0

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
        </div>

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
                  labelFormatter={(value) => String(value)}
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

/* ------------------------------------------------------------------ */
/*  子组件：节点多折线卡片（同风格，略高）                                  */
/* ------------------------------------------------------------------ */

const NodeSparklineCard = memo(function NodeSparklineCardInner({
  title,
  data,
  nodeNames,
  config,
  animate,
}: {
  title: string
  data: Record<string, string | number>[]
  nodeNames: Map<number, string>
  config: ChartConfig
  animate: boolean
}) {
  const shouldAnimate = data.length > 0

  return (
    <Card className="overflow-hidden border-border/70">
      <CardContent className="p-4">
        <p className="mb-2 text-sm text-muted-foreground">{title}</p>

        <ChartContainer config={config} className="aspect-auto h-20 w-full">
          <LineChart
            accessibilityLayer
            data={data}
            margin={{ top: 6, right: 0, left: 0, bottom: 0 }}
          >
            <XAxis dataKey="date" hide />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  indicator="dot"
                  labelFormatter={(value) => String(value)}
                  formatter={(value) => formatBytes(Number(value))}
                />
              }
            />
            {Array.from(nodeNames.entries()).map(([id], i) => (
              <Line
                key={id}
                type="monotone"
                dataKey={`node_${id}`}
                name={nodeNames.get(id) ?? `节点${id}`}
                stroke={NODE_COLORS[i % NODE_COLORS.length]}
                strokeWidth={2}
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

        {/* 图例 */}
        <div className="mt-2 flex flex-wrap gap-3">
          {Array.from(nodeNames.entries()).map(([id, name], i) => (
            <div key={id} className="flex items-center gap-1.5 text-xs">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  backgroundColor: NODE_COLORS[i % NODE_COLORS.length],
                }}
              />
              <span className="text-muted-foreground">{name}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
})

/* ------------------------------------------------------------------ */
/*  主页面                                                               */
/* ------------------------------------------------------------------ */

export default function TrafficAnalysisPage() {
  const defaultRange = useMemo(() => quickRange(7), [])
  const [fromDate, setFromDate] = useState(defaultRange.from)
  const [toDate, setToDate] = useState(defaultRange.to)
  const [data, setData] = useState<AnalysisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // 动画仅首次加载时播放，后续查询不再重播
  const [shouldAnimate, setShouldAnimate] = useState(true)

  const fetchAnalysis = useCallback(async () => {
    if (!fromDate || !toDate) return
    setLoading(true)
    setError("")

    try {
      const params = new URLSearchParams({ from: fromDate, to: toDate })
      const res = await fetch(`/api/admin/traffic/analysis?${params}`)
      const json = await res.json()

      if (!json.ok) {
        setError(json.error?.message ?? "请求失败")
        setData(null)
        return
      }

      setData(json.data as AnalysisData)
    } catch {
      setError("网络错误")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate])

  // 首次加载
  useEffect(() => {
    if (!fromDate || !toDate) return

    const params = new URLSearchParams({ from: fromDate, to: toDate })
    void fetch(`/api/admin/traffic/analysis?${params}`)
      .then((res) => res.json())
      .then((json) => {
        if (!json.ok) {
          setError(json.error?.message ?? "请求失败")
          setData(null)
          return
        }

        setData(json.data as AnalysisData)
      })
      .catch(() => {
        setError("网络错误")
        setData(null)
      })
      .finally(() => {
        setLoading(false)
        setShouldAnimate(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 快捷按钮
  const setQuick = useCallback((days: number) => {
    const r = quickRange(days)
    setFromDate(r.from)
    setToDate(r.to)
  }, [])

  // sparkline 数据
  const txSparkData = useMemo(
    () =>
      data?.daily.map((d) => ({
        label: d.date.slice(5),
        txBytes: d.txBytes,
      })) ?? [],
    [data]
  )
  const rxSparkData = useMemo(
    () =>
      data?.daily.map((d) => ({
        label: d.date.slice(5),
        rxBytes: d.rxBytes,
      })) ?? [],
    [data]
  )
  const totalSparkData = useMemo(
    () =>
      data?.daily.map((d) => ({
        label: d.date.slice(5),
        totalBytes: d.totalBytes,
      })) ?? [],
    [data]
  )

  // 多折线图 pivot
  const txPivot = useMemo(
    () => (data ? pivotDailyByNode(data.dailyByNode, "txBytes") : null),
    [data]
  )
  const rxPivot = useMemo(
    () => (data ? pivotDailyByNode(data.dailyByNode, "rxBytes") : null),
    [data]
  )

  // 预计算节点图表 config，避免在 JSX 中每次渲染都重建对象
  const txNodeConfig = useMemo(() => {
    if (!txPivot) return null
    const cfg: Record<string, { label: string; color: string }> = {}
    let i = 0
    for (const [id, name] of txPivot.nodeNames) {
      cfg[`node_${id}`] = {
        label: name,
        color: NODE_COLORS[i % NODE_COLORS.length],
      }
      i++
    }
    return cfg as ChartConfig
  }, [txPivot])

  const rxNodeConfig = useMemo(() => {
    if (!rxPivot) return null
    const cfg: Record<string, { label: string; color: string }> = {}
    let i = 0
    for (const [id, name] of rxPivot.nodeNames) {
      cfg[`node_${id}`] = {
        label: name,
        color: NODE_COLORS[i % NODE_COLORS.length],
      }
      i++
    }
    return cfg as ChartConfig
  }, [rxPivot])

  // 节点柱状图数据
  const nodeBarData = useMemo(() => {
    if (!data) return []
    return data.byNode.map((n) => ({
      label: n.nodeName,
      出站: n.txBytes,
      入站: n.rxBytes,
    }))
  }, [data])

  // 用户柱状图数据
  const userBarData = useMemo(() => {
    if (!data) return []
    return data.byUser.slice(0, 20).map((u) => ({
      label: u.username,
      出站: u.txBytes,
      入站: u.rxBytes,
    }))
  }, [data])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      {/* 页头 */}
      <div>
        <h1 className="text-2xl font-semibold">流量分析</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          按日期范围查询全局、节点、用户维度的流量统计
        </p>
      </div>

      {/* 日期选择器 */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1">
            <Label htmlFor="from">起始日期</Label>
            <Input
              id="from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">结束日期</Label>
            <Input
              id="to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-40"
            />
          </div>
          <Button onClick={() => void fetchAnalysis()} disabled={loading}>
            {loading ? "加载中…" : "查询"}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setQuick(1)}>
              今天
            </Button>
            <Button variant="outline" size="sm" onClick={() => setQuick(7)}>
              近 7 天
            </Button>
            <Button variant="outline" size="sm" onClick={() => setQuick(30)}>
              近 30 天
            </Button>
            <Button variant="outline" size="sm" onClick={() => setQuick(90)}>
              近 90 天
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 错误提示 */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* 无数据 */}
      {!loading && data && data.daily.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            所选时间范围内暂无流量数据
          </CardContent>
        </Card>
      )}

      {/* 汇总 sparkline 卡片（与 admin 流量卡片同风格） */}
      {data && data.daily.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <TrafficSparkCard
            title="总出站流量"
            totalBytes={data.totalTxBytes}
            data={txSparkData}
            dataKey="txBytes"
            config={TX_SPARK_CONFIG}
            subtitle={`${data.from} ~ ${data.to}`}
            animate={shouldAnimate}
          />
          <TrafficSparkCard
            title="总入站流量"
            totalBytes={data.totalRxBytes}
            data={rxSparkData}
            dataKey="rxBytes"
            config={RX_SPARK_CONFIG}
            subtitle={`${data.from} ~ ${data.to}`}
            animate={shouldAnimate}
          />
          <TrafficSparkCard
            title="总流量"
            totalBytes={data.totalBytes}
            data={totalSparkData}
            dataKey="totalBytes"
            config={TOTAL_SPARK_CONFIG}
            subtitle={`${data.daily.length} 天`}
            animate={shouldAnimate}
          />
        </div>
      )}

      {/* 各节点每日趋势 sparkline */}
      {data &&
        txPivot &&
        rxPivot &&
        txPivot.nodeNames.size > 0 &&
        txNodeConfig &&
        rxNodeConfig && (
          <div className="grid gap-4 md:grid-cols-2">
            <NodeSparklineCard
              title="各节点每日出站"
              data={txPivot.rows}
              nodeNames={txPivot.nodeNames}
              config={txNodeConfig}
              animate={shouldAnimate}
            />
            <NodeSparklineCard
              title="各节点每日入站"
              data={rxPivot.rows}
              nodeNames={rxPivot.nodeNames}
              config={rxNodeConfig}
              animate={shouldAnimate}
            />
          </div>
        )}

      {/* 节点流量对比柱状图 */}
      {data && data.byNode.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">节点流量对比</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={NODE_BAR_CONFIG} className="h-64 w-full">
              <BarChart data={nodeBarData}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) =>
                    String(v).length > 8
                      ? String(v).slice(0, 8) + "…"
                      : String(v)
                  }
                />
                <YAxis
                  tickFormatter={(v) => formatBytes(Number(v))}
                  tickLine={false}
                  axisLine={false}
                  width={60}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(v) => formatBytes(Number(v))}
                    />
                  }
                />
                <Legend />
                <Bar
                  dataKey="出站"
                  fill="var(--color-出站)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="入站"
                  fill="var(--color-入站)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {/* 用户流量 Top 20 柱状图 */}
      {data && data.byUser.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              用户流量 Top {Math.min(data.byUser.length, 20)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={USER_BAR_CONFIG} className="h-64 w-full">
              <BarChart data={userBarData}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) =>
                    String(v).length > 8
                      ? String(v).slice(0, 8) + "…"
                      : String(v)
                  }
                />
                <YAxis
                  tickFormatter={(v) => formatBytes(Number(v))}
                  tickLine={false}
                  axisLine={false}
                  width={60}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(v) => formatBytes(Number(v))}
                    />
                  }
                />
                <Legend />
                <Bar
                  dataKey="出站"
                  fill="var(--color-出站)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="入站"
                  fill="var(--color-入站)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {/* 节点明细表 */}
      {data && data.byNode.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">节点流量明细</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>节点 ID</TH>
                  <TH>节点名称</TH>
                  <TH className="text-right">出站流量</TH>
                  <TH className="text-right">入站流量</TH>
                  <TH className="text-right">总流量</TH>
                  <TH className="text-right">占比</TH>
                </TR>
              </THead>
              <TBody>
                {data.byNode.map((node) => {
                  const pct =
                    data.totalBytes > 0
                      ? ((node.totalBytes / data.totalBytes) * 100).toFixed(1)
                      : "0.0"
                  return (
                    <TR key={node.nodeId}>
                      <TD>{node.nodeId}</TD>
                      <TD className="font-medium">{node.nodeName}</TD>
                      <TD className="text-right tabular-nums">
                        {formatBytes(node.txBytes)}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {formatBytes(node.rxBytes)}
                      </TD>
                      <TD className="text-right font-semibold tabular-nums">
                        {formatBytes(node.totalBytes)}
                      </TD>
                      <TD className="text-right">
                        <Badge className="bg-secondary text-secondary-foreground">
                          {pct}%
                        </Badge>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* 用户明细表 */}
      {data && data.byUser.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">用户流量明细</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>用户 ID</TH>
                  <TH>用户名</TH>
                  <TH className="text-right">出站流量</TH>
                  <TH className="text-right">入站流量</TH>
                  <TH className="text-right">总流量</TH>
                  <TH className="text-right">占比</TH>
                </TR>
              </THead>
              <TBody>
                {data.byUser.map((user) => {
                  const pct =
                    data.totalBytes > 0
                      ? ((user.totalBytes / data.totalBytes) * 100).toFixed(1)
                      : "0.0"
                  return (
                    <TR key={user.userId}>
                      <TD>{user.userId}</TD>
                      <TD className="font-medium">{user.username}</TD>
                      <TD className="text-right tabular-nums">
                        {formatBytes(user.txBytes)}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {formatBytes(user.rxBytes)}
                      </TD>
                      <TD className="text-right font-semibold tabular-nums">
                        {formatBytes(user.totalBytes)}
                      </TD>
                      <TD className="text-right">
                        <Badge className="bg-secondary text-secondary-foreground">
                          {pct}%
                        </Badge>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
