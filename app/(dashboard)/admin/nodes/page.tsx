"use client"

import { FormEvent, useEffect, useState } from "react"
import { Area, AreaChart, XAxis, YAxis } from "recharts"
import {
  Activity,
  Bot,
  Copy,
  Eye,
  EyeOff,
  Globe,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Server,
  Square,
  Terminal,
  Trash2,
} from "lucide-react"

import { useConfirm } from "@/components/confirm-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
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
  SelectGroup,
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
import { cn } from "@/lib/utils"

type DnsStatus = "match" | "mismatch" | "unresolved" | "skip"

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
  agent_version: string | null
  // 节点配置
  node_ip: string | null
  node_port: number | null
  node_port_hopping: string | null
  cert_mode: string
  cert_path: string | null
  key_path: string | null
  acme_domains: string | null
  acme_email: string | null
  acme_dns_provider: string | null
  acme_dns_config: string | null
  masquerade_type: string | null
  masquerade_config: string | null
  agent_interval: number | null
  agent_auto_update_enabled: 0 | 1 | null
  dns_status: DnsStatus
}

type HourPoint = {
  index: number
  bucketDate: string
  hour: number
  label: string
  txBytes: number
  rxBytes: number
  totalBytes: number
}

const HISTORY_CHUNK_SIZE = 200

const CHART_CONFIG = {
  rxBytes: {
    label: "下载",
    theme: { light: "#3b82f6", dark: "#60a5fa" },
  },
  txBytes: {
    label: "上传",
    theme: { light: "#8b5cf6", dark: "#a78bfa" },
  },
} satisfies ChartConfig

// 节点心跳判定：最近 3 分钟内上报视为"在线"
const FRESH_THRESHOLD_MS = 3 * 60 * 1000

const DNS_STATUS_META: Record<
  Exclude<DnsStatus, "skip">,
  {
    label: string
    shortLabel: string
    dotClassName: string
    badgeClassName: string
    description: string
  }
> = {
  match: {
    label: "DNS 正常",
    shortLabel: "正常",
    dotClassName: "bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.6)]",
    badgeClassName: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    description: "DNS 已指向正确 IP",
  },
  mismatch: {
    label: "DNS 不匹配",
    shortLabel: "不匹配",
    dotClassName: "bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.6)]",
    badgeClassName: "bg-red-500/15 text-red-700 dark:text-red-400",
    description: "DNS 指向的 IP 与节点 IP 不一致",
  },
  unresolved: {
    label: "DNS 未解析",
    shortLabel: "未解析",
    dotClassName: "bg-yellow-500 shadow-[0_0_4px_rgba(234,179,8,0.6)]",
    badgeClassName: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
    description: "域名无法解析",
  },
}

function getDnsStatusMeta(status: DnsStatus) {
  if (status === "skip") return null
  return DNS_STATUS_META[status]
}

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
    index: hour,
    bucketDate: "",
    hour,
    label: String(hour).padStart(2, "0"),
    txBytes: 0,
    rxBytes: 0,
    totalBytes: 0,
  }))
}

function normalizeHourly(input: unknown): HourPoint[] {
  if (!Array.isArray(input)) return buildEmptyHourly()

  const out: HourPoint[] = []

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

    out.push({
      index:
        typeof row.index === "number" && Number.isFinite(row.index)
          ? Math.max(0, Math.floor(row.index))
          : out.length,
      bucketDate:
        typeof row.bucketDate === "string" && row.bucketDate.trim()
          ? row.bucketDate
          : "",
      hour,
      label:
        typeof row.label === "string" && row.label.trim()
          ? row.label
          : String(hour).padStart(2, "0"),
      txBytes: tx,
      rxBytes: rx,
      totalBytes: tx + rx,
    })

    if (out.length >= 24) break
  }

  return out.length > 0 ? out : buildEmptyHourly()
}

// 节点卡片底部的流量折线图
function NodeTrafficChart({ hourly }: { hourly: HourPoint[] }) {
  return (
    <ChartContainer
      config={CHART_CONFIG}
      className="absolute inset-0 h-full w-full"
    >
      <AreaChart
        accessibilityLayer
        data={hourly}
        margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
      >
        <defs>
          <linearGradient id="fillRx" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--color-rxBytes)"
              stopOpacity={0.3}
            />
            <stop
              offset="100%"
              stopColor="var(--color-rxBytes)"
              stopOpacity={0.02}
            />
          </linearGradient>
          <linearGradient id="fillTx" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--color-txBytes)"
              stopOpacity={0.25}
            />
            <stop
              offset="100%"
              stopColor="var(--color-txBytes)"
              stopOpacity={0.02}
            />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" hide />
        <YAxis hide />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, name) =>
                `${name === "rxBytes" ? "下载" : "上传"}: ${formatBytes(Number(value))}`
              }
            />
          }
        />
        <Area
          type="monotone"
          dataKey="rxBytes"
          stroke="var(--color-rxBytes)"
          strokeWidth={1.5}
          fill="url(#fillRx)"
          dot={false}
          activeDot={{ r: 3 }}
        />
        <Area
          type="monotone"
          dataKey="txBytes"
          stroke="var(--color-txBytes)"
          strokeWidth={1.5}
          fill="url(#fillTx)"
          dot={false}
          activeDot={{ r: 3 }}
        />
      </AreaChart>
    </ChartContainer>
  )
}

// 节点卡片组件
function NodeCard({
  row,
  hourly,
  hideIp,
  onEdit,
  onRemove,
  onToggleStatus,
  onShowAgentConfig,
  onShowDeployCommand,
  onDnsResolve,
}: {
  row: NodeRow
  hourly: HourPoint[]
  hideIp: boolean
  onEdit: (row: NodeRow) => void
  onRemove: (row: NodeRow) => void
  onToggleStatus: (row: NodeRow) => void
  onShowAgentConfig: (row: NodeRow) => void
  onShowDeployCommand: (row: NodeRow) => void
  onDnsResolve: (row: NodeRow) => void
}) {
  const fresh = isFresh(row.last_report_at)
  const onlineCount = row.online_count ?? 0
  const dnsStatusMeta = getDnsStatusMeta(row.dns_status)

  // 计算今日上传/下载
  const todayTx = hourly.reduce((sum, h) => sum + h.txBytes, 0)
  const todayRx = hourly.reduce((sum, h) => sum + h.rxBytes, 0)

  return (
    <Card className="relative h-40 overflow-hidden">
      {/* 流量图 - 作为卡片背景 */}
      <NodeTrafficChart hourly={hourly} />

      {/* 渐变遮罩 - 确保文字可读 */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card/95 via-card/70 to-card/30" />

      {/* 节点信息 - 叠加在图表上 */}
      <div className="relative flex h-full flex-col justify-between p-3">
        {/* 顶部：名称 + 状态 */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold">{row.name}</h3>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {hideIp ? row.ip.replace(/[^.]/g, "*") : row.ip}:
              {row.port_hopping ?? row.port}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* 在线状态指示灯 */}
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                fresh
                  ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]"
                  : "bg-muted-foreground/40"
              }`}
            />
            {/* 更多操作菜单 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="h-6 w-6">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => onEdit(row)}>
                  <Pencil className="h-4 w-4" />
                  编辑节点
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onShowAgentConfig(row)}>
                  <Copy className="h-4 w-4" />
                  Agent 配置
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onShowDeployCommand(row)}>
                  <Terminal className="h-4 w-4" />
                  一键部署
                </DropdownMenuItem>
                {row.node_ip && row.ip !== row.node_ip && (
                  <DropdownMenuItem onClick={() => onDnsResolve(row)}>
                    <Globe className="h-4 w-4" />
                    DNS 解析
                    {dnsStatusMeta && (
                      <span
                        className={cn(
                          "ml-auto h-2 w-2 rounded-full",
                          dnsStatusMeta.dotClassName
                        )}
                        title={dnsStatusMeta.description}
                      />
                    )}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onToggleStatus(row)}>
                  {row.status === "enabled" ? (
                    <>
                      <Square className="h-4 w-4" />
                      禁用节点
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      启用节点
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onRemove(row)}
                >
                  <Trash2 className="h-4 w-4" />
                  删除节点
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* 底部：统计 + 状态标签 */}
        <div className="space-y-1">
          {/* 状态标签行 */}
          <div className="flex flex-wrap items-center gap-1">
            <Badge
              className={cn(
                "px-1.5 py-0 text-[10px]",
                row.status === "enabled"
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {row.status === "enabled" ? "启用" : "禁用"}
            </Badge>
            {dnsStatusMeta && (
              <Badge
                className={cn(
                  "px-1.5 py-0 text-[10px]",
                  dnsStatusMeta.badgeClassName
                )}
                title={dnsStatusMeta.description}
              >
                <Globe className="mr-0.5 h-2.5 w-2.5" />
                {dnsStatusMeta.label}
              </Badge>
            )}
            {fresh && (
              <Badge className="bg-blue-500/15 px-1.5 py-0 text-[10px] text-blue-700 dark:text-blue-400">
                <Activity className="mr-0.5 h-2.5 w-2.5" />
                {onlineCount}
              </Badge>
            )}
            {!fresh && row.last_report_at && (
              <Badge className="bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
                离线
              </Badge>
            )}
            {row.agent_version && (
              <Badge
                className="bg-muted px-1.5 py-0 font-mono text-[10px] text-muted-foreground"
                title={`Agent 版本：${row.agent_version}`}
              >
                <Bot className="mr-0.5 h-2.5 w-2.5" />
                {row.agent_version}
              </Badge>
            )}
          </div>

          {/* 今日流量 */}
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-muted-foreground">今日</span>
            <span className="font-medium text-violet-600 dark:text-violet-400">
              ↑ {formatBytes(todayTx)}
            </span>
            <span className="font-medium text-blue-600 dark:text-blue-400">
              ↓ {formatBytes(todayRx)}
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}

// 创建/编辑节点的表单内容
function NodeForm({
  // 订阅配置
  name,
  setName,
  ip,
  setIp,
  portInput,
  setPortInput,
  sni,
  setSni,
  obfs,
  setObfs,
  obfsPassword,
  setObfsPassword,
  insecure,
  setInsecure,
  pinSha256,
  setPinSha256,
  // 节点配置
  nodeIp,
  setNodeIp,
  nodePortInput,
  setNodePortInput,
  certMode,
  setCertMode,
  certPath,
  setCertPath,
  keyPath,
  setKeyPath,
  acmeDomainsInput,
  setAcmeDomainsInput,
  acmeEmail,
  setAcmeEmail,
  acmeDnsProvider,
  setAcmeDnsProvider,
  acmeCfToken,
  setAcmeCfToken,
  // 伪装
  masqueradeType,
  setMasqueradeType,
  masqContent,
  setMasqContent,
  masqContentType,
  setMasqContentType,
  masqStatusCode,
  setMasqStatusCode,
  masqProxyUrl,
  setMasqProxyUrl,
  masqProxyRewriteHost,
  setMasqProxyRewriteHost,
  masqProxyInsecure,
  setMasqProxyInsecure,
  masqProxyXForwarded,
  setMasqProxyXForwarded,
  masqFileDir,
  setMasqFileDir,
  // Agent 配置
  agentInterval,
  setAgentInterval,
  agentAutoUpdateEnabled,
  setAgentAutoUpdateEnabled,
  onSubmit,
  submitLabel,
  onCancel,
}: {
  // 订阅配置
  name: string
  setName: (v: string) => void
  ip: string
  setIp: (v: string) => void
  portInput: string
  setPortInput: (v: string) => void
  sni: string
  setSni: (v: string) => void
  obfs: string
  setObfs: (v: string) => void
  obfsPassword: string
  setObfsPassword: (v: string) => void
  insecure: boolean
  setInsecure: (v: boolean) => void
  pinSha256: string
  setPinSha256: (v: string) => void
  // 节点配置
  nodeIp: string
  setNodeIp: (v: string) => void
  nodePortInput: string
  setNodePortInput: (v: string) => void
  certMode: string
  setCertMode: (v: string) => void
  certPath: string
  setCertPath: (v: string) => void
  keyPath: string
  setKeyPath: (v: string) => void
  acmeDomainsInput: string
  setAcmeDomainsInput: (v: string) => void
  acmeEmail: string
  setAcmeEmail: (v: string) => void
  acmeDnsProvider: string
  setAcmeDnsProvider: (v: string) => void
  acmeCfToken: string
  setAcmeCfToken: (v: string) => void
  // 伪装
  masqueradeType: string
  setMasqueradeType: (v: string) => void
  masqContent: string
  setMasqContent: (v: string) => void
  masqContentType: string
  setMasqContentType: (v: string) => void
  masqStatusCode: string
  setMasqStatusCode: (v: string) => void
  masqProxyUrl: string
  setMasqProxyUrl: (v: string) => void
  masqProxyRewriteHost: boolean
  setMasqProxyRewriteHost: (v: boolean) => void
  masqProxyInsecure: boolean
  setMasqProxyInsecure: (v: boolean) => void
  masqProxyXForwarded: boolean
  setMasqProxyXForwarded: (v: boolean) => void
  masqFileDir: string
  setMasqFileDir: (v: string) => void
  // Agent 配置
  agentInterval: string
  setAgentInterval: (v: string) => void
  agentAutoUpdateEnabled: boolean
  setAgentAutoUpdateEnabled: (v: boolean) => void
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  submitLabel: string
  onCancel?: () => void
}) {
  return (
    <form
      className="space-y-4 **:data-[slot=label]:text-xs"
      onSubmit={onSubmit}
    >
      {/* === 订阅配置 === */}
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            订阅配置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>节点名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="节点名称"
              required
            />
          </div>
          <div className="space-y-1">
            <Label>订阅地址</Label>
            <Input
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="域名或 IP，如 hy2.example.com"
              required
            />
            <p className="text-[11px] text-muted-foreground">
              客户端通过此地址连接节点，域名会自动解析到节点 IP
            </p>
          </div>
          <div className="space-y-1">
            <Label>订阅端口（支持端口跳跃）</Label>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Obfs 类型</Label>
              <Select
                value={obfs || "none"}
                onValueChange={(v) => setObfs(v === "none" ? "" : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    <SelectItem value="none">不使用</SelectItem>
                    <SelectItem value="salamander">Salamander</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Obfs 密码</Label>
              <Input
                value={obfsPassword}
                onChange={(e) => setObfsPassword(e.target.value)}
                placeholder="可选"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>pinSHA256</Label>
            <Input
              value={pinSha256}
              onChange={(e) => setPinSha256(e.target.value)}
              placeholder="可选，自签证书的 SHA-256 指纹"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={insecure}
              onCheckedChange={(next) => setInsecure(next === true)}
            />
            <span>跳过证书校验 (insecure)</span>
          </label>
        </CardContent>
      </Card>

      {/* === 伪装 === */}
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            伪装
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>伪装类型</Label>
            <Select value={masqueradeType} onValueChange={setMasqueradeType}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectGroup>
                  <SelectItem value="none">不伪装</SelectItem>
                  <SelectItem value="string">字符串</SelectItem>
                  <SelectItem value="proxy">反向代理</SelectItem>
                  <SelectItem value="file">静态文件</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {masqueradeType === "string" && (
            <>
              <div className="space-y-1">
                <Label>响应内容</Label>
                <Textarea
                  value={masqContent}
                  onChange={(e) => setMasqContent(e.target.value)}
                  placeholder="ok"
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Content-Type</Label>
                  <Input
                    value={masqContentType}
                    onChange={(e) => setMasqContentType(e.target.value)}
                    placeholder="text/plain; charset=utf-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label>状态码</Label>
                  <Input
                    type="number"
                    value={masqStatusCode}
                    onChange={(e) => setMasqStatusCode(e.target.value)}
                    placeholder="200"
                  />
                </div>
              </div>
            </>
          )}
          {masqueradeType === "proxy" && (
            <>
              <div className="space-y-1">
                <Label>代理 URL</Label>
                <Input
                  value={masqProxyUrl}
                  onChange={(e) => setMasqProxyUrl(e.target.value)}
                  placeholder="https://example.com"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={masqProxyRewriteHost}
                  onCheckedChange={(next) =>
                    setMasqProxyRewriteHost(next === true)
                  }
                />
                <span>Rewrite Host</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={masqProxyInsecure}
                  onCheckedChange={(next) =>
                    setMasqProxyInsecure(next === true)
                  }
                />
                <span>跳过后端证书校验 (Insecure)</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={masqProxyXForwarded}
                  onCheckedChange={(next) =>
                    setMasqProxyXForwarded(next === true)
                  }
                />
                <span>X-Forwarded-For</span>
              </label>
            </>
          )}
          {masqueradeType === "file" && (
            <div className="space-y-1">
              <Label>文件目录</Label>
              <Input
                value={masqFileDir}
                onChange={(e) => setMasqFileDir(e.target.value)}
                placeholder="/www/masq"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* === 节点配置 === */}
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            节点配置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>节点 IP</Label>
            <Input
              value={nodeIp}
              onChange={(e) => setNodeIp(e.target.value)}
              placeholder="服务器实际 IP，如 1.2.3.4"
            />
            <p className="text-[11px] text-muted-foreground">
              用于一键部署和 DNS 解析，留空则使用订阅地址
            </p>
          </div>
          <div className="space-y-1">
            <Label>节点端口（支持端口跳跃）</Label>
            <Input
              value={nodePortInput}
              onChange={(e) => setNodePortInput(e.target.value)}
              placeholder="留空则与订阅端口一致"
            />
          </div>
          <div className="space-y-1">
            <Label>证书模式</Label>
            <Select value={certMode} onValueChange={setCertMode}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectGroup>
                  <SelectItem value="self-signed">自签证书</SelectItem>
                  <SelectItem value="acme-http">ACME HTTP</SelectItem>
                  <SelectItem value="acme-dns">ACME DNS</SelectItem>
                  <SelectItem value="custom">自定义路径</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {(certMode === "acme-http" || certMode === "acme-dns") && (
            <>
              <div className="space-y-1">
                <Label>ACME 域名</Label>
                <Textarea
                  value={acmeDomainsInput}
                  onChange={(e) => setAcmeDomainsInput(e.target.value)}
                  placeholder={"每行一个，如\nexample.com\n*.example.com"}
                  rows={3}
                />
                <p className="text-[11px] text-muted-foreground">
                  {certMode === "acme-http"
                    ? "HTTP 验证仅支持裸域名，不支持通配符"
                    : "DNS 验证支持通配符域名"}
                </p>
              </div>
              <div className="space-y-1">
                <Label>ACME 邮箱</Label>
                <Input
                  type="email"
                  value={acmeEmail}
                  onChange={(e) => setAcmeEmail(e.target.value)}
                  placeholder="留空则使用全局设置"
                />
              </div>
            </>
          )}
          {certMode === "acme-dns" && (
            <>
              <div className="space-y-1">
                <Label>DNS 服务商</Label>
                <Select
                  value={acmeDnsProvider}
                  onValueChange={setAcmeDnsProvider}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择 DNS 服务商" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      <SelectItem value="cloudflare">Cloudflare</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Hysteria2 ACME 仅支持 DNS-01 验证，必须配置 DNS 服务商
                </p>
              </div>
              {acmeDnsProvider === "cloudflare" && (
                <div className="space-y-1">
                  <Label>Cloudflare API Token</Label>
                  <Input
                    type="password"
                    value={acmeCfToken}
                    onChange={(e) => setAcmeCfToken(e.target.value)}
                    placeholder="留空则使用全局设置"
                  />
                </div>
              )}
            </>
          )}
          {certMode === "custom" && (
            <>
              <div className="space-y-1">
                <Label>证书路径</Label>
                <Input
                  value={certPath}
                  onChange={(e) => setCertPath(e.target.value)}
                  placeholder="/etc/hysteria/server.crt"
                />
              </div>
              <div className="space-y-1">
                <Label>私钥路径</Label>
                <Input
                  value={keyPath}
                  onChange={(e) => setKeyPath(e.target.value)}
                  placeholder="/etc/hysteria/server.key"
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* === Agent 配置 === */}
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            Agent 配置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-2">
          <div className="space-y-1">
            <Label>上报间隔（秒）</Label>
            <Input
              type="number"
              value={agentInterval}
              onChange={(e) => setAgentInterval(e.target.value)}
              placeholder="留空默认 120"
            />
            <p className="text-[11px] text-muted-foreground">
              Agent 向面板上报流量与在线状态的时间间隔
            </p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>每日自动更新</Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                每日从 GitHub 检查并更新对应架构的 agent。
              </p>
            </div>
            <Switch
              checked={agentAutoUpdateEnabled}
              onCheckedChange={setAgentAutoUpdateEnabled}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2 pt-2">
        <Button type="submit" className="flex-1">
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
        )}
      </div>
    </form>
  )
}

export default function AdminNodesPage() {
  const { confirm, alert } = useConfirm()
  const [rows, setRows] = useState<NodeRow[]>([])
  const [historyByNode, setHistoryByNode] = useState<
    Record<number, HourPoint[]>
  >({})

  // 创建面板
  const [hideIp, setHideIp] = useState(false)
  const [dnsStatusMap, setDnsStatusMap] = useState<Record<number, DnsStatus>>(
    {}
  )
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [ip, setIp] = useState("")
  const [portInput, setPortInput] = useState("")
  const [sni, setSni] = useState("")
  const [obfs, setObfs] = useState("")
  const [obfsPassword, setObfsPassword] = useState("")
  const [insecure, setInsecure] = useState(false)
  const [pinSha256, setPinSha256] = useState("")
  const [nodeIp, setNodeIp] = useState("")
  const [nodePortInput, setNodePortInput] = useState("")
  const [certMode, setCertMode] = useState("self-signed")
  const [certPath, setCertPath] = useState("")
  const [keyPath, setKeyPath] = useState("")
  const [acmeDomainsInput, setAcmeDomainsInput] = useState("")
  const [acmeEmail, setAcmeEmail] = useState("")
  const [acmeDnsProvider, setAcmeDnsProvider] = useState("")
  const [acmeCfToken, setAcmeCfToken] = useState("")
  const [masqueradeType, setMasqueradeType] = useState("string")
  const [masqContent, setMasqContent] = useState("ok")
  const [masqContentType, setMasqContentType] = useState(
    "text/plain; charset=utf-8"
  )
  const [masqStatusCode, setMasqStatusCode] = useState("200")
  const [masqProxyUrl, setMasqProxyUrl] = useState("")
  const [masqProxyRewriteHost, setMasqProxyRewriteHost] = useState(true)
  const [masqProxyInsecure, setMasqProxyInsecure] = useState(false)
  const [masqProxyXForwarded, setMasqProxyXForwarded] = useState(false)
  const [masqFileDir, setMasqFileDir] = useState("/www/masq")
  const [agentInterval, setAgentInterval] = useState("")
  const [agentAutoUpdateEnabled, setAgentAutoUpdateEnabled] = useState(true)

  // 编辑面板
  const [editingRow, setEditingRow] = useState<NodeRow | null>(null)
  const [editName, setEditName] = useState("")
  const [editIp, setEditIp] = useState("")
  const [editPortInput, setEditPortInput] = useState("")
  const [editSni, setEditSni] = useState("")
  const [editObfs, setEditObfs] = useState("")
  const [editObfsPassword, setEditObfsPassword] = useState("")
  const [editInsecure, setEditInsecure] = useState(false)
  const [editPinSha256, setEditPinSha256] = useState("")
  const [editNodeIp, setEditNodeIp] = useState("")
  const [editNodePortInput, setEditNodePortInput] = useState("")
  const [editCertMode, setEditCertMode] = useState("self-signed")
  const [editCertPath, setEditCertPath] = useState("")
  const [editKeyPath, setEditKeyPath] = useState("")
  const [editAcmeDomainsInput, setEditAcmeDomainsInput] = useState("")
  const [editAcmeEmail, setEditAcmeEmail] = useState("")
  const [editAcmeDnsProvider, setEditAcmeDnsProvider] = useState("")
  const [editAcmeCfToken, setEditAcmeCfToken] = useState("")
  const [editMasqueradeType, setEditMasqueradeType] = useState("string")
  const [editMasqContent, setEditMasqContent] = useState("ok")
  const [editMasqContentType, setEditMasqContentType] = useState(
    "text/plain; charset=utf-8"
  )
  const [editMasqStatusCode, setEditMasqStatusCode] = useState("200")
  const [editMasqProxyUrl, setEditMasqProxyUrl] = useState("")
  const [editMasqProxyRewriteHost, setEditMasqProxyRewriteHost] = useState(true)
  const [editMasqProxyInsecure, setEditMasqProxyInsecure] = useState(false)
  const [editMasqProxyXForwarded, setEditMasqProxyXForwarded] = useState(false)
  const [editMasqFileDir, setEditMasqFileDir] = useState("/www/masq")
  const [editAgentInterval, setEditAgentInterval] = useState("")
  const [editAgentAutoUpdateEnabled, setEditAgentAutoUpdateEnabled] =
    useState(true)

  async function refreshNodes() {
    const response = await fetch("/api/admin/nodes")
    const json = await response.json()

    if (!json?.ok || !Array.isArray(json.data)) {
      setRows([])
      setHistoryByNode({})
      return
    }

    const nextRows = json.data as NodeRow[]
    setRows(nextRows)
    await Promise.all([
      loadDnsStatus(),
      loadHistory(nextRows.map((row) => row.id)),
    ])
  }

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
      return
    }

    const nextHistory: Record<number, HourPoint[]> = {}

    for (let i = 0; i < ids.length; i += HISTORY_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + HISTORY_CHUNK_SIZE)
      const params = new URLSearchParams()
      params.set("ids", chunk.join(","))

      const response = await fetch(
        `/api/admin/nodes/history?${params.toString()}`
      )
      const json = await response.json()
      if (!json?.ok) continue

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
      if (!nextHistory[id]) nextHistory[id] = []
    }

    if (!isMounted()) return
    setHistoryByNode(nextHistory)
  }

  async function load() {
    await refreshNodes()
  }

  async function loadDnsStatus() {
    try {
      const res = await fetch("/api/admin/nodes/dns-status")
      const json = await res.json()
      if (json?.ok && json.data && typeof json.data === "object") {
        setDnsStatusMap(json.data as Record<number, DnsStatus>)
      }
    } catch {
      // 静默失败，不影响主流程
    }
  }

  useEffect(() => {
    let mounted = true

    // 首次加载 + 定时轮询，保持节点在线状态实时更新
    const refresh = async () => {
      if (!mounted) return
      const response = await fetch("/api/admin/nodes")
      const json = await response.json()
      if (!mounted) return

      const nextRows =
        json?.ok && Array.isArray(json.data) ? (json.data as NodeRow[]) : []

      setRows(nextRows)
      void loadDnsStatus()
      await loadHistory(
        nextRows.map((row) => row.id),
        () => mounted
      )
    }

    void refresh()
    const timer = setInterval(() => void refresh(), 30_000)

    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])

  // 解析 acmeDnsConfig
  function buildAcmeDnsConfig(
    src: "create" | "edit"
  ): Record<string, string> | null {
    const provider = src === "create" ? acmeDnsProvider : editAcmeDnsProvider
    const token = src === "create" ? acmeCfToken : editAcmeCfToken
    if (provider === "cloudflare" && token.trim()) {
      return { cloudflare_api_token: token.trim() }
    }
    return null
  }

  function parseAcmeDomainsInput(raw: string): string[] {
    return raw
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  function buildMasqueradeConfigObj(
    src: "create" | "edit"
  ): Record<string, unknown> | null {
    const type = src === "create" ? masqueradeType : editMasqueradeType
    if (type === "none") return null
    if (type === "string") {
      return {
        content: src === "create" ? masqContent : editMasqContent,
        headers: {
          "content-type":
            src === "create" ? masqContentType : editMasqContentType,
        },
        statusCode: Number(
          src === "create" ? masqStatusCode : editMasqStatusCode
        ),
      }
    }
    if (type === "proxy") {
      return {
        url: src === "create" ? masqProxyUrl : editMasqProxyUrl,
        rewriteHost:
          src === "create" ? masqProxyRewriteHost : editMasqProxyRewriteHost,
        insecure: src === "create" ? masqProxyInsecure : editMasqProxyInsecure,
        xForwarded:
          src === "create" ? masqProxyXForwarded : editMasqProxyXForwarded,
      }
    }
    if (type === "file") {
      return {
        dir: src === "create" ? masqFileDir : editMasqFileDir,
      }
    }
    return null
  }

  async function resolveDns(row: NodeRow) {
    try {
      const res = await fetch(`/api/admin/nodes/${row.id}/dns`, {
        method: "POST",
      })
      const json = await res.json()
      const refreshPromise = refreshNodes()
      if (!res.ok || !json.ok) {
        await alert({
          title: "DNS 解析失败",
          description: json?.error?.message ?? "请稍后重试",
          variant: "destructive",
        })
        await refreshPromise.catch(() => undefined)
        return
      }
      const d = json.data
      const actionText =
        d.action === "created"
          ? "已创建"
          : d.action === "updated"
            ? "已更新"
            : "已是最新"
      await alert({
        title: "DNS 解析成功",
        description: `${d.domain} → ${d.ip}（${actionText}，Zone: ${d.zone}）`,
      })
      await refreshPromise.catch(() => undefined)
    } catch {
      await alert({
        title: "DNS 解析失败",
        description: "网络错误，请稍后重试",
        variant: "destructive",
      })
      await refreshNodes().catch(() => undefined)
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const acmeDomains =
      certMode === "acme-http" || certMode === "acme-dns"
        ? parseAcmeDomainsInput(acmeDomainsInput)
        : []
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
        nodeIp: nodeIp || null,
        nodePort: nodePortInput || null,
        certMode,
        certPath: certPath || null,
        keyPath: keyPath || null,
        acmeDomains: acmeDomains.length > 0 ? acmeDomains : null,
        acmeEmail: acmeEmail || null,
        acmeDnsProvider: acmeDnsProvider || null,
        acmeDnsConfig: buildAcmeDnsConfig("create"),
        masqueradeType,
        masqueradeConfig: buildMasqueradeConfigObj("create"),
        agentInterval: agentInterval ? Number(agentInterval) : null,
        agentAutoUpdateEnabled,
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
    setNodeIp("")
    setNodePortInput("")
    setCertMode("self-signed")
    setCertPath("")
    setKeyPath("")
    setAcmeDomainsInput("")
    setAcmeEmail("")
    setAcmeDnsProvider("")
    setAcmeCfToken("")
    setMasqueradeType("string")
    setMasqContent("ok")
    setMasqContentType("text/plain; charset=utf-8")
    setMasqStatusCode("200")
    setMasqProxyUrl("")
    setMasqProxyRewriteHost(true)
    setMasqProxyInsecure(false)
    setMasqProxyXForwarded(false)
    setMasqFileDir("/www/masq")
    setAgentInterval("")
    setAgentAutoUpdateEnabled(true)
    setCreateOpen(false)
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
      title: `删除节点 ${row.name}？`,
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
    if (editingRow?.id === row.id) setEditingRow(null)
    await load()
  }

  function startEdit(row: NodeRow) {
    setEditingRow(row)
    setEditName(row.name)
    setEditIp(row.ip)
    setEditPortInput(row.port_hopping ?? String(row.port))
    setEditSni(row.sni ?? "")
    setEditObfs(row.obfs ?? "")
    setEditObfsPassword(row.obfs_password ?? "")
    setEditInsecure(row.insecure === 1)
    setEditPinSha256(row.pin_sha256 ?? "")
    // 节点配置
    setEditNodeIp(row.node_ip ?? "")
    setEditNodePortInput(
      row.node_port_hopping ?? (row.node_port ? String(row.node_port) : "")
    )
    // 旧值兼容：acme → acme-dns
    const rawCertMode = row.cert_mode || "self-signed"
    setEditCertMode(rawCertMode === "acme" ? "acme-dns" : rawCertMode)
    setEditCertPath(row.cert_path ?? "")
    setEditKeyPath(row.key_path ?? "")
    // acme_domains 是 JSON 数组字符串
    try {
      const domains = row.acme_domains
        ? (JSON.parse(row.acme_domains) as string[])
        : []
      setEditAcmeDomainsInput(domains.join("\n"))
    } catch {
      setEditAcmeDomainsInput("")
    }
    setEditAcmeEmail(row.acme_email ?? "")
    setEditAcmeDnsProvider(row.acme_dns_provider ?? "")
    // acme_dns_config 是 JSON 字符串
    try {
      const config = row.acme_dns_config
        ? (JSON.parse(row.acme_dns_config) as Record<string, string>)
        : {}
      setEditAcmeCfToken(config.cloudflare_api_token ?? "")
    } catch {
      setEditAcmeCfToken("")
    }
    // 伪装配置
    setEditMasqueradeType(row.masquerade_type || "string")
    try {
      const mc = row.masquerade_config
        ? (JSON.parse(row.masquerade_config) as Record<string, unknown>)
        : null
      if (mc) {
        if (row.masquerade_type === "string") {
          setEditMasqContent((mc.content as string) ?? "ok")
          const headers = mc.headers as Record<string, string> | undefined
          setEditMasqContentType(
            headers?.["content-type"] ?? "text/plain; charset=utf-8"
          )
          setEditMasqStatusCode(String(mc.statusCode ?? "200"))
        } else if (row.masquerade_type === "proxy") {
          setEditMasqProxyUrl((mc.url as string) ?? "")
          setEditMasqProxyRewriteHost(mc.rewriteHost !== false)
          setEditMasqProxyInsecure(mc.insecure === true)
          setEditMasqProxyXForwarded(mc.xForwarded === true)
        } else if (row.masquerade_type === "file") {
          setEditMasqFileDir((mc.dir as string) ?? "/www/masq")
        }
      } else {
        // 无伪装配置，重置为默认
        setEditMasqContent("ok")
        setEditMasqContentType("text/plain; charset=utf-8")
        setEditMasqStatusCode("200")
        setEditMasqProxyUrl("")
        setEditMasqProxyRewriteHost(true)
        setEditMasqProxyInsecure(false)
        setEditMasqProxyXForwarded(false)
        setEditMasqFileDir("/www/masq")
      }
    } catch {
      setEditMasqContent("ok")
      setEditMasqContentType("text/plain; charset=utf-8")
      setEditMasqStatusCode("200")
      setEditMasqProxyUrl("")
      setEditMasqProxyRewriteHost(true)
      setEditMasqProxyInsecure(false)
      setEditMasqProxyXForwarded(false)
      setEditMasqFileDir("/www/masq")
    }
    // Agent 配置
    setEditAgentInterval(
      row.agent_interval != null ? String(row.agent_interval) : ""
    )
    setEditAgentAutoUpdateEnabled(row.agent_auto_update_enabled !== 0)
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingRow) return
    const editAcmeDomains =
      editCertMode === "acme-http" || editCertMode === "acme-dns"
        ? parseAcmeDomainsInput(editAcmeDomainsInput)
        : []
    await updateNode(editingRow.id, {
      name: editName,
      ip: editIp,
      port: editPortInput,
      sni: editSni,
      obfs: editObfs,
      obfsPassword: editObfsPassword,
      insecure: editInsecure,
      pinSha256: editPinSha256,
      nodeIp: editNodeIp || null,
      nodePort: editNodePortInput || null,
      certMode: editCertMode,
      certPath: editCertPath || null,
      keyPath: editKeyPath || null,
      acmeDomains: editAcmeDomains.length > 0 ? editAcmeDomains : null,
      acmeEmail: editAcmeEmail || null,
      acmeDnsProvider: editAcmeDnsProvider || null,
      acmeDnsConfig: buildAcmeDnsConfig("edit"),
      masqueradeType: editMasqueradeType,
      masqueradeConfig: buildMasqueradeConfigObj("edit"),
      agentInterval: editAgentInterval ? Number(editAgentInterval) : null,
      agentAutoUpdateEnabled: editAgentAutoUpdateEnabled,
    })

    setEditingRow(null)
  }

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
        interval_seconds: row.agent_interval ?? 120,
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

  async function showDeployCommand(row: NodeRow) {
    // ACME 节点先检查 DNS 解析状态
    const isAcmeMode =
      row.cert_mode === "acme" ||
      row.cert_mode === "acme-dns" ||
      row.cert_mode === "acme-http"
    if (isAcmeMode && row.dns_status !== "skip" && row.dns_status !== "match") {
      const statusText =
        row.dns_status === "mismatch"
          ? "DNS 指向的 IP 与节点 IP 不一致"
          : "域名无法解析"
      const shouldResolve = await confirm({
        title: "DNS 解析状态异常",
        description: `当前节点使用 ACME 证书模式，但${statusText}。建议先更新 DNS 解析再部署，否则 ACME 证书签发可能失败。`,
        confirmText: "先更新解析",
        cancelText: "仍然部署",
      })
      if (shouldResolve) {
        await resolveDns(row)
        return
      }
    }

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
          cert_mode?: string
          cert_path?: string
          key_path?: string
          interval_seconds?: number
          deploy_port?: number
          deploy_port_hopping?: string | null
          obfs?: string | null
          acme_domains?: string[]
          acme_email?: string | null
          acme_dns_provider?: string | null
        }
      | undefined

    const isAcme =
      meta?.cert_mode === "acme-http" ||
      meta?.cert_mode === "acme-dns" ||
      meta?.cert_mode === "acme"

    await alert({
      title: `${row.name} 的一键部署命令${copied ? "（已复制）" : ""}`,
      description: (
        <div className="space-y-3">
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>在节点服务器以 root 执行（将自动安装/配置 hy2 与 agent）。</p>
          </div>
          <pre className="max-h-[260px] min-w-0 overflow-auto rounded bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
            {command}
          </pre>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              端口：{meta?.deploy_port ?? 443}
              {meta?.deploy_port_hopping &&
                `（端口跳跃：${meta.deploy_port_hopping}）`}
            </p>
            {meta?.obfs === "salamander" && <p>混淆：Salamander</p>}
            <p>上报间隔：{meta?.interval_seconds ?? 120} 秒</p>
            {isAcme ? (
              <>
                <p>
                  ACME 域名：
                  {meta?.acme_domains?.length
                    ? meta.acme_domains.join("，")
                    : "未设置"}
                </p>
                {meta?.acme_email && <p>ACME 邮箱：{meta.acme_email}</p>}
                {meta?.cert_mode === "acme-dns" && (
                  <p>DNS 服务商：{meta?.acme_dns_provider ?? "未设置"}</p>
                )}
              </>
            ) : (
              <>
                <p>
                  证书路径：
                  {meta?.cert_path ?? "/etc/hysteria/server.crt"}
                </p>
                <p>
                  私钥路径：
                  {meta?.key_path ?? "/etc/hysteria/server.key"}
                </p>
              </>
            )}
          </div>
        </div>
      ),
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 p-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">节点管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {rows.length} 个节点
            {rows.filter((r) => isFresh(r.last_report_at)).length > 0 && (
              <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                · {rows.filter((r) => isFresh(r.last_report_at)).length} 个在线
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setHideIp((v) => !v)}
            title={hideIp ? "显示 IP" : "隐藏 IP"}
          >
            {hideIp ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            添加节点
          </Button>
        </div>
      </div>

      {/* 节点卡片网格 */}
      {rows.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Server className="mb-3 h-10 w-10 opacity-40" />
          <p className="text-sm">暂无节点</p>
          <p className="mt-1 text-xs">点击右上角「添加节点」创建第一个节点</p>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((row) => (
            <NodeCard
              key={row.id}
              row={{ ...row, dns_status: dnsStatusMap[row.id] ?? "skip" }}
              hourly={historyByNode[row.id] ?? buildEmptyHourly()}
              hideIp={hideIp}
              onEdit={startEdit}
              onRemove={removeNode}
              onToggleStatus={(r) =>
                void updateNode(r.id, {
                  status: r.status === "enabled" ? "disabled" : "enabled",
                })
              }
              onShowAgentConfig={(r) => void showAgentConfig(r)}
              onShowDeployCommand={(r) => void showDeployCommand(r)}
              onDnsResolve={(r) => void resolveDns(r)}
            />
          ))}
        </div>
      )}

      {/* 创建节点 - 右侧滑出面板 */}
      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent className="data-[side=right]:sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>添加节点</SheetTitle>
            <SheetDescription>
              创建新的 Hysteria2 节点，创建后可部署 Agent 上报流量。
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <NodeForm
              name={name}
              setName={setName}
              ip={ip}
              setIp={setIp}
              portInput={portInput}
              setPortInput={setPortInput}
              sni={sni}
              setSni={setSni}
              obfs={obfs}
              setObfs={setObfs}
              obfsPassword={obfsPassword}
              setObfsPassword={setObfsPassword}
              insecure={insecure}
              setInsecure={setInsecure}
              pinSha256={pinSha256}
              setPinSha256={setPinSha256}
              nodeIp={nodeIp}
              setNodeIp={setNodeIp}
              nodePortInput={nodePortInput}
              setNodePortInput={setNodePortInput}
              certMode={certMode}
              setCertMode={setCertMode}
              certPath={certPath}
              setCertPath={setCertPath}
              keyPath={keyPath}
              setKeyPath={setKeyPath}
              acmeDomainsInput={acmeDomainsInput}
              setAcmeDomainsInput={setAcmeDomainsInput}
              acmeEmail={acmeEmail}
              setAcmeEmail={setAcmeEmail}
              acmeDnsProvider={acmeDnsProvider}
              setAcmeDnsProvider={setAcmeDnsProvider}
              acmeCfToken={acmeCfToken}
              setAcmeCfToken={setAcmeCfToken}
              masqueradeType={masqueradeType}
              setMasqueradeType={setMasqueradeType}
              masqContent={masqContent}
              setMasqContent={setMasqContent}
              masqContentType={masqContentType}
              setMasqContentType={setMasqContentType}
              masqStatusCode={masqStatusCode}
              setMasqStatusCode={setMasqStatusCode}
              masqProxyUrl={masqProxyUrl}
              setMasqProxyUrl={setMasqProxyUrl}
              masqProxyRewriteHost={masqProxyRewriteHost}
              setMasqProxyRewriteHost={setMasqProxyRewriteHost}
              masqProxyInsecure={masqProxyInsecure}
              setMasqProxyInsecure={setMasqProxyInsecure}
              masqProxyXForwarded={masqProxyXForwarded}
              setMasqProxyXForwarded={setMasqProxyXForwarded}
              masqFileDir={masqFileDir}
              setMasqFileDir={setMasqFileDir}
              agentInterval={agentInterval}
              setAgentInterval={setAgentInterval}
              agentAutoUpdateEnabled={agentAutoUpdateEnabled}
              setAgentAutoUpdateEnabled={setAgentAutoUpdateEnabled}
              onSubmit={create}
              submitLabel="创建节点"
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* 编辑节点 - 右侧滑出面板 */}
      <Sheet
        open={editingRow !== null}
        onOpenChange={(open) => {
          if (!open) setEditingRow(null)
        }}
      >
        <SheetContent className="data-[side=right]:sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>编辑节点 {editingRow?.name}</SheetTitle>
            <SheetDescription>修改节点配置，保存后立即生效。</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <NodeForm
              name={editName}
              setName={setEditName}
              ip={editIp}
              setIp={setEditIp}
              portInput={editPortInput}
              setPortInput={setEditPortInput}
              sni={editSni}
              setSni={setEditSni}
              obfs={editObfs}
              setObfs={setEditObfs}
              obfsPassword={editObfsPassword}
              setObfsPassword={setEditObfsPassword}
              insecure={editInsecure}
              setInsecure={setEditInsecure}
              pinSha256={editPinSha256}
              setPinSha256={setEditPinSha256}
              nodeIp={editNodeIp}
              setNodeIp={setEditNodeIp}
              nodePortInput={editNodePortInput}
              setNodePortInput={setEditNodePortInput}
              certMode={editCertMode}
              setCertMode={setEditCertMode}
              certPath={editCertPath}
              setCertPath={setEditCertPath}
              keyPath={editKeyPath}
              setKeyPath={setEditKeyPath}
              acmeDomainsInput={editAcmeDomainsInput}
              setAcmeDomainsInput={setEditAcmeDomainsInput}
              acmeEmail={editAcmeEmail}
              setAcmeEmail={setEditAcmeEmail}
              acmeDnsProvider={editAcmeDnsProvider}
              setAcmeDnsProvider={setEditAcmeDnsProvider}
              acmeCfToken={editAcmeCfToken}
              setAcmeCfToken={setEditAcmeCfToken}
              masqueradeType={editMasqueradeType}
              setMasqueradeType={setEditMasqueradeType}
              masqContent={editMasqContent}
              setMasqContent={setEditMasqContent}
              masqContentType={editMasqContentType}
              setMasqContentType={setEditMasqContentType}
              masqStatusCode={editMasqStatusCode}
              setMasqStatusCode={setEditMasqStatusCode}
              masqProxyUrl={editMasqProxyUrl}
              setMasqProxyUrl={setEditMasqProxyUrl}
              masqProxyRewriteHost={editMasqProxyRewriteHost}
              setMasqProxyRewriteHost={setEditMasqProxyRewriteHost}
              masqProxyInsecure={editMasqProxyInsecure}
              setMasqProxyInsecure={setEditMasqProxyInsecure}
              masqProxyXForwarded={editMasqProxyXForwarded}
              setMasqProxyXForwarded={setEditMasqProxyXForwarded}
              masqFileDir={editMasqFileDir}
              setMasqFileDir={setEditMasqFileDir}
              agentInterval={editAgentInterval}
              setAgentInterval={setEditAgentInterval}
              agentAutoUpdateEnabled={editAgentAutoUpdateEnabled}
              setAgentAutoUpdateEnabled={setEditAgentAutoUpdateEnabled}
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
