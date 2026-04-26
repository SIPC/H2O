"use client"

import { FormEvent, useEffect, useState } from "react"
import { Line, LineChart, XAxis } from "recharts"

import { useConfirm } from "@/components/confirm-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"

type NodeRow = {
  id: number
  name: string
  ip: string
  port: number
  port_hopping: string | null
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

type HourPoint = {
  hour: number
  label: string
  txBytes: number
  rxBytes: number
  totalBytes: number
}

const HISTORY_CHUNK_SIZE = 200

const NODE_SPARK_CONFIG = {
  totalBytes: {
    label: "总用量",
    theme: {
      light: "#ffffff",
      dark: "#ffffff",
    },
  },
} satisfies ChartConfig

// 节点心跳判定：最近 3 分钟内上报视为"在线"
const FRESH_THRESHOLD_MS = 3 * 60 * 1000

function parseSqliteUtc(value: string): Date {
  return new Date(value.endsWith("Z") ? value : `${value}Z`)
}

function isFresh(lastReportAt: string | null): boolean {
  if (!lastReportAt) return false
  return (
    Date.now() - parseSqliteUtc(lastReportAt).getTime() < FRESH_THRESHOLD_MS
  )
}

function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0
  return Math.min(23, Math.max(0, Math.floor(hour)))
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

function buildEmptyHourly(): HourPoint[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: String(hour).padStart(2, "0"),
    txBytes: 0,
    rxBytes: 0,
    totalBytes: 0,
  }))
}

function normalizeHourly(input: unknown): HourPoint[] {
  const base = buildEmptyHourly()
  if (!Array.isArray(input)) return base

  for (const item of input) {
    if (!item || typeof item !== "object") continue
    const row = item as Partial<HourPoint>
    if (typeof row.hour !== "number" || !Number.isFinite(row.hour)) continue

    const hour = clampHour(row.hour)
    const tx =
      typeof row.txBytes === "number" && Number.isFinite(row.txBytes)
        ? Math.max(0, Math.floor(row.txBytes))
        : 0
    const rx =
      typeof row.rxBytes === "number" && Number.isFinite(row.rxBytes)
        ? Math.max(0, Math.floor(row.rxBytes))
        : 0

    base[hour] = {
      hour,
      label: String(hour).padStart(2, "0"),
      txBytes: tx,
      rxBytes: rx,
      totalBytes: tx + rx,
    }
  }

  return base
}

// 只显示今天已经发生过的小时，保证最右点是当前小时
function buildElapsedHourly(data: HourPoint[], currentLocalHour: number) {
  const hour = clampHour(currentLocalHour)
  const elapsed = data.slice(0, hour + 1)
  return elapsed.length > 0 ? elapsed : data.slice(0, 1)
}

function NodeUsageSpark({
  hourly,
  currentLocalHour,
}: {
  hourly: HourPoint[]
  currentLocalHour: number
}) {
  const data = buildElapsedHourly(hourly, currentLocalHour)

  return (
    <ChartContainer
      config={NODE_SPARK_CONFIG}
      className="aspect-auto h-7 w-[160px]"
    >
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
              hideLabel
              hideIndicator
              formatter={(value) => formatBytes(Number(value))}
            />
          }
        />
        <Line
          type="monotone"
          dataKey="totalBytes"
          stroke="var(--color-totalBytes)"
          strokeWidth={1.6}
          dot={false}
          activeDot={{ r: 2 }}
        />
      </LineChart>
    </ChartContainer>
  )
}

export default function AdminNodesPage() {
  const { confirm, alert } = useConfirm()
  const [rows, setRows] = useState<NodeRow[]>([])
  const [historyByNode, setHistoryByNode] = useState<
    Record<number, HourPoint[]>
  >({})
  const [historyCurrentLocalHour, setHistoryCurrentLocalHour] = useState(0)

  // 创建表单
  const [name, setName] = useState("")
  const [ip, setIp] = useState("")
  const [portInput, setPortInput] = useState("")
  const [sni, setSni] = useState("")
  const [obfs, setObfs] = useState("")
  const [obfsPassword, setObfsPassword] = useState("")
  const [insecure, setInsecure] = useState(false)
  const [pinSha256, setPinSha256] = useState("")

  // 编辑表单
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [editIp, setEditIp] = useState("")
  const [editPortInput, setEditPortInput] = useState("")
  const [editSni, setEditSni] = useState("")
  const [editObfs, setEditObfs] = useState("")
  const [editObfsPassword, setEditObfsPassword] = useState("")
  const [editInsecure, setEditInsecure] = useState(false)
  const [editPinSha256, setEditPinSha256] = useState("")

  async function loadHistory(
    nodeIds: number[],
    isMounted: () => boolean = () => true
  ) {
    const ids = Array.from(
      new Set(nodeIds.filter((id) => Number.isInteger(id) && id > 0))
    )

    if (ids.length === 0) {
      if (!isMounted()) return
      setHistoryByNode({})
      setHistoryCurrentLocalHour(0)
      return
    }

    const nextHistory: Record<number, HourPoint[]> = {}
    let nextCurrentHour = 0

    for (let i = 0; i < ids.length; i += HISTORY_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + HISTORY_CHUNK_SIZE)
      const params = new URLSearchParams()
      params.set("ids", chunk.join(","))

      const response = await fetch(
        `/api/admin/nodes/history?${params.toString()}`
      )
      const json = await response.json()
      if (!json?.ok) continue

      if (typeof json.data?.currentLocalHour === "number") {
        nextCurrentHour = clampHour(json.data.currentLocalHour)
      }

      if (!Array.isArray(json.data?.items)) continue
      for (const rawItem of json.data.items as Array<{
        nodeId?: unknown
        hourly?: unknown
      }>) {
        if (
          typeof rawItem.nodeId !== "number" ||
          !Number.isFinite(rawItem.nodeId)
        )
          continue
        nextHistory[Math.floor(rawItem.nodeId)] = normalizeHourly(
          rawItem.hourly
        )
      }
    }

    for (const id of ids) {
      if (!nextHistory[id]) nextHistory[id] = buildEmptyHourly()
    }

    if (!isMounted()) return
    setHistoryByNode(nextHistory)
    setHistoryCurrentLocalHour(nextCurrentHour)
  }

  async function load() {
    const response = await fetch("/api/admin/nodes")
    const json = await response.json()

    if (!json?.ok || !Array.isArray(json.data)) {
      setRows([])
      setHistoryByNode({})
      setHistoryCurrentLocalHour(0)
      return
    }

    const nextRows = json.data as NodeRow[]
    setRows(nextRows)
    await loadHistory(nextRows.map((row) => row.id))
  }

  useEffect(() => {
    let mounted = true

    void (async () => {
      const response = await fetch("/api/admin/nodes")
      const json = await response.json()
      if (!mounted) return

      const nextRows =
        json?.ok && Array.isArray(json.data) ? (json.data as NodeRow[]) : []

      setRows(nextRows)
      await loadHistory(
        nextRows.map((row) => row.id),
        () => mounted
      )
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
        port: portInput,
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
    setPortInput("443")
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
    setEditPortInput(row.port_hopping ?? String(row.port))
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
      port: editPortInput,
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
      typeof window !== "undefined"
        ? window.location.origin
        : "https://h2o.example.com"

    const config = JSON.stringify(
      {
        h2o_url: origin,
        auth_path: row.auth_path,
        hysteria_stats_url: "http://127.0.0.1:9999",
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
      title: `${row.name} 的 agent 配置${copied ? "（已复制）" : ""}`,
      description: (
        <pre className="max-h-[400px] min-w-0 overflow-auto rounded bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
          {config}
        </pre>
      ),
    })
  }

  // 获取一键部署命令并弹窗展示（会尝试自动复制）
  async function showDeployCommand(row: NodeRow) {
    const response = await fetch(`/api/admin/nodes/${row.id}/deploy-command`)
    const json = await response.json()

    if (!response.ok || !json?.ok) {
      await alert({
        title: "获取一键部署命令失败",
        description: json?.error?.message ?? "请稍后重试",
        variant: "destructive",
      })
      return
    }

    const command =
      typeof json.data?.command === "string" ? json.data.command : ""
    if (!command) {
      await alert({
        title: "获取一键部署命令失败",
        description: "接口返回异常，请检查后端日志",
        variant: "destructive",
      })
      return
    }

    let copied = false
    try {
      await navigator.clipboard.writeText(command)
      copied = true
    } catch {
      copied = false
    }

    const meta = json.data?.meta as
      | {
          cert_path?: string
          key_path?: string
          interval_seconds?: number
        }
      | undefined

    await alert({
      title: `${row.name} 的一键部署命令${copied ? "（已复制）" : ""}`,
      description: (
        <div className="space-y-3">
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>在节点服务器以 root 执行（将自动安装/配置 hy2 与 agent）。</p>
            <p>若证书或私钥文件不存在，部署脚本会自动生成自签证书。</p>
          </div>
          <pre className="max-h-[260px] min-w-0 overflow-auto rounded bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
            {command}
          </pre>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>证书路径：{meta?.cert_path ?? "/etc/hysteria/server.crt"}</p>
            <p>私钥路径：{meta?.key_path ?? "/etc/hysteria/server.key"}</p>
            <p>上报间隔：{meta?.interval_seconds ?? 120} 秒</p>
          </div>
        </div>
      ),
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 p-6">
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
              <Label>端口（支持端口跳跃）</Label>
              <Input
                value={portInput}
                onChange={(e) => setPortInput(e.target.value)}
                placeholder="如 443 或 1145,1155,1157 或 1145-1155"
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
                <TH>总用量历史</TH>
                <TH>SNI</TH>
                <TH>Obfs</TH>
                <TH>Auth Path</TH>
                <TH>操作</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => {
                const fresh = isFresh(row.last_report_at)
                const hourly = historyByNode[row.id] ?? buildEmptyHourly()

                return (
                  <TR key={row.id}>
                    <TD>{row.id}</TD>
                    <TD>{row.name}</TD>
                    <TD>{row.ip}</TD>
                    <TD className="text-xs">{row.port_hopping ?? row.port}</TD>
                    <TD>{row.status === "enabled" ? "启用" : "禁用"}</TD>
                    <TD
                      className={
                        row.last_report_at
                          ? fresh
                            ? "text-xs text-emerald-600 dark:text-emerald-400"
                            : "text-xs text-muted-foreground"
                          : "text-xs text-muted-foreground"
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
                    <TD className="min-w-[170px] py-1">
                      <NodeUsageSpark
                        hourly={hourly}
                        currentLocalHour={historyCurrentLocalHour}
                      />
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
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => void showDeployCommand(row)}
                        >
                          一键部署
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
                <Label>端口（支持端口跳跃）</Label>
                <Input
                  value={editPortInput}
                  onChange={(e) => setEditPortInput(e.target.value)}
                  placeholder="如 443 或 1145,1155,1157 或 1145-1155"
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
