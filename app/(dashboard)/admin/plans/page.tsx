"use client"

import { FormEvent, useEffect, useState } from "react"

import { useConfirm } from "@/components/confirm-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"

type PlanRow = {
  id: number
  name: string
  traffic_limit_bytes: number
  duration_days: number
  up_mbps: number
  down_mbps: number
  node_ids: string | null
}

type NodeRow = { id: number; name: string }

// 前端统一用 GB 展示，提交 / 存库仍走 bytes
const BYTES_PER_GB = 1024 ** 3

function bytesToGbString(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0"
  // 去掉无意义的末尾 0，整数 GB 直接显示整数
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

export default function AdminPlansPage() {
  const { confirm, alert } = useConfirm()
  const [rows, setRows] = useState<PlanRow[]>([])
  const [nodes, setNodes] = useState<NodeRow[]>([])

  const [name, setName] = useState("")
  const [trafficLimitGb, setTrafficLimitGb] = useState("1")
  const [durationDays, setDurationDays] = useState("30")
  const [upMbps, setUpMbps] = useState("0")
  const [downMbps, setDownMbps] = useState("0")
  const [selectedNodeIds, setSelectedNodeIds] = useState<number[]>([])

  const [editOpen, setEditOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<PlanRow | null>(null)
  const [editName, setEditName] = useState("")
  const [editTraffic, setEditTraffic] = useState("")
  const [editDuration, setEditDuration] = useState("")
  const [editUpMbps, setEditUpMbps] = useState("0")
  const [editDownMbps, setEditDownMbps] = useState("0")
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

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const response = await fetch("/api/admin/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        trafficLimitBytes: Math.round(Number(trafficLimitGb) * BYTES_PER_GB),
        durationDays: Number(durationDays),
        upMbps: Math.max(0, Math.floor(Number(upMbps))),
        downMbps: Math.max(0, Math.floor(Number(downMbps))),
        nodeIds: selectedNodeIds,
      }),
    })

    const json = await response.json()
    if (!response.ok || !json.ok) return

    setName("")
    setTrafficLimitGb("1")
    setDurationDays("30")
    setUpMbps("0")
    setDownMbps("0")
    setSelectedNodeIds([])
    await load()
  }

  function openEdit(row: PlanRow) {
    setEditTarget(row)
    setEditName(row.name)
    setEditTraffic(bytesToGbString(row.traffic_limit_bytes))
    setEditDuration(String(row.duration_days))
    setEditUpMbps(String(row.up_mbps ?? 0))
    setEditDownMbps(String(row.down_mbps ?? 0))
    setEditNodeIds(parseNodeIds(row.node_ids))
    setEditOpen(true)
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editTarget) return

    const response = await fetch(`/api/admin/plans/${editTarget.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: editName,
        trafficLimitBytes: Math.round(Number(editTraffic) * BYTES_PER_GB),
        durationDays: Number(editDuration),
        upMbps: Math.max(0, Math.floor(Number(editUpMbps))),
        downMbps: Math.max(0, Math.floor(Number(editDownMbps))),
        nodeIds: editNodeIds,
      }),
    })

    const json = await response.json()
    if (!response.ok || !json.ok) return

    setEditOpen(false)
    setEditTarget(null)
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
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>套餐管理</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="mb-4 grid gap-3 md:grid-cols-3" onSubmit={create}>
            <div className="space-y-1">
              <Label>名称</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>流量上限(GB)</Label>
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
              <Label>时长(天)</Label>
              <Input
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>上行限速(Mbps，0 不限)</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={upMbps}
                onChange={(e) => setUpMbps(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>下行限速(Mbps，0 不限)</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={downMbps}
                onChange={(e) => setDownMbps(e.target.value)}
              />
            </div>
            <div className="space-y-1 md:col-span-3">
              <Label>可用节点（勾选的节点可被此套餐使用）</Label>
              <NodeCheckboxGroup
                nodes={nodes}
                value={selectedNodeIds}
                onChange={setSelectedNodeIds}
              />
            </div>
            <div className="md:col-span-3">
              <Button type="submit">创建套餐</Button>
            </div>
          </form>

          <Table>
            <THead>
              <TR>
                <TH>ID</TH>
                <TH>名称</TH>
                <TH>流量上限</TH>
                <TH>时长(天)</TH>
                <TH>上/下行限速</TH>
                <TH>可用节点</TH>
                <TH>操作</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => {
                const ids = parseNodeIds(row.node_ids)
                return (
                  <TR key={row.id}>
                    <TD>{row.id}</TD>
                    <TD>{row.name}</TD>
                    <TD>{formatBytes(row.traffic_limit_bytes)}</TD>
                    <TD>{row.duration_days}</TD>
                    <TD className="text-xs">
                      {formatSpeed(row.up_mbps ?? 0)} /{" "}
                      {formatSpeed(row.down_mbps ?? 0)}
                    </TD>
                    <TD className="max-w-[280px] truncate text-xs">
                      {renderNodeNames(ids)}
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-2">
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
              编辑套餐{" "}
              {editTarget ? `#${editTarget.id} (${editTarget.name})` : ""}
            </DialogTitle>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={submitEdit}>
            <div className="space-y-1">
              <Label>名称</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>流量上限(GB)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={editTraffic}
                onChange={(e) => setEditTraffic(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>时长(天)</Label>
              <Input
                value={editDuration}
                onChange={(e) => setEditDuration(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>上行限速(Mbps，0 不限)</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={editUpMbps}
                  onChange={(e) => setEditUpMbps(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>下行限速(Mbps，0 不限)</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={editDownMbps}
                  onChange={(e) => setEditDownMbps(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>可用节点</Label>
              <NodeCheckboxGroup
                nodes={nodes}
                value={editNodeIds}
                onChange={setEditNodeIds}
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
