"use client"

import { FormEvent, useEffect, useState } from "react"
import { ChevronsUpDown } from "lucide-react"

import { useConfirm } from "@/components/confirm-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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

export default function AdminSubscriptionsPage() {
  const { confirm, alert } = useConfirm()
  const [rows, setRows] = useState<Row[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [userId, setUserId] = useState<number | null>(null)
  const [planId, setPlanId] = useState<number | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Row | null>(null)
  const [editStatus, setEditStatus] = useState<SubscriptionStatus>("active")
  const [editExpire, setEditExpire] = useState("")
  const [editUsed, setEditUsed] = useState("0")

  async function load() {
    const response = await fetch("/api/admin/subscriptions")
    const json = await response.json()
    if (json?.ok) setRows(json.data)
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
      if (subJson?.ok) setRows(subJson.data)
      if (userJson?.ok) setUsers(userJson.data)
      if (planJson?.ok) setPlans(planJson.data)
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
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
                <TH>状态</TH>
                <TH>到期时间</TH>
                <TH>操作</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id}>
                  <TD>{row.id}</TD>
                  <TD>{row.username}</TD>
                  <TD>{row.plan_name}</TD>
                  <TD>{formatBytes(row.used_traffic_bytes)}</TD>
                  <TD>{formatBytes(row.traffic_limit_bytes)}</TD>
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
              ))}
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
