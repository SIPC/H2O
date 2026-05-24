"use client"

import { FormEvent, useCallback, useEffect, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { ChevronsUpDown, X } from "lucide-react"

import { DataTable, DataTableColumnHeader } from "@/components/data-table"
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
import {
  parseAgentTaskOutput,
  renderAgentTaskOutput,
  type AgentLogEntry,
} from "@/lib/agent-task-output"
import { isAgentTaskTimeoutError } from "@/lib/agent-task-timeout"
import { cn } from "@/lib/utils"

type AgentTaskType =
  | "HY2_STATUS"
  | "HY2_START"
  | "HY2_STOP"
  | "HY2_RESTART"
  | "HY2_LOGS"
  | "HY2_SELF_UPDATE"
  | "AGENT_LOGS"
  | "AGENT_RESTART"
  | "APPLY_CONFIG"
  | "AGENT_SELF_UPDATE"

type AgentTaskStatus =
  | "queued"
  | "claimed"
  | "succeeded"
  | "failed"
  | "cancelled"

type TaskTypeFilter = "all" | AgentTaskType
type StatusFilter = "all" | AgentTaskStatus | "timeout"

type AgentTaskRow = {
  id: number
  node_id: number
  node_name: string | null
  type: AgentTaskType
  payload: string | null
  status: AgentTaskStatus
  result: string | null
  error: string | null
  created_by: number | null
  created_by_username: string | null
  created_at: string
  claimed_at: string | null
  lease_expires_at: string | null
  finished_at: string | null
  updated_at: string
}

type NodeRow = { id: number; name: string }

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

const TASK_LABEL: Record<AgentTaskType, string> = {
  HY2_STATUS: "检查 Hysteria2 状态",
  HY2_START: "启动 Hysteria2",
  HY2_STOP: "停止 Hysteria2",
  HY2_RESTART: "重启 Hysteria2",
  HY2_LOGS: "查看 Hysteria2 日志",
  HY2_SELF_UPDATE: "更新 Hysteria2",
  AGENT_LOGS: "查看 Agent 日志",
  AGENT_RESTART: "重启 Agent",
  APPLY_CONFIG: "应用配置",
  AGENT_SELF_UPDATE: "更新 Agent",
}

const TASK_STATUS_LABEL: Record<AgentTaskStatus, string> = {
  queued: "排队中",
  claimed: "执行中",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
}

const taskTypeOptions: Array<{ label: string; value: TaskTypeFilter }> = [
  { label: "全部任务", value: "all" },
  { label: "检查 Hysteria2 状态", value: "HY2_STATUS" },
  { label: "启动 Hysteria2", value: "HY2_START" },
  { label: "停止 Hysteria2", value: "HY2_STOP" },
  { label: "重启 Hysteria2", value: "HY2_RESTART" },
  { label: "查看 Hysteria2 日志", value: "HY2_LOGS" },
  { label: "更新 Hysteria2", value: "HY2_SELF_UPDATE" },
  { label: "查看 Agent 日志", value: "AGENT_LOGS" },
  { label: "重启 Agent", value: "AGENT_RESTART" },
  { label: "应用配置", value: "APPLY_CONFIG" },
  { label: "更新 Agent", value: "AGENT_SELF_UPDATE" },
]

const statusOptions: Array<{ label: string; value: StatusFilter }> = [
  { label: "全部状态", value: "all" },
  { label: "排队中", value: "queued" },
  { label: "执行中", value: "claimed" },
  { label: "成功", value: "succeeded" },
  { label: "失败", value: "failed" },
  { label: "超时", value: "timeout" },
  { label: "已取消", value: "cancelled" },
]

function formatDate(value: string | null) {
  if (!value) return "-"
  return new Date(value.endsWith("Z") ? value : `${value}Z`).toLocaleString()
}

function parseJsonString(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

function renderJsonLike(raw: string | null): string {
  const parsed = parseJsonString(raw)
  if (parsed === null || parsed === undefined || parsed === "") return "-"
  if (typeof parsed === "string") return parsed
  return JSON.stringify(parsed, null, 2)
}

function parseTaskOutput(row: AgentTaskRow) {
  return renderAgentTaskOutput(row.result, row.error)
}

function getTaskSummary(row: AgentTaskRow) {
  const output = parseTaskOutput(row)
  if (output) return output.length > 120 ? `${output.slice(0, 120)}...` : output
  if (row.payload) {
    const payload = renderJsonLike(row.payload)
    return payload.length > 120 ? `${payload.slice(0, 120)}...` : payload
  }
  return "-"
}

function isTimedOutTask(row: AgentTaskRow) {
  return row.status === "failed" && isAgentTaskTimeoutError(row.error)
}

function getTaskStatusLabel(row: AgentTaskRow) {
  if (isTimedOutTask(row)) return "超时"
  return TASK_STATUS_LABEL[row.status] ?? row.status
}

function statusBadgeClass(row: AgentTaskRow) {
  if (row.status === "succeeded") {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
  }
  if (isTimedOutTask(row)) {
    return "bg-orange-500/15 text-orange-700 dark:text-orange-400"
  }
  if (row.status === "failed")
    return "bg-red-500/15 text-red-700 dark:text-red-400"
  if (row.status === "queued" || row.status === "claimed") {
    return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300"
  }
  return "bg-muted text-muted-foreground"
}

function OptionCombobox<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: Array<{ label: string; value: T }>
  placeholder: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((option) => option.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn("justify-between font-normal", className)}
        >
          {current?.label ?? placeholder}
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0">
        <Command>
          <CommandList>
            <CommandEmpty>无匹配项</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  data-checked={value === option.value}
                  onSelect={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                >
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function NodeCombobox({
  nodes,
  value,
  onChange,
  className,
}: {
  nodes: NodeRow[]
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = nodes.find((node) => node.name === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn("justify-between font-normal", className)}
        >
          <span className={selected ? "" : "text-muted-foreground"}>
            {selected ? `#${selected.id} ${selected.name}` : "全部节点"}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-65 p-0">
        <Command>
          <CommandInput placeholder="搜索节点名" />
          <CommandList>
            <CommandEmpty>无匹配节点</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__clear__"
                onSelect={() => {
                  onChange("")
                  setOpen(false)
                }}
              >
                <X className="size-4 opacity-60" />
                全部节点
              </CommandItem>
              {nodes.map((node) => (
                <CommandItem
                  key={node.id}
                  value={node.name}
                  data-checked={value === node.name}
                  onSelect={() => {
                    onChange(node.name)
                    setOpen(false)
                  }}
                >
                  #{node.id} {node.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export default function AdminAgentTasksPage() {
  const [rows, setRows] = useState<AgentTaskRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [nodeName, setNodeName] = useState("")
  const [typeFilter, setTypeFilter] = useState<TaskTypeFilter>("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [nodes, setNodes] = useState<NodeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [activeRow, setActiveRow] = useState<AgentTaskRow | null>(null)

  const load = useCallback(
    async (
      opts: {
        page?: number
        pageSize?: number
        nodeName?: string
        type?: TaskTypeFilter
        status?: StatusFilter
        silent?: boolean
      } = {}
    ) => {
      const nextPage = opts.page ?? page
      const nextPageSize = opts.pageSize ?? pageSize
      const nextNodeName = opts.nodeName ?? nodeName
      const nextType = opts.type ?? typeFilter
      const nextStatus = opts.status ?? statusFilter

      const params = new URLSearchParams()
      if (nextNodeName.trim()) params.set("nodeName", nextNodeName.trim())
      if (nextType !== "all") params.set("type", nextType)
      if (nextStatus !== "all") params.set("status", nextStatus)
      params.set("page", String(nextPage))
      params.set("pageSize", String(nextPageSize))

      if (!opts.silent) setLoading(true)
      try {
        const response = await fetch(
          `/api/admin/agent-tasks?${params.toString()}`
        )
        const json = await response.json()
        if (!json?.ok) return

        setRows(json.data.rows)
        setTotal(json.data.total)
        setPage(json.data.page)
        setPageSize(json.data.pageSize)
      } finally {
        if (!opts.silent) setLoading(false)
      }
    },
    [nodeName, page, pageSize, statusFilter, typeFilter]
  )

  useEffect(() => {
    let mounted = true

    void (async () => {
      try {
        const params = new URLSearchParams({ page: "1", pageSize: "50" })
        const [taskRes, nodeRes] = await Promise.all([
          fetch(`/api/admin/agent-tasks?${params.toString()}`),
          fetch("/api/admin/nodes"),
        ])
        const taskJson = await taskRes.json()
        const nodeJson = await nodeRes.json()
        if (!mounted) return
        if (taskJson?.ok) {
          setRows(taskJson.data.rows)
          setTotal(taskJson.data.total)
          setPage(taskJson.data.page)
          setPageSize(taskJson.data.pageSize)
        }
        if (nodeJson?.ok) setNodes(nodeJson.data)
      } finally {
        if (mounted) setLoading(false)
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      void load({ silent: true })
    }, 5_000)
    return () => clearInterval(timer)
  }, [load])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await load({ page: 1 })
  }

  async function switchNode(next: string) {
    setNodeName(next)
    await load({ page: 1, nodeName: next })
  }

  async function switchType(next: TaskTypeFilter) {
    setTypeFilter(next)
    await load({ page: 1, type: next })
  }

  async function switchStatus(next: StatusFilter) {
    setStatusFilter(next)
    await load({ page: 1, status: next })
  }

  async function changePage(next: number) {
    await load({ page: next })
  }

  async function changePageSize(next: number) {
    await load({ page: 1, pageSize: next })
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const columns: ColumnDef<AgentTaskRow>[] = [
    {
      accessorKey: "created_at",
      header: "创建时间",
      cell: ({ row }) => formatDate(row.original.created_at),
    },
    {
      accessorKey: "node_name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="节点" />
      ),
      cell: ({ row }) => row.original.node_name ?? `#${row.original.node_id}`,
    },
    {
      accessorKey: "type",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="任务" />
      ),
      cell: ({ row }) => TASK_LABEL[row.original.type] ?? row.original.type,
    },
    {
      accessorKey: "status",
      header: "状态",
      cell: ({ row }) => (
        <Badge className={cn(statusBadgeClass(row.original))}>
          {getTaskStatusLabel(row.original)}
        </Badge>
      ),
    },
    {
      accessorKey: "created_by_username",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="创建者" />
      ),
      cell: ({ row }) => row.original.created_by_username ?? "-",
    },
    {
      id: "finished_at",
      header: "完成时间",
      cell: ({ row }) => formatDate(row.original.finished_at),
    },
    {
      id: "summary",
      header: "结果摘要",
      cell: ({ row }) => (
        <span className="line-clamp-2 max-w-90 font-mono text-xs whitespace-pre-wrap">
          {getTaskSummary(row.original)}
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
      <div>
        <h1 className="text-2xl font-bold">Agent 队列日志</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          查看所有节点 Agent 任务的排队、领取、执行结果和输出。
        </p>
      </div>

      <form className="grid gap-3 md:grid-cols-4" onSubmit={submit}>
        <div className="space-y-1">
          <Label>节点</Label>
          <NodeCombobox
            nodes={nodes}
            value={nodeName}
            onChange={(next) => void switchNode(next)}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label>任务类型</Label>
          <OptionCombobox
            value={typeFilter}
            onChange={(next) => void switchType(next)}
            options={taskTypeOptions}
            placeholder="全部任务"
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label>状态</Label>
          <OptionCombobox
            value={statusFilter}
            onChange={(next) => void switchStatus(next)}
            options={statusOptions}
            placeholder="全部状态"
            className="w-full"
          />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit">查询</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setNodeName("")
              setTypeFilter("all")
              setStatusFilter("all")
              void load({ page: 1, nodeName: "", type: "all", status: "all" })
            }}
          >
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

      <TaskDetailSheet row={activeRow} onClose={() => setActiveRow(null)} />
    </div>
  )
}

function TaskDetailSheet({
  row,
  onClose,
}: {
  row: AgentTaskRow | null
  onClose: () => void
}) {
  const taskOutput = row ? parseAgentTaskOutput(row.result, row.error) : null
  const output = taskOutput?.value ?? ""

  return (
    <Sheet
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="data-[side=right]:sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>任务详情</SheetTitle>
          <SheetDescription>
            {row
              ? `#${row.id} · ${TASK_LABEL[row.type] ?? row.type} · ${row.node_name ?? `节点 #${row.node_id}`}`
              : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {row ? (
            <div className="grid gap-4 text-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <DetailField label="节点" value={row.node_name ?? "-"} />
                <DetailField label="节点 ID" value={String(row.node_id)} mono />
                <DetailField
                  label="任务"
                  value={TASK_LABEL[row.type] ?? row.type}
                />
                <DetailField label="状态" value={getTaskStatusLabel(row)} />
                <DetailField
                  label="创建者"
                  value={row.created_by_username ?? "-"}
                />
                <DetailField
                  label="创建时间"
                  value={formatDate(row.created_at)}
                />
                <DetailField
                  label="领取时间"
                  value={formatDate(row.claimed_at)}
                />
                <DetailField
                  label="租约到期"
                  value={formatDate(row.lease_expires_at)}
                />
                <DetailField
                  label="完成时间"
                  value={formatDate(row.finished_at)}
                />
                <DetailField
                  label="更新时间"
                  value={formatDate(row.updated_at)}
                />
              </div>

              {row.payload ? (
                <DetailBlock
                  title="任务参数"
                  value={renderJsonLike(row.payload)}
                />
              ) : null}
              {output ? (
                <DetailBlock
                  title="执行输出"
                  value={output}
                  logEntries={taskOutput?.logEntries}
                />
              ) : null}
              {row.result && row.error ? (
                <DetailBlock
                  title="错误信息"
                  value={renderJsonLike(row.error)}
                />
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
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-sm break-all", mono && "font-mono text-xs")}>
        {value}
      </div>
    </div>
  )
}

function getLogDetail(entry: AgentLogEntry, key: string) {
  const value = entry.detail?.[key]
  if (value === undefined || value === null) return "-"
  return typeof value === "string" ? value : JSON.stringify(value)
}

function TruncatedLogCell({
  value,
  className,
}: {
  value: string
  className?: string
}) {
  return (
    <div
      className={cn("truncate", className)}
      title={value === "-" ? undefined : value}
    >
      {value}
    </div>
  )
}

function LogLevelBadge({ level }: { level?: string }) {
  if (!level) return <span className="text-muted-foreground">-</span>

  return (
    <Badge
      className={cn(
        "px-1.5 py-0 font-mono text-[10px]",
        level === "ERROR" && "bg-red-500/15 text-red-700 dark:text-red-400",
        level === "WARN" &&
          "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
        level === "INFO" && "bg-blue-500/15 text-blue-700 dark:text-blue-400",
        level !== "ERROR" &&
          level !== "WARN" &&
          level !== "INFO" &&
          "bg-muted text-muted-foreground"
      )}
    >
      {level}
    </Badge>
  )
}

function AgentLogTable({ entries }: { entries: AgentLogEntry[] }) {
  return (
    <div className="max-h-105 overflow-auto">
      <Table className="min-w-[920px] table-fixed text-xs [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5">
        <colgroup>
          <col className="w-[150px]" />
          <col className="w-[64px]" />
          <col className="w-[130px]" />
          <col className="w-[72px]" />
          <col className="w-[132px]" />
          <col className="w-[180px]" />
          <col />
        </colgroup>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead>时间</TableHead>
            <TableHead>级别</TableHead>
            <TableHead>事件</TableHead>
            <TableHead>用户</TableHead>
            <TableHead>来源</TableHead>
            <TableHead>目标</TableHead>
            <TableHead>错误 / 详情</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry, index) => {
            const source = getLogDetail(entry, "addr")
            const target =
              getLogDetail(entry, "reqAddr") !== "-"
                ? getLogDetail(entry, "reqAddr")
                : (entry.service ?? "-")
            const detail =
              getLogDetail(entry, "error") !== "-"
                ? getLogDetail(entry, "error")
                : entry.detail
                  ? JSON.stringify(entry.detail)
                  : (entry.prefix ?? entry.raw)

            return (
              <TableRow key={`${entry.time ?? "raw"}-${index}`}>
                <TableCell className="font-mono text-[11px] whitespace-nowrap">
                  <TruncatedLogCell value={entry.time ?? "-"} />
                </TableCell>
                <TableCell>
                  <LogLevelBadge level={entry.level} />
                </TableCell>
                <TableCell className="font-medium">
                  <TruncatedLogCell value={entry.message || "-"} />
                </TableCell>
                <TableCell className="font-mono text-[11px]">
                  <TruncatedLogCell value={getLogDetail(entry, "id")} />
                </TableCell>
                <TableCell className="font-mono text-[11px]">
                  <TruncatedLogCell value={source} />
                </TableCell>
                <TableCell className="font-mono text-[11px]">
                  <TruncatedLogCell value={target} />
                </TableCell>
                <TableCell className="font-mono text-[11px]">
                  <TruncatedLogCell value={detail} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function DetailBlock({
  title,
  value,
  logEntries,
}: {
  title: string
  value: string
  logEntries?: AgentLogEntry[]
}) {
  return (
    <div className="rounded-md border">
      <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
        {title}
      </div>
      {logEntries ? (
        <AgentLogTable entries={logEntries} />
      ) : (
        <pre className="max-h-105 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">
          {value}
        </pre>
      )}
    </div>
  )
}
