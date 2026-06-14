"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { MoreVertical, Pencil, Plus, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { useConfirm } from "@/components/confirm-provider"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Switch } from "@/components/ui/switch"
import type { ColumnDef } from "@tanstack/react-table"
import {
  DataTable,
  DataTableColumnHeader,
  DataTableFacetedFilter,
  DataTableViewOptions,
} from "@/components/data-table"

type TrafficBillingMode = "tx_rx" | "tx" | "rx"

type PlanRow = {
  id: number
  name: string
  traffic_limit_bytes: number
  traffic_billing_mode: TrafficBillingMode | null
  duration_days: number
  up_mbps: number
  down_mbps: number
  auto_renew: number
  renewal_period_days: number | null
  node_ids: string | null
}

type NodeRow = { id: number; name: string }

const TRAFFIC_BILLING_LABEL_KEY: Record<TrafficBillingMode, string> = {
  tx_rx: "adminBasic.trafficBilling.txRx",
  tx: "adminBasic.trafficBilling.tx",
  rx: "adminBasic.trafficBilling.rx",
}

function normalizeTrafficBillingMode(
  value: string | null | undefined
): TrafficBillingMode {
  return value === "tx" || value === "rx" ? value : "tx_rx"
}

function trafficBillingModeKey(value: string | null | undefined) {
  return TRAFFIC_BILLING_LABEL_KEY[normalizeTrafficBillingMode(value)]
}

// 前端统一用 GB 展示，提交 / 存库仍走 bytes
const BYTES_PER_GB = 1024 ** 3

function bytesToGbString(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0"
  return String(Number((bytes / BYTES_PER_GB).toFixed(4)))
}

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

// 限速展示：0 视为不限速
function formatSpeed(
  mbps: number,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  if (!Number.isFinite(mbps) || mbps <= 0)
    return t("adminBasic.label.unlimited")
  return `${mbps} Mbps`
}

function parseNodeIds(value: string | null): number[] {
  if (!value) return []
  return value
    .split(",")
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v))
}

function NodeCheckboxGroup({
  nodes,
  value,
  onChange,
}: {
  nodes: NodeRow[]
  value: number[]
  onChange: (next: number[]) => void
}) {
  const { t } = useI18n()

  function toggle(nodeId: number, checked: boolean) {
    if (checked) {
      if (!value.includes(nodeId)) onChange([...value, nodeId])
    } else {
      onChange(value.filter((id) => id !== nodeId))
    }
  }

  if (nodes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("adminBasic.label.noNodes")}
      </p>
    )
  }

  return (
    <div className="flex max-h-80 flex-col gap-2 overflow-auto rounded-md border p-3">
      {nodes.map((node) => {
        const checked = value.includes(node.id)
        const checkboxId = `node-${node.id}`
        return (
          <label
            key={node.id}
            htmlFor={checkboxId}
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <Checkbox
              id={checkboxId}
              checked={checked}
              onCheckedChange={(next) => toggle(node.id, next === true)}
            />
            <span>
              #{node.id} {node.name}
            </span>
          </label>
        )
      })}
    </div>
  )
}

// 套餐表单（创建 / 编辑共用）
function PlanForm({
  name,
  setName,
  trafficLimitGb,
  setTrafficLimitGb,
  trafficBillingMode,
  setTrafficBillingMode,
  durationDays,
  setDurationDays,
  upMbps,
  setUpMbps,
  downMbps,
  setDownMbps,
  permanent,
  setPermanent,
  autoRenew,
  setAutoRenew,
  renewalPeriodDays,
  setRenewalPeriodDays,
  selectedNodeIds,
  setSelectedNodeIds,
  nodes,
  onSubmit,
  submitLabel,
  onCancel,
}: {
  name: string
  setName: (v: string) => void
  trafficLimitGb: string
  setTrafficLimitGb: (v: string) => void
  trafficBillingMode: TrafficBillingMode
  setTrafficBillingMode: (v: TrafficBillingMode) => void
  durationDays: string
  setDurationDays: (v: string) => void
  upMbps: string
  setUpMbps: (v: string) => void
  downMbps: string
  setDownMbps: (v: string) => void
  permanent: boolean
  setPermanent: (v: boolean) => void
  autoRenew: boolean
  setAutoRenew: (v: boolean) => void
  renewalPeriodDays: string
  setRenewalPeriodDays: (v: string) => void
  selectedNodeIds: number[]
  setSelectedNodeIds: (v: number[]) => void
  nodes: NodeRow[]
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  submitLabel: string
  onCancel?: () => void
}) {
  const { t } = useI18n()

  return (
    <form
      className="space-y-4 **:data-[slot=label]:text-xs"
      onSubmit={onSubmit}
    >
      {/* === 基础信息 === */}
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            {t("adminPlans.form.basicInfo")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>{t("adminPlans.form.name")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t("adminPlans.form.trafficLimitGb")}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={trafficLimitGb}
                onChange={(e) => setTrafficLimitGb(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>{t("adminPlans.form.billingMode")}</Label>
              <Select
                value={trafficBillingMode}
                onValueChange={(v) =>
                  setTrafficBillingMode(v as TrafficBillingMode)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={t("adminPlans.form.billingModePlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="tx_rx">
                    {t("adminBasic.trafficBilling.txRx")}
                  </SelectItem>
                  <SelectItem value="tx">
                    {t("adminBasic.trafficBilling.tx")}
                  </SelectItem>
                  <SelectItem value="rx">
                    {t("adminBasic.trafficBilling.rx")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>{t("adminPlans.form.durationDays")}</Label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <Switch
                  checked={permanent}
                  onCheckedChange={setPermanent}
                  size="sm"
                />
                {t("adminPlans.form.permanentEnabled")}
              </label>
            </div>
            {!permanent && (
              <Input
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                required
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* === 限速设置 === */}
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            {t("adminPlans.form.speedSettings")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("adminPlans.form.upSpeedMbps")}</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={upMbps}
                onChange={(e) => setUpMbps(e.target.value)}
                placeholder={t("adminPlans.form.unlimitedPlaceholder")}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("adminPlans.form.downSpeedMbps")}</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={downMbps}
                onChange={(e) => setDownMbps(e.target.value)}
                placeholder={t("adminPlans.form.unlimitedPlaceholder")}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* === 可用节点 === */}
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            {t("adminPlans.form.availableNodes")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <NodeCheckboxGroup
            nodes={nodes}
            value={selectedNodeIds}
            onChange={setSelectedNodeIds}
          />
        </CardContent>
      </Card>

      {/* === 其他设置 === */}
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            {t("adminPlans.form.otherSettings")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("adminPlans.form.autoRenew")}</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("adminPlans.form.autoRenewDescription")}
              </p>
            </div>
            <Switch checked={autoRenew} onCheckedChange={setAutoRenew} />
          </div>
          {autoRenew && (
            <div className="space-y-1">
              <Label>{t("adminPlans.form.renewalPeriodDays")}</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={renewalPeriodDays}
                onChange={(e) => setRenewalPeriodDays(e.target.value)}
                placeholder={t("adminPlans.form.renewalPlaceholder")}
                required
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2 pt-2">
        <Button type="submit">{submitLabel}</Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </form>
  )
}

export default function AdminPlansPage() {
  const { confirm, alert } = useConfirm()
  const { t } = useI18n()
  const [rows, setRows] = useState<PlanRow[]>([])
  const [nodes, setNodes] = useState<NodeRow[]>([])
  const [loading, setLoading] = useState(true)

  // 创建面板
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [trafficLimitGb, setTrafficLimitGb] = useState("1")
  const [trafficBillingMode, setTrafficBillingMode] =
    useState<TrafficBillingMode>("tx_rx")
  const [durationDays, setDurationDays] = useState("30")
  const [upMbps, setUpMbps] = useState("0")
  const [downMbps, setDownMbps] = useState("0")
  const [permanent, setPermanent] = useState(false)
  const [autoRenew, setAutoRenew] = useState(false)
  const [renewalPeriodDays, setRenewalPeriodDays] = useState("30")
  const [selectedNodeIds, setSelectedNodeIds] = useState<number[]>([])

  // 编辑面板
  const [editingRow, setEditingRow] = useState<PlanRow | null>(null)
  const [editName, setEditName] = useState("")
  const [editTraffic, setEditTraffic] = useState("")
  const [editTrafficBillingMode, setEditTrafficBillingMode] =
    useState<TrafficBillingMode>("tx_rx")
  const [editDuration, setEditDuration] = useState("")
  const [editUpMbps, setEditUpMbps] = useState("0")
  const [editDownMbps, setEditDownMbps] = useState("0")
  const [editPermanent, setEditPermanent] = useState(false)
  const [editAutoRenew, setEditAutoRenew] = useState(false)
  const [editRenewalPeriodDays, setEditRenewalPeriodDays] = useState("30")
  const [editNodeIds, setEditNodeIds] = useState<number[]>([])

  async function load() {
    setLoading(true)
    try {
      const [planRes, nodeRes] = await Promise.all([
        fetch("/api/admin/plans"),
        fetch("/api/admin/nodes"),
      ])
      const planJson = await planRes.json()
      const nodeJson = await nodeRes.json()
      if (planJson?.ok) setRows(planJson.data)
      if (nodeJson?.ok) setNodes(nodeJson.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true

    void (async () => {
      try {
        const [planRes, nodeRes] = await Promise.all([
          fetch("/api/admin/plans"),
          fetch("/api/admin/nodes"),
        ])
        const planJson = await planRes.json()
        const nodeJson = await nodeRes.json()
        if (mounted && planJson?.ok) setRows(planJson.data)
        if (mounted && nodeJson?.ok) setNodes(nodeJson.data)
      } finally {
        if (mounted) setLoading(false)
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  function resetCreateForm() {
    setName("")
    setTrafficLimitGb("1")
    setTrafficBillingMode("tx_rx")
    setDurationDays("30")
    setUpMbps("0")
    setDownMbps("0")
    setPermanent(false)
    setAutoRenew(false)
    setRenewalPeriodDays("30")
    setSelectedNodeIds([])
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const response = await fetch("/api/admin/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        trafficLimitBytes: Math.round(Number(trafficLimitGb) * BYTES_PER_GB),
        trafficBillingMode,
        durationDays: permanent ? 0 : Number(durationDays),
        upMbps: Math.max(0, Math.floor(Number(upMbps))),
        downMbps: Math.max(0, Math.floor(Number(downMbps))),
        nodeIds: selectedNodeIds,
        autoRenew,
        renewalPeriodDays: autoRenew ? Number(renewalPeriodDays) : undefined,
      }),
    })

    const json = await response.json()
    if (!response.ok || !json.ok) return

    resetCreateForm()
    setCreateOpen(false)
    await load()
  }

  function startEdit(row: PlanRow) {
    setEditingRow(row)
    setEditName(row.name)
    setEditTraffic(bytesToGbString(row.traffic_limit_bytes))
    setEditTrafficBillingMode(
      normalizeTrafficBillingMode(row.traffic_billing_mode)
    )
    setEditDuration(String(row.duration_days))
    setEditUpMbps(String(row.up_mbps ?? 0))
    setEditDownMbps(String(row.down_mbps ?? 0))
    setEditPermanent(row.duration_days === 0)
    setEditAutoRenew(row.auto_renew === 1)
    setEditRenewalPeriodDays(
      row.renewal_period_days ? String(row.renewal_period_days) : "30"
    )
    setEditNodeIds(parseNodeIds(row.node_ids))
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingRow) return

    const response = await fetch(`/api/admin/plans/${editingRow.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: editName,
        trafficLimitBytes: Math.round(Number(editTraffic) * BYTES_PER_GB),
        trafficBillingMode: editTrafficBillingMode,
        durationDays: editPermanent ? 0 : Number(editDuration),
        upMbps: Math.max(0, Math.floor(Number(editUpMbps))),
        downMbps: Math.max(0, Math.floor(Number(editDownMbps))),
        nodeIds: editNodeIds,
        autoRenew: editAutoRenew,
        renewalPeriodDays: editAutoRenew
          ? Number(editRenewalPeriodDays)
          : undefined,
      }),
    })

    const json = await response.json()
    if (!response.ok || !json.ok) return

    setEditingRow(null)
    await load()
  }

  async function remove(row: PlanRow) {
    const ok = await confirm({
      title: t("adminPlans.delete.confirmTitle", {
        id: row.id,
        name: row.name,
      }),
      description: t("adminPlans.delete.confirmDescription"),
      confirmText: t("common.delete"),
      variant: "destructive",
    })
    if (!ok) return

    const response = await fetch(`/api/admin/plans/${row.id}`, {
      method: "DELETE",
    })
    const json = await response.json()
    if (!response.ok || !json.ok) {
      await alert({
        title: t("adminPlans.delete.failedTitle"),
        description: json?.error?.message ?? t("common.retryLater"),
        variant: "destructive",
      })
      return
    }
    await load()
  }

  function renderNodeNames(ids: number[]) {
    if (ids.length === 0) return "-"
    return ids
      .map((id) => {
        const node = nodes.find((n) => n.id === id)
        return node ? node.name : `#${id}`
      })
      .join("、")
  }

  const columns = useMemo<ColumnDef<PlanRow>[]>(
    () => [
      {
        accessorKey: "id",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("adminBasic.label.id")}
          />
        ),
        meta: { label: t("adminBasic.label.id") },
      },
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("adminBasic.label.name")}
          />
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.getValue("name")}</span>
        ),
        meta: { label: t("adminBasic.label.name") },
      },
      {
        accessorKey: "traffic_limit_bytes",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("adminBasic.label.trafficLimit")}
          />
        ),
        cell: ({ row }) => formatBytes(row.getValue("traffic_limit_bytes")),
        meta: { label: t("adminBasic.label.trafficLimit") },
      },
      {
        id: "traffic_billing_mode",
        accessorFn: (row) =>
          normalizeTrafficBillingMode(row.traffic_billing_mode),
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("adminBasic.label.billingMode")}
          />
        ),
        cell: ({ row }) => (
          <Badge>
            {t(trafficBillingModeKey(row.original.traffic_billing_mode))}
          </Badge>
        ),
        filterFn: "arrIncludesSome" as const,
        meta: { label: t("adminBasic.label.billingMode") },
      },
      {
        accessorKey: "duration_days",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("adminPlans.table.durationDays")}
          />
        ),
        cell: ({ row }) =>
          row.getValue("duration_days") === 0
            ? t("adminBasic.label.permanent")
            : row.getValue("duration_days"),
        meta: { label: t("adminPlans.table.duration") },
      },
      {
        id: "speed",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("adminPlans.table.speed")}
          />
        ),
        cell: ({ row }) => (
          <span className="text-xs">
            {formatSpeed(row.original.up_mbps ?? 0, t)} /{" "}
            {formatSpeed(row.original.down_mbps ?? 0, t)}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: "auto_renew",
        accessorFn: (row) => (row.auto_renew === 1 ? "1" : "0"),
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("adminPlans.form.autoRenew")}
          />
        ),
        filterFn: "arrIncludesSome" as const,
        meta: { label: t("adminPlans.form.autoRenew") },
        cell: ({ row }) =>
          row.original.auto_renew === 1 && row.original.renewal_period_days ? (
            <Badge>
              {t("adminPlans.table.autoRenewEveryDays", {
                days: row.original.renewal_period_days,
              })}
            </Badge>
          ) : (
            <span className="text-muted-foreground">
              {t("adminBasic.label.closed")}
            </span>
          ),
      },
      {
        id: "node_ids",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("adminPlans.form.availableNodes")}
          />
        ),
        cell: ({ row }) => (
          <span className="block max-w-70 truncate text-xs">
            {renderNodeNames(parseNodeIds(row.original.node_ids))}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        enableSorting: false,
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
                {t("adminBasic.action.edit")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void remove(row.original)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("adminBasic.action.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, t]
  )

  return (
    <div className="mx-auto flex w-full max-w-450 flex-col gap-4 p-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("adminPlans.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("adminPlans.count", { count: rows.length })}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t("adminPlans.add")}
        </Button>
      </div>

      {/* 套餐列表 */}
      {rows.length === 0 && !loading ? (
        <Card className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-sm">{t("adminPlans.empty.title")}</p>
          <p className="mt-1 text-xs">{t("adminPlans.empty.description")}</p>
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
              <DataTableFacetedFilter
                column={table.getColumn("traffic_billing_mode")}
                title={t("adminBasic.label.billingMode")}
                options={[
                  {
                    label: t("adminBasic.trafficBilling.txRx"),
                    value: "tx_rx",
                  },
                  { label: t("adminBasic.trafficBilling.tx"), value: "tx" },
                  { label: t("adminBasic.trafficBilling.rx"), value: "rx" },
                ]}
              />
              <DataTableFacetedFilter
                column={table.getColumn("auto_renew")}
                title={t("adminPlans.form.autoRenew")}
                options={[
                  { label: t("adminPlans.filter.autoRenewOn"), value: "1" },
                  { label: t("adminPlans.filter.autoRenewOff"), value: "0" },
                ]}
              />
              <DataTableViewOptions table={table} />
            </>
          )}
        />
      )}

      {/* 创建套餐 - 右侧滑出面板 */}
      <Sheet
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) resetCreateForm()
        }}
      >
        <SheetContent className="data-[side=right]:sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t("adminPlans.create.title")}</SheetTitle>
            <SheetDescription>
              {t("adminPlans.create.description")}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <PlanForm
              name={name}
              setName={setName}
              trafficLimitGb={trafficLimitGb}
              setTrafficLimitGb={setTrafficLimitGb}
              trafficBillingMode={trafficBillingMode}
              setTrafficBillingMode={setTrafficBillingMode}
              durationDays={durationDays}
              setDurationDays={setDurationDays}
              upMbps={upMbps}
              setUpMbps={setUpMbps}
              downMbps={downMbps}
              setDownMbps={setDownMbps}
              permanent={permanent}
              setPermanent={setPermanent}
              autoRenew={autoRenew}
              setAutoRenew={setAutoRenew}
              renewalPeriodDays={renewalPeriodDays}
              setRenewalPeriodDays={setRenewalPeriodDays}
              selectedNodeIds={selectedNodeIds}
              setSelectedNodeIds={setSelectedNodeIds}
              nodes={nodes}
              onSubmit={create}
              submitLabel={t("adminPlans.create.submit")}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* 编辑套餐 - 右侧滑出面板 */}
      <Sheet
        open={editingRow !== null}
        onOpenChange={(open) => {
          if (!open) setEditingRow(null)
        }}
      >
        <SheetContent className="data-[side=right]:sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {t("adminPlans.edit.title")}{" "}
              {editingRow ? `#${editingRow.id} (${editingRow.name})` : ""}
            </SheetTitle>
            <SheetDescription>
              {t("adminPlans.edit.description")}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <PlanForm
              name={editName}
              setName={setEditName}
              trafficLimitGb={editTraffic}
              setTrafficLimitGb={setEditTraffic}
              trafficBillingMode={editTrafficBillingMode}
              setTrafficBillingMode={setEditTrafficBillingMode}
              durationDays={editDuration}
              setDurationDays={setEditDuration}
              upMbps={editUpMbps}
              setUpMbps={setEditUpMbps}
              downMbps={editDownMbps}
              setDownMbps={setEditDownMbps}
              permanent={editPermanent}
              setPermanent={setEditPermanent}
              autoRenew={editAutoRenew}
              setAutoRenew={setEditAutoRenew}
              renewalPeriodDays={editRenewalPeriodDays}
              setRenewalPeriodDays={setEditRenewalPeriodDays}
              selectedNodeIds={editNodeIds}
              setSelectedNodeIds={setEditNodeIds}
              nodes={nodes}
              onSubmit={submitEdit}
              submitLabel={t("adminPlans.edit.submit")}
              onCancel={() => setEditingRow(null)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
