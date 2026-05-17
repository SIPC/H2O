"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { MoreVertical, Pencil, Plus, Trash2 } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import { useConfirm } from "@/components/confirm-provider"
import { DataTable, DataTableColumnHeader } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Textarea } from "@/components/ui/textarea"
import type {
  DirectOutboundMode,
  HysteriaOutboundItem,
  HysteriaOutboundProfileConfig,
  HysteriaOutboundType,
} from "@/lib/hysteria-routing-types"

type OutboundProfileRow = {
  id: number
  name: string
  remark: string | null
  config: string
  revision: number
  config_hash: string | null
  created_at: string
  updated_at: string
  acl_count: number
  bound_node_count: number
}

type OutboundDraft = HysteriaOutboundItem

const DIRECT_MODE_LABEL: Record<DirectOutboundMode, string> = {
  auto: "自动双栈",
  "64": "优先 IPv6",
  "46": "优先 IPv4",
  "6": "仅 IPv6",
  "4": "仅 IPv4",
}

function newOutboundDraft(index: number): OutboundDraft {
  const id = `outbound_${Date.now().toString(36)}_${index}`
  return {
    id,
    name: `proxy_${index}`,
    type: "direct",
    direct: { mode: "auto", fastOpen: false },
  }
}

function parseConfig(raw: string): HysteriaOutboundProfileConfig {
  try {
    const parsed = JSON.parse(raw) as HysteriaOutboundProfileConfig
    return {
      outbounds: Array.isArray(parsed.outbounds) ? parsed.outbounds : [],
    }
  } catch {
    return { outbounds: [] }
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-"
  return value.replace("T", " ").slice(0, 19)
}

function formatDefaultOutbound(config: HysteriaOutboundProfileConfig) {
  return config.outbounds[0]?.name ?? "内置 direct"
}

function OutboundForm({
  profileName,
  setProfileName,
  remark,
  setRemark,
  outbounds,
  setOutbounds,
  onSubmit,
  submitLabel,
  onCancel,
}: {
  profileName: string
  setProfileName: (value: string) => void
  remark: string
  setRemark: (value: string) => void
  outbounds: OutboundDraft[]
  setOutbounds: (value: OutboundDraft[]) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  submitLabel: string
  onCancel?: () => void
}) {
  function updateOutbound(index: number, next: OutboundDraft) {
    setOutbounds(outbounds.map((item, i) => (i === index ? next : item)))
  }

  function changeType(index: number, type: HysteriaOutboundType) {
    const current = outbounds[index]
    const next: OutboundDraft = { ...current, type }
    if (type === "direct") {
      next.direct = next.direct ?? { mode: "auto", fastOpen: false }
      delete next.socks5
      delete next.http
    }
    if (type === "socks5") {
      next.socks5 = next.socks5 ?? { addr: "127.0.0.1:1080" }
      delete next.direct
      delete next.http
    }
    if (type === "http") {
      next.http = next.http ?? { url: "http://127.0.0.1:8080", insecure: false }
      delete next.direct
      delete next.socks5
    }
    updateOutbound(index, next)
  }

  function moveOutbound(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= outbounds.length) return
    const next = [...outbounds]
    const [item] = next.splice(index, 1)
    next.splice(nextIndex, 0, item)
    setOutbounds(next)
  }

  function duplicateOutbound(index: number) {
    const current = outbounds[index]
    const copy: OutboundDraft = {
      ...structuredClone(current),
      id: `${current.id}_copy_${Date.now().toString(36)}`,
      name: `${current.name}_copy`,
    }
    const next = [...outbounds]
    next.splice(index + 1, 0, copy)
    setOutbounds(next)
  }

  return (
    <form
      className="space-y-4 **:data-[slot=label]:text-xs"
      onSubmit={onSubmit}
    >
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            基础信息
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>配置组名称</Label>
            <Input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>备注</Label>
            <Textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
              placeholder="可选，仅管理员可见"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-1">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base leading-none font-semibold">
              出站列表
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setOutbounds([
                  ...outbounds,
                  newOutboundDraft(outbounds.length + 1),
                ])
              }
            >
              <Plus className="h-4 w-4" />
              添加出站
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {outbounds.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              暂无自定义出站。未绑定 ACL 时 Hy2 会使用内置 direct。
            </div>
          ) : null}
          {outbounds.map((outbound, index) => (
            <Card key={outbound.id} className="border-muted">
              <CardHeader className="p-3 pb-0">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm">
                      #{index + 1} {index === 0 ? "默认出口" : "出站"}
                    </CardTitle>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      ACL 规则引用稳定 ID；可安全修改实际名称。
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={index === 0}
                      onClick={() => moveOutbound(index, -1)}
                    >
                      上移
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={index === outbounds.length - 1}
                      onClick={() => moveOutbound(index, 1)}
                    >
                      下移
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => duplicateOutbound(index)}
                    >
                      复制
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        setOutbounds(outbounds.filter((_, i) => i !== index))
                      }
                    >
                      删除
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label>稳定 ID</Label>
                    <Input
                      value={outbound.id}
                      onChange={(e) =>
                        updateOutbound(index, {
                          ...outbound,
                          id: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Hy2 出站名称</Label>
                    <Input
                      value={outbound.name}
                      onChange={(e) =>
                        updateOutbound(index, {
                          ...outbound,
                          name: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>类型</Label>
                    <Select
                      value={outbound.type}
                      onValueChange={(value) =>
                        changeType(index, value as HysteriaOutboundType)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="direct">Direct</SelectItem>
                        <SelectItem value="socks5">SOCKS5</SelectItem>
                        <SelectItem value="http">HTTP/HTTPS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {outbound.type === "direct" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>出站模式</Label>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {Object.entries(DIRECT_MODE_LABEL).map(
                          ([value, label]) => {
                            const checked =
                              (outbound.direct?.mode ?? "auto") === value
                            return (
                              <Button
                                key={value}
                                type="button"
                                variant={checked ? "default" : "outline"}
                                size="sm"
                                className="justify-center"
                                onClick={() =>
                                  updateOutbound(index, {
                                    ...outbound,
                                    direct: {
                                      ...(outbound.direct ?? { mode: "auto" }),
                                      mode: value as DirectOutboundMode,
                                    },
                                  })
                                }
                              >
                                {label}
                              </Button>
                            )
                          }
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>TCP Fast Open</Label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {[
                          { label: "关闭", value: false },
                          { label: "开启", value: true },
                        ].map((option) => {
                          const checked =
                            (outbound.direct?.fastOpen === true) ===
                            option.value
                          return (
                            <Button
                              key={option.label}
                              type="button"
                              variant={checked ? "default" : "outline"}
                              size="sm"
                              className="justify-center"
                              onClick={() =>
                                updateOutbound(index, {
                                  ...outbound,
                                  direct: {
                                    ...(outbound.direct ?? { mode: "auto" }),
                                    fastOpen: option.value,
                                  },
                                })
                              }
                            >
                              {option.label}
                            </Button>
                          )
                        })}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>绑定 IPv4</Label>
                      <Input
                        value={outbound.direct?.bindIPv4 ?? ""}
                        onChange={(e) =>
                          updateOutbound(index, {
                            ...outbound,
                            direct: {
                              ...(outbound.direct ?? { mode: "auto" }),
                              bindIPv4: e.target.value,
                            },
                          })
                        }
                        placeholder="可选，如 192.0.2.10"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>绑定 IPv6</Label>
                      <Input
                        value={outbound.direct?.bindIPv6 ?? ""}
                        onChange={(e) =>
                          updateOutbound(index, {
                            ...outbound,
                            direct: {
                              ...(outbound.direct ?? { mode: "auto" }),
                              bindIPv6: e.target.value,
                            },
                          })
                        }
                        placeholder="可选"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label>绑定网卡</Label>
                      <Input
                        value={outbound.direct?.bindDevice ?? ""}
                        onChange={(e) =>
                          updateOutbound(index, {
                            ...outbound,
                            direct: {
                              ...(outbound.direct ?? { mode: "auto" }),
                              bindDevice: e.target.value,
                            },
                          })
                        }
                        placeholder="可选，与绑定 IP 互斥，如 eth0"
                      />
                    </div>
                  </div>
                )}

                {outbound.type === "socks5" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1 sm:col-span-2">
                      <Label>代理地址</Label>
                      <Input
                        value={outbound.socks5?.addr ?? ""}
                        onChange={(e) =>
                          updateOutbound(index, {
                            ...outbound,
                            socks5: {
                              ...(outbound.socks5 ?? { addr: "" }),
                              addr: e.target.value,
                            },
                          })
                        }
                        placeholder="host:port"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>用户名</Label>
                      <Input
                        value={outbound.socks5?.username ?? ""}
                        onChange={(e) =>
                          updateOutbound(index, {
                            ...outbound,
                            socks5: {
                              ...(outbound.socks5 ?? { addr: "" }),
                              username: e.target.value,
                            },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>密码</Label>
                      <Input
                        type="password"
                        value={outbound.socks5?.password ?? ""}
                        onChange={(e) =>
                          updateOutbound(index, {
                            ...outbound,
                            socks5: {
                              ...(outbound.socks5 ?? { addr: "" }),
                              password: e.target.value,
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                )}

                {outbound.type === "http" && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label>HTTP/HTTPS 代理 URL</Label>
                      <Input
                        value={outbound.http?.url ?? ""}
                        onChange={(e) =>
                          updateOutbound(index, {
                            ...outbound,
                            http: {
                              ...(outbound.http ?? { url: "" }),
                              url: e.target.value,
                            },
                          })
                        }
                        placeholder="http://user:pass@example.com:8080"
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <Label>跳过 TLS 校验</Label>
                        <p className="text-[11px] text-muted-foreground">
                          仅 HTTPS 代理需要时开启
                        </p>
                      </div>
                      <Switch
                        checked={outbound.http?.insecure === true}
                        onCheckedChange={(checked) =>
                          updateOutbound(index, {
                            ...outbound,
                            http: {
                              ...(outbound.http ?? { url: "" }),
                              insecure: checked,
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
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

export default function AdminRoutingOutboundsPage() {
  const { confirm, alert } = useConfirm()
  const [rows, setRows] = useState<OutboundProfileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<OutboundProfileRow | null>(null)

  const [name, setName] = useState("")
  const [remark, setRemark] = useState("")
  const [outbounds, setOutbounds] = useState<OutboundDraft[]>([])

  const [editName, setEditName] = useState("")
  const [editRemark, setEditRemark] = useState("")
  const [editOutbounds, setEditOutbounds] = useState<OutboundDraft[]>([])

  async function load() {
    setLoading(true)
    try {
      const response = await fetch("/api/admin/routing/outbounds")
      const json = await response.json()
      if (json?.ok) setRows(json.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true

    void (async () => {
      try {
        const response = await fetch("/api/admin/routing/outbounds")
        const json = await response.json()
        if (mounted && json?.ok) setRows(json.data)
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
    setRemark("")
    setOutbounds([newOutboundDraft(1)])
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const response = await fetch("/api/admin/routing/outbounds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, remark, config: { outbounds } }),
    })
    const json = await response.json()
    if (!response.ok || !json.ok) {
      toast.error("创建失败", {
        description: json?.error?.message ?? "请稍后重试",
      })
      return
    }
    setCreateOpen(false)
    resetCreateForm()
    toast.success("已创建出站配置")
    await load()
  }

  function startEdit(row: OutboundProfileRow) {
    const config = parseConfig(row.config)
    setEditingRow(row)
    setEditName(row.name)
    setEditRemark(row.remark ?? "")
    setEditOutbounds(structuredClone(config.outbounds))
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingRow) return
    const response = await fetch(
      `/api/admin/routing/outbounds/${editingRow.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: editName,
          remark: editRemark,
          config: { outbounds: editOutbounds },
        }),
      }
    )
    const json = await response.json()
    if (!response.ok || !json.ok) {
      toast.error("保存失败", {
        description: json?.error?.message ?? "请稍后重试",
      })
      return
    }
    setEditingRow(null)
    toast.success("已保存出站配置")
    await load()
  }

  async function remove(row: OutboundProfileRow) {
    const ok = await confirm({
      title: `删除出站配置 #${row.id} (${row.name})？`,
      description: "仍有 ACL 策略引用该配置时无法删除。",
      confirmText: "删除",
      variant: "destructive",
    })
    if (!ok) return
    const response = await fetch(`/api/admin/routing/outbounds/${row.id}`, {
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
    toast.success("已删除出站配置")
    await load()
  }

  const columns = useMemo<ColumnDef<OutboundProfileRow>[]>(
    () => [
      {
        accessorKey: "id",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="ID" />
        ),
        meta: { label: "ID" },
      },
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="名称" />
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
        meta: { label: "名称" },
      },
      {
        id: "summary",
        header: "出站摘要",
        cell: ({ row }) => {
          const config = parseConfig(row.original.config)
          return (
            <div className="space-y-1 text-xs">
              <div>
                共 {config.outbounds.length} 个，默认：
                {formatDefaultOutbound(config)}
              </div>
              <div className="flex flex-wrap gap-1">
                {config.outbounds.slice(0, 4).map((item) => (
                  <Badge key={item.id} className="text-[10px]">
                    {item.name} · {item.type}
                  </Badge>
                ))}
                {config.outbounds.length > 4 && (
                  <Badge className="border bg-transparent">
                    +{config.outbounds.length - 4}
                  </Badge>
                )}
              </div>
            </div>
          )
        },
        enableSorting: false,
      },
      {
        accessorKey: "acl_count",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="引用 ACL" />
        ),
        cell: ({ row }) => row.original.acl_count,
        meta: { label: "引用 ACL" },
      },
      {
        accessorKey: "bound_node_count",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="影响节点" />
        ),
        cell: ({ row }) => row.original.bound_node_count,
        meta: { label: "影响节点" },
      },
      {
        accessorKey: "updated_at",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="更新时间" />
        ),
        cell: ({ row }) => formatDate(row.original.updated_at),
        meta: { label: "更新时间" },
      },
      {
        id: "actions",
        header: "",
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
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">出站配置</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            定义可复用的 Hysteria2 outbounds，供 ACL 策略引用。
          </p>
        </div>
        <Button
          onClick={() => {
            resetCreateForm()
            setCreateOpen(true)
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          添加出站配置
        </Button>
      </div>

      {rows.length === 0 && !loading ? (
        <Card className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-sm">暂无出站配置</p>
          <p className="mt-1 text-xs">点击右上角创建第一个出站配置组</p>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          defaultPageSize={20}
          pageSizeOptions={[10, 20, 50]}
          loading={loading}
        />
      )}

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent className="data-[side=right]:sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>添加出站配置</SheetTitle>
            <SheetDescription>
              配置 direct / SOCKS5 / HTTP 出站。第一个出站会作为 Hy2 默认出口。
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <OutboundForm
              profileName={name}
              setProfileName={setName}
              remark={remark}
              setRemark={setRemark}
              outbounds={outbounds}
              setOutbounds={setOutbounds}
              onSubmit={create}
              submitLabel="创建配置"
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={editingRow !== null}
        onOpenChange={(open) => !open && setEditingRow(null)}
      >
        <SheetContent className="data-[side=right]:sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>
              {editingRow
                ? `编辑出站配置 #${editingRow.id} (${editingRow.name})`
                : "编辑出站配置"}
            </SheetTitle>
            <SheetDescription>
              保存后会自动 bump 所有关联节点的 Agent 配置版本。
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <OutboundForm
              profileName={editName}
              setProfileName={setEditName}
              remark={editRemark}
              setRemark={setEditRemark}
              outbounds={editOutbounds}
              setOutbounds={setEditOutbounds}
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
