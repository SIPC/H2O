"use client"

import { FormEvent, useEffect, useState } from "react"

import { useConfirm } from "@/components/confirm-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"

type NodeRow = {
  id: number
  name: string
  ip: string
  port: number
  auth_path: string
  status: "enabled" | "disabled"
  sni: string | null
  obfs: string | null
  obfs_password: string | null
  insecure: 0 | 1
  pin_sha256: string | null
  last_report_at: string | null
  online_count: number | null
}

// 节点心跳判定：最近 3 分钟内上报视为"在线"
const FRESH_THRESHOLD_MS = 3 * 60 * 1000

function parseSqliteUtc(value: string): Date {
  return new Date(value.endsWith("Z") ? value : `${value}Z`)
}

function isFresh(lastReportAt: string | null): boolean {
  if (!lastReportAt) return false
  return Date.now() - parseSqliteUtc(lastReportAt).getTime() < FRESH_THRESHOLD_MS
}

export default function AdminNodesPage() {
  const { confirm, alert } = useConfirm()
  const [rows, setRows] = useState<NodeRow[]>([])

  // 创建表单
  const [name, setName] = useState("")
  const [ip, setIp] = useState("")
  const [port, setPort] = useState("443")
  const [sni, setSni] = useState("")
  const [obfs, setObfs] = useState("")
  const [obfsPassword, setObfsPassword] = useState("")
  const [insecure, setInsecure] = useState(false)
  const [pinSha256, setPinSha256] = useState("")

  // 编辑表单
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [editIp, setEditIp] = useState("")
  const [editPort, setEditPort] = useState("443")
  const [editSni, setEditSni] = useState("")
  const [editObfs, setEditObfs] = useState("")
  const [editObfsPassword, setEditObfsPassword] = useState("")
  const [editInsecure, setEditInsecure] = useState(false)
  const [editPinSha256, setEditPinSha256] = useState("")

  async function load() {
    const response = await fetch("/api/admin/nodes")
    const json = await response.json()
    if (json?.ok) setRows(json.data)
  }

  useEffect(() => {
    let mounted = true

    void (async () => {
      const response = await fetch("/api/admin/nodes")
      const json = await response.json()
      if (mounted && json?.ok) setRows(json.data)
    })()

    return () => {
      mounted = false
    }
  }, [])

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const response = await fetch("/api/admin/nodes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        ip,
        port: Number(port),
        sni: sni || null,
        obfs: obfs || null,
        obfsPassword: obfsPassword || null,
        insecure,
        pinSha256: pinSha256 || null,
      }),
    })

    const json = await response.json()
    if (!response.ok || !json.ok) return

    setName("")
    setIp("")
    setPort("443")
    setSni("")
    setObfs("")
    setObfsPassword("")
    setInsecure(false)
    setPinSha256("")
    await load()
  }

  async function updateNode(nodeId: number, body: Record<string, unknown>) {
    const response = await fetch(`/api/admin/nodes/${nodeId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })

    const json = await response.json()
    if (!response.ok || !json.ok) return
    await load()
  }

  async function removeNode(row: NodeRow) {
    const ok = await confirm({
      title: `删除节点 #${row.id} (${row.name})？`,
      description: "关联套餐将自动解绑；已有订阅的历史流量不会重置。",
      confirmText: "删除",
      variant: "destructive",
    })
    if (!ok) return

    const response = await fetch(`/api/admin/nodes/${row.id}`, {
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
    if (editingId === row.id) setEditingId(null)
    await load()
  }

  function startEdit(row: NodeRow) {
    setEditingId(row.id)
    setEditName(row.name)
    setEditIp(row.ip)
    setEditPort(String(row.port))
    setEditSni(row.sni ?? "")
    setEditObfs(row.obfs ?? "")
    setEditObfsPassword(row.obfs_password ?? "")
    setEditInsecure(row.insecure === 1)
    setEditPinSha256(row.pin_sha256 ?? "")
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (editingId == null) return

    await updateNode(editingId, {
      name: editName,
      ip: editIp,
      port: Number(editPort),
      sni: editSni,
      obfs: editObfs,
      obfsPassword: editObfsPassword,
      insecure: editInsecure,
      pinSha256: editPinSha256,
    })

    setEditingId(null)
  }

  // 弹出 agent 部署配置片段，并尝试复制到剪贴板
  async function showAgentConfig(row: NodeRow) {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://h2o.example.com"
    const config = JSON.stringify(
      {
        h2o_url: origin,
        auth_path: row.auth_path,
        hysteria_stats_url: "http://127.0.0.1:25300",
        hysteria_stats_secret: "<填入 Hy2 config 的 trafficStats.secret>",
        interval_seconds: 120,
      },
      null,
      2
    )

    let copied = false
    try {
      await navigator.clipboard.writeText(config)
      copied = true
    } catch {
      copied = false
    }

    await alert({
      title: `${row.name} \u7684 agent \u914d\u7f6e${copied ? "\uff08\u5df2\u590d\u5236\uff09" : ""}`,
      description: (
        <pre className="bg-muted max-h-[400px] overflow-auto rounded p-3 font-mono text-xs whitespace-pre-wrap">
          {config}
        </pre>
      ),
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>节点管理</CardTitle>
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
              <Label>IP / 域名</Label>
              <Input
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>端口</Label>
              <Input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>SNI</Label>
              <Input
                value={sni}
                onChange={(e) => setSni(e.target.value)}
                placeholder="可选，TLS SNI"
              />
            </div>
            <div className="space-y-1">
              <Label>Obfs 类型</Label>
              <Input
                value={obfs}
                onChange={(e) => setObfs(e.target.value)}
                placeholder="可选，如 salamander"
              />
            </div>
            <div className="space-y-1">
              <Label>Obfs 密码</Label>
              <Input
                value={obfsPassword}
                onChange={(e) => setObfsPassword(e.target.value)}
                placeholder="可选"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>pinSHA256</Label>
              <Input
                value={pinSha256}
                onChange={(e) => setPinSha256(e.target.value)}
                placeholder="可选，自签证书的 SHA-256 指纹"
              />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={insecure}
                  onCheckedChange={(next) => setInsecure(next === true)}
                />
                <span>跳过证书校验 (insecure)</span>
              </label>
            </div>
            <div className="md:col-span-3">
              <Button type="submit">创建节点</Button>
            </div>
          </form>

          <Table>
            <THead>
              <TR>
                <TH>ID</TH>
                <TH>名称</TH>
                <TH>IP</TH>
                <TH>端口</TH>
                <TH>状态</TH>
                <TH>最后心跳</TH>
                <TH>在线</TH>
                <TH>SNI</TH>
                <TH>Obfs</TH>
                <TH>Auth Path</TH>
                <TH>操作</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => {
                const fresh = isFresh(row.last_report_at)
                return (
                  <TR key={row.id}>
                    <TD>{row.id}</TD>
                    <TD>{row.name}</TD>
                    <TD>{row.ip}</TD>
                    <TD>{row.port}</TD>
                    <TD>{row.status === "enabled" ? "启用" : "禁用"}</TD>
                    <TD
                      className={
                        row.last_report_at
                          ? fresh
                            ? "text-xs text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground text-xs"
                          : "text-muted-foreground text-xs"
                      }
                    >
                      {row.last_report_at
                        ? parseSqliteUtc(row.last_report_at).toLocaleString()
                        : "-"}
                    </TD>
                    <TD
                      className={
                        fresh
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground"
                      }
                    >
                      {row.online_count ?? 0}
                    </TD>
                    <TD className="text-xs">{row.sni ?? "-"}</TD>
                    <TD className="text-xs">{row.obfs ?? "-"}</TD>
                    <TD className="max-w-[200px] truncate font-mono text-xs">
                      {row.auth_path}
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => startEdit(row)}
                        >
                          编辑
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => void showAgentConfig(row)}
                        >
                          Agent 配置
                        </Button>
                        {row.status === "enabled" ? (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() =>
                              void updateNode(row.id, { status: "disabled" })
                            }
                          >
                            禁用
                          </Button>
                        ) : (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() =>
                              void updateNode(row.id, { status: "enabled" })
                            }
                          >
                            启用
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="destructive"
                          onClick={() => void removeNode(row)}
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

      {editingId != null ? (
        <Card>
          <CardHeader>
            <CardTitle>编辑节点 #{editingId}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 md:grid-cols-3" onSubmit={submitEdit}>
              <div className="space-y-1">
                <Label>名称</Label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>IP / 域名</Label>
                <Input
                  value={editIp}
                  onChange={(e) => setEditIp(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>端口</Label>
                <Input
                  value={editPort}
                  onChange={(e) => setEditPort(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>SNI</Label>
                <Input
                  value={editSni}
                  onChange={(e) => setEditSni(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Obfs 类型</Label>
                <Input
                  value={editObfs}
                  onChange={(e) => setEditObfs(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Obfs 密码</Label>
                <Input
                  value={editObfsPassword}
                  onChange={(e) => setEditObfsPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>pinSHA256</Label>
                <Input
                  value={editPinSha256}
                  onChange={(e) => setEditPinSha256(e.target.value)}
                />
              </div>
              <div className="flex items-end gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={editInsecure}
                    onCheckedChange={(next) => setEditInsecure(next === true)}
                  />
                  <span>跳过证书校验 (insecure)</span>
                </label>
              </div>
              <div className="flex gap-2 md:col-span-3">
                <Button type="submit">保存</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingId(null)}
                >
                  取消
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
