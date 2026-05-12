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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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

const eventLabel: Record<EventName, string> = {
  LOGIN: "登录",
  REGISTER: "注册",
  LOGOUT: "登出",
  RESET_TOKEN_SELF: "自助重置Key",
  RESET_TOKEN_ADMIN: "管理员重置Key",
  BOOTSTRAP_ADMIN: "初始化管理员",
  USER_CREATE: "创建用户",
  USER_UPDATE: "更新用户",
  USER_DELETE: "删除用户",
  NODE_CREATE: "创建节点",
  NODE_UPDATE: "更新节点",
  NODE_DELETE: "删除节点",
  AGENT_TASK_CREATE: "创建 Agent 任务",
  AGENT_SECRET_ROTATE: "轮换 Agent 密钥",
  AGENT_CONFIG_VIEW: "查看 Agent 配置",
  PLAN_CREATE: "创建套餐",
  PLAN_UPDATE: "更新套餐",
  PLAN_DELETE: "删除套餐",
  SUBSCRIPTION_CREATE: "创建订阅",
  SUBSCRIPTION_UPDATE: "更新订阅",
  SUBSCRIPTION_DELETE: "删除订阅",
  SUBSCRIPTION_FETCH: "拉取订阅",
  SETTINGS_UPDATE: "修改设置",
}

const reasonLabel: Record<string, string> = {
  OK: "成功",
  INVALID_PAYLOAD: "参数非法",
  INVALID_ID: "ID 非法",
  INVALID_CREDENTIALS: "账号或密码错误",
  INVALID_PASSWORD: "密码非法",
  INVALID_STATUS: "状态非法",
  INVALID_EXPIRE: "到期时间非法",
  INVALID_TRAFFIC: "流量值非法",
  INVALID_DURATION: "时长非法",
  BAD_PASSWORD: "密码错误",
  NO_USER: "账号不存在",
  USER_EXISTS: "用户名已占用",
  USER_DISABLED: "账号已禁用",
  LOGIN_DISABLED: "登录已关闭",
  REGISTRATION_DISABLED: "注册已关闭",
  ADMIN_EXISTS: "管理员已存在",
  NOT_FOUND: "记录不存在",
  CREATE_FAILED: "创建失败",
  UPDATE_FAILED: "更新失败",
  DELETE_FAILED: "删除失败",
  PLAN_IN_USE: "套餐仍被引用",
  PLAN_NOT_FOUND: "套餐不存在",
  CANNOT_DELETE_SELF: "不能删除自己",
  UNKNOWN_KEY: "未知设置项",
  TURNSTILE_FAILED: "人机验证失败",
  TURNSTILE_MISSING: "缺少人机验证",
  TURNSTILE_MISCONFIGURED: "人机验证未配置",
  INVALID_TOKEN: "订阅 Key 非法",
  NO_NODES: "暂无可用节点",
}

const eventOptions: Array<{ label: string; value: EventFilter }> = [
  { label: "全部事件", value: "all" },
  { label: "登录", value: "LOGIN" },
  { label: "注册", value: "REGISTER" },
  { label: "登出", value: "LOGOUT" },
  { label: "自助重置Key", value: "RESET_TOKEN_SELF" },
  { label: "管理员重置Key", value: "RESET_TOKEN_ADMIN" },
  { label: "初始化管理员", value: "BOOTSTRAP_ADMIN" },
  { label: "创建用户", value: "USER_CREATE" },
  { label: "更新用户", value: "USER_UPDATE" },
  { label: "删除用户", value: "USER_DELETE" },
  { label: "创建节点", value: "NODE_CREATE" },
  { label: "更新节点", value: "NODE_UPDATE" },
  { label: "删除节点", value: "NODE_DELETE" },
  { label: "创建 Agent 任务", value: "AGENT_TASK_CREATE" },
  { label: "轮换 Agent 密钥", value: "AGENT_SECRET_ROTATE" },
  { label: "查看 Agent 配置", value: "AGENT_CONFIG_VIEW" },
  { label: "创建套餐", value: "PLAN_CREATE" },
  { label: "更新套餐", value: "PLAN_UPDATE" },
  { label: "删除套餐", value: "PLAN_DELETE" },
  { label: "创建订阅", value: "SUBSCRIPTION_CREATE" },
  { label: "更新订阅", value: "SUBSCRIPTION_UPDATE" },
  { label: "删除订阅", value: "SUBSCRIPTION_DELETE" },
  { label: "拉取订阅", value: "SUBSCRIPTION_FETCH" },
  { label: "修改设置", value: "SETTINGS_UPDATE" },
]

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

function EventCombobox({
  value,
  onChange,
  className,
}: {
  value: EventFilter
  onChange: (value: EventFilter) => void
  className?: string
}) {
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
          {current?.label ?? "全部事件"}
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandList>
            <CommandEmpty>无匹配项</CommandEmpty>
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
            {selected ? `#${selected.id} ${selected.username}` : "全部账号"}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0">
        <Command>
          <CommandInput placeholder="搜索用户名" />
          <CommandList>
            <CommandEmpty>无匹配账号</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__clear__"
                onSelect={() => {
                  onChange("")
                  setOpen(false)
                }}
              >
                <X className="size-4 opacity-60" />
                全部账号
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

// detail 里常见字段的中文标签，未命中的直接用原 key
const detailLabel: Record<string, string> = {
  method: "请求方法",
  url: "请求 URL",
  format: "返回格式",
  ua: "User-Agent",
  accept: "Accept",
  accept_encoding: "Accept-Encoding",
  referer: "Referer",
  nodes: "节点数",
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
  const [rows, setRows] = useState<EventRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [username, setUsername] = useState("")
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
    } = {}
  ) {
    const nextPage = opts.page ?? page
    const nextPageSize = opts.pageSize ?? pageSize
    const nextSuccess = opts.success ?? successFilter
    const nextEvent = opts.event ?? eventFilter
    const nextUsername = opts.username ?? username

    const params = new URLSearchParams()
    if (nextSuccess !== "all") params.set("success", nextSuccess)
    if (nextEvent !== "all") params.set("event", nextEvent)
    if (nextUsername.trim()) params.set("username", nextUsername.trim())
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
      header: "时间",
      cell: ({ row }) => {
        const v = row.original.created_at
        return new Date(v.endsWith("Z") ? v : `${v}Z`).toLocaleString()
      },
    },
    {
      accessorKey: "event",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="事件" />
      ),
      cell: ({ row }) => eventLabel[row.original.event] ?? row.original.event,
    },
    {
      accessorKey: "username",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="账号" />
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
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold">事件日志</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          登录 / 注册 / 登出 / 轮换 Key 等业务事件。
        </p>
      </div>

      {/* 筛选条件 */}
      <form className="grid gap-3 md:grid-cols-4" onSubmit={submit}>
        <div className="space-y-1">
          <Label>账号</Label>
          <UserFilterCombobox
            users={users}
            value={username}
            onChange={(v) => void switchUsername(v)}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label>事件类型</Label>
          <EventCombobox
            value={eventFilter}
            onChange={(next) => void switchEvent(next)}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label>结果</Label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={successFilter === "all" ? "default" : "outline"}
              onClick={() => void switchSuccess("all")}
            >
              全部
            </Button>
            <Button
              type="button"
              size="sm"
              variant={successFilter === "1" ? "default" : "outline"}
              onClick={() => void switchSuccess("1")}
            >
              成功
            </Button>
            <Button
              type="button"
              size="sm"
              variant={successFilter === "0" ? "default" : "outline"}
              onClick={() => void switchSuccess("0")}
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
              setSuccessFilter("all")
              setEventFilter("all")
              void load({
                page: 1,
                success: "all",
                event: "all",
                username: "",
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
          <SheetTitle>日志详情</SheetTitle>
          <SheetDescription>
            {row ? `#${row.id} · ${eventLabel[row.event] ?? row.event}` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {row ? (
            <div className="grid gap-3 text-sm">
              <DetailField label="时间" value={createdAt} />
              <DetailField
                label="事件"
                value={eventLabel[row.event] ?? row.event}
              />
              <DetailField label="账号" value={row.username ?? "-"} />
              <DetailField label="IP" value={row.ip ?? "-"} mono />
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
