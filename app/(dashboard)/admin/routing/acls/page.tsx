"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { Link2, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import { useConfirm } from "@/components/confirm-provider"
import { DataTable, DataTableColumnHeader } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
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
import { Textarea } from "@/components/ui/textarea"
import type {
  AclProtocol,
  AclRule,
  AclRuleKind,
  HysteriaAclProfileConfig,
  HysteriaOutboundProfileConfig,
} from "@/lib/hysteria-routing-types"

type AclProfileRow = {
  id: number
  name: string
  remark: string | null
  outbound_profile_id: number | null
  outbound_profile_name: string | null
  config: string
  revision: number
  config_hash: string | null
  created_at: string
  updated_at: string
  bound_node_count: number
  bound_node_ids: string | null
}

type OutboundProfileRow = {
  id: number
  name: string
  config: string
}

type BindingNodeRow = {
  id: number
  name: string
  ip: string
  status: "enabled" | "disabled"
  acl_profile_id: number | null
  acl_profile_name: string | null
}

type AclDraft = AclRule

const NONE_VALUE = "__none__"
const BUILTIN_OUTBOUNDS = [
  { value: "direct", label: "direct（内置直连）" },
  { value: "reject", label: "reject（内置拒绝）" },
  { value: "default", label: "default（默认出口）" },
]

function newRuleDraft(index: number): AclDraft {
  return {
    id: `rule_${Date.now().toString(36)}_${index}`,
    kind: "rule",
    outbound: "direct",
    address: "all",
    protocol: "*",
    port: "*",
    enabled: true,
  }
}

function parseAclConfig(raw: string): HysteriaAclProfileConfig {
  try {
    const parsed = JSON.parse(raw) as HysteriaAclProfileConfig
    return { ...parsed, rules: Array.isArray(parsed.rules) ? parsed.rules : [] }
  } catch {
    return { rules: [] }
  }
}

function parseOutboundConfig(raw: string): HysteriaOutboundProfileConfig {
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

function buildOutboundOptions(
  outboundProfiles: OutboundProfileRow[],
  selectedOutboundProfileId: number | null
) {
  const profile = outboundProfiles.find(
    (item) => item.id === selectedOutboundProfileId
  )
  const config = profile
    ? parseOutboundConfig(profile.config)
    : { outbounds: [] }
  return [
    ...BUILTIN_OUTBOUNDS,
    ...config.outbounds.map((item) => ({
      value: item.id,
      label: `${item.name}（${item.type}）`,
    })),
  ]
}

function AclForm({
  profileName,
  setProfileName,
  remark,
  setRemark,
  outboundProfiles,
  outboundProfileId,
  setOutboundProfileId,
  rules,
  setRules,
  geoip,
  setGeoip,
  geosite,
  setGeosite,
  geoUpdateInterval,
  setGeoUpdateInterval,
  onSubmit,
  submitLabel,
  onCancel,
}: {
  profileName: string
  setProfileName: (value: string) => void
  remark: string
  setRemark: (value: string) => void
  outboundProfiles: OutboundProfileRow[]
  outboundProfileId: number | null
  setOutboundProfileId: (value: number | null) => void
  rules: AclDraft[]
  setRules: (value: AclDraft[]) => void
  geoip: string
  setGeoip: (value: string) => void
  geosite: string
  setGeosite: (value: string) => void
  geoUpdateInterval: string
  setGeoUpdateInterval: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  submitLabel: string
  onCancel?: () => void
}) {
  const outboundOptions = buildOutboundOptions(
    outboundProfiles,
    outboundProfileId
  )

  function updateRule(index: number, next: AclDraft) {
    setRules(rules.map((item, i) => (i === index ? next : item)))
  }

  function changeRuleKind(index: number, kind: AclRuleKind) {
    const current = rules[index]
    if (kind === "comment") {
      updateRule(index, {
        id: current.id,
        kind,
        comment: current.comment || "说明",
        enabled: current.enabled !== false,
      })
      return
    }
    if (kind === "raw") {
      updateRule(index, {
        id: current.id,
        kind,
        raw: current.raw || "direct(all)",
        enabled: current.enabled !== false,
      })
      return
    }
    updateRule(index, {
      id: current.id,
      kind,
      outbound: current.outbound || "direct",
      address: current.address || "all",
      protocol: current.protocol || "*",
      port: current.port || "*",
      hijackAddress: current.hijackAddress,
      enabled: current.enabled !== false,
    })
  }

  function moveRule(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= rules.length) return
    const next = [...rules]
    const [item] = next.splice(index, 1)
    next.splice(nextIndex, 0, item)
    setRules(next)
  }

  function addPreset(type: "reject_quic" | "reject_private" | "direct_all") {
    if (type === "reject_quic") {
      setRules([
        ...rules,
        {
          id: `rule_${Date.now().toString(36)}_quic`,
          kind: "rule",
          outbound: "reject",
          address: "all",
          protocol: "udp",
          port: "443",
          enabled: true,
        },
      ])
      return
    }
    if (type === "reject_private") {
      const now = Date.now().toString(36)
      setRules([
        ...rules,
        {
          id: `rule_${now}_p1`,
          kind: "rule",
          outbound: "reject",
          address: "10.0.0.0/8",
          protocol: "*",
          port: "*",
          enabled: true,
        },
        {
          id: `rule_${now}_p2`,
          kind: "rule",
          outbound: "reject",
          address: "172.16.0.0/12",
          protocol: "*",
          port: "*",
          enabled: true,
        },
        {
          id: `rule_${now}_p3`,
          kind: "rule",
          outbound: "reject",
          address: "192.168.0.0/16",
          protocol: "*",
          port: "*",
          enabled: true,
        },
        {
          id: `rule_${now}_p4`,
          kind: "rule",
          outbound: "reject",
          address: "fc00::/7",
          protocol: "*",
          port: "*",
          enabled: true,
        },
      ])
      return
    }
    setRules([
      ...rules,
      {
        id: `rule_${Date.now().toString(36)}_all`,
        kind: "rule",
        outbound: "direct",
        address: "all",
        protocol: "*",
        port: "*",
        enabled: true,
      },
    ])
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
            <Label>策略名称</Label>
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
          <div className="space-y-1">
            <Label>关联出站配置</Label>
            <Select
              value={
                outboundProfileId == null
                  ? NONE_VALUE
                  : String(outboundProfileId)
              }
              onValueChange={(value) =>
                setOutboundProfileId(
                  value === NONE_VALUE ? null : Number(value)
                )
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value={NONE_VALUE}>
                  不关联（仅使用内置 direct/reject/default）
                </SelectItem>
                {outboundProfiles.map((profile) => (
                  <SelectItem key={profile.id} value={String(profile.id)}>
                    #{profile.id} {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base leading-none font-semibold">
              ACL 规则
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addPreset("reject_quic")}
              >
                禁 QUIC
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addPreset("reject_private")}
              >
                禁私网
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addPreset("direct_all")}
              >
                直连 all
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  setRules([...rules, newRuleDraft(rules.length + 1)])
                }
              >
                <Plus className="h-4 w-4" />
                添加规则
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {rules.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              暂无 ACL 规则。未命中规则时 Hy2 使用默认出口。
            </div>
          ) : null}
          {rules.map((rule, index) => (
            <Card key={rule.id} className="border-muted">
              <CardHeader className="p-3 pb-0">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm">#{index + 1} 规则</CardTitle>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      从上到下匹配，首个命中规则生效。
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    <Switch
                      size="sm"
                      className="mr-2"
                      checked={rule.enabled !== false}
                      aria-label="切换规则启用状态"
                      title={
                        rule.enabled === false ? "规则已停用" : "规则已启用"
                      }
                      onCheckedChange={(checked) =>
                        updateRule(index, { ...rule, enabled: checked })
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={index === 0}
                      onClick={() => moveRule(index, -1)}
                    >
                      上移
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={index === rules.length - 1}
                      onClick={() => moveRule(index, 1)}
                    >
                      下移
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        setRules(rules.filter((_, i) => i !== index))
                      }
                    >
                      删除
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>规则 ID</Label>
                    <Input
                      value={rule.id}
                      onChange={(e) =>
                        updateRule(index, { ...rule, id: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>类型</Label>
                    <Select
                      value={rule.kind}
                      onValueChange={(value) =>
                        changeRuleKind(index, value as AclRuleKind)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="rule">可视化规则</SelectItem>
                        <SelectItem value="comment">注释</SelectItem>
                        <SelectItem value="raw">原始规则</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {rule.kind === "comment" && (
                  <div className="space-y-1">
                    <Label>注释</Label>
                    <Input
                      value={rule.comment ?? ""}
                      onChange={(e) =>
                        updateRule(index, { ...rule, comment: e.target.value })
                      }
                      placeholder="例如：流媒体分流"
                    />
                  </div>
                )}

                {rule.kind === "raw" && (
                  <div className="space-y-1">
                    <Label>原始 ACL 规则</Label>
                    <Input
                      value={rule.raw ?? ""}
                      onChange={(e) =>
                        updateRule(index, { ...rule, raw: e.target.value })
                      }
                      placeholder="例如：reject(all, udp/443)"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      适用于高级 ACL 规则。
                    </p>
                  </div>
                )}

                {rule.kind === "rule" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>出口</Label>
                      <Select
                        value={rule.outbound || "direct"}
                        onValueChange={(value) =>
                          updateRule(index, { ...rule, outbound: value })
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {outboundOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>地址</Label>
                      <Input
                        value={rule.address ?? ""}
                        onChange={(e) =>
                          updateRule(index, {
                            ...rule,
                            address: e.target.value,
                          })
                        }
                        placeholder="all / suffix:example.com / geoip:cn"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>协议</Label>
                      <Select
                        value={rule.protocol || "*"}
                        onValueChange={(value) =>
                          updateRule(index, {
                            ...rule,
                            protocol: value as AclProtocol,
                          })
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value="*">TCP + UDP</SelectItem>
                          <SelectItem value="tcp">TCP</SelectItem>
                          <SelectItem value="udp">UDP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>端口</Label>
                      <Input
                        value={rule.port ?? "*"}
                        onChange={(e) =>
                          updateRule(index, { ...rule, port: e.target.value })
                        }
                        placeholder="* / 443 / 20000-30000"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label>劫持地址</Label>
                      <Input
                        value={rule.hijackAddress ?? ""}
                        onChange={(e) =>
                          updateRule(index, {
                            ...rule,
                            hijackAddress: e.target.value,
                          })
                        }
                        placeholder="可选，仅允许 IPv4 / IPv6"
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            Geo 数据库（可选）
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>geoip 路径</Label>
            <Input
              value={geoip}
              onChange={(e) => setGeoip(e.target.value)}
              placeholder="留空由 Hy2 自动下载"
            />
          </div>
          <div className="space-y-1">
            <Label>geosite 路径</Label>
            <Input
              value={geosite}
              onChange={(e) => setGeosite(e.target.value)}
              placeholder="留空由 Hy2 自动下载"
            />
          </div>
          <div className="space-y-1">
            <Label>更新间隔</Label>
            <Input
              value={geoUpdateInterval}
              onChange={(e) => setGeoUpdateInterval(e.target.value)}
              placeholder="如 168h"
            />
          </div>
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

function NodeBindingEditor({
  nodes,
  selectedNodeIds,
  setSelectedNodeIds,
}: {
  nodes: BindingNodeRow[]
  selectedNodeIds: number[]
  setSelectedNodeIds: (value: number[]) => void
}) {
  function toggle(nodeId: number, checked: boolean) {
    if (checked) {
      if (!selectedNodeIds.includes(nodeId))
        setSelectedNodeIds([...selectedNodeIds, nodeId])
    } else {
      setSelectedNodeIds(selectedNodeIds.filter((id) => id !== nodeId))
    }
  }

  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无节点</p>
  }

  return (
    <div className="space-y-2">
      {nodes.map((node) => {
        const inputId = `bind-node-${node.id}`
        const checked = selectedNodeIds.includes(node.id)
        return (
          <label
            key={node.id}
            htmlFor={inputId}
            className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm"
          >
            <Checkbox
              id={inputId}
              checked={checked}
              onCheckedChange={(value) => toggle(node.id, value === true)}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  #{node.id} {node.name}
                </span>
                <Badge
                  className={
                    node.status === "enabled"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }
                >
                  {node.status === "enabled" ? "启用" : "禁用"}
                </Badge>
                {node.acl_profile_name && !checked ? (
                  <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-300">
                    当前绑定：{node.acl_profile_name}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                {node.ip}
              </p>
            </div>
          </label>
        )
      })}
    </div>
  )
}

export default function AdminRoutingAclsPage() {
  const { confirm, alert } = useConfirm()
  const [rows, setRows] = useState<AclProfileRow[]>([])
  const [outboundProfiles, setOutboundProfiles] = useState<
    OutboundProfileRow[]
  >([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<AclProfileRow | null>(null)
  const [bindingRow, setBindingRow] = useState<AclProfileRow | null>(null)
  const [bindingNodes, setBindingNodes] = useState<BindingNodeRow[]>([])
  const [bindingSelectedNodeIds, setBindingSelectedNodeIds] = useState<
    number[]
  >([])
  const [bindingLoading, setBindingLoading] = useState(false)

  const [name, setName] = useState("")
  const [remark, setRemark] = useState("")
  const [outboundProfileId, setOutboundProfileId] = useState<number | null>(
    null
  )
  const [rules, setRules] = useState<AclDraft[]>([])
  const [geoip, setGeoip] = useState("")
  const [geosite, setGeosite] = useState("")
  const [geoUpdateInterval, setGeoUpdateInterval] = useState("")

  const [editName, setEditName] = useState("")
  const [editRemark, setEditRemark] = useState("")
  const [editOutboundProfileId, setEditOutboundProfileId] = useState<
    number | null
  >(null)
  const [editRules, setEditRules] = useState<AclDraft[]>([])
  const [editGeoip, setEditGeoip] = useState("")
  const [editGeosite, setEditGeosite] = useState("")
  const [editGeoUpdateInterval, setEditGeoUpdateInterval] = useState("")

  async function load() {
    setLoading(true)
    try {
      const [aclRes, outboundRes] = await Promise.all([
        fetch("/api/admin/routing/acls"),
        fetch("/api/admin/routing/outbounds"),
      ])
      const aclJson = await aclRes.json()
      const outboundJson = await outboundRes.json()
      if (aclJson?.ok) setRows(aclJson.data)
      if (outboundJson?.ok) setOutboundProfiles(outboundJson.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true

    void (async () => {
      try {
        const [aclRes, outboundRes] = await Promise.all([
          fetch("/api/admin/routing/acls"),
          fetch("/api/admin/routing/outbounds"),
        ])
        const aclJson = await aclRes.json()
        const outboundJson = await outboundRes.json()
        if (mounted && aclJson?.ok) setRows(aclJson.data)
        if (mounted && outboundJson?.ok) setOutboundProfiles(outboundJson.data)
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
    setOutboundProfileId(null)
    setRules([newRuleDraft(1)])
    setGeoip("")
    setGeosite("")
    setGeoUpdateInterval("")
  }

  function buildConfig(
    currentRules: AclDraft[],
    currentGeoip: string,
    currentGeosite: string,
    currentGeoUpdateInterval: string
  ): HysteriaAclProfileConfig {
    return {
      rules: currentRules,
      geoip: currentGeoip.trim() || undefined,
      geosite: currentGeosite.trim() || undefined,
      geoUpdateInterval: currentGeoUpdateInterval.trim() || undefined,
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const response = await fetch("/api/admin/routing/acls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        remark,
        outboundProfileId,
        config: buildConfig(rules, geoip, geosite, geoUpdateInterval),
      }),
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
    toast.success("已创建 ACL 策略")
    await load()
  }

  function startEdit(row: AclProfileRow) {
    const config = parseAclConfig(row.config)
    setEditingRow(row)
    setEditName(row.name)
    setEditRemark(row.remark ?? "")
    setEditOutboundProfileId(row.outbound_profile_id)
    setEditRules(structuredClone(config.rules))
    setEditGeoip(config.geoip ?? "")
    setEditGeosite(config.geosite ?? "")
    setEditGeoUpdateInterval(config.geoUpdateInterval ?? "")
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingRow) return
    const response = await fetch(`/api/admin/routing/acls/${editingRow.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: editName,
        remark: editRemark,
        outboundProfileId: editOutboundProfileId,
        config: buildConfig(
          editRules,
          editGeoip,
          editGeosite,
          editGeoUpdateInterval
        ),
      }),
    })
    const json = await response.json()
    if (!response.ok || !json.ok) {
      toast.error("保存失败", {
        description: json?.error?.message ?? "请稍后重试",
      })
      return
    }
    setEditingRow(null)
    toast.success("已保存 ACL 策略")
    await load()
  }

  async function remove(row: AclProfileRow) {
    const ok = await confirm({
      title: `删除 ACL 策略 #${row.id} (${row.name})？`,
      description: "已绑定该策略的节点会同时解除绑定，并触发配置版本更新。",
      confirmText: "删除",
      variant: "destructive",
    })
    if (!ok) return
    const response = await fetch(`/api/admin/routing/acls/${row.id}`, {
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
    toast.success("已删除 ACL 策略")
    await load()
  }

  async function openBinding(row: AclProfileRow) {
    setBindingRow(row)
    setBindingLoading(true)
    try {
      const response = await fetch(`/api/admin/routing/acls/${row.id}/nodes`)
      const json = await response.json()
      if (!response.ok || !json.ok) {
        toast.error("加载失败", {
          description: json?.error?.message ?? "请稍后重试",
        })
        return
      }
      const nodes = json.data.nodes as BindingNodeRow[]
      setBindingNodes(nodes)
      setBindingSelectedNodeIds(
        nodes
          .filter((node) => node.acl_profile_id === row.id)
          .map((node) => node.id)
      )
    } finally {
      setBindingLoading(false)
    }
  }

  async function saveBinding() {
    if (!bindingRow) return
    const response = await fetch(
      `/api/admin/routing/acls/${bindingRow.id}/nodes`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeIds: bindingSelectedNodeIds }),
      }
    )
    const json = await response.json()
    if (!response.ok || !json.ok) {
      toast.error("保存失败", {
        description: json?.error?.message ?? "请稍后重试",
      })
      return
    }
    setBindingRow(null)
    toast.success("已保存节点绑定")
    await load()
  }

  const columns = useMemo<ColumnDef<AclProfileRow>[]>(
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
        id: "outbound",
        header: "出站配置",
        cell: ({ row }) =>
          row.original.outbound_profile_name ? (
            <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300">
              {row.original.outbound_profile_name}
            </Badge>
          ) : (
            <span className="text-muted-foreground">仅内置出口</span>
          ),
        enableSorting: false,
      },
      {
        id: "rules",
        header: "规则",
        cell: ({ row }) => {
          const config = parseAclConfig(row.original.config)
          return <span>{config.rules.length} 条</span>
        },
        enableSorting: false,
      },
      {
        accessorKey: "bound_node_count",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="绑定节点" />
        ),
        cell: ({ row }) => row.original.bound_node_count,
        meta: { label: "绑定节点" },
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
              <DropdownMenuItem onClick={() => void openBinding(row.original)}>
                <Link2 className="mr-2 h-4 w-4" />
                绑定节点
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
          <h1 className="text-2xl font-bold">ACL 策略</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            定义 Hysteria2 ACL 分流/拒绝规则，并绑定到节点。
          </p>
        </div>
        <Button
          onClick={() => {
            resetCreateForm()
            setCreateOpen(true)
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          添加 ACL 策略
        </Button>
      </div>

      {rows.length === 0 && !loading ? (
        <Card className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-sm">暂无 ACL 策略</p>
          <p className="mt-1 text-xs">点击右上角创建第一个策略</p>
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
        <SheetContent className="data-[side=right]:sm:max-w-4xl">
          <SheetHeader>
            <SheetTitle>添加 ACL 策略</SheetTitle>
            <SheetDescription>
              ACL 从上到下匹配；规则可引用内置出口或关联出站配置中的稳定 ID。
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <AclForm
              profileName={name}
              setProfileName={setName}
              remark={remark}
              setRemark={setRemark}
              outboundProfiles={outboundProfiles}
              outboundProfileId={outboundProfileId}
              setOutboundProfileId={setOutboundProfileId}
              rules={rules}
              setRules={setRules}
              geoip={geoip}
              setGeoip={setGeoip}
              geosite={geosite}
              setGeosite={setGeosite}
              geoUpdateInterval={geoUpdateInterval}
              setGeoUpdateInterval={setGeoUpdateInterval}
              onSubmit={create}
              submitLabel="创建策略"
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={editingRow !== null}
        onOpenChange={(open) => !open && setEditingRow(null)}
      >
        <SheetContent className="data-[side=right]:sm:max-w-4xl">
          <SheetHeader>
            <SheetTitle>
              {editingRow
                ? `编辑 ACL 策略 #${editingRow.id} (${editingRow.name})`
                : "编辑 ACL 策略"}
            </SheetTitle>
            <SheetDescription>
              保存后会自动 bump 所有绑定节点的 Agent 配置版本。
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <AclForm
              profileName={editName}
              setProfileName={setEditName}
              remark={editRemark}
              setRemark={setEditRemark}
              outboundProfiles={outboundProfiles}
              outboundProfileId={editOutboundProfileId}
              setOutboundProfileId={setEditOutboundProfileId}
              rules={editRules}
              setRules={setEditRules}
              geoip={editGeoip}
              setGeoip={setEditGeoip}
              geosite={editGeosite}
              setGeosite={setEditGeosite}
              geoUpdateInterval={editGeoUpdateInterval}
              setGeoUpdateInterval={setEditGeoUpdateInterval}
              onSubmit={submitEdit}
              submitLabel="保存修改"
              onCancel={() => setEditingRow(null)}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={bindingRow !== null}
        onOpenChange={(open) => !open && setBindingRow(null)}
      >
        <SheetContent className="data-[side=right]:sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>
              {bindingRow ? `绑定节点：${bindingRow.name}` : "绑定节点"}
            </SheetTitle>
            <SheetDescription>
              一个节点只能绑定一个 ACL
              策略；保存时会自动解除被其他策略占用的节点绑定。
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {bindingLoading ? (
              <p className="text-sm text-muted-foreground">加载中...</p>
            ) : (
              <NodeBindingEditor
                nodes={bindingNodes}
                selectedNodeIds={bindingSelectedNodeIds}
                setSelectedNodeIds={setBindingSelectedNodeIds}
              />
            )}
            <div className="mt-4 flex gap-2">
              <Button onClick={() => void saveBinding()}>保存绑定</Button>
              <Button variant="outline" onClick={() => setBindingRow(null)}>
                取消
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
