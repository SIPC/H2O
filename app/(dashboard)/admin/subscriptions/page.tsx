"use client"

import { FormEvent, useEffect, useState } from "react"
import {
  ChevronsUpDown,
  MoreVertical,
  Pencil,
  Plus,
  ShieldBan,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { Line, LineChart, XAxis } from "recharts"

import { Badge } from "@/components/ui/badge"
import { useConfirm } from "@/components/confirm-provider"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
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

import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { cn } from "@/lib/utils"

type SubscriptionStatus = "active" | "expired" | "blocked"

type Row = {
  id: number
  username: string
  plan_name: string
  used_traffic_bytes: number
  traffic_limit_bytes: number
  status: SubscriptionStatus
  expire_time: string
}

type UserRow = { id: number; username: string }
type PlanRow = { id: number; name: string }

type HourPoint = {
  index: number
  bucketDate: string
  hour: number
  label: string
  txBytes: number
  rxBytes: number
}

const statusOptions: Array<{ label: string; value: SubscriptionStatus }> = [
  { label: "启用 (active)", value: "active" },
  { label: "过期 (expired)", value: "expired" },
  { label: "封禁 (blocked)", value: "blocked" },
]

const statusLabel: Record<SubscriptionStatus, string> = {
  active: "启用",
  expired: "过期",
  blocked: "封禁",
}

const HISTORY_CHUNK_SIZE = 200

const TX_SPARK_CONFIG = {
  txBytes: {
    label: "总出",
    theme: {
      light: "#171717",
      dark: "#ffffff",
    },
  },
} satisfies ChartConfig

const RX_SPARK_CONFIG = {
  rxBytes: {
    label: "总入",
    theme: {
      light: "#171717",
      dark: "#ffffff",
    },
  },
} satisfies ChartConfig

// 字节数按单位自适应：B/KB/MB/GB/TB/PB
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  let value = bytes
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  const decimals = idx === 0 ? 0 : value >= 100 ? 1 : 2
  return `${value.toFixed(decimals)} ${units[idx]}`
}

// 将 ISO 时间转换为 datetime-local input 需要的本地格式
function toDatetimeLocal(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0
  return Math.min(23, Math.max(0, Math.floor(hour)))
}

function buildEmptyHourly(): HourPoint[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    index: hour,
    bucketDate: "",
    hour,
    label: String(hour).padStart(2, "0"),
    txBytes: 0,
    rxBytes: 0,
  }))
}

function normalizeHourly(input: unknown): HourPoint[] {
  if (!Array.isArray(input)) return buildEmptyHourly()

  const out: HourPoint[] = []

  for (const item of input) {
    if (!item || typeof item !== "object") continue
    const row = item as Partial<HourPoint>
    if (typeof row.hour !== "number" || !Number.isFinite(row.hour)) continue

    const hour = clampHour(row.hour)
    out.push({
      index:
        typeof row.index === "number" && Number.isFinite(row.index)
          ? Math.max(0, Math.floor(row.index))
          : out.length,
      bucketDate:
        typeof row.bucketDate === "string" && row.bucketDate.trim()
          ? row.bucketDate
          : "",
      hour,
      label:
        typeof row.label === "string" && row.label.trim()
          ? row.label
          : String(hour).padStart(2, "0"),
      txBytes:
        typeof row.txBytes === "number" && Number.isFinite(row.txBytes)
          ? Math.max(0, Math.floor(row.txBytes))
          : 0,
      rxBytes:
        typeof row.rxBytes === "number" && Number.isFinite(row.rxBytes)
          ? Math.max(0, Math.floor(row.rxBytes))
          : 0,
    })

    if (out.length >= 24) break
  }

  return out.length > 0 ? out : buildEmptyHourly()
}

// 通用 ID-标签下拉选择，支持输入过滤（用户选择、套餐选择共用）
function EntityCombobox({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  className,
}: {
  options: Array<{ value: number; label: string }>
  value: number | null
  onChange: (value: number) => void
  placeholder: string
  searchPlaceholder: string
  emptyText: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn("justify-between font-normal", className)}
        >
          <span className={current ? "" : "text-muted-foreground"}>
            {current?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  data-checked={value === o.value}
                  onSelect={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function SubscriptionHistorySpark({
  hourly,
  dataKey,
}: {
  hourly: HourPoint[]
  dataKey: "txBytes" | "rxBytes"
}) {
  const data = hourly
  const shouldAnimate = data.length > 0
  const config = dataKey === "txBytes" ? TX_SPARK_CONFIG : RX_SPARK_CONFIG

  return (
    <ChartContainer config={config} className="aspect-auto h-7 w-[160px]">
      <LineChart
        accessibilityLayer
        data={data}
        margin={{ top: 1, right: 0, left: 0, bottom: 0 }}
      >
        <XAxis dataKey="label" hide />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              hideLabel
              hideIndicator
              formatter={(value) => formatBytes(Number(value))}
            />
          }
        />
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={`var(--color-${dataKey})`}
          strokeWidth={1.6}
          dot={false}
          activeDot={{ r: 2 }}
          isAnimationActive={shouldAnimate}
          animationBegin={0}
          animationDuration={700}
          animationEasing="linear"
        />
      </LineChart>
    </ChartContainer>
  )
}

// 订阅表单（创建 / 编辑共用）
function SubscriptionForm({
  isEdit,
  userId,
  setUserId,
  planId,
  setPlanId,
  users,
  plans,
  status,
  setStatus,
  editExpire,
  setEditExpire,
  editUsed,
  setEditUsed,
  onSubmit,
  submitLabel,
  onCancel,
}: {
  isEdit: boolean
  userId: number | null
  setUserId: (v: number | null) => void
  planId: number | null
  setPlanId: (v: number | null) => void
  users: UserRow[]
  plans: PlanRow[]
  status: SubscriptionStatus
  setStatus: (v: SubscriptionStatus) => void
  editExpire: string
  setEditExpire: (v: string) => void
  editUsed: string
  setEditUsed: (v: string) => void
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  submitLabel: string
  onCancel?: () => void
}) {
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      {!isEdit && (
        <>
          <div className="space-y-1">
            <Label>用户</Label>
            <EntityCombobox
              options={users.map((u) => ({
                value: u.id,
                label: `#${u.id} ${u.username}`,
              }))}
              value={userId}
              onChange={setUserId}
              placeholder="选择用户"
              searchPlaceholder="搜索用户名"
              emptyText="无匹配用户"
              className="w-full"
            />
          </div>
          <div className="space-y-1">
            <Label>套餐</Label>
            <EntityCombobox
              options={plans.map((p) => ({
                value: p.id,
                label: `#${p.id} ${p.name}`,
              }))}
              value={planId}
              onChange={setPlanId}
              placeholder="选择套餐"
              searchPlaceholder="搜索套餐名"
              emptyText="无匹配套餐"
              className="w-full"
            />
          </div>
        </>
      )}

      {isEdit && (
        <>
          <div className="space-y-1">
            <Label>状态</Label>
            <div className="flex gap-2">
              {statusOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={status === option.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatus(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label>到期时间</Label>
            <Input
              type="datetime-local"
              value={editExpire}
              onChange={(e) => setEditExpire(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>已用流量 (bytes)</Label>
            <Input
              value={editUsed}
              onChange={(e) => setEditUsed(e.target.value)}
              required
            />
          </div>
        </>
      )}

      <div className="flex gap-2 pt-2">
        <Button type="submit">{submitLabel}</Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
        )}
      </div>
    </form>
  )
}

export default function AdminSubscriptionsPage() {
  const { confirm, alert } = useConfirm()
  const [rows, setRows] = useState<Row[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [plans, setPlans] = useState<PlanRow[]>([])

  const [historyBySub, setHistoryBySub] = useState<Record<number, HourPoint[]>>(
    {}
  )

  // 创建面板
  const [createOpen, setCreateOpen] = useState(false)
  const [userId, setUserId] = useState<number | null>(null)
  const [planId, setPlanId] = useState<number | null>(null)

  // 编辑面板
  const [editingRow, setEditingRow] = useState<Row | null>(null)
  const [editStatus, setEditStatus] = useState<SubscriptionStatus>("active")
  const [editExpire, setEditExpire] = useState("")
  const [editUsed, setEditUsed] = useState("0")

  async function loadHistory(
    subscriptionIds: number[],
    isMounted: () => boolean = () => true
  ) {
    const ids = Array.from(
      new Set(subscriptionIds.filter((id) => Number.isInteger(id) && id > 0))
    )

    if (ids.length === 0) {
      if (!isMounted()) return
      setHistoryBySub({})
      return
    }

    const nextHistory: Record<number, HourPoint[]> = {}

    for (let i = 0; i < ids.length; i += HISTORY_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + HISTORY_CHUNK_SIZE)
      const params = new URLSearchParams()
      params.set("ids", chunk.join(","))

      const response = await fetch(
        `/api/admin/subscriptions/history?${params.toString()}`
      )
      const json = await response.json()

      if (!json?.ok) continue

      if (!Array.isArray(json.data?.items)) continue
      for (const rawItem of json.data.items as Array<{
        subscriptionId?: unknown
        hourly?: unknown
      }>) {
        if (
          typeof rawItem.subscriptionId !== "number" ||
          !Number.isFinite(rawItem.subscriptionId)
        ) {
          continue
        }
        nextHistory[Math.floor(rawItem.subscriptionId)] = normalizeHourly(
          rawItem.hourly
        )
      }
    }

    for (const id of ids) {
      if (!nextHistory[id]) nextHistory[id] = []
    }

    if (!isMounted()) return
    setHistoryBySub(nextHistory)
  }

  async function load() {
    const response = await fetch("/api/admin/subscriptions")
    const json = await response.json()

    if (!json?.ok || !Array.isArray(json.data)) {
      setRows([])
      setHistoryBySub({})
      return
    }

    const nextRows = json.data as Row[]
    setRows(nextRows)
    await loadHistory(nextRows.map((row) => row.id))
  }

  useEffect(() => {
    let mounted = true

    void (async () => {
      const [subRes, userRes, planRes] = await Promise.all([
        fetch("/api/admin/subscriptions"),
        fetch("/api/admin/users"),
        fetch("/api/admin/plans"),
      ])
      const subJson = await subRes.json()
      const userJson = await userRes.json()
      const planJson = await planRes.json()

      if (!mounted) return

      const nextRows =
        subJson?.ok && Array.isArray(subJson.data)
          ? (subJson.data as Row[])
          : []

      setRows(nextRows)
      if (userJson?.ok) setUsers(userJson.data)
      if (planJson?.ok) setPlans(planJson.data)

      await loadHistory(
        nextRows.map((row) => row.id),
        () => mounted
      )
    })()

    return () => {
      mounted = false
    }
  }, [])

  function resetCreateForm() {
    setUserId(null)
    setPlanId(null)
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (userId === null || planId === null) {
      await alert({
        title: "请选择用户和套餐",
        description: "创建订阅前必须同时选择目标用户与套餐。",
      })
      return
    }
    const response = await fetch("/api/admin/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, planId }),
    })

    const json = await response.json()
    if (!response.ok || !json.ok) return

    resetCreateForm()
    setCreateOpen(false)
    await load()
  }

  async function patchSub(subId: number, body: Record<string, unknown>) {
    const response = await fetch(`/api/admin/subscriptions/${subId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })

    const json = await response.json()
    if (!response.ok || !json.ok) return
    await load()
  }

  function startEdit(row: Row) {
    setEditingRow(row)
    setEditStatus(row.status)
    setEditExpire(toDatetimeLocal(row.expire_time))
    setEditUsed(String(row.used_traffic_bytes))
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingRow) return

    await patchSub(editingRow.id, {
      status: editStatus,
      expireTime: new Date(editExpire).toISOString(),
      usedTrafficBytes: Number(editUsed),
    })

    setEditingRow(null)
  }

  async function remove(row: Row) {
    const ok = await confirm({
      title: `删除订阅 #${row.id}？`,
      description: `用户 ${row.username} / 套餐 ${row.plan_name}；该订阅删除后节点无法再通过它认证。`,
      confirmText: "删除",
      variant: "destructive",
    })
    if (!ok) return

    const response = await fetch(`/api/admin/subscriptions/${row.id}`, {
      method: "DELETE",
    })
    const json = await response.json()
    if (!response.ok || !json.ok) {
      await alert({
        title: "删除失败",
        description: json?.error?.message ?? "请稍后重试",
        variant: "destructive",
      })
      return
    }
    await load()
  }

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 p-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">订阅管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {rows.length} 个订阅
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          添加订阅
        </Button>
      </div>

      {/* 订阅列表 */}
      {rows.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-sm">暂无订阅</p>
          <p className="mt-1 text-xs">点击右上角「添加订阅」创建第一个订阅</p>
        </Card>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>ID</TH>
              <TH>用户</TH>
              <TH>套餐</TH>
              <TH>已用流量</TH>
              <TH>流量上限</TH>
              <TH>总出历史</TH>
              <TH>总入历史</TH>
              <TH>状态</TH>
              <TH>到期时间</TH>
              <TH className="w-12"></TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => {
              const hourly = historyBySub[row.id] ?? []

              return (
                <TR key={row.id}>
                  <TD>{row.id}</TD>
                  <TD className="font-medium">{row.username}</TD>
                  <TD>{row.plan_name}</TD>
                  <TD>{formatBytes(row.used_traffic_bytes)}</TD>
                  <TD>{formatBytes(row.traffic_limit_bytes)}</TD>
                  <TD className="min-w-[170px] py-1">
                    <SubscriptionHistorySpark
                      hourly={hourly}
                      dataKey="txBytes"
                    />
                  </TD>
                  <TD className="min-w-[170px] py-1">
                    <SubscriptionHistorySpark
                      hourly={hourly}
                      dataKey="rxBytes"
                    />
                  </TD>
                  <TD>
                    <Badge
                      className={
                        row.status === "active"
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : row.status === "blocked"
                            ? "bg-destructive/15 text-destructive"
                            : "bg-muted text-muted-foreground"
                      }
                    >
                      {statusLabel[row.status] ?? row.status}
                    </Badge>
                  </TD>
                  <TD>{new Date(row.expire_time).toLocaleString()}</TD>
                  <TD>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => startEdit(row)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          编辑
                        </DropdownMenuItem>
                        {row.status === "blocked" ? (
                          <DropdownMenuItem
                            onClick={() =>
                              void patchSub(row.id, { status: "active" })
                            }
                          >
                            <ShieldCheck className="mr-2 h-4 w-4" />
                            解封
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() =>
                              void patchSub(row.id, { status: "blocked" })
                            }
                          >
                            <ShieldBan className="mr-2 h-4 w-4" />
                            封禁
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => void remove(row)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      )}

      {/* 创建订阅 - 右侧滑出面板 */}
      <Sheet
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) resetCreateForm()
        }}
      >
        <SheetContent className="data-[side=right]:sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>添加订阅</SheetTitle>
            <SheetDescription>选择用户和套餐，创建新的订阅。</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <SubscriptionForm
              isEdit={false}
              userId={userId}
              setUserId={setUserId}
              planId={planId}
              setPlanId={setPlanId}
              users={users}
              plans={plans}
              status="active"
              setStatus={() => {}}
              editExpire=""
              setEditExpire={() => {}}
              editUsed=""
              setEditUsed={() => {}}
              onSubmit={create}
              submitLabel="创建订阅"
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* 编辑订阅 - 右侧滑出面板 */}
      <Sheet
        open={editingRow !== null}
        onOpenChange={(open) => {
          if (!open) setEditingRow(null)
        }}
      >
        <SheetContent className="data-[side=right]:sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              编辑订阅{" "}
              {editingRow ? `#${editingRow.id} (${editingRow.username})` : ""}
            </SheetTitle>
            <SheetDescription>修改订阅配置，保存后立即生效。</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <SubscriptionForm
              isEdit
              userId={null}
              setUserId={() => {}}
              planId={null}
              setPlanId={() => {}}
              users={users}
              plans={plans}
              status={editStatus}
              setStatus={setEditStatus}
              editExpire={editExpire}
              setEditExpire={setEditExpire}
              editUsed={editUsed}
              setEditUsed={setEditUsed}
              onSubmit={submitEdit}
              submitLabel="保存修改"
              onCancel={() => setEditingRow(null)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
