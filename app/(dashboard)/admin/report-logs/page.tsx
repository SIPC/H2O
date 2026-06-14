"use client"

import { FormEvent, useEffect, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { ChevronsUpDown, X } from "lucide-react"

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

type TFunction = ReturnType<typeof useI18n>["t"]

function getReasonLabel(t: TFunction, reason: string | null | undefined) {
  if (!reason) return "-"
  const key = `logs.reason.${reason}`
  const label = t(key)
  return label === key ? reason : label
}

function getReportDetailValueLabel(t: TFunction, value: string) {
  const key = `logs.report.detailValue.${value}`
  const label = t(key)
  return label === key ? value : label
}

function getReportDetailLabel(t: TFunction, key: string) {
  const labelKey = `logs.report.detail.${key}`
  const label = t(labelKey)
  return label === labelKey ? key : label
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

function renderDetailValue(t: TFunction, value: unknown): string {
  if (value === null || value === undefined) return "-"
  if (typeof value === "boolean") {
    return value ? t("logs.common.yes") : t("logs.common.no")
  }
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "-"
  if (typeof value === "object") return JSON.stringify(value, null, 2)
  const raw = String(value)
  return getReportDetailValueLabel(t, raw)
}

function renderDetailSummary(t: TFunction, detail: string | null) {
  const entries = parseDetail(detail)
  if (!entries || entries.length === 0) return "-"
  return entries
    .map(
      ([key, value]) =>
        `${getReportDetailLabel(t, key)}: ${renderDetailValue(t, value)}`
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
  const { t } = useI18n()
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
      header: t("logs.common.time"),
      cell: ({ row }) => formatDate(row.original.created_at),
    },
    {
      accessorKey: "node_name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("logs.common.node")} />
      ),
      cell: ({ row }) => row.original.node_name ?? "-",
    },
    {
      accessorKey: "ip",
      header: t("logs.common.sourceIp"),
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.ip ?? "-"}</span>
      ),
    },
    {
      id: "summary",
      header: t("logs.report.usersOnlineColumn"),
      cell: ({ row }) => (
        <span className="text-xs">
          {t("logs.common.usersOnline", {
            users: row.original.reported_users,
            online: row.original.online_count,
          })}
        </span>
      ),
    },
    {
      id: "delta",
      header: t("logs.report.deltaColumn"),
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
      header: t("logs.common.result"),
      cell: ({ row }) =>
        row.original.success === 1 ? (
          <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            {t("logs.common.success")}
          </Badge>
        ) : (
          <Badge className="bg-destructive/15 text-destructive">
            {t("logs.common.failure")}
          </Badge>
        ),
    },
    {
      accessorKey: "reason",
      header: t("logs.common.reason"),
      cell: ({ row }) => (
        <span className="text-xs">
          {getReasonLabel(t, row.original.reason)}
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
          onClick={() => void openDetail(row.original)}
        >
          {t("logs.common.details")}
        </Button>
      ),
    },
  ]

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold">{t("logs.report.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("logs.report.description")}
        </p>
      </div>

      {/* 筛选条件 */}
      <form className="grid gap-3 md:grid-cols-4" onSubmit={submit}>
        <div className="space-y-1">
          <Label>{t("logs.common.account")}</Label>
          <NamedEntityCombobox
            items={users.map((u) => ({ id: u.id, name: u.username }))}
            value={username}
            onChange={(v) => void switchUsername(v)}
            placeholder={t("logs.common.allAccounts")}
            searchPlaceholder={t("logs.common.searchUsername")}
            clearLabel={t("logs.common.allAccounts")}
            emptyText={t("logs.common.noMatchingAccounts")}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label>{t("logs.common.node")}</Label>
          <NamedEntityCombobox
            items={nodes}
            value={nodeName}
            onChange={(v) => void switchNode(v)}
            placeholder={t("logs.common.allNodes")}
            searchPlaceholder={t("logs.common.searchNodeName")}
            clearLabel={t("logs.common.allNodes")}
            emptyText={t("logs.common.noMatchingNodes")}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label>{t("logs.common.result")}</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={successFilter === "all" ? "default" : "outline"}
              onClick={() => void switchFilter("all")}
            >
              {t("logs.common.all")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={successFilter === "1" ? "default" : "outline"}
              onClick={() => void switchFilter("1")}
            >
              {t("logs.common.success")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={successFilter === "0" ? "default" : "outline"}
              onClick={() => void switchFilter("0")}
            >
              {t("logs.common.failure")}
            </Button>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit">{t("logs.common.query")}</Button>
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
            {t("logs.common.reset")}
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
  const { t } = useI18n()
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
          <SheetTitle>{t("logs.report.detailTitle")}</SheetTitle>
          <SheetDescription>
            {report
              ? `#${report.id} · ${report.node_name ?? t("logs.common.unknownNode")}`
              : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {report ? (
            <div className="grid gap-4 text-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <DetailField
                  label={t("logs.common.time")}
                  value={formatDate(report.created_at)}
                />
                <DetailField
                  label={t("logs.common.node")}
                  value={report.node_name ?? "-"}
                />
                <DetailField
                  label={t("logs.report.authPath")}
                  value={report.auth_path}
                  mono
                />
                <DetailField
                  label={t("logs.common.sourceIp")}
                  value={report.ip ?? "-"}
                  mono
                />
                <DetailField
                  label={t("logs.common.agent")}
                  value={report.agent_version ?? "-"}
                />
                <DetailField
                  label={t("logs.common.result")}
                  value={
                    report.success === 1
                      ? t("logs.common.success")
                      : t("logs.common.failure")
                  }
                />
                <DetailField
                  label={t("logs.common.reason")}
                  value={getReasonLabel(t, report.reason)}
                />
                <DetailField
                  label={t("logs.report.usersOnlineColumn")}
                  value={t("logs.common.usersOnline", {
                    users: report.reported_users,
                    online: report.online_count,
                  })}
                />
                <DetailField
                  label={t("logs.report.snapshot")}
                  value={formatTrafficPair(
                    report.total_tx_bytes,
                    report.total_rx_bytes
                  )}
                  mono
                />
                <DetailField
                  label={t("logs.report.deltaColumn")}
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
                    {t("logs.common.summaryData")}
                  </div>
                  <div className="divide-y">
                    {entries.map(([key, value]) => (
                      <div
                        key={key}
                        className="grid grid-cols-[120px_1fr] gap-2 px-3 py-2 text-xs"
                      >
                        <div className="text-muted-foreground">
                          {getReportDetailLabel(t, key)}
                        </div>
                        <div className="font-mono break-all whitespace-pre-wrap">
                          {renderDetailValue(t, value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-md border">
                <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  {t("logs.common.userDetails")}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("logs.common.account")}</TableHead>
                      <TableHead>{t("logs.common.online")}</TableHead>
                      <TableHead>{t("logs.report.reportedTxRx")}</TableHead>
                      <TableHead>{t("logs.report.lastTxRx")}</TableHead>
                      <TableHead>{t("logs.report.deltaTxRx")}</TableHead>
                      <TableHead>{t("logs.common.subscription")}</TableHead>
                      <TableHead>{t("logs.common.result")}</TableHead>
                      <TableHead>{t("logs.common.reason")}</TableHead>
                      <TableHead>{t("logs.common.details")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={9} className="h-20 text-center">
                          {t("logs.common.loading")}
                        </TableCell>
                      </TableRow>
                    ) : userLogs.length > 0 ? (
                      userLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell>
                            <div className="font-medium">{log.username}</div>
                            <div className="text-xs text-muted-foreground">
                              {log.user_id
                                ? `#${log.user_id}`
                                : t("logs.common.unmatchedUser")}
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
                                {t("logs.common.success")}
                              </Badge>
                            ) : (
                              <Badge className="bg-destructive/15 text-destructive">
                                {t("logs.common.failure")}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-xs">
                              {getReasonLabel(t, log.reason)}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-65 font-mono text-xs break-all whitespace-pre-wrap">
                            {renderDetailSummary(t, log.detail)}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={9} className="h-20 text-center">
                          {t("logs.common.noUserDetails")}
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
