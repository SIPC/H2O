"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { MoreVertical, Pencil, Plus, Trash2 } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import { useConfirm } from "@/components/confirm-provider"
import { useI18n } from "@/components/i18n-provider"
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

const DIRECT_MODE_LABEL_KEYS: Record<DirectOutboundMode, string> = {
  auto: "routing.outbounds.directMode.auto",
  "64": "routing.outbounds.directMode.64",
  "46": "routing.outbounds.directMode.46",
  "6": "routing.outbounds.directMode.6",
  "4": "routing.outbounds.directMode.4",
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

function formatDefaultOutbound(
  config: HysteriaOutboundProfileConfig,
  t: (key: string, params?: Record<string, unknown>) => string
) {
  return (
    config.outbounds[0]?.name ?? t("routing.outbounds.defaultOutboundFallback")
  )
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
  const { t } = useI18n()

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
            {t("routing.common.basicInfo")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>{t("routing.common.name")}</Label>
            <Input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>{t("routing.common.remark")}</Label>
            <Textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
              placeholder={t("routing.common.optionalAdminOnly")}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-1">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base leading-none font-semibold">
              {t("routing.outbounds.listTitle")}
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
              {t("routing.outbounds.addOutbound")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {outbounds.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              {t("routing.outbounds.emptyOutbounds")}
            </div>
          ) : null}
          {outbounds.map((outbound, index) => (
            <Card key={outbound.id} className="border-muted">
              <CardHeader className="p-3 pb-0">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm">
                      {t("routing.outbounds.cardTitle", {
                        index: index + 1,
                        type:
                          index === 0
                            ? t("routing.outbounds.defaultOutbound")
                            : t("routing.outbounds.outbound"),
                      })}
                    </CardTitle>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {t("routing.outbounds.cardHelp")}
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
                      {t("routing.common.moveUp")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={index === outbounds.length - 1}
                      onClick={() => moveOutbound(index, 1)}
                    >
                      {t("routing.common.moveDown")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => duplicateOutbound(index)}
                    >
                      {t("routing.common.copy")}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        setOutbounds(outbounds.filter((_, i) => i !== index))
                      }
                    >
                      {t("routing.common.delete")}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label>{t("routing.outbounds.outboundId")}</Label>
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
                    <Label>{t("routing.outbounds.outboundName")}</Label>
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
                    <Label>{t("routing.common.type")}</Label>
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
                      <Label>{t("routing.outbounds.mode")}</Label>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {Object.entries(DIRECT_MODE_LABEL_KEYS).map(
                          ([value, labelKey]) => {
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
                                {t(labelKey)}
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
                          {
                            label: t("routing.outbounds.fastOpenOff"),
                            value: false,
                          },
                          {
                            label: t("routing.outbounds.fastOpenOn"),
                            value: true,
                          },
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
                      <Label>{t("routing.outbounds.bindIpv4")}</Label>
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
                        placeholder={t("routing.outbounds.bindIpv4Placeholder")}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("routing.outbounds.bindIpv6")}</Label>
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
                        placeholder={t("routing.outbounds.optionalPlaceholder")}
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label>{t("routing.outbounds.bindDevice")}</Label>
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
                        placeholder={t(
                          "routing.outbounds.bindDevicePlaceholder"
                        )}
                      />
                    </div>
                  </div>
                )}

                {outbound.type === "socks5" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1 sm:col-span-2">
                      <Label>{t("routing.outbounds.proxyAddress")}</Label>
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
                      <Label>{t("routing.common.username")}</Label>
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
                      <Label>{t("routing.common.password")}</Label>
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
                      <Label>{t("routing.outbounds.httpProxyUrl")}</Label>
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
                        <Label>{t("routing.outbounds.skipTlsVerify")}</Label>
                        <p className="text-[11px] text-muted-foreground">
                          {t("routing.outbounds.skipTlsVerifyHint")}
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
            {t("routing.common.cancel")}
          </Button>
        )}
      </div>
    </form>
  )
}

export default function AdminRoutingOutboundsPage() {
  const { confirm, alert } = useConfirm()
  const { t } = useI18n()
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
      toast.error(t("routing.common.createFailed"), {
        description: json?.error?.message ?? t("routing.common.retryLater"),
      })
      return
    }
    setCreateOpen(false)
    resetCreateForm()
    toast.success(t("routing.outbounds.createSuccess"))
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
      toast.error(t("routing.common.saveFailed"), {
        description: json?.error?.message ?? t("routing.common.retryLater"),
      })
      return
    }
    setEditingRow(null)
    toast.success(t("routing.outbounds.saveSuccess"))
    await load()
  }

  async function remove(row: OutboundProfileRow) {
    const ok = await confirm({
      title: t("routing.outbounds.deleteConfirmTitle", {
        id: row.id,
        name: row.name,
      }),
      description: t("routing.outbounds.deleteConfirmDescription"),
      confirmText: t("routing.common.delete"),
      variant: "destructive",
    })
    if (!ok) return
    const response = await fetch(`/api/admin/routing/outbounds/${row.id}`, {
      method: "DELETE",
    })
    const json = await response.json()
    if (!response.ok || !json.ok) {
      await alert({
        title: t("routing.common.deleteFailed"),
        description: json?.error?.message ?? t("routing.common.retryLater"),
        variant: "destructive",
      })
      return
    }
    toast.success(t("routing.outbounds.deleteSuccess"))
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
          <DataTableColumnHeader
            column={column}
            title={t("routing.common.name")}
          />
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
        meta: { label: t("routing.common.name") },
      },
      {
        id: "summary",
        header: t("routing.outbounds.summaryHeader"),
        cell: ({ row }) => {
          const config = parseConfig(row.original.config)
          return (
            <div className="space-y-1 text-xs">
              <div>
                {t("routing.outbounds.summaryCountDefault", {
                  count: config.outbounds.length,
                  defaultName: formatDefaultOutbound(config, t),
                })}
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
          <DataTableColumnHeader
            column={column}
            title={t("routing.outbounds.aclReferences")}
          />
        ),
        cell: ({ row }) => row.original.acl_count,
        meta: { label: t("routing.outbounds.aclReferences") },
      },
      {
        accessorKey: "bound_node_count",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("routing.outbounds.affectedNodes")}
          />
        ),
        cell: ({ row }) => row.original.bound_node_count,
        meta: { label: t("routing.outbounds.affectedNodes") },
      },
      {
        accessorKey: "updated_at",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("routing.common.updatedAt")}
          />
        ),
        cell: ({ row }) => formatDate(row.original.updated_at),
        meta: { label: t("routing.common.updatedAt") },
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
                {t("routing.common.edit")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void remove(row.original)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("routing.common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  )

  return (
    <div className="mx-auto flex w-full max-w-450 flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("routing.outbounds.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("routing.outbounds.description")}
          </p>
        </div>
        <Button
          onClick={() => {
            resetCreateForm()
            setCreateOpen(true)
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          {t("routing.outbounds.add")}
        </Button>
      </div>

      {rows.length === 0 && !loading ? (
        <Card className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-sm">{t("routing.outbounds.emptyTitle")}</p>
          <p className="mt-1 text-xs">
            {t("routing.outbounds.emptyDescription")}
          </p>
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
            <SheetTitle>{t("routing.outbounds.createTitle")}</SheetTitle>
            <SheetDescription>
              {t("routing.outbounds.createDescription")}
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
              submitLabel={t("routing.outbounds.createSubmit")}
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
                ? t("routing.outbounds.editTitle", {
                    id: editingRow.id,
                    name: editingRow.name,
                  })
                : t("routing.outbounds.editTitleFallback")}
            </SheetTitle>
            <SheetDescription>
              {t("routing.outbounds.editDescription")}
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
              submitLabel={t("routing.common.saveChanges")}
              onCancel={() => setEditingRow(null)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
