"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import { Area, AreaChart, XAxis, YAxis } from "recharts"
import {
  Activity,
  Bot,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Globe,
  Info,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type DnsStatus = "match" | "partial" | "mismatch" | "unresolved" | "skip"
type DnsDeployDecision = "resolve" | "skip" | "exit"

type DnsStatusInfo = {
  status: DnsStatus
  detail?: string
}

type AgentTaskType =
  | "HY2_STATUS"
  | "HY2_START"
  | "HY2_STOP"
  | "HY2_RESTART"
  | "HY2_LOGS"
  | "AGENT_LOGS"
  | "AGENT_RESTART"
  | "APPLY_CONFIG"
  | "AGENT_SELF_UPDATE"

type AgentTaskStatus =
  | "queued"
  | "claimed"
  | "succeeded"
  | "failed"
  | "cancelled"

type AgentTaskRow = {
  id: number
  node_id: number
  type: AgentTaskType
  payload: string | null
  status: AgentTaskStatus
  result: string | null
  error: string | null
  created_at: string
  claimed_at: string | null
  lease_expires_at: string | null
  finished_at: string | null
  updated_at: string
}

type AgentDetail = {
  node: {
    id: number
    name: string
    agent_control_enabled: boolean
    agent_config_revision: number
    agent_desired_config_hash: string | null
    agent_interval: number
    agent_auto_update_enabled: boolean
  }
  desired_config: {
    revision: number
    hash: string
    config_path: string
    service_name: string
  } | null
  state: Record<string, unknown> | null
  recent_tasks: AgentTaskRow[]
}

type NodeRow = {
  id: number
  name: string
  remark: string | null
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
  agent_control_enabled: 0 | 1 | null
  agent_config_revision: number | null
  agent_desired_config_hash: string | null
  agent_last_config_built_at: string | null
  agent_last_seen_at: string | null
  control_agent_version: string | null
  hostname: string | null
  os: string | null
  arch: string | null
  service_manager: string | null
  hy2_status: string | null
  hy2_version: string | null
  hysteria_config_path: string | null
  hysteria_config_hash: string | null
  applied_config_revision: number | null
  last_config_apply_at: string | null
  last_error: string | null
  capabilities: string | null
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
  dns_status_detail?: string | null
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

// 控制面心跳判定：最近 3 分钟内同步视为在线
const AGENT_FRESH_THRESHOLD_MS = 3 * 60 * 1000

const TASK_LABEL: Record<AgentTaskType, string> = {
  HY2_STATUS: "检查 Hysteria2 状态",
  HY2_START: "启动 Hysteria2",
  HY2_STOP: "停止 Hysteria2",
  HY2_RESTART: "重启 Hysteria2",
  HY2_LOGS: "查看 Hysteria2 日志",
  AGENT_LOGS: "查看 Agent 日志",
  AGENT_RESTART: "重启 Agent",
  APPLY_CONFIG: "应用配置",
  AGENT_SELF_UPDATE: "Agent 自更新",
}

const TASK_STATUS_LABEL: Record<AgentTaskStatus, string> = {
  queued: "排队中",
  claimed: "执行中",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
}

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
    description: "所有 DNS 源均已指向正确 IP",
  },
  partial: {
    label: "DNS 部分生效",
    shortLabel: "部分生效",
    dotClassName: "bg-blue-500 shadow-[0_0_4px_rgba(59,130,246,0.6)]",
    badgeClassName: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    description: "部分 DNS 源已指向正确 IP，仍在传播或存在缓存差异",
  },
  mismatch: {
    label: "DNS 不匹配",
    shortLabel: "不匹配",
    dotClassName: "bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.6)]",
    badgeClassName: "bg-red-500/15 text-red-700 dark:text-red-400",
    description: "所有已解析 DNS 源均未指向节点 IP",
  },
  unresolved: {
    label: "DNS 未解析",
    shortLabel: "未解析",
    dotClassName: "bg-yellow-500 shadow-[0_0_4px_rgba(234,179,8,0.6)]",
    badgeClassName: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
    description: "所有 DNS 源均无法解析该域名",
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

function isAgentFresh(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false
  return (
    Date.now() - parseSqliteUtc(lastSeenAt).getTime() < AGENT_FRESH_THRESHOLD_MS
  )
}

function getNodeStatusLight(
  trafficFresh: boolean,
  agentFresh: boolean,
  hy2Status: string | null
) {
  if (trafficFresh && agentFresh) {
    return {
      className: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]",
      title: "流量上报与控制面均在线",
    }
  }
  if (trafficFresh) {
    return {
      className: "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.5)]",
      title: "流量上报在线，控制面离线",
    }
  }
  if (agentFresh) {
    if (hy2Status === "failed") {
      return {
        className: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]",
        title: "控制面在线，Hysteria2 异常",
      }
    }
    return {
      className: "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.5)]",
      title:
        hy2Status === "stopped"
          ? "控制面在线，Hysteria2 已停止"
          : "控制面在线，暂无流量上报",
    }
  }
  return {
    className: "bg-muted-foreground/40",
    title: "流量上报与控制面均离线",
  }
}

function getHy2StatusLabel(status: string | null) {
  if (status === "running") return "Hysteria2 运行中"
  if (status === "stopped") return "Hysteria2 已停止"
  if (status === "failed") return "Hysteria2 异常"
  if (status === "unknown") return "Hysteria2 未知"
  return status || "Hysteria2 未知"
}

function getHy2StatusClass(status: string | null) {
  if (status === "running") {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
  }
  if (status === "stopped") return "bg-muted text-muted-foreground"
  if (status === "failed") return "bg-red-500/15 text-red-700 dark:text-red-400"
  return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300"
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
  onQueueAgentTask,
  onShowAgentDetail,
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
  onQueueAgentTask: (row: NodeRow, type: AgentTaskType) => void
  onShowAgentDetail: (row: NodeRow) => void
}) {
  const fresh = isFresh(row.last_report_at)
  const agentFresh = isAgentFresh(row.agent_last_seen_at)
  const displayAgentVersion = row.control_agent_version
  const onlineCount = row.online_count ?? 0
  const dnsStatusMeta = getDnsStatusMeta(row.dns_status)
  const dnsStatusTitle = row.dns_status_detail || dnsStatusMeta?.description
  const statusLight = getNodeStatusLight(fresh, agentFresh, row.hy2_status)

  // 计算今日上传/下载
  const todayTx = hourly.reduce((sum, h) => sum + h.txBytes, 0)
  const todayRx = hourly.reduce((sum, h) => sum + h.rxBytes, 0)

  return (
    <Card className="relative h-48 overflow-hidden">
      {/* 流量图 - 作为卡片背景 */}
      <NodeTrafficChart hourly={hourly} />

      {/* 渐变遮罩 - 确保文字可读 */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card/95 via-card/70 to-card/30" />

      {displayAgentVersion && (
        <Badge
          className="absolute right-3 bottom-3 z-10 bg-muted px-1.5 py-0 font-mono text-[10px] text-muted-foreground"
          title={`Agent 版本：${displayAgentVersion}`}
        >
          <Bot className="mr-0.5 h-2.5 w-2.5" />
          {displayAgentVersion}
        </Badge>
      )}

      {/* 节点信息 - 叠加在图表上 */}
      <div className="relative flex h-full flex-col justify-between p-3">
        {/* 顶部：名称 + 状态 */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <h3 className="truncate text-sm font-semibold">{row.name}</h3>
              {row.remark && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex shrink-0 cursor-help text-muted-foreground hover:text-foreground">
                      <Info className="h-3.5 w-3.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-70 break-words whitespace-pre-wrap">
                    {row.remark}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {hideIp ? row.ip.replace(/[^.]/g, "*") : row.ip}:
              {row.port_hopping ?? row.port}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* 节点综合状态指示灯 */}
            <span
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                statusLight.className
              )}
              title={statusLight.title}
            />
            {/* 更多操作菜单 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="h-6 w-6">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
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
                <DropdownMenuItem onClick={() => onShowAgentDetail(row)}>
                  <Bot className="h-4 w-4" />
                  Agent 状态
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Server className="h-4 w-4" />
                    Hy2 操作
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-44">
                    <DropdownMenuItem
                      onClick={() => onQueueAgentTask(row, "APPLY_CONFIG")}
                    >
                      <RefreshCw className="h-4 w-4" />
                      下发配置
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onQueueAgentTask(row, "HY2_RESTART")}
                    >
                      <RotateCw className="h-4 w-4" />
                      重启 Hysteria2
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onQueueAgentTask(row, "HY2_START")}
                    >
                      <Play className="h-4 w-4" />
                      启动 Hysteria2
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onQueueAgentTask(row, "HY2_STOP")}
                    >
                      <Square className="h-4 w-4" />
                      停止 Hysteria2
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onQueueAgentTask(row, "HY2_LOGS")}
                    >
                      <FileText className="h-4 w-4" />
                      Hysteria2 日志
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
                            title={dnsStatusTitle}
                          />
                        )}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Bot className="h-4 w-4" />
                    Agent 操作
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-44">
                    <DropdownMenuItem
                      onClick={() => onQueueAgentTask(row, "AGENT_RESTART")}
                    >
                      <RotateCw className="h-4 w-4" />
                      重启 Agent
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onQueueAgentTask(row, "AGENT_LOGS")}
                    >
                      <FileText className="h-4 w-4" />
                      Agent 日志
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onQueueAgentTask(row, "AGENT_SELF_UPDATE")}
                    >
                      <Bot className="h-4 w-4" />
                      Agent 自更新
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
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
                title={dnsStatusTitle}
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
            {!fresh && !agentFresh && row.last_report_at && (
              <Badge className="bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
                离线
              </Badge>
            )}
            {!fresh && agentFresh && row.hy2_status === "running" && (
              <Badge
                className="bg-yellow-500/15 px-1.5 py-0 text-[10px] text-yellow-700 dark:text-yellow-300"
                title="控制面在线且 Hysteria2 运行中，但最近未收到流量上报"
              >
                流量异常
              </Badge>
            )}
            {row.hy2_status && (
              <Badge
                className={cn(
                  "px-1.5 py-0 text-[10px]",
                  getHy2StatusClass(row.hy2_status)
                )}
              >
                {getHy2StatusLabel(row.hy2_status)}
              </Badge>
            )}
          </div>

          {/* 今日流量 */}
          <div className="flex items-center gap-2 pr-20 text-[11px]">
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
  remark,
  setRemark,
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
  agentControlEnabled,
  setAgentControlEnabled,
  onSubmit,
  submitLabel,
  onCancel,
}: {
  // 订阅配置
  name: string
  setName: (v: string) => void
  remark: string
  setRemark: (v: string) => void
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
  agentControlEnabled: boolean
  setAgentControlEnabled: (v: boolean) => void
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
            <Label>备注</Label>
            <Textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="可选，仅管理员可见"
              rows={2}
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
              <Label>控制面同步</Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                允许 Agent 拉取配置和执行 Hysteria2 管理任务。
              </p>
            </div>
            <Switch
              checked={agentControlEnabled}
              onCheckedChange={setAgentControlEnabled}
            />
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
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [historyByNode, setHistoryByNode] = useState<
    Record<number, HourPoint[]>
  >({})

  // 创建面板
  const [hideIp, setHideIp] = useState(false)
  const [dnsStatusMap, setDnsStatusMap] = useState<
    Record<number, DnsStatusInfo>
  >({})
  const dnsStatusRequestSeq = useRef(0)
  const dnsDeployDecisionResolveRef = useRef<
    ((decision: DnsDeployDecision) => void) | null
  >(null)
  const [dnsDeployDialog, setDnsDeployDialog] = useState<{
    description: string
  } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [remark, setRemark] = useState("")
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
  const [agentControlEnabled, setAgentControlEnabled] = useState(true)

  // 编辑面板
  const [editingRow, setEditingRow] = useState<NodeRow | null>(null)
  const [editName, setEditName] = useState("")
  const [editRemark, setEditRemark] = useState("")
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
  const [editAgentControlEnabled, setEditAgentControlEnabled] = useState(true)
  const [agentDetailRow, setAgentDetailRow] = useState<NodeRow | null>(null)
  const [agentDetail, setAgentDetail] = useState<AgentDetail | null>(null)
  const [agentDetailLoading, setAgentDetailLoading] = useState(false)

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

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refreshNodes()
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }

  function promptDnsDeployDecision(description: string) {
    return new Promise<DnsDeployDecision>((resolve) => {
      dnsDeployDecisionResolveRef.current = resolve
      setDnsDeployDialog({ description })
    })
  }

  function closeDnsDeployDialog(decision: DnsDeployDecision) {
    const resolve = dnsDeployDecisionResolveRef.current
    dnsDeployDecisionResolveRef.current = null
    setDnsDeployDialog(null)
    resolve?.(decision)
  }

  async function loadDnsStatus() {
    const requestSeq = dnsStatusRequestSeq.current + 1
    dnsStatusRequestSeq.current = requestSeq

    try {
      const res = await fetch("/api/admin/nodes/dns-status")
      const json = await res.json()
      if (
        requestSeq === dnsStatusRequestSeq.current &&
        json?.ok &&
        json.data &&
        typeof json.data === "object"
      ) {
        const nextMap: Record<number, DnsStatusInfo> = {}
        for (const [rawId, rawValue] of Object.entries(json.data)) {
          const id = Number(rawId)
          if (!Number.isInteger(id) || id <= 0) continue
          if (typeof rawValue === "string") {
            nextMap[id] = { status: rawValue as DnsStatus }
            continue
          }
          if (rawValue && typeof rawValue === "object") {
            const item = rawValue as { status?: unknown; detail?: unknown }
            if (typeof item.status !== "string") continue
            nextMap[id] = {
              status: item.status as DnsStatus,
              detail: typeof item.detail === "string" ? item.detail : undefined,
            }
          }
        }
        setDnsStatusMap(nextMap)
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
      try {
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
      } finally {
        if (mounted) setLoading(false)
      }
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

  async function resolveDns(
    row: NodeRow,
    opts: { showSuccessAlert?: boolean } = {}
  ): Promise<boolean> {
    const showSuccessAlert = opts.showSuccessAlert ?? true

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
        return false
      }
      const d = json.data
      const actionText =
        d.action === "created"
          ? "已创建"
          : d.action === "updated"
            ? "已更新"
            : "已是最新"
      if (showSuccessAlert) {
        await alert({
          title: "DNS 解析成功",
          description: `${d.domain} → ${d.ip}（${actionText}，Zone: ${d.zone}）`,
        })
      }
      await refreshPromise.catch(() => undefined)
      return true
    } catch {
      await alert({
        title: "DNS 解析失败",
        description: "网络错误，请稍后重试",
        variant: "destructive",
      })
      await refreshNodes().catch(() => undefined)
      return false
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
        remark: remark || null,
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
        agentControlEnabled,
      }),
    })

    const json = await response.json()
    if (!response.ok || !json.ok) return

    setName("")
    setRemark("")
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
    setAgentControlEnabled(true)
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
    setEditRemark(row.remark ?? "")
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
    setEditAgentControlEnabled(row.agent_control_enabled !== 0)
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
      remark: editRemark || null,
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
      agentControlEnabled: editAgentControlEnabled,
    })

    setEditingRow(null)
  }

  async function showAgentConfig(row: NodeRow) {
    const response = await fetch(`/api/admin/nodes/${row.id}/agent-config`)
    const json = await response.json()

    if (
      !response.ok ||
      !json?.ok ||
      typeof json.data?.config_json !== "string"
    ) {
      await alert({
        title: "获取 Agent 配置失败",
        description: json?.error?.message ?? "请稍后重试",
        variant: "destructive",
      })
      return
    }

    const config = json.data.config_json as string

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

  async function queueAgentTask(row: NodeRow, type: AgentTaskType) {
    const payload =
      type === "HY2_LOGS" || type === "AGENT_LOGS" ? { lines: 160 } : null
    const confirmDescriptions: Partial<Record<AgentTaskType, string>> = {
      HY2_STOP: "停止 Hysteria2 会中断当前节点连接，确认继续？",
      AGENT_RESTART: "重启 Agent 会短暂中断控制面同步和流量上报，确认继续？",
      AGENT_SELF_UPDATE: "Agent 自更新成功后会自动重启服务，确认继续？",
    }
    const confirmDescription = confirmDescriptions[type]
    if (confirmDescription) {
      const ok = await confirm({
        title: `${TASK_LABEL[type]}？`,
        description: confirmDescription,
        confirmText: "继续",
      })
      if (!ok) return
    }

    const response = await fetch(`/api/admin/nodes/${row.id}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, payload }),
    })
    const json = await response.json()
    if (!response.ok || !json?.ok) {
      await alert({
        title: "创建任务失败",
        description: json?.error?.message ?? "请稍后重试",
        variant: "destructive",
      })
      return
    }

    await alert({
      title: "任务已创建",
      description: `${TASK_LABEL[type]} 已进入队列，Agent 下次同步时会执行。`,
    })
    await load()
    if (agentDetailRow?.id === row.id) {
      await loadAgentDetail(row)
    }
  }

  async function loadAgentDetail(row: NodeRow) {
    setAgentDetailRow(row)
    setAgentDetail(null)
    setAgentDetailLoading(true)
    try {
      const response = await fetch(`/api/admin/nodes/${row.id}/agent`)
      const json = await response.json()
      if (!response.ok || !json?.ok) {
        await alert({
          title: "获取 Agent 状态失败",
          description: json?.error?.message ?? "请稍后重试",
          variant: "destructive",
        })
        return
      }
      setAgentDetail(json.data as AgentDetail)
    } finally {
      setAgentDetailLoading(false)
    }
  }

  function parseTaskOutput(task: AgentTaskRow) {
    const raw = task.result || task.error
    if (!raw) return ""
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === "object" && "logs" in parsed) {
        const logs = (parsed as { logs?: unknown }).logs
        return typeof logs === "string" ? logs : raw
      }
      return JSON.stringify(parsed, null, 2)
    } catch {
      return raw
    }
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
      const decision = await promptDnsDeployDecision(
        `当前节点使用 ACME 证书模式，但${statusText}。建议先更新 DNS 解析再部署，否则 ACME 证书签发可能失败。`
      )
      if (decision === "exit") return
      if (decision === "resolve") {
        const resolved = await resolveDns(row, { showSuccessAlert: false })
        if (!resolved) return
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
    <>
      <Dialog
        open={dnsDeployDialog !== null}
        onOpenChange={(next) => {
          if (!next) closeDnsDeployDialog("exit")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>DNS 解析状态异常</DialogTitle>
            <DialogDescription>
              {dnsDeployDialog?.description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => closeDnsDeployDialog("skip")}
            >
              先不更新
            </Button>
            <Button onClick={() => closeDnsDeployDialog("resolve")}>
              更新 DNS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 p-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">节点管理</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              共 {rows.length} 个节点
              {rows.filter((r) => isFresh(r.last_report_at)).length > 0 && (
                <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                  · {rows.filter((r) => isFresh(r.last_report_at)).length}{" "}
                  个在线
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
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              title="刷新节点数据"
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshing && "animate-spin")}
              />
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              添加节点
            </Button>
          </div>
        </div>

        {/* 节点卡片网格 */}
        {loading ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Card key={index} className="h-48 overflow-hidden">
                <CardContent className="flex h-full flex-col justify-between p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-3 w-36" />
                    </div>
                    <Skeleton className="size-6 rounded-md" />
                  </div>
                  <div className="space-y-2">
                    <div className="flex gap-1">
                      <Skeleton className="h-4 w-12" />
                      <Skeleton className="h-4 w-14" />
                    </div>
                    <Skeleton className="h-3 w-40" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : rows.length === 0 ? (
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
                row={{
                  ...row,
                  dns_status: dnsStatusMap[row.id]?.status ?? "skip",
                  dns_status_detail: dnsStatusMap[row.id]?.detail ?? null,
                }}
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
                onQueueAgentTask={(r, type) => void queueAgentTask(r, type)}
                onShowAgentDetail={(r) => void loadAgentDetail(r)}
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
                remark={remark}
                setRemark={setRemark}
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
                agentControlEnabled={agentControlEnabled}
                setAgentControlEnabled={setAgentControlEnabled}
                onSubmit={create}
                submitLabel="创建节点"
              />
            </div>
          </SheetContent>
        </Sheet>

        {/* Agent 状态 - 右侧滑出面板 */}
        <Sheet
          open={agentDetailRow !== null}
          onOpenChange={(open) => {
            if (!open) {
              setAgentDetailRow(null)
              setAgentDetail(null)
            }
          }}
        >
          <SheetContent className="data-[side=right]:sm:max-w-xl">
            <SheetHeader>
              <SheetTitle>Agent 状态 {agentDetailRow?.name}</SheetTitle>
              <SheetDescription>
                查看控制面状态、配置同步进度和最近任务结果。
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
              {agentDetailLoading ? (
                <div className="space-y-3 pt-2">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-40 w-full" />
                </div>
              ) : agentDetail ? (
                <>
                  <Card>
                    <CardHeader className="p-4 pb-1">
                      <CardTitle className="text-base leading-none font-semibold">
                        当前状态
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">控制面</span>
                          <p className="font-medium">
                            {isAgentFresh(
                              (agentDetail.state?.last_seen_at as
                                | string
                                | null) ?? null
                            )
                              ? "在线"
                              : "离线"}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            Hysteria2
                          </span>
                          <p className="font-medium">
                            {getHy2StatusLabel(
                              (agentDetail.state?.hy2_status as
                                | string
                                | null) ?? null
                            )}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">主机</span>
                          <p className="font-mono break-all">
                            {(agentDetail.state?.hostname as string | null) ??
                              "-"}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">系统</span>
                          <p className="font-mono">
                            {[
                              agentDetail.state?.os as string | null,
                              agentDetail.state?.arch as string | null,
                            ]
                              .filter(Boolean)
                              .join("/") || "-"}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Agent</span>
                          <p className="font-mono">
                            {(agentDetail.state?.agent_version as
                              | string
                              | null) ?? "-"}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            最后同步
                          </span>
                          <p className="font-mono text-[11px]">
                            {(agentDetail.state?.last_seen_at as
                              | string
                              | null) ?? "-"}
                          </p>
                        </div>
                      </div>
                      {typeof agentDetail.state?.last_error === "string" &&
                        agentDetail.state.last_error && (
                          <div className="rounded bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300">
                            {agentDetail.state.last_error}
                          </div>
                        )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="p-4 pb-1">
                      <CardTitle className="text-base leading-none font-semibold">
                        配置同步
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      <div className="flex flex-wrap gap-2">
                        <Badge>
                          目标 r{agentDetail.desired_config?.revision ?? "-"}
                        </Badge>
                        <Badge>
                          已应用 r
                          {(agentDetail.state?.applied_config_revision as
                            | number
                            | null) ?? "-"}
                        </Badge>
                      </div>
                      <p className="font-mono text-[11px] break-all text-muted-foreground">
                        目标 Hash：{agentDetail.desired_config?.hash ?? "-"}
                      </p>
                      <p className="font-mono text-[11px] break-all text-muted-foreground">
                        当前 Hash：
                        {(agentDetail.state?.hysteria_config_hash as
                          | string
                          | null) ?? "-"}
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="p-4 pb-1">
                      <CardTitle className="text-base leading-none font-semibold">
                        最近任务
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {agentDetail.recent_tasks.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          暂无任务
                        </p>
                      ) : (
                        agentDetail.recent_tasks.map((task) => {
                          const output = parseTaskOutput(task)
                          return (
                            <div
                              key={task.id}
                              className="rounded border p-2 text-xs"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">
                                  #{task.id}{" "}
                                  {TASK_LABEL[task.type] ?? task.type}
                                </span>
                                <Badge
                                  className={cn(
                                    "text-[10px]",
                                    task.status === "succeeded" &&
                                      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                                    task.status === "failed" &&
                                      "bg-red-500/15 text-red-700 dark:text-red-400",
                                    (task.status === "queued" ||
                                      task.status === "claimed") &&
                                      "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300"
                                  )}
                                >
                                  {TASK_STATUS_LABEL[task.status] ??
                                    task.status}
                                </Badge>
                              </div>
                              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                                {task.created_at}
                              </p>
                              {output && (
                                <pre className="mt-2 max-h-52 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">
                                  {output}
                                </pre>
                              )}
                            </div>
                          )
                        })
                      )}
                    </CardContent>
                  </Card>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">暂无 Agent 状态</p>
              )}
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
              <SheetDescription>
                修改节点配置，保存后立即生效。
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <NodeForm
                name={editName}
                setName={setEditName}
                remark={editRemark}
                setRemark={setEditRemark}
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
                agentControlEnabled={editAgentControlEnabled}
                setAgentControlEnabled={setEditAgentControlEnabled}
                onSubmit={submitEdit}
                submitLabel="保存修改"
                onCancel={() => setEditingRow(null)}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
