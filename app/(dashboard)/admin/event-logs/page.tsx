"use client"

import { FormEvent, useEffect, useState } from "react"
import { ChevronsUpDown } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"
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
  | "PLAN_CREATE"
  | "PLAN_UPDATE"
  | "PLAN_DELETE"
  | "SUBSCRIPTION_CREATE"
  | "SUBSCRIPTION_UPDATE"
  | "SUBSCRIPTION_DELETE"
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
  PLAN_CREATE: "创建套餐",
  PLAN_UPDATE: "更新套餐",
  PLAN_DELETE: "删除套餐",
  SUBSCRIPTION_CREATE: "创建订阅",
  SUBSCRIPTION_UPDATE: "更新订阅",
  SUBSCRIPTION_DELETE: "删除订阅",
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
  { label: "创建套餐", value: "PLAN_CREATE" },
  { label: "更新套餐", value: "PLAN_UPDATE" },
  { label: "删除套餐", value: "PLAN_DELETE" },
  { label: "创建订阅", value: "SUBSCRIPTION_CREATE" },
  { label: "更新订阅", value: "SUBSCRIPTION_UPDATE" },
  { label: "删除订阅", value: "SUBSCRIPTION_DELETE" },
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

function formatDetail(detail: string | null): string {
  if (!detail) return "-"
  try {
    const obj = JSON.parse(detail) as Record<string, unknown>
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join("；")
  } catch {
    return detail
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

    const response = await fetch(`/api/admin/event-logs?${params.toString()}`)
    const json = await response.json()
    if (!json?.ok) return

    setRows(json.data.rows)
    setTotal(json.data.total)
    setPage(json.data.page)
    setPageSize(json.data.pageSize)
  }

  useEffect(() => {
    let mounted = true

    void (async () => {
      const params = new URLSearchParams({ page: "1", pageSize: "50" })
      const response = await fetch(`/api/admin/event-logs?${params.toString()}`)
      const json = await response.json()
      if (mounted && json?.ok) {
        setRows(json.data.rows)
        setTotal(json.data.total)
        setPage(json.data.page)
        setPageSize(json.data.pageSize)
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

  async function changePage(next: number) {
    await load({ page: next })
  }

  async function changePageSize(next: number) {
    await load({ page: 1, pageSize: next })
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(total, page * pageSize)

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>事件日志</CardTitle>
          <p className="text-xs text-muted-foreground">
            登录 / 注册 / 登出 / 轮换 Key 等业务事件；节点认证请求请查看「认证日志」。
          </p>
        </CardHeader>
        <CardContent>
          <form className="mb-4 grid gap-3 md:grid-cols-4" onSubmit={submit}>
            <div className="space-y-1">
              <Label>账号</Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="用户名"
              />
            </div>
            <div className="space-y-1">
              <Label>事件类型</Label>
              <EventCombobox
                value={eventFilter}
                onChange={(next) => void switchEvent(next)}
                className="h-9 w-full"
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

          <Table>
            <THead>
              <TR>
                <TH>时间</TH>
                <TH>事件</TH>
                <TH>账号</TH>
                <TH>IP</TH>
                <TH>结果</TH>
                <TH>原因</TH>
                <TH>数据</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id}>
                  <TD>
                    {new Date(
                      row.created_at.endsWith("Z")
                        ? row.created_at
                        : `${row.created_at}Z`
                    ).toLocaleString()}
                  </TD>
                  <TD>{eventLabel[row.event] ?? row.event}</TD>
                  <TD>{row.username ?? "-"}</TD>
                  <TD className="font-mono text-xs">{row.ip ?? "-"}</TD>
                  <TD>
                    {row.success === 1 ? (
                      <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        成功
                      </Badge>
                    ) : (
                      <Badge className="bg-destructive/15 text-destructive">
                        失败
                      </Badge>
                    )}
                  </TD>
                  <TD className="text-xs">
                    {row.reason
                      ? (reasonLabel[row.reason] ?? row.reason)
                      : "-"}
                  </TD>
                  <TD className="max-w-[260px] truncate text-xs text-muted-foreground">
                    {formatDetail(row.detail)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
              <span>
                共 {total} 条{total > 0 ? `，当前 ${rangeStart}–${rangeEnd}` : ""}
              </span>
              <span className="flex items-center gap-1">
                每页
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <Button
                    key={size}
                    type="button"
                    size="xs"
                    variant={pageSize === size ? "default" : "outline"}
                    onClick={() => void changePageSize(size)}
                  >
                    {size}
                  </Button>
                ))}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => void changePage(1)}
              >
                首页
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => void changePage(page - 1)}
              >
                上一页
              </Button>
              <span className="text-muted-foreground">
                第 {page} / {totalPages} 页
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => void changePage(page + 1)}
              >
                下一页
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => void changePage(totalPages)}
              >
                末页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
