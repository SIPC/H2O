"use client"

import { FormEvent, useEffect, useState } from "react"
import { ChevronsUpDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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
        <Button variant="outline" role="combobox" className={cn("justify-between", className)}>
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

export default function AdminSubscriptionsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [userId, setUserId] = useState("")
  const [planId, setPlanId] = useState("")

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
      const response = await fetch("/api/admin/subscriptions")
      const json = await response.json()
      if (mounted && json?.ok) setRows(json.data)
    })()

    return () => {
      mounted = false
    }
  }, [])

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const response = await fetch("/api/admin/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: Number(userId), planId: Number(planId) }),
    })

    const json = await response.json()
    if (!response.ok || !json.ok) return

    setUserId("")
    setPlanId("")
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
    if (!window.confirm(`确认删除订阅 #${row.id}（用户 ${row.username} / 套餐 ${row.plan_name}）？`)) return

    const response = await fetch(`/api/admin/subscriptions/${row.id}`, { method: "DELETE" })
    const json = await response.json()
    if (!response.ok || !json.ok) return
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
              <Label>用户ID</Label>
              <Input value={userId} onChange={(e) => setUserId(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>套餐ID</Label>
              <Input value={planId} onChange={(e) => setPlanId(e.target.value)} required />
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
                  <TD>{row.used_traffic_bytes}</TD>
                  <TD>{row.traffic_limit_bytes}</TD>
                  <TD>{statusLabel[row.status] ?? row.status}</TD>
                  <TD>{new Date(row.expire_time).toLocaleString()}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-2">
                      {row.status === "blocked" ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => void patchSub(row.id, { status: "active" })}
                        >
                          解封
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => void patchSub(row.id, { status: "blocked" })}
                        >
                          封禁
                        </Button>
                      )}
                      <Button size="xs" variant="outline" onClick={() => openEdit(row)}>
                        编辑
                      </Button>
                      <Button size="xs" variant="destructive" onClick={() => void remove(row)}>
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
              编辑订阅 {editTarget ? `#${editTarget.id} (${editTarget.username})` : ""}
            </DialogTitle>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={submitEdit}>
            <div className="space-y-1">
              <Label>状态</Label>
              <StatusCombobox value={editStatus} onChange={setEditStatus} className="h-9 w-full" />
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
              <Input value={editUsed} onChange={(e) => setEditUsed(e.target.value)} required />
            </div>
            <div className="flex gap-2">
              <Button type="submit">保存</Button>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                取消
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
