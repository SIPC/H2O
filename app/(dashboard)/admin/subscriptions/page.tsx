"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { type ColumnDef } from "@tanstack/react-table"
import {
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
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
import {
  DataTable,
  DataTableColumnHeader,
  DataTableFacetedFilter,
  DataTableViewOptions,
} from "@/components/data-table"

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
  isPermanent,
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
  isPermanent: boolean
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  submitLabel: string
  onCancel?: () => void
}) {
  return (
    <form
      className="space-y-4 **:data-[slot=label]:text-xs"
      onSubmit={onSubmit}
    >
      {/* === 基础信息 === */}
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            基础信息
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isEdit && (
            <>
              <div className="space-y-1">
                <Label>用户</Label>
                <Select
                  value={userId !== null ? String(userId) : ""}
                  onValueChange={(v) => setUserId(Number(v))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择用户" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          #{u.id} {u.username}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>套餐</Label>
                <Select
                  value={planId !== null ? String(planId) : ""}
                  onValueChange={(v) => setPlanId(Number(v))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择套餐" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      {plans.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          #{p.id} {p.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
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
                  disabled={isPermanent}
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
        </CardContent>
      </Card>

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
  const [loading, setLoading] = useState(true)

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
    setLoading(true)
    try {
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
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true

    void (async () => {
      try {
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
      } finally {
        if (mounted) setLoading(false)
      }
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

    const body: Record<string, unknown> = {
      status: editStatus,
      usedTrafficBytes: Number(editUsed),
    }

    // 永久订阅不发送 expireTime，避免被意外修改
    if (!editIsPermanent && editExpire) {
      body.expireTime = new Date(editExpire).toISOString()
    }

    await patchSub(editingRow.id, body)

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

  const editIsPermanent =
    editingRow !== null && new Date(editExpire).getFullYear() >= 9999

  const planOptions = useMemo(
    () =>
      [...new Set(rows.map((r) => r.plan_name))].map((p) => ({
        label: p,
        value: p,
      })),
    [rows]
  )

  const columns: ColumnDef<Row>[] = [
    {
      accessorKey: "id",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="ID" />
      ),
      meta: { label: "ID" },
    },
    {
      accessorKey: "username",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="用户" />
      ),
      cell: ({ row }) => (
        <span className="font-medium">{row.original.username}</span>
      ),
      meta: { label: "用户" },
    },
    {
      accessorKey: "plan_name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="套餐" />
      ),
      filterFn: "arrIncludesSome" as const,
      meta: { label: "套餐" },
    },
    {
      accessorKey: "used_traffic_bytes",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="已用流量" />
      ),
      cell: ({ row }) => formatBytes(row.original.used_traffic_bytes),
      meta: { label: "已用流量" },
    },
    {
      accessorKey: "traffic_limit_bytes",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="流量上限" />
      ),
      cell: ({ row }) => formatBytes(row.original.traffic_limit_bytes),
      meta: { label: "流量上限" },
    },
    {
      id: "tx_history",
      header: "总出历史",
      enableSorting: false,
      cell: ({ row }) => {
        const hourly = historyBySub[row.original.id] ?? []
        return (
          <div className="min-w-[170px] py-1">
            <SubscriptionHistorySpark hourly={hourly} dataKey="txBytes" />
          </div>
        )
      },
    },
    {
      id: "rx_history",
      header: "总入历史",
      enableSorting: false,
      cell: ({ row }) => {
        const hourly = historyBySub[row.original.id] ?? []
        return (
          <div className="min-w-[170px] py-1">
            <SubscriptionHistorySpark hourly={hourly} dataKey="rxBytes" />
          </div>
        )
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="状态" />
      ),
      cell: ({ row }) => (
        <Badge
          className={
            row.original.status === "active"
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : row.original.status === "blocked"
                ? "bg-destructive/15 text-destructive"
                : "bg-muted text-muted-foreground"
          }
        >
          {statusLabel[row.original.status] ?? row.original.status}
        </Badge>
      ),
      filterFn: "arrIncludesSome" as const,
      meta: { label: "状态" },
    },
    {
      accessorKey: "expire_time",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="到期时间" />
      ),
      cell: ({ row }) =>
        new Date(row.original.expire_time).getFullYear() >= 9999
          ? "—"
          : new Date(row.original.expire_time).toLocaleString(),
      meta: { label: "到期时间" },
    },
    {
      id: "actions",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => startEdit(row.original)}>
              <Pencil className="mr-2 h-4 w-4" />
              编辑
            </DropdownMenuItem>
            {row.original.status === "blocked" ? (
              <DropdownMenuItem
                onClick={() =>
                  void patchSub(row.original.id, { status: "active" })
                }
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                解封
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() =>
                  void patchSub(row.original.id, { status: "blocked" })
                }
              >
                <ShieldBan className="mr-2 h-4 w-4" />
                封禁
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void remove(row.original)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

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
      {rows.length === 0 && !loading ? (
        <Card className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-sm">暂无订阅</p>
          <p className="mt-1 text-xs">点击右上角「添加订阅」创建第一个订阅</p>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          defaultPageSize={20}
          pageSizeOptions={[10, 20, 50, 100]}
          loading={loading}
          loadingRowCount={8}
          renderToolbar={(table) => (
            <>
              <Input
                placeholder="搜索用户名…"
                value={
                  (table.getColumn("username")?.getFilterValue() as string) ??
                  ""
                }
                onChange={(e) =>
                  table.getColumn("username")?.setFilterValue(e.target.value)
                }
                className="h-8 max-w-[200px]"
              />
              <DataTableFacetedFilter
                column={table.getColumn("plan_name")}
                title="套餐"
                options={planOptions}
              />
              <DataTableFacetedFilter
                column={table.getColumn("status")}
                title="状态"
                options={[
                  { label: "启用", value: "active" },
                  { label: "过期", value: "expired" },
                  { label: "封禁", value: "blocked" },
                ]}
              />
              <DataTableViewOptions table={table} />
            </>
          )}
        />
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
              isPermanent={false}
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
              isPermanent={editIsPermanent}
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
