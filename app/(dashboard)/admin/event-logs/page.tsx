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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { DataTable, DataTableColumnHeader } from "@/components/data-table"

import { cn } from "@/lib/utils"

type EventName =
  | "LOGIN"
  | "REGISTER"
  | "LOGOUT"
  | "RESET_TOKEN_SELF"
  | "RESET_TOKEN_ADMIN"
  | "BOOTSTRAP_ADMIN"
  | "USER_CREATE"
  | "USER_UPDATE"
  | "USER_DELETE"
  | "NODE_CREATE"
  | "NODE_UPDATE"
  | "NODE_DELETE"
  | "AGENT_TASK_CREATE"
  | "AGENT_SECRET_ROTATE"
  | "AGENT_CONFIG_VIEW"
  | "PLAN_CREATE"
  | "PLAN_UPDATE"
  | "PLAN_DELETE"
  | "SUBSCRIPTION_CREATE"
  | "SUBSCRIPTION_UPDATE"
  | "SUBSCRIPTION_DELETE"
  | "SUBSCRIPTION_FETCH"
  | "SETTINGS_UPDATE"
  | "OUTBOUND_PROFILE_CREATE"
  | "OUTBOUND_PROFILE_UPDATE"
  | "OUTBOUND_PROFILE_DELETE"
  | "ACL_PROFILE_CREATE"
  | "ACL_PROFILE_UPDATE"
  | "ACL_PROFILE_DELETE"
  | "ACL_NODE_BINDING_UPDATE"

type EventRow = {
  id: number
  created_at: string
  event: EventName
  user_id: number | null
  username: string | null
  ip: string | null
  success: 0 | 1
  reason: string | null
  detail: string | null
}

type SuccessFilter = "all" | "1" | "0"

type EventFilter = "all" | EventName

type UserRow = { id: number; username: string }

type TFunction = ReturnType<typeof useI18n>["t"]

const eventLabelKey: Record<EventName, string> = {
  LOGIN: "logs.event.event.LOGIN",
  REGISTER: "logs.event.event.REGISTER",
  LOGOUT: "logs.event.event.LOGOUT",
  RESET_TOKEN_SELF: "logs.event.event.RESET_TOKEN_SELF",
  RESET_TOKEN_ADMIN: "logs.event.event.RESET_TOKEN_ADMIN",
  BOOTSTRAP_ADMIN: "logs.event.event.BOOTSTRAP_ADMIN",
  USER_CREATE: "logs.event.event.USER_CREATE",
  USER_UPDATE: "logs.event.event.USER_UPDATE",
  USER_DELETE: "logs.event.event.USER_DELETE",
  NODE_CREATE: "logs.event.event.NODE_CREATE",
  NODE_UPDATE: "logs.event.event.NODE_UPDATE",
  NODE_DELETE: "logs.event.event.NODE_DELETE",
  AGENT_TASK_CREATE: "logs.event.event.AGENT_TASK_CREATE",
  AGENT_SECRET_ROTATE: "logs.event.event.AGENT_SECRET_ROTATE",
  AGENT_CONFIG_VIEW: "logs.event.event.AGENT_CONFIG_VIEW",
  PLAN_CREATE: "logs.event.event.PLAN_CREATE",
  PLAN_UPDATE: "logs.event.event.PLAN_UPDATE",
  PLAN_DELETE: "logs.event.event.PLAN_DELETE",
  SUBSCRIPTION_CREATE: "logs.event.event.SUBSCRIPTION_CREATE",
  SUBSCRIPTION_UPDATE: "logs.event.event.SUBSCRIPTION_UPDATE",
  SUBSCRIPTION_DELETE: "logs.event.event.SUBSCRIPTION_DELETE",
  SUBSCRIPTION_FETCH: "logs.event.event.SUBSCRIPTION_FETCH",
  SETTINGS_UPDATE: "logs.event.event.SETTINGS_UPDATE",
  OUTBOUND_PROFILE_CREATE: "logs.event.event.OUTBOUND_PROFILE_CREATE",
  OUTBOUND_PROFILE_UPDATE: "logs.event.event.OUTBOUND_PROFILE_UPDATE",
  OUTBOUND_PROFILE_DELETE: "logs.event.event.OUTBOUND_PROFILE_DELETE",
  ACL_PROFILE_CREATE: "logs.event.event.ACL_PROFILE_CREATE",
  ACL_PROFILE_UPDATE: "logs.event.event.ACL_PROFILE_UPDATE",
  ACL_PROFILE_DELETE: "logs.event.event.ACL_PROFILE_DELETE",
  ACL_NODE_BINDING_UPDATE: "logs.event.event.ACL_NODE_BINDING_UPDATE",
}

const eventOptions: Array<{ labelKey: string; value: EventFilter }> = [
  { labelKey: "logs.common.allEvents", value: "all" },
  { labelKey: "logs.event.event.LOGIN", value: "LOGIN" },
  { labelKey: "logs.event.event.REGISTER", value: "REGISTER" },
  { labelKey: "logs.event.event.LOGOUT", value: "LOGOUT" },
  { labelKey: "logs.event.event.RESET_TOKEN_SELF", value: "RESET_TOKEN_SELF" },
  {
    labelKey: "logs.event.event.RESET_TOKEN_ADMIN",
    value: "RESET_TOKEN_ADMIN",
  },
  { labelKey: "logs.event.event.BOOTSTRAP_ADMIN", value: "BOOTSTRAP_ADMIN" },
  { labelKey: "logs.event.event.USER_CREATE", value: "USER_CREATE" },
  { labelKey: "logs.event.event.USER_UPDATE", value: "USER_UPDATE" },
  { labelKey: "logs.event.event.USER_DELETE", value: "USER_DELETE" },
  { labelKey: "logs.event.event.NODE_CREATE", value: "NODE_CREATE" },
  { labelKey: "logs.event.event.NODE_UPDATE", value: "NODE_UPDATE" },
  { labelKey: "logs.event.event.NODE_DELETE", value: "NODE_DELETE" },
  {
    labelKey: "logs.event.event.AGENT_TASK_CREATE",
    value: "AGENT_TASK_CREATE",
  },
  {
    labelKey: "logs.event.event.AGENT_SECRET_ROTATE",
    value: "AGENT_SECRET_ROTATE",
  },
  {
    labelKey: "logs.event.event.AGENT_CONFIG_VIEW",
    value: "AGENT_CONFIG_VIEW",
  },
  { labelKey: "logs.event.event.PLAN_CREATE", value: "PLAN_CREATE" },
  { labelKey: "logs.event.event.PLAN_UPDATE", value: "PLAN_UPDATE" },
  { labelKey: "logs.event.event.PLAN_DELETE", value: "PLAN_DELETE" },
  {
    labelKey: "logs.event.event.SUBSCRIPTION_CREATE",
    value: "SUBSCRIPTION_CREATE",
  },
  {
    labelKey: "logs.event.event.SUBSCRIPTION_UPDATE",
    value: "SUBSCRIPTION_UPDATE",
  },
  {
    labelKey: "logs.event.event.SUBSCRIPTION_DELETE",
    value: "SUBSCRIPTION_DELETE",
  },
  {
    labelKey: "logs.event.event.SUBSCRIPTION_FETCH",
    value: "SUBSCRIPTION_FETCH",
  },
  { labelKey: "logs.event.event.SETTINGS_UPDATE", value: "SETTINGS_UPDATE" },
  {
    labelKey: "logs.event.event.OUTBOUND_PROFILE_CREATE",
    value: "OUTBOUND_PROFILE_CREATE",
  },
  {
    labelKey: "logs.event.event.OUTBOUND_PROFILE_UPDATE",
    value: "OUTBOUND_PROFILE_UPDATE",
  },
  {
    labelKey: "logs.event.event.OUTBOUND_PROFILE_DELETE",
    value: "OUTBOUND_PROFILE_DELETE",
  },
  {
    labelKey: "logs.event.event.ACL_PROFILE_CREATE",
    value: "ACL_PROFILE_CREATE",
  },
  {
    labelKey: "logs.event.event.ACL_PROFILE_UPDATE",
    value: "ACL_PROFILE_UPDATE",
  },
  {
    labelKey: "logs.event.event.ACL_PROFILE_DELETE",
    value: "ACL_PROFILE_DELETE",
  },
  {
    labelKey: "logs.event.event.ACL_NODE_BINDING_UPDATE",
    value: "ACL_NODE_BINDING_UPDATE",
  },
]

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

function getEventLabel(t: TFunction, event: EventName) {
  return t(eventLabelKey[event] ?? event)
}

function getReasonLabel(t: TFunction, reason: string | null | undefined) {
  if (!reason) return "-"
  const key = `logs.reason.${reason}`
  const label = t(key)
  return label === key ? reason : label
}

function getDetailLabel(t: TFunction, key: string) {
  const labelKey = `logs.event.detail.${key}`
  const label = t(labelKey)
  return label === labelKey ? key : label
}

function EventCombobox({
  value,
  onChange,
  className,
}: {
  value: EventFilter
  onChange: (value: EventFilter) => void
  className?: string
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const current = eventOptions.find((o) => o.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn("justify-between", className)}
        >
          {current ? t(current.labelKey) : t("logs.common.allEvents")}
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandList>
            <CommandEmpty>{t("logs.common.noMatches")}</CommandEmpty>
            <CommandGroup>
              {eventOptions.map((option) => (
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

// 账号筛选下拉：value 为空字符串表示不筛选
function UserFilterCombobox({
  users,
  value,
  onChange,
  className,
}: {
  users: UserRow[]
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const selected = users.find((u) => u.username === value)

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
              ? `#${selected.id} ${selected.username}`
              : t("logs.common.allAccounts")}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0">
        <Command>
          <CommandInput placeholder={t("logs.common.searchUsername")} />
          <CommandList>
            <CommandEmpty>{t("logs.common.noMatchingAccounts")}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__clear__"
                onSelect={() => {
                  onChange("")
                  setOpen(false)
                }}
              >
                <X className="size-4 opacity-60" />
                {t("logs.common.allAccounts")}
              </CommandItem>
              {users.map((u) => (
                <CommandItem
                  key={u.id}
                  value={u.username}
                  data-checked={value === u.username}
                  onSelect={() => {
                    onChange(u.username)
                    setOpen(false)
                  }}
                >
                  #{u.id} {u.username}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function renderDetailValue(value: unknown): string {
  if (value === null || value === undefined) return "-"
  if (typeof value === "object") return JSON.stringify(value, null, 2)
  return String(value)
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

export default function AdminEventLogsPage() {
  const { t } = useI18n()
  const [rows, setRows] = useState<EventRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [username, setUsername] = useState("")
  const [ip, setIp] = useState("")
  const [successFilter, setSuccessFilter] = useState<SuccessFilter>("all")
  const [eventFilter, setEventFilter] = useState<EventFilter>("all")
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  // 当前在弹窗里查看的行；null 表示未打开
  const [activeRow, setActiveRow] = useState<EventRow | null>(null)

  async function load(
    opts: {
      page?: number
      pageSize?: number
      success?: SuccessFilter
      event?: EventFilter
      username?: string
      ip?: string
    } = {}
  ) {
    const nextPage = opts.page ?? page
    const nextPageSize = opts.pageSize ?? pageSize
    const nextSuccess = opts.success ?? successFilter
    const nextEvent = opts.event ?? eventFilter
    const nextUsername = opts.username ?? username
    const nextIp = opts.ip ?? ip

    const params = new URLSearchParams()
    if (nextSuccess !== "all") params.set("success", nextSuccess)
    if (nextEvent !== "all") params.set("event", nextEvent)
    if (nextUsername.trim()) params.set("username", nextUsername.trim())
    if (nextIp.trim()) params.set("ip", nextIp.trim())
    params.set("page", String(nextPage))
    params.set("pageSize", String(nextPageSize))

    setLoading(true)
    try {
      const response = await fetch(`/api/admin/event-logs?${params.toString()}`)
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
        const [logRes, userRes] = await Promise.all([
          fetch(`/api/admin/event-logs?${params.toString()}`),
          fetch("/api/admin/users"),
        ])
        const logJson = await logRes.json()
        const userJson = await userRes.json()
        if (!mounted) return
        if (logJson?.ok) {
          setRows(logJson.data.rows)
          setTotal(logJson.data.total)
          setPage(logJson.data.page)
          setPageSize(logJson.data.pageSize)
        }
        if (userJson?.ok) setUsers(userJson.data)
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

  async function switchSuccess(next: SuccessFilter) {
    setSuccessFilter(next)
    await load({ page: 1, success: next })
  }

  async function switchEvent(next: EventFilter) {
    setEventFilter(next)
    await load({ page: 1, event: next })
  }

  async function switchUsername(next: string) {
    setUsername(next)
    await load({ page: 1, username: next })
  }

  async function changePage(next: number) {
    await load({ page: next })
  }

  async function changePageSize(next: number) {
    await load({ page: 1, pageSize: next })
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const columns: ColumnDef<EventRow>[] = [
    {
      accessorKey: "created_at",
      header: t("logs.common.time"),
      cell: ({ row }) => {
        const v = row.original.created_at
        return new Date(v.endsWith("Z") ? v : `${v}Z`).toLocaleString()
      },
    },
    {
      accessorKey: "event",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("logs.common.event")} />
      ),
      cell: ({ row }) => getEventLabel(t, row.original.event),
    },
    {
      accessorKey: "username",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("logs.common.account")}
        />
      ),
      cell: ({ row }) => row.original.username ?? "-",
    },
    {
      accessorKey: "ip",
      header: "IP",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.ip ?? "-"}</span>
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
          onClick={() => setActiveRow(row.original)}
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
        <h1 className="text-2xl font-bold">{t("logs.event.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("logs.event.description")}
        </p>
      </div>

      {/* 筛选条件 */}
      <form className="grid gap-3 md:grid-cols-5" onSubmit={submit}>
        <div className="space-y-1">
          <Label>{t("logs.common.account")}</Label>
          <UserFilterCombobox
            users={users}
            value={username}
            onChange={(v) => void switchUsername(v)}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label>{t("logs.common.eventType")}</Label>
          <EventCombobox
            value={eventFilter}
            onChange={(next) => void switchEvent(next)}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label>{t("logs.common.ip")}</Label>
          <Input
            value={ip}
            onChange={(event) => setIp(event.target.value)}
            placeholder={t("logs.common.ipSearchPlaceholder")}
          />
        </div>
        <div className="space-y-1">
          <Label>{t("logs.common.result")}</Label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={successFilter === "all" ? "default" : "outline"}
              onClick={() => void switchSuccess("all")}
            >
              {t("logs.common.all")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={successFilter === "1" ? "default" : "outline"}
              onClick={() => void switchSuccess("1")}
            >
              {t("logs.common.success")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={successFilter === "0" ? "default" : "outline"}
              onClick={() => void switchSuccess("0")}
            >
              {t("logs.common.failure")}
            </Button>
          </div>
        </div>
        <div className="flex items-end justify-end gap-2">
          <Button type="submit">{t("logs.common.query")}</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setUsername("")
              setIp("")
              setSuccessFilter("all")
              setEventFilter("all")
              void load({
                page: 1,
                success: "all",
                event: "all",
                username: "",
                ip: "",
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

      <EventLogDetailSheet row={activeRow} onClose={() => setActiveRow(null)} />
    </div>
  )
}

function EventLogDetailSheet({
  row,
  onClose,
}: {
  row: EventRow | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const entries = parseDetail(row?.detail ?? null)
  const createdAt = row
    ? new Date(
        row.created_at.endsWith("Z") ? row.created_at : `${row.created_at}Z`
      ).toLocaleString()
    : ""

  return (
    <Sheet
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t("logs.event.detailTitle")}</SheetTitle>
          <SheetDescription>
            {row ? `#${row.id} · ${getEventLabel(t, row.event)}` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {row ? (
            <div className="grid gap-3 text-sm">
              <DetailField label={t("logs.common.time")} value={createdAt} />
              <DetailField
                label={t("logs.common.event")}
                value={getEventLabel(t, row.event)}
              />
              <DetailField
                label={t("logs.common.account")}
                value={row.username ?? "-"}
              />
              <DetailField
                label={t("logs.common.ip")}
                value={row.ip ?? "-"}
                mono
              />
              <DetailField
                label={t("logs.common.result")}
                value={
                  row.success === 1
                    ? t("logs.common.success")
                    : t("logs.common.failure")
                }
              />
              <DetailField
                label={t("logs.common.reason")}
                value={getReasonLabel(t, row.reason)}
              />
              {entries && entries.length > 0 ? (
                <div className="mt-2 rounded-md border">
                  <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                    {t("logs.common.data")}
                  </div>
                  <div className="divide-y">
                    {entries.map(([key, value]) => (
                      <div
                        key={key}
                        className="grid grid-cols-[120px_1fr] gap-2 px-3 py-2 text-xs"
                      >
                        <div className="text-muted-foreground">
                          {getDetailLabel(t, key)}
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
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-sm break-all", mono && "font-mono text-xs")}>
        {value}
      </div>
    </div>
  )
}
