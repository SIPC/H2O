"use client"

import { FormEvent, useEffect, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { ChevronsUpDown, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { DataTable, DataTableColumnHeader } from "@/components/data-table"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

type ReportRow = {
  id: number
  created_at: string
  node_id: number | null
  node_name: string | null
  auth_path: string
  ip: string | null
  success: 0 | 1
  reason: string
  reported_users: number
  online_count: number
  total_tx_bytes: number
  total_rx_bytes: number
  delta_tx_bytes: number
  delta_rx_bytes: number
  agent_version: string | null
  detail: string | null
}

type UserLogRow = {
  id: number
  report_id: number
  created_at: string
  node_id: number | null
  node_name: string | null
  user_id: number | null
  username: string
  reported_tx_bytes: number
  reported_rx_bytes: number
  last_tx_bytes: number | null
  last_rx_bytes: number | null
  delta_tx_bytes: number
  delta_rx_bytes: number
  online_count: number
  subscription_id: number | null
  success: 0 | 1
  reason: string
  detail: string | null
}

type UserRow = { id: number; username: string }
type NodeRow = { id: number; name: string }

type SuccessFilter = "all" | "1" | "0"

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

const reasonLabel: Record<string, string> = {
  OK: "成功",
  BAD_PAYLOAD: "参数非法",
  NO_NODE: "节点无效",
  NO_USER: "账号不存在",
  USER_DISABLED: "账号已禁用",
  NO_SUB: "无可用订阅",
  TRAFFIC_EXCEEDED: "流量耗尽",
  INTERNAL: "处理失败",
}

const detailLabel: Record<string, string> = {
  processed: "已处理用户",
  skipped: "跳过用户",
  blocked: "封禁订阅",
  error: "错误",
  counter_reset: "计数器重置",
  discarded_delta_tx_bytes: "未计费 TX 增量",
  discarded_delta_rx_bytes: "未计费 RX 增量",
  node_delta_users: "节点有增量用户",
  node_counter_reset_users: "节点计数器重置用户",
  node_snapshot_fallback_users: "快照兜底用户",
  subscription_delta_tx_bytes: "订阅计费 TX 增量",
  subscription_delta_rx_bytes: "订阅计费 RX 增量",
  used_traffic_bytes: "原已用流量",
  next_usage_bytes: "新已用流量",
  traffic_limit_bytes: "套餐流量上限",
}

function formatDate(value: string) {
  return new Date(value.endsWith("Z") ? value : `${value}Z`).toLocaleString()
}

function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "-"
  if (!Number.isFinite(bytes)) return "-"
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  let value = Math.max(0, bytes)
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`
}

function formatTrafficPair(tx: number, rx: number) {
  return `↑ ${formatBytes(tx)} / ↓ ${formatBytes(rx)}`
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
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "-"
  if (typeof value === "object") return JSON.stringify(value, null, 2)
  return String(value)
}

function renderDetailSummary(detail: string | null) {
  const entries = parseDetail(detail)
  if (!entries || entries.length === 0) return "-"
  return entries
    .map(
      ([key, value]) =>
        `${detailLabel[key] ?? key}: ${renderDetailValue(value)}`
    )
    .join("\n")
}

// 账号 / 节点筛选下拉：value 为空字符串表示不筛选
function NamedEntityCombobox({
  items,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  clearLabel,
  emptyText,
  className,
}: {
  items: Array<{ id: number; name: string }>
  value: string
  onChange: (value: string) => void
  placeholder: string
  searchPlaceholder: string
  clearLabel: string
  emptyText: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = items.find((i) => i.name === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn("justify-between font-normal", className)}
        >
          <span className={selected ? "" : "text-muted-foreground"}>
            {selected ? `#${selected.id} ${selected.name}` : placeholder}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-65 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__clear__"
                onSelect={() => {
                  onChange("")
                  setOpen(false)
                }}
              >
                <X className="size-4 opacity-60" />
                {clearLabel}
              </CommandItem>
              {items.map((i) => (
                <CommandItem
                  key={i.id}
                  value={i.name}
                  data-checked={value === i.name}
                  onSelect={() => {
                    onChange(i.name)
                    setOpen(false)
                  }}
                >
                  #{i.id} {i.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export default function AdminReportLogsPage() {
  const [rows, setRows] = useState<ReportRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [username, setUsername] = useState("")
  const [nodeName, setNodeName] = useState("")
  const [successFilter, setSuccessFilter] = useState<SuccessFilter>("all")
  const [users, setUsers] = useState<UserRow[]>([])
  const [nodes, setNodes] = useState<NodeRow[]>([])
  const [activeReport, setActiveReport] = useState<ReportRow | null>(null)
  const [activeUserLogs, setActiveUserLogs] = useState<UserLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)

  async function load(
    opts: {
      page?: number
      pageSize?: number
      filter?: SuccessFilter
      username?: string
      nodeName?: string
    } = {}
  ) {
    const nextPage = opts.page ?? page
    const nextPageSize = opts.pageSize ?? pageSize
    const nextFilter = opts.filter ?? successFilter
    const nextUsername = opts.username ?? username
    const nextNodeName = opts.nodeName ?? nodeName

    const params = new URLSearchParams()
    if (nextFilter !== "all") params.set("success", nextFilter)
    if (nextUsername.trim()) params.set("username", nextUsername.trim())
    if (nextNodeName.trim()) params.set("nodeName", nextNodeName.trim())
    params.set("page", String(nextPage))
    params.set("pageSize", String(nextPageSize))

    setLoading(true)
    try {
      const response = await fetch(
        `/api/admin/report-logs?${params.toString()}`
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
        const [logRes, userRes, nodeRes] = await Promise.all([
          fetch(`/api/admin/report-logs?${params.toString()}`),
          fetch("/api/admin/users"),
          fetch("/api/admin/nodes"),
        ])
        const logJson = await logRes.json()
        const userJson = await userRes.json()
        const nodeJson = await nodeRes.json()
        if (!mounted) return
        if (logJson?.ok) {
          setRows(logJson.data.rows)
          setTotal(logJson.data.total)
          setPage(logJson.data.page)
          setPageSize(logJson.data.pageSize)
        }
        if (userJson?.ok) setUsers(userJson.data)
        if (nodeJson?.ok) setNodes(nodeJson.data)
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

  async function switchFilter(next: SuccessFilter) {
    setSuccessFilter(next)
    await load({ page: 1, filter: next })
  }

  async function switchUsername(next: string) {
    setUsername(next)
    await load({ page: 1, username: next })
  }

  async function switchNode(next: string) {
    setNodeName(next)
    await load({ page: 1, nodeName: next })
  }

  async function changePage(next: number) {
    await load({ page: next })
  }

  async function changePageSize(next: number) {
    await load({ page: 1, pageSize: next })
  }

  async function openDetail(row: ReportRow) {
    setActiveReport(row)
    setActiveUserLogs([])
    setDetailLoading(true)
    const response = await fetch(`/api/admin/report-logs/${row.id}`)
    const json = await response.json()
    if (json?.ok) {
      setActiveReport(json.data.report)
      setActiveUserLogs(json.data.userLogs)
    }
    setDetailLoading(false)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const columns: ColumnDef<ReportRow>[] = [
    {
      accessorKey: "created_at",
      header: "时间",
      cell: ({ row }) => formatDate(row.original.created_at),
    },
    {
      accessorKey: "node_name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="节点" />
      ),
      cell: ({ row }) => row.original.node_name ?? "-",
    },
    {
      accessorKey: "ip",
      header: "来源 IP",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.ip ?? "-"}</span>
      ),
    },
    {
      id: "summary",
      header: "用户 / 在线",
      cell: ({ row }) => (
        <span className="text-xs">
          {row.original.reported_users} 用户 / {row.original.online_count} 在线
        </span>
      ),
    },
    {
      id: "delta",
      header: "本次增量",
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {formatTrafficPair(
            row.original.delta_tx_bytes,
            row.original.delta_rx_bytes
          )}
        </span>
      ),
    },
    {
      accessorKey: "success",
      header: "结果",
      cell: ({ row }) =>
        row.original.success === 1 ? (
          <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            成功
          </Badge>
        ) : (
          <Badge className="bg-destructive/15 text-destructive">失败</Badge>
        ),
    },
    {
      accessorKey: "reason",
      header: "原因",
      cell: ({ row }) => (
        <span className="text-xs">
          {reasonLabel[row.original.reason] ?? row.original.reason}
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
          onClick={() => void openDetail(row.original)}
        >
          详情
        </Button>
      ),
    },
  ]

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold">上报日志</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Agent 流量上报记录。
        </p>
      </div>

      {/* 筛选条件 */}
      <form className="grid gap-3 md:grid-cols-4" onSubmit={submit}>
        <div className="space-y-1">
          <Label>账号</Label>
          <NamedEntityCombobox
            items={users.map((u) => ({ id: u.id, name: u.username }))}
            value={username}
            onChange={(v) => void switchUsername(v)}
            placeholder="全部账号"
            searchPlaceholder="搜索用户名"
            clearLabel="全部账号"
            emptyText="无匹配账号"
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label>节点</Label>
          <NamedEntityCombobox
            items={nodes}
            value={nodeName}
            onChange={(v) => void switchNode(v)}
            placeholder="全部节点"
            searchPlaceholder="搜索节点名"
            clearLabel="全部节点"
            emptyText="无匹配节点"
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label>结果</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={successFilter === "all" ? "default" : "outline"}
              onClick={() => void switchFilter("all")}
            >
              全部
            </Button>
            <Button
              type="button"
              size="sm"
              variant={successFilter === "1" ? "default" : "outline"}
              onClick={() => void switchFilter("1")}
            >
              成功
            </Button>
            <Button
              type="button"
              size="sm"
              variant={successFilter === "0" ? "default" : "outline"}
              onClick={() => void switchFilter("0")}
            >
              失败
            </Button>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit">查询</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setUsername("")
              setNodeName("")
              setSuccessFilter("all")
              void load({
                page: 1,
                filter: "all",
                username: "",
                nodeName: "",
              })
            }}
          >
            重置
          </Button>
        </div>
      </form>

      {/* 日志列表 */}
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

      <ReportLogDetailSheet
        report={activeReport}
        userLogs={activeUserLogs}
        loading={detailLoading}
        onClose={() => {
          setActiveReport(null)
          setActiveUserLogs([])
        }}
      />
    </div>
  )
}

function ReportLogDetailSheet({
  report,
  userLogs,
  loading,
  onClose,
}: {
  report: ReportRow | null
  userLogs: UserLogRow[]
  loading: boolean
  onClose: () => void
}) {
  const entries = parseDetail(report?.detail ?? null)

  return (
    <Sheet
      open={report !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="data-[side=right]:sm:max-w-6xl">
        <SheetHeader>
          <SheetTitle>上报详情</SheetTitle>
          <SheetDescription>
            {report ? `#${report.id} · ${report.node_name ?? "未知节点"}` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {report ? (
            <div className="grid gap-4 text-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <DetailField
                  label="时间"
                  value={formatDate(report.created_at)}
                />
                <DetailField label="节点" value={report.node_name ?? "-"} />
                <DetailField label="auth_path" value={report.auth_path} mono />
                <DetailField label="来源 IP" value={report.ip ?? "-"} mono />
                <DetailField
                  label="Agent"
                  value={report.agent_version ?? "-"}
                />
                <DetailField
                  label="结果"
                  value={report.success === 1 ? "成功" : "失败"}
                />
                <DetailField
                  label="原因"
                  value={reasonLabel[report.reason] ?? report.reason}
                />
                <DetailField
                  label="用户 / 在线"
                  value={`${report.reported_users} 用户 / ${report.online_count} 在线`}
                />
                <DetailField
                  label="上报快照"
                  value={formatTrafficPair(
                    report.total_tx_bytes,
                    report.total_rx_bytes
                  )}
                  mono
                />
                <DetailField
                  label="本次增量"
                  value={formatTrafficPair(
                    report.delta_tx_bytes,
                    report.delta_rx_bytes
                  )}
                  mono
                />
              </div>

              {entries && entries.length > 0 ? (
                <div className="rounded-md border">
                  <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                    汇总数据
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

              <div className="rounded-md border">
                <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  用户明细
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>账号</TableHead>
                      <TableHead>在线</TableHead>
                      <TableHead>上报 TX/RX</TableHead>
                      <TableHead>上次 TX/RX</TableHead>
                      <TableHead>增量 TX/RX</TableHead>
                      <TableHead>订阅</TableHead>
                      <TableHead>结果</TableHead>
                      <TableHead>原因</TableHead>
                      <TableHead>详情</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={9} className="h-20 text-center">
                          加载中...
                        </TableCell>
                      </TableRow>
                    ) : userLogs.length > 0 ? (
                      userLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell>
                            <div className="font-medium">{log.username}</div>
                            <div className="text-xs text-muted-foreground">
                              {log.user_id ? `#${log.user_id}` : "未匹配用户"}
                            </div>
                          </TableCell>
                          <TableCell>{log.online_count}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {formatTrafficPair(
                              log.reported_tx_bytes,
                              log.reported_rx_bytes
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {log.last_tx_bytes === null &&
                            log.last_rx_bytes === null
                              ? "-"
                              : formatTrafficPair(
                                  log.last_tx_bytes ?? 0,
                                  log.last_rx_bytes ?? 0
                                )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {formatTrafficPair(
                              log.delta_tx_bytes,
                              log.delta_rx_bytes
                            )}
                          </TableCell>
                          <TableCell>
                            {log.subscription_id
                              ? `#${log.subscription_id}`
                              : "-"}
                          </TableCell>
                          <TableCell>
                            {log.success === 1 ? (
                              <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                                成功
                              </Badge>
                            ) : (
                              <Badge className="bg-destructive/15 text-destructive">
                                失败
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-xs">
                              {reasonLabel[log.reason] ?? log.reason}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-65 font-mono text-xs break-all whitespace-pre-wrap">
                            {renderDetailSummary(log.detail)}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={9} className="h-20 text-center">
                          暂无用户明细
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
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
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-sm break-all", mono && "font-mono text-xs")}>
        {value}
      </div>
    </div>
  )
}
