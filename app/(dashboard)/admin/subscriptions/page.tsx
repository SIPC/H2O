"use client"

import { FormEvent, useEffect, useState } from "react"
import { ChevronsUpDown } from "lucide-react"
import { Line, LineChart, XAxis } from "recharts"

import { useConfirm } from "@/components/confirm-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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
      light: "#ffffff",
      dark: "#ffffff",
    },
  },
} satisfies ChartConfig

const RX_SPARK_CONFIG = {
  rxBytes: {
    label: "总入",
    theme: {
      light: "#ffffff",
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

function StatusCombobox({
  value,
  onChange,
  className,
}: {
  value: SubscriptionStatus
  onChange: (value: SubscriptionStatus) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const current = statusOptions.find((option) => option.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn("justify-between", className)}
        >
          {current?.label ?? value}
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandList>
            <CommandEmpty>无匹配项</CommandEmpty>
            <CommandGroup>
              {statusOptions.map((option) => (
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

export default function AdminSubscriptionsPage() {
  const { confirm, alert } = useConfirm()
  const [rows, setRows] = useState<Row[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [userId, setUserId] = useState<number | null>(null)
  const [planId, setPlanId] = useState<number | null>(null)

  const [historyBySub, setHistoryBySub] = useState<Record<number, HourPoint[]>>(
    {}
  )

  const [editOpen, setEditOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Row | null>(null)
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

    setUserId(null)
    setPlanId(null)
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

  function openEdit(row: Row) {
    setEditTarget(row)
    setEditStatus(row.status)
    setEditExpire(toDatetimeLocal(row.expire_time))
    setEditUsed(String(row.used_traffic_bytes))
    setEditOpen(true)
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editTarget) return

    await patchSub(editTarget.id, {
      status: editStatus,
      expireTime: new Date(editExpire).toISOString(),
      usedTrafficBytes: Number(editUsed),
    })

    setEditOpen(false)
    setEditTarget(null)
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
      <Card>
        <CardHeader>
          <CardTitle>订阅管理</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="mb-4 grid gap-3 md:grid-cols-3" onSubmit={create}>
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
                className="h-9 w-full"
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
                className="h-9 w-full"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit">创建订阅</Button>
            </div>
          </form>

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
                <TH>操作</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => {
                const hourly = historyBySub[row.id] ?? []

                return (
                  <TR key={row.id}>
                    <TD>{row.id}</TD>
                    <TD>{row.username}</TD>
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
                    <TD>{statusLabel[row.status] ?? row.status}</TD>
                    <TD>{new Date(row.expire_time).toLocaleString()}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-2">
                        {row.status === "blocked" ? (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() =>
                              void patchSub(row.id, { status: "active" })
                            }
                          >
                            解封
                          </Button>
                        ) : (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() =>
                              void patchSub(row.id, { status: "blocked" })
                            }
                          >
                            封禁
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => openEdit(row)}
                        >
                          编辑
                        </Button>
                        <Button
                          size="xs"
                          variant="destructive"
                          onClick={() => void remove(row)}
                        >
                          删除
                        </Button>
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open)
          if (!open) setEditTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              编辑订阅{" "}
              {editTarget ? `#${editTarget.id} (${editTarget.username})` : ""}
            </DialogTitle>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={submitEdit}>
            <div className="space-y-1">
              <Label>状态</Label>
              <StatusCombobox
                value={editStatus}
                onChange={setEditStatus}
                className="h-9 w-full"
              />
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
              <Label>已用流量(bytes)</Label>
              <Input
                value={editUsed}
                onChange={(e) => setEditUsed(e.target.value)}
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit">保存</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
              >
                取消
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
