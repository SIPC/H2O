"use client"

import { FormEvent, useCallback, useEffect, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { ChevronsUpDown, X } from "lucide-react"

import { DataTable, DataTableColumnHeader } from "@/components/data-table"
import { useI18n } from "@/components/i18n-provider"
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

type TFunction = ReturnType<typeof useI18n>["t"]

const TASK_LABEL_KEY: Record<AgentTaskType, string> = {
  HY2_STATUS: "logs.agentTasks.task.HY2_STATUS",
  HY2_START: "logs.agentTasks.task.HY2_START",
  HY2_STOP: "logs.agentTasks.task.HY2_STOP",
  HY2_RESTART: "logs.agentTasks.task.HY2_RESTART",
  HY2_LOGS: "logs.agentTasks.task.HY2_LOGS",
  HY2_SELF_UPDATE: "logs.agentTasks.task.HY2_SELF_UPDATE",
  AGENT_LOGS: "logs.agentTasks.task.AGENT_LOGS",
  AGENT_RESTART: "logs.agentTasks.task.AGENT_RESTART",
  APPLY_CONFIG: "logs.agentTasks.task.APPLY_CONFIG",
  AGENT_SELF_UPDATE: "logs.agentTasks.task.AGENT_SELF_UPDATE",
}

const TASK_STATUS_LABEL_KEY: Record<AgentTaskStatus, string> = {
  queued: "logs.agentTasks.status.queued",
  claimed: "logs.agentTasks.status.claimed",
  succeeded: "logs.agentTasks.status.succeeded",
  failed: "logs.agentTasks.status.failed",
  cancelled: "logs.agentTasks.status.cancelled",
}

const taskTypeOptions: Array<{ labelKey: string; value: TaskTypeFilter }> = [
  { labelKey: "logs.common.allTasks", value: "all" },
  { labelKey: "logs.agentTasks.task.HY2_STATUS", value: "HY2_STATUS" },
  { labelKey: "logs.agentTasks.task.HY2_START", value: "HY2_START" },
  { labelKey: "logs.agentTasks.task.HY2_STOP", value: "HY2_STOP" },
  { labelKey: "logs.agentTasks.task.HY2_RESTART", value: "HY2_RESTART" },
  { labelKey: "logs.agentTasks.task.HY2_LOGS", value: "HY2_LOGS" },
  {
    labelKey: "logs.agentTasks.task.HY2_SELF_UPDATE",
    value: "HY2_SELF_UPDATE",
  },
  { labelKey: "logs.agentTasks.task.AGENT_LOGS", value: "AGENT_LOGS" },
  { labelKey: "logs.agentTasks.task.AGENT_RESTART", value: "AGENT_RESTART" },
  { labelKey: "logs.agentTasks.task.APPLY_CONFIG", value: "APPLY_CONFIG" },
  {
    labelKey: "logs.agentTasks.task.AGENT_SELF_UPDATE",
    value: "AGENT_SELF_UPDATE",
  },
]

const statusOptions: Array<{ labelKey: string; value: StatusFilter }> = [
  { labelKey: "logs.common.allStatuses", value: "all" },
  { labelKey: "logs.agentTasks.status.queued", value: "queued" },
  { labelKey: "logs.agentTasks.status.claimed", value: "claimed" },
  { labelKey: "logs.agentTasks.status.succeeded", value: "succeeded" },
  { labelKey: "logs.agentTasks.status.failed", value: "failed" },
  { labelKey: "logs.agentTasks.status.timeout", value: "timeout" },
  { labelKey: "logs.agentTasks.status.cancelled", value: "cancelled" },
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

function parseTaskOutput(t: TFunction, row: AgentTaskRow) {
  return renderAgentTaskOutput(row.result, row.error, t)
}

function getTaskSummary(t: TFunction, row: AgentTaskRow) {
  const output = parseTaskOutput(t, row)
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

function getTaskLabel(t: TFunction, type: AgentTaskType) {
  return t(TASK_LABEL_KEY[type] ?? type)
}

function getTaskStatusLabel(t: TFunction, row: AgentTaskRow) {
  if (isTimedOutTask(row)) return t("logs.agentTasks.status.timeout")
  return t(TASK_STATUS_LABEL_KEY[row.status] ?? row.status)
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
  placeholderKey,
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: Array<{ labelKey: string; value: T }>
  placeholderKey: string
  className?: string
}) {
  const { t } = useI18n()
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
          {current ? t(current.labelKey) : t(placeholderKey)}
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0">
        <Command>
          <CommandList>
            <CommandEmpty>{t("logs.common.noMatches")}</CommandEmpty>
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
                  {t(option.labelKey)}
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
  const { t } = useI18n()
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
            {selected
              ? `#${selected.id} ${selected.name}`
              : t("logs.common.allNodes")}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-65 p-0">
        <Command>
          <CommandInput placeholder={t("logs.common.searchNodeName")} />
          <CommandList>
            <CommandEmpty>{t("logs.common.noMatchingNodes")}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__clear__"
                onSelect={() => {
                  onChange("")
                  setOpen(false)
                }}
              >
                <X className="size-4 opacity-60" />
                {t("logs.common.allNodes")}
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
  const { t } = useI18n()
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
      header: t("logs.common.createdAt"),
      cell: ({ row }) => formatDate(row.original.created_at),
    },
    {
      accessorKey: "node_name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("logs.common.node")} />
      ),
      cell: ({ row }) => row.original.node_name ?? `#${row.original.node_id}`,
    },
    {
      accessorKey: "type",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("logs.common.task")} />
      ),
      cell: ({ row }) => getTaskLabel(t, row.original.type),
    },
    {
      accessorKey: "status",
      header: t("logs.common.status"),
      cell: ({ row }) => (
        <Badge className={cn(statusBadgeClass(row.original))}>
          {getTaskStatusLabel(t, row.original)}
        </Badge>
      ),
    },
    {
      accessorKey: "created_by_username",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("logs.common.creator")}
        />
      ),
      cell: ({ row }) => row.original.created_by_username ?? "-",
    },
    {
      id: "finished_at",
      header: t("logs.common.finishedAt"),
      cell: ({ row }) => formatDate(row.original.finished_at),
    },
    {
      id: "summary",
      header: t("logs.common.resultSummary"),
      cell: ({ row }) => (
        <span className="line-clamp-2 max-w-90 font-mono text-xs whitespace-pre-wrap">
          {getTaskSummary(t, row.original)}
        </span>
      ),
    },
    {
      id: "actions",
      header: t("logs.common.actions"),
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => setActiveRow(row.original)}
        >
          {t("logs.common.details")}
        </Button>
      ),
    },
  ]

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-bold">{t("logs.agentTasks.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("logs.agentTasks.description")}
        </p>
      </div>

      <form className="grid gap-3 md:grid-cols-4" onSubmit={submit}>
        <div className="space-y-1">
          <Label>{t("logs.common.node")}</Label>
          <NodeCombobox
            nodes={nodes}
            value={nodeName}
            onChange={(next) => void switchNode(next)}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label>{t("logs.common.taskType")}</Label>
          <OptionCombobox
            value={typeFilter}
            onChange={(next) => void switchType(next)}
            options={taskTypeOptions}
            placeholderKey="logs.common.allTasks"
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label>{t("logs.common.status")}</Label>
          <OptionCombobox
            value={statusFilter}
            onChange={(next) => void switchStatus(next)}
            options={statusOptions}
            placeholderKey="logs.common.allStatuses"
            className="w-full"
          />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit">{t("logs.common.query")}</Button>
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
            {t("logs.common.reset")}
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
  const { t } = useI18n()
  const taskOutput = row ? parseAgentTaskOutput(row.result, row.error, t) : null
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
          <SheetTitle>{t("logs.agentTasks.detailTitle")}</SheetTitle>
          <SheetDescription>
            {row
              ? `#${row.id} · ${getTaskLabel(t, row.type)} · ${
                  row.node_name ??
                  t("logs.agentTasks.nodeFallback", { id: row.node_id })
                }`
              : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {row ? (
            <div className="grid gap-4 text-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <DetailField
                  label={t("logs.common.node")}
                  value={row.node_name ?? "-"}
                />
                <DetailField
                  label={t("logs.common.nodeId")}
                  value={String(row.node_id)}
                  mono
                />
                <DetailField
                  label={t("logs.common.task")}
                  value={getTaskLabel(t, row.type)}
                />
                <DetailField
                  label={t("logs.common.status")}
                  value={getTaskStatusLabel(t, row)}
                />
                <DetailField
                  label={t("logs.common.creator")}
                  value={row.created_by_username ?? "-"}
                />
                <DetailField
                  label={t("logs.common.createdAt")}
                  value={formatDate(row.created_at)}
                />
                <DetailField
                  label={t("logs.common.claimedAt")}
                  value={formatDate(row.claimed_at)}
                />
                <DetailField
                  label={t("logs.common.leaseExpiresAt")}
                  value={formatDate(row.lease_expires_at)}
                />
                <DetailField
                  label={t("logs.common.finishedAt")}
                  value={formatDate(row.finished_at)}
                />
                <DetailField
                  label={t("logs.common.updatedAt")}
                  value={formatDate(row.updated_at)}
                />
              </div>

              {row.payload ? (
                <DetailBlock
                  title={t("logs.agentTasks.taskParams")}
                  value={renderJsonLike(row.payload)}
                />
              ) : null}
              {output ? (
                <DetailBlock
                  title={t("logs.agentTasks.executionOutput")}
                  value={output}
                  logEntries={taskOutput?.logEntries}
                />
              ) : null}
              {row.result && row.error ? (
                <DetailBlock
                  title={t("logs.agentTasks.errorInfo")}
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
  const { t } = useI18n()

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
            <TableHead>{t("logs.common.time")}</TableHead>
            <TableHead>{t("logs.common.level")}</TableHead>
            <TableHead>{t("logs.common.event")}</TableHead>
            <TableHead>{t("logs.common.user")}</TableHead>
            <TableHead>{t("logs.common.source")}</TableHead>
            <TableHead>{t("logs.common.destination")}</TableHead>
            <TableHead>{t("logs.common.errorDetails")}</TableHead>
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
