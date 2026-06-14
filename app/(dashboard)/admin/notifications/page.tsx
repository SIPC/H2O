"use client"

import { FormEvent, useEffect, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import { DataTable, DataTableColumnHeader } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

type NotificationRow = {
  id: number
  created_at: string
  channel: string
  event: string
  level: string
  title: string
  message: string
  target: string | null
  subject_type: string | null
  subject_id: string | null
  success: 0 | 1
  reason: string | null
  detail: string | null
}

type SelectOption = { label: string; value: string }

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

const channelLabel: Record<string, string> = {
  telegram: "Telegram",
  system: "系统",
}

const eventLabel: Record<string, string> = {
  NODE_STATUS: "节点上下线",
  HY2_STATUS: "Hy2 状态",
  SUBSCRIPTION_TRAFFIC_EXCEEDED: "订阅流量超限",
  HOST_TRAFFIC_EXCEEDED: "节点流量超限",
  AGENT_TASK_FAILED: "Agent 任务失败",
  TEST: "测试通知",
}

const levelLabel: Record<string, string> = {
  info: "信息",
  success: "恢复",
  warning: "告警",
  error: "错误",
}

const reasonLabel: Record<string, string> = {
  OK: "成功",
  TELEGRAM_DISABLED: "Telegram 未启用",
  TELEGRAM_CONFIG_MISSING: "Telegram 配置缺失",
  TELEGRAM_API_ERROR: "Telegram API 错误",
  TELEGRAM_TIMEOUT: "Telegram 请求超时",
  TELEGRAM_NETWORK_ERROR: "Telegram 网络错误",
  INVALID_CONFIG: "Telegram 配置非法",
  CONFIG_MISSING: "Telegram 配置缺失",
  NODE_OFFLINE: "节点离线",
  NODE_ONLINE: "节点上线",
  HY2_FAILED: "Hy2 异常",
  HY2_RECOVERED: "Hy2 恢复",
  TRAFFIC_EXCEEDED: "流量超限",
  AGENT_TASK_FAILED: "Agent 任务失败",
  INTERNAL: "内部错误",
}

const detailLabel: Record<string, string> = {
  node_id: "节点 ID",
  node_name: "节点名",
  user_id: "用户 ID",
  username: "用户名",
  subscription_id: "订阅 ID",
  used_traffic_bytes: "已用流量",
  traffic_limit_bytes: "流量上限",
  next_usage_bytes: "新用量",
  billable_delta_bytes: "计费增量",
  host_traffic_used_bytes: "节点已用流量",
  host_traffic_limit_bytes: "节点流量上限",
  task_id: "任务 ID",
  task_type: "任务类型",
  error: "错误",
}

const channelOptions: SelectOption[] = [
  { label: "全部渠道", value: "all" },
  { label: "Telegram", value: "telegram" },
  { label: "系统", value: "system" },
]

const eventOptions: SelectOption[] = [
  { label: "全部事件", value: "all" },
  { label: "节点上下线", value: "NODE_STATUS" },
  { label: "Hy2 状态", value: "HY2_STATUS" },
  { label: "订阅流量超限", value: "SUBSCRIPTION_TRAFFIC_EXCEEDED" },
  { label: "节点流量超限", value: "HOST_TRAFFIC_EXCEEDED" },
  { label: "Agent 任务失败", value: "AGENT_TASK_FAILED" },
  { label: "测试通知", value: "TEST" },
]

const levelOptions: SelectOption[] = [
  { label: "全部级别", value: "all" },
  { label: "信息", value: "info" },
  { label: "恢复", value: "success" },
  { label: "告警", value: "warning" },
  { label: "错误", value: "error" },
]

const successOptions: SelectOption[] = [
  { label: "全部结果", value: "all" },
  { label: "成功", value: "1" },
  { label: "失败", value: "0" },
]

function formatDate(value: string) {
  return new Date(value.endsWith("Z") ? value : `${value}Z`).toLocaleString()
}

function parseDetail(detail: string | null): Array<[string, unknown]> | null {
  if (!detail) return null
  try {
    const obj = JSON.parse(detail) as Record<string, unknown>
    return Object.entries(obj)
  } catch {
    return [["raw", detail]]
  }
}

function renderDetailValue(value: unknown): string {
  if (value === null || value === undefined) return "-"
  if (typeof value === "boolean") return value ? "是" : "否"
  if (typeof value === "object") return JSON.stringify(value, null, 2)
  return String(value)
}

function levelBadgeClass(level: string) {
  if (level === "error") return "bg-destructive/15 text-destructive"
  if (level === "warning") return "bg-muted text-foreground"
  if (level === "success") return "bg-primary/15 text-primary"
  return "bg-muted text-muted-foreground"
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

export default function AdminNotificationsPage() {
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [query, setQuery] = useState("")
  const [channelFilter, setChannelFilter] = useState("all")
  const [eventFilter, setEventFilter] = useState("all")
  const [levelFilter, setLevelFilter] = useState("all")
  const [successFilter, setSuccessFilter] = useState("all")
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [activeRow, setActiveRow] = useState<NotificationRow | null>(null)

  async function load(
    opts: {
      page?: number
      pageSize?: number
      query?: string
      channel?: string
      event?: string
      level?: string
      success?: string
    } = {}
  ) {
    const nextPage = opts.page ?? page
    const nextPageSize = opts.pageSize ?? pageSize
    const nextQuery = opts.query ?? query
    const nextChannel = opts.channel ?? channelFilter
    const nextEvent = opts.event ?? eventFilter
    const nextLevel = opts.level ?? levelFilter
    const nextSuccess = opts.success ?? successFilter

    const params = new URLSearchParams()
    if (nextQuery.trim()) params.set("q", nextQuery.trim())
    if (nextChannel !== "all") params.set("channel", nextChannel)
    if (nextEvent !== "all") params.set("event", nextEvent)
    if (nextLevel !== "all") params.set("level", nextLevel)
    if (nextSuccess !== "all") params.set("success", nextSuccess)
    params.set("page", String(nextPage))
    params.set("pageSize", String(nextPageSize))

    setLoading(true)
    try {
      const response = await fetch(
        `/api/admin/notifications?${params.toString()}`
      )
      const json = await response.json()
      if (!json?.ok) return

      setRows(json.data.rows)
      setTotal(json.data.total)
      setPage(json.data.page)
      setPageSize(json.data.pageSize)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true

    void (async () => {
      try {
        const params = new URLSearchParams({ page: "1", pageSize: "50" })
        const response = await fetch(
          `/api/admin/notifications?${params.toString()}`
        )
        const json = await response.json()
        if (!mounted) return
        if (json?.ok) {
          setRows(json.data.rows)
          setTotal(json.data.total)
          setPage(json.data.page)
          setPageSize(json.data.pageSize)
        }
      } finally {
        if (mounted) setLoading(false)
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await load({ page: 1 })
  }

  async function switchChannel(next: string) {
    setChannelFilter(next)
    await load({ page: 1, channel: next })
  }

  async function switchEvent(next: string) {
    setEventFilter(next)
    await load({ page: 1, event: next })
  }

  async function switchLevel(next: string) {
    setLevelFilter(next)
    await load({ page: 1, level: next })
  }

  async function switchSuccess(next: string) {
    setSuccessFilter(next)
    await load({ page: 1, success: next })
  }

  async function changePage(next: number) {
    await load({ page: next })
  }

  async function changePageSize(next: number) {
    await load({ page: 1, pageSize: next })
  }

  function resetFilters() {
    setQuery("")
    setChannelFilter("all")
    setEventFilter("all")
    setLevelFilter("all")
    setSuccessFilter("all")
    void load({
      page: 1,
      query: "",
      channel: "all",
      event: "all",
      level: "all",
      success: "all",
    })
  }

  async function runCheckNow() {
    setChecking(true)
    try {
      const response = await fetch("/api/admin/notifications/check", {
        method: "POST",
      })
      const json = await response.json()
      if (!response.ok || !json?.ok) {
        toast.error("检查失败", {
          description: json?.error?.message ?? "请稍后重试",
        })
        return
      }
      toast.success("检查完成", {
        description: `处理 ${json.data?.processed ?? 0} 条，发送 ${json.data?.sent ?? 0} 条`,
      })
      await load({ page: 1 })
    } catch {
      toast.error("检查失败", {
        description: "网络错误，请稍后重试",
      })
    } finally {
      setChecking(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const columns: ColumnDef<NotificationRow>[] = [
    {
      accessorKey: "created_at",
      header: "时间",
      cell: ({ row }) => formatDate(row.original.created_at),
    },
    {
      accessorKey: "channel",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="渠道" />
      ),
      cell: ({ row }) => (
        <Badge>
          {channelLabel[row.original.channel] ?? row.original.channel}
        </Badge>
      ),
    },
    {
      accessorKey: "event",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="事件" />
      ),
      cell: ({ row }) => eventLabel[row.original.event] ?? row.original.event,
    },
    {
      accessorKey: "level",
      header: "级别",
      cell: ({ row }) => (
        <Badge className={levelBadgeClass(row.original.level)}>
          {levelLabel[row.original.level] ?? row.original.level}
        </Badge>
      ),
    },
    {
      accessorKey: "title",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="内容" />
      ),
      cell: ({ row }) => (
        <div className="flex max-w-80 flex-col gap-0.5">
          <span className="truncate font-medium">{row.original.title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {row.original.message}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "target",
      header: "目标",
      cell: ({ row }) => row.original.target ?? "-",
    },
    {
      accessorKey: "success",
      header: "结果",
      cell: ({ row }) =>
        row.original.success === 1 ? (
          <Badge className="bg-primary/15 text-primary">成功</Badge>
        ) : (
          <Badge className="bg-destructive/15 text-destructive">失败</Badge>
        ),
    },
    {
      accessorKey: "reason",
      header: "原因",
      cell: ({ row }) => (
        <span className="text-xs">
          {row.original.reason
            ? (reasonLabel[row.original.reason] ?? row.original.reason)
            : "-"}
        </span>
      ),
    },
    {
      id: "操作",
      header: "操作",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => setActiveRow(row.original)}
        >
          详情
        </Button>
      ),
    },
  ]

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">通知历史</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            查看 Telegram Bot
            等渠道的通知投递记录，后续节点告警会统一汇总在这里。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={checking}
          onClick={() => void runCheckNow()}
        >
          {checking ? "检查中..." : "立即检查"}
        </Button>
      </div>

      <form className="grid gap-3 md:grid-cols-6" onSubmit={submit}>
        <div className="flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="notification_query">搜索</Label>
          <Input
            id="notification_query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="标题、内容、目标或原因"
          />
        </div>
        <FilterSelect
          label="渠道"
          value={channelFilter}
          options={channelOptions}
          onChange={(next) => void switchChannel(next)}
        />
        <FilterSelect
          label="事件"
          value={eventFilter}
          options={eventOptions}
          onChange={(next) => void switchEvent(next)}
        />
        <FilterSelect
          label="级别"
          value={levelFilter}
          options={levelOptions}
          onChange={(next) => void switchLevel(next)}
        />
        <FilterSelect
          label="结果"
          value={successFilter}
          options={successOptions}
          onChange={(next) => void switchSuccess(next)}
        />
        <div className="flex items-end justify-end gap-2 md:col-span-6">
          <Button type="submit">查询</Button>
          <Button type="button" variant="outline" onClick={resetFilters}>
            重置
          </Button>
        </div>
      </form>

      <DataTable
        columns={columns}
        data={rows}
        manualPagination
        pageCount={totalPages}
        page={page}
        pageSize={pageSize}
        totalRows={total}
        onPageChange={changePage}
        onPageSizeChange={changePageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        loading={loading}
        loadingRowCount={10}
      />

      <NotificationDetailSheet
        row={activeRow}
        onClose={() => setActiveRow(null)}
      />
    </div>
  )
}

function NotificationDetailSheet({
  row,
  onClose,
}: {
  row: NotificationRow | null
  onClose: () => void
}) {
  const entries = parseDetail(row?.detail ?? null)
  const createdAt = row ? formatDate(row.created_at) : ""

  return (
    <Sheet
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>通知详情</SheetTitle>
          <SheetDescription>
            {row ? `#${row.id} · ${eventLabel[row.event] ?? row.event}` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {row ? (
            <div className="flex flex-col gap-3 text-sm">
              <DetailField label="时间" value={createdAt} />
              <DetailField
                label="渠道"
                value={channelLabel[row.channel] ?? row.channel}
              />
              <DetailField
                label="事件"
                value={eventLabel[row.event] ?? row.event}
              />
              <DetailField
                label="级别"
                value={levelLabel[row.level] ?? row.level}
              />
              <DetailField label="标题" value={row.title} />
              <DetailField label="内容" value={row.message} multiline />
              <DetailField label="目标" value={row.target ?? "-"} />
              <DetailField
                label="主体"
                value={
                  row.subject_type || row.subject_id
                    ? `${row.subject_type ?? "-"}:${row.subject_id ?? "-"}`
                    : "-"
                }
                mono
              />
              <DetailField
                label="结果"
                value={row.success === 1 ? "成功" : "失败"}
              />
              <DetailField
                label="原因"
                value={
                  row.reason ? (reasonLabel[row.reason] ?? row.reason) : "-"
                }
              />
              {entries && entries.length > 0 ? (
                <div className="mt-2 rounded-md border">
                  <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                    数据
                  </div>
                  <div className="divide-y">
                    {entries.map(([key, value]) => (
                      <div
                        key={key}
                        className="grid grid-cols-[120px_1fr] gap-2 px-3 py-2 text-xs"
                      >
                        <div className="text-muted-foreground">
                          {detailLabel[key] ?? key}
                        </div>
                        <div className="font-mono break-all whitespace-pre-wrap">
                          {renderDetailValue(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DetailField({
  label,
  value,
  mono,
  multiline,
}: {
  label: string
  value: string
  mono?: boolean
  multiline?: boolean
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-sm break-all",
          mono && "font-mono text-xs",
          multiline && "whitespace-pre-wrap"
        )}
      >
        {value}
      </div>
    </div>
  )
}
