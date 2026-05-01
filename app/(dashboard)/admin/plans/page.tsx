"use client"

import { FormEvent, useEffect, useState } from "react"
import { MoreVertical, Pencil, Plus, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { useConfirm } from "@/components/confirm-provider"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"

type PlanRow = {
  id: number
  name: string
  traffic_limit_bytes: number
  duration_days: number
  up_mbps: number
  down_mbps: number
  auto_renew: number
  renewal_period_days: number | null
  node_ids: string | null
}

type NodeRow = { id: number; name: string }

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
function formatSpeed(mbps: number): string {
  if (!Number.isFinite(mbps) || mbps <= 0) return "不限"
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
  function toggle(nodeId: number, checked: boolean) {
    if (checked) {
      if (!value.includes(nodeId)) onChange([...value, nodeId])
    } else {
      onChange(value.filter((id) => id !== nodeId))
    }
  }

  if (nodes.length === 0) {
    return <p className="text-xs text-muted-foreground">暂无节点</p>
  }

  return (
    <div className="flex max-h-48 flex-col gap-2 overflow-auto rounded-md border p-3">
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
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="space-y-1">
        <Label>名称</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <Label>流量上限 (GB)</Label>
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
        <div className="flex items-center justify-between">
          <Label>时长 (天)</Label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <Switch
              checked={permanent}
              onCheckedChange={setPermanent}
              size="sm"
            />
            永久有效
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
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>上行限速 (Mbps)</Label>
          <Input
            type="number"
            min="0"
            step="1"
            value={upMbps}
            onChange={(e) => setUpMbps(e.target.value)}
            placeholder="0 = 不限"
          />
        </div>
        <div className="space-y-1">
          <Label>下行限速 (Mbps)</Label>
          <Input
            type="number"
            min="0"
            step="1"
            value={downMbps}
            onChange={(e) => setDownMbps(e.target.value)}
            placeholder="0 = 不限"
          />
        </div>
      </div>

      {/* 自动续订 */}
      <div className="space-y-3 rounded-md border p-3">
        <div className="flex items-center justify-between">
          <div>
            <Label>自动续订</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              开启后流量按周期自动重置，被封的订阅也会自动解封
            </p>
          </div>
          <Switch checked={autoRenew} onCheckedChange={setAutoRenew} />
        </div>
        {autoRenew && (
          <div className="space-y-1">
            <Label>续订周期 (天)</Label>
            <Input
              type="number"
              min="1"
              step="1"
              value={renewalPeriodDays}
              onChange={(e) => setRenewalPeriodDays(e.target.value)}
              placeholder="例如 30"
              required
            />
          </div>
        )}
      </div>

      <div className="space-y-1">
        <Label>可用节点</Label>
        <NodeCheckboxGroup
          nodes={nodes}
          value={selectedNodeIds}
          onChange={setSelectedNodeIds}
        />
      </div>
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

export default function AdminPlansPage() {
  const { confirm, alert } = useConfirm()
  const [rows, setRows] = useState<PlanRow[]>([])
  const [nodes, setNodes] = useState<NodeRow[]>([])

  // 创建面板
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [trafficLimitGb, setTrafficLimitGb] = useState("1")
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
  const [editDuration, setEditDuration] = useState("")
  const [editUpMbps, setEditUpMbps] = useState("0")
  const [editDownMbps, setEditDownMbps] = useState("0")
  const [editPermanent, setEditPermanent] = useState(false)
  const [editAutoRenew, setEditAutoRenew] = useState(false)
  const [editRenewalPeriodDays, setEditRenewalPeriodDays] = useState("30")
  const [editNodeIds, setEditNodeIds] = useState<number[]>([])

  async function load() {
    const [planRes, nodeRes] = await Promise.all([
      fetch("/api/admin/plans"),
      fetch("/api/admin/nodes"),
    ])
    const planJson = await planRes.json()
    const nodeJson = await nodeRes.json()
    if (planJson?.ok) setRows(planJson.data)
    if (nodeJson?.ok) setNodes(nodeJson.data)
  }

  useEffect(() => {
    let mounted = true

    void (async () => {
      const [planRes, nodeRes] = await Promise.all([
        fetch("/api/admin/plans"),
        fetch("/api/admin/nodes"),
      ])
      const planJson = await planRes.json()
      const nodeJson = await nodeRes.json()
      if (mounted && planJson?.ok) setRows(planJson.data)
      if (mounted && nodeJson?.ok) setNodes(nodeJson.data)
    })()

    return () => {
      mounted = false
    }
  }, [])

  function resetCreateForm() {
    setName("")
    setTrafficLimitGb("1")
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
      title: `删除套餐 #${row.id} (${row.name})？`,
      description: "仍有订阅关联该套餐时无法删除。",
      confirmText: "删除",
      variant: "destructive",
    })
    if (!ok) return

    const response = await fetch(`/api/admin/plans/${row.id}`, {
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

  function renderNodeNames(ids: number[]) {
    if (ids.length === 0) return "-"
    return ids
      .map((id) => {
        const node = nodes.find((n) => n.id === id)
        return node ? node.name : `#${id}`
      })
      .join("、")
  }

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 p-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">套餐管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {rows.length} 个套餐
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          添加套餐
        </Button>
      </div>

      {/* 套餐列表 */}
      {rows.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-sm">暂无套餐</p>
          <p className="mt-1 text-xs">点击右上角「添加套餐」创建第一个套餐</p>
        </Card>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>ID</TH>
              <TH>名称</TH>
              <TH>流量上限</TH>
              <TH>时长 (天)</TH>
              <TH>上/下行限速</TH>
              <TH>自动续订</TH>
              <TH>可用节点</TH>
              <TH className="w-12"></TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => {
              const ids = parseNodeIds(row.node_ids)
              return (
                <TR key={row.id}>
                  <TD>{row.id}</TD>
                  <TD className="font-medium">{row.name}</TD>
                  <TD>{formatBytes(row.traffic_limit_bytes)}</TD>
                  <TD>
                    {row.duration_days === 0 ? "永久" : row.duration_days}
                  </TD>
                  <TD className="text-xs">
                    {formatSpeed(row.up_mbps ?? 0)} /{" "}
                    {formatSpeed(row.down_mbps ?? 0)}
                  </TD>
                  <TD>
                    {row.auto_renew === 1 && row.renewal_period_days ? (
                      <Badge>每 {row.renewal_period_days} 天</Badge>
                    ) : (
                      <span className="text-muted-foreground">关闭</span>
                    )}
                  </TD>
                  <TD className="max-w-[280px] truncate text-xs">
                    {renderNodeNames(ids)}
                  </TD>
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
            <SheetTitle>添加套餐</SheetTitle>
            <SheetDescription>
              创建新的订阅套餐，设置流量、时长和限速。
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <PlanForm
              name={name}
              setName={setName}
              trafficLimitGb={trafficLimitGb}
              setTrafficLimitGb={setTrafficLimitGb}
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
              submitLabel="创建套餐"
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
              编辑套餐{" "}
              {editingRow ? `#${editingRow.id} (${editingRow.name})` : ""}
            </SheetTitle>
            <SheetDescription>修改套餐配置，保存后立即生效。</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <PlanForm
              name={editName}
              setName={setEditName}
              trafficLimitGb={editTraffic}
              setTrafficLimitGb={setEditTraffic}
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
              submitLabel="保存修改"
              onCancel={() => setEditingRow(null)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
