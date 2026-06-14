"use client"

import {
  CSSProperties,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { toast } from "sonner"
import { Area, AreaChart, XAxis, YAxis } from "recharts"
import {
  Activity,
  ArrowUpDown,
  Bot,
  ChevronDown,
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
import {
  ACME_CA_PROVIDERS,
  ACME_DNS_PROVIDER_FIELDS,
  ACME_DNS_PROVIDERS,
  ACME_DNS_PROVIDER_LABELS,
  NODE_ACME_CA_PROVIDER_LABELS,
  isAcmeDnsProvider,
  type NodeAcmeCaProvider,
} from "@/lib/acme-config"
import {
  parseAgentTaskOutput,
  type AgentLogEntry,
} from "@/lib/agent-task-output"
import { COUNTRY_OPTIONS } from "@/lib/country-options"
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { isAgentTaskTimeoutError } from "@/lib/agent-task-timeout"
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
  | "HY2_SELF_UPDATE"
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

type HostTrafficResetCycle =
  | "none"
  | "daily"
  | "weekly"
  | "monthly"
  | "custom_days"

type HostTrafficBillingMode = "tx_rx" | "tx" | "rx"
type CongestionType = "default" | "bbr" | "reno"
type CongestionBbrProfile = "standard" | "conservative" | "aggressive"
type AcmeDnsConfigDraft = Record<string, string>

type HostTrafficUnit = "GB" | "TB"

const NODE_ACME_CA_PROVIDERS: NodeAcmeCaProvider[] = [
  "inherit",
  ...ACME_CA_PROVIDERS,
]

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
    hy2_auto_update_enabled: boolean
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
  sort_order: number
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
  obfs_min_packet_size: number | null
  obfs_max_packet_size: number | null
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
  public_ip: string | null
  public_ip_source: string | null
  public_ip_updated_at: string | null
  geo_country_code: string | null
  geo_country_name: string | null
  geo_region: string | null
  geo_city: string | null
  geo_latitude: number | null
  geo_longitude: number | null
  geo_timezone: string | null
  geo_asn: string | null
  geo_org: string | null
  geo_provider: string | null
  geo_updated_at: string | null
  geo_override: string | null
  // 节点配置
  node_ipv4: string | null
  node_ipv6: string | null
  node_port: number | null
  node_port_hopping: string | null
  cert_mode: string
  cert_path: string | null
  key_path: string | null
  acme_domains: string | null
  acme_email: string | null
  acme_ca_provider: NodeAcmeCaProvider | null
  acme_ca_url: string | null
  acme_dns_provider: string | null
  acme_dns_config: string | null
  masquerade_type: string | null
  masquerade_config: string | null
  agent_interval: number | null
  agent_auto_update_enabled: 0 | 1 | null
  hy2_auto_update_enabled: 0 | 1 | null
  server_bandwidth_up_mbps: number | null
  server_bandwidth_down_mbps: number | null
  ignore_client_bandwidth: 0 | 1 | null
  quic_init_stream_receive_window: number | null
  quic_max_stream_receive_window: number | null
  quic_init_conn_receive_window: number | null
  quic_max_conn_receive_window: number | null
  quic_max_idle_timeout_seconds: number | null
  quic_max_incoming_streams: number | null
  quic_disable_path_mtu_discovery: 0 | 1 | null
  congestion_type: Exclude<CongestionType, "default"> | null
  congestion_bbr_profile: CongestionBbrProfile | null
  host_traffic_limit_bytes: number | null
  host_traffic_used_bytes: number | null
  host_traffic_billing_mode: HostTrafficBillingMode | null
  host_traffic_reset_cycle: HostTrafficResetCycle | null
  host_traffic_reset_interval_days: number | null
  host_traffic_reset_anchor: string | null
  host_traffic_last_reset_at: string | null
  host_traffic_remaining_bytes: number | null
  host_traffic_usage_ratio: number | null
  host_traffic_next_reset_at: string | null
  host_traffic_over_limit: boolean
  acl_profile_id: number | null
  acl_profile_name: string | null
  outbound_profile_id: number | null
  outbound_profile_name: string | null
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
const HOST_TRAFFIC_UNIT_MULTIPLIER: Record<HostTrafficUnit, number> = {
  GB: 1024 ** 3,
  TB: 1024 ** 4,
}

const HOST_TRAFFIC_RESET_LABEL: Record<HostTrafficResetCycle, string> = {
  none: "不自动重置",
  daily: "每天",
  weekly: "每周",
  monthly: "每月",
  custom_days: "每 N 天",
}

const HOST_TRAFFIC_BILLING_LABEL: Record<HostTrafficBillingMode, string> = {
  tx_rx: "上行 + 下行",
  tx: "仅上行",
  rx: "仅下行",
}

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
  HY2_SELF_UPDATE: "更新 Hysteria2",
  AGENT_LOGS: "查看 Agent 日志",
  AGENT_RESTART: "重启 Agent",
  APPLY_CONFIG: "应用配置",
  AGENT_SELF_UPDATE: "更新 Agent",
}

const TASK_STATUS_LABEL: Record<AgentTaskStatus, string> = {
  queued: "排队中",
  claimed: "执行中",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
}

function isTimedOutTask(task: AgentTaskRow) {
  return task.status === "failed" && isAgentTaskTimeoutError(task.error)
}

function getTaskStatusLabel(task: AgentTaskRow) {
  if (isTimedOutTask(task)) return "超时"
  return TASK_STATUS_LABEL[task.status] ?? task.status
}

function getTaskStatusClass(task: AgentTaskRow) {
  if (task.status === "succeeded") {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
  }
  if (isTimedOutTask(task)) {
    return "bg-orange-500/15 text-orange-700 dark:text-orange-400"
  }
  if (task.status === "failed") {
    return "bg-red-500/15 text-red-700 dark:text-red-400"
  }
  if (task.status === "queued" || task.status === "claimed") {
    return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300"
  }
  return ""
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
    description: "所有已解析 DNS 源均未指向节点公网地址",
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

function formatHy2Version(version: string | null) {
  if (!version) return null
  const value = version.trim()
  if (!value) return null
  const labeledMatch = value.match(
    /^\s*Version:\s*(?:app\/)?v?(\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?)\b/im
  )
  if (labeledMatch?.[1]) return labeledMatch[1]
  const tagMatch = value.match(
    /^(?:app\/)?v?(\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?)$/i
  )
  return tagMatch?.[1] ?? null
}

function hasAgentCapability(row: NodeRow, capability: string) {
  if (!row.capabilities) return false
  try {
    const parsed = JSON.parse(row.capabilities) as unknown
    return Array.isArray(parsed) && parsed.includes(capability)
  } catch {
    return false
  }
}

function normalizeCountryFilter(code: string | null) {
  const normalized = code?.trim().toUpperCase()
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : null
}

function getCountryOption(code: string | null) {
  const normalized = normalizeCountryFilter(code)
  if (!normalized) return null
  return COUNTRY_OPTIONS.find((item) => item.code === normalized) ?? null
}

function getCountryFlagUrl(countryCode: string | null) {
  const code = countryCode?.trim().toLowerCase()
  if (!code || !/^[a-z]{2}$/.test(code)) return null
  return `https://flagcdn.com/w40/${code}.png`
}

function getNodeGeoTitle(row: NodeRow, hideIp: boolean) {
  const manual = row.geo_provider === "manual"
  const lines = [
    row.geo_country_name || row.geo_country_code
      ? `位置：${[row.geo_country_name, row.geo_region, row.geo_city]
          .filter(Boolean)
          .join(" / ")}`
      : null,
    manual ? "来源：手动覆盖" : null,
    row.geo_asn ? `ASN：${row.geo_asn}` : null,
    row.geo_org ? `运营商：${row.geo_org}` : null,
    !hideIp && row.public_ip ? `公网 IP：${row.public_ip}` : null,
    !manual && row.public_ip_source
      ? `来源：${row.public_ip_source === "agent" ? "Agent 探测" : "面板观测"}`
      : null,
    !manual && row.geo_updated_at
      ? `GeoIP 更新时间：${row.geo_updated_at}`
      : null,
  ].filter(Boolean)

  return lines.length > 0 ? lines.join("\n") : undefined
}

type GeoOverrideDraft = {
  countryCode: string
  countryName: string
  region: string
  city: string
  latitude: string
  longitude: string
}

function emptyGeoOverrideDraft(): GeoOverrideDraft {
  return {
    countryCode: "",
    countryName: "",
    region: "",
    city: "",
    latitude: "",
    longitude: "",
  }
}

function parseGeoOverrideDraft(raw: string | null): GeoOverrideDraft {
  if (!raw) return emptyGeoOverrideDraft()
  try {
    const parsed = JSON.parse(raw) as Partial<{
      countryCode: string | null
      countryName: string | null
      region: string | null
      city: string | null
      latitude: number | null
      longitude: number | null
    }>
    return {
      countryCode: parsed.countryCode ?? "",
      countryName: parsed.countryName ?? "",
      region: "",
      city: "",
      latitude: "",
      longitude: "",
    }
  } catch {
    return emptyGeoOverrideDraft()
  }
}

function buildGeoOverridePayload(draft: GeoOverrideDraft) {
  const countryCode = draft.countryCode.trim().toUpperCase()
  const countryName = draft.countryName.trim()
  const region = draft.region.trim()
  const city = draft.city.trim()
  const latitude = draft.latitude.trim()
  const longitude = draft.longitude.trim()

  if (
    !countryCode &&
    !countryName &&
    !region &&
    !city &&
    !latitude &&
    !longitude
  ) {
    return null
  }

  return {
    countryCode: countryCode || null,
    countryName: countryName || null,
    region: region || null,
    city: city || null,
    latitude: latitude ? Number(latitude) : null,
    longitude: longitude ? Number(longitude) : null,
  }
}

function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0
  return Math.min(23, Math.max(0, Math.floor(hour)))
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "0 B"
  const sign = bytes < 0 ? "-" : ""
  let value = Math.abs(bytes)
  if (value <= 0) return "0 B"

  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  const decimals = idx === 0 ? 0 : value >= 100 ? 1 : 2
  return `${sign}${value.toFixed(decimals)} ${units[idx]}`
}

function formatLocalDateTime(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ""

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hour = String(date.getHours()).padStart(2, "0")
  const minute = String(date.getMinutes()).padStart(2, "0")
  const second = String(date.getSeconds()).padStart(2, "0")
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

function formatLocalDateTimeInput(value: string | null): string {
  return formatLocalDateTime(value).replace(" ", "T")
}

function certModeLabel(value: string | undefined) {
  if (value === "acme-http") return "ACME HTTP"
  if (value === "acme-dns" || value === "acme") return "ACME DNS"
  if (value === "custom") return "自定义证书"
  return "自签证书"
}

function acmeDnsProviderLabel(value: string | null | undefined) {
  if (!value) return "未设置"
  return isAcmeDnsProvider(value) ? ACME_DNS_PROVIDER_LABELS[value] : value
}

function acmeCaLabel(
  value:
    | {
        provider?: string
        url?: string | null
        source?: "node" | "global"
      }
    | null
    | undefined
) {
  const source = value?.source === "node" ? "节点覆盖" : "全局默认"
  if (value?.provider === "custom")
    return `${source} · ${value.url ?? "自定义"}`
  if (value?.provider === "zerossl") return `${source} · ZeroSSL`
  return `${source} · Let’s Encrypt`
}

function DeployInfoItem({
  label,
  value,
  mono = false,
}: {
  label: string
  value: ReactNode
  mono?: boolean
}) {
  return (
    <div className="rounded-lg border bg-background/60 p-3">
      <div className="text-[11px] font-medium text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 min-h-5 text-sm font-medium break-all text-foreground",
          mono && "font-mono text-xs"
        )}
      >
        {value || "-"}
      </div>
    </div>
  )
}

function serializeLocalDateTimeInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return date.toISOString()
}

function getHostTrafficLimitValue(
  bytes: number | null,
  unit: HostTrafficUnit
): string {
  if (!bytes || bytes <= 0) return ""
  const value = bytes / HOST_TRAFFIC_UNIT_MULTIPLIER[unit]
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function buildHostTrafficLimitBytes(
  value: string,
  unit: HostTrafficUnit
): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n * HOST_TRAFFIC_UNIT_MULTIPLIER[unit])
}

function getSecureRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
    return bytes
  }

  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256)
  }

  return bytes
}

function pickRandomChars(length: number, alphabet: string): string {
  const bytes = getSecureRandomBytes(length)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")
}

function shuffleRandomChars(chars: string[]): string {
  const priorities = getSecureRandomBytes(chars.length)
  return chars
    .map((char, index) => ({ char, priority: priorities[index] ?? 0 }))
    .sort((a, b) => a.priority - b.priority)
    .map((item) => item.char)
    .join("")
}

function generateAcmeEmail(domain: string | null): string {
  const mailboxDomain = domain ?? "example.com"
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_"
  return `acme-${pickRandomChars(12, alphabet).toLowerCase()}@${mailboxDomain}`
}

function obfsRequiresPassword(obfs: string): boolean {
  return obfs === "salamander" || obfs === "gecko"
}

function generateStrongObfsPassword(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
  const numbers = "23456789"
  const symbols = "!#$%&()*+,-./:;<=>?@[]^_{|}~"
  const chars = [
    ...pickRandomChars(10, letters),
    ...pickRandomChars(6, numbers),
    ...pickRandomChars(16, symbols),
  ]

  return shuffleRandomChars(chars)
}

function getAutoFillDomain(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null

  let host = raw
  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
    )
    host = url.hostname
  } catch {
    host = raw.split(/[/?#]/, 1)[0] ?? raw
  }

  host = host.trim()
  if (!host) return null
  if (host.startsWith("[") && host.endsWith("]")) return null
  if (host.includes("@")) host = host.slice(host.lastIndexOf("@") + 1)

  const colonCount = (host.match(/:/g) ?? []).length
  if (colonCount > 1) return null
  if (colonCount === 1) host = host.split(":")[0] ?? host

  host = host.replace(/\.$/, "").toLowerCase()
  if (!host || host === "localhost") return null
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null
  if (!host.includes(".")) return null

  const labels = host.split(".")
  const isValidDomain = labels.every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
  )

  return isValidDomain ? host : null
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

function NodeFormSection({
  title,
  defaultOpen = true,
  contentClassName = "space-y-3",
  children,
}: {
  title: string
  defaultOpen?: boolean
  contentClassName?: string
  children: React.ReactNode
}) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <Card className="overflow-hidden transition-colors hover:border-border/80">
        <CardHeader className="p-0">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group flex w-full items-center justify-between gap-3 border-b border-transparent bg-transparent p-4 pb-3 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:border-border/70 data-[state=open]:hover:bg-muted/40"
            >
              <CardTitle className="text-base leading-none font-semibold transition-colors group-hover:text-foreground">
                {title}
              </CardTitle>
              <span className="rounded-md p-0.5 text-muted-foreground transition-colors group-hover:bg-background/80 group-hover:text-foreground">
                <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
              </span>
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className={cn("p-4 pt-3", contentClassName)}>
            {children}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}

function SortableNodeCard({
  row,
  children,
}: {
  row: NodeRow
  children: React.ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "cursor-grab touch-none rounded-xl active:cursor-grabbing",
        isDragging && "z-50 opacity-70 shadow-lg"
      )}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  )
}

function getLogDetail(entry: AgentLogEntry, key: string) {
  const value = entry.detail?.[key]
  if (value === undefined || value === null) return "-"
  return typeof value === "string" ? value : JSON.stringify(value)
}

function TruncatedLogCell({
  value,
  className,
}: {
  value: string
  className?: string
}) {
  return (
    <div
      className={cn("truncate", className)}
      title={value === "-" ? undefined : value}
    >
      {value}
    </div>
  )
}

function LogLevelBadge({ level }: { level?: string }) {
  if (!level) return <span className="text-muted-foreground">-</span>

  return (
    <Badge
      className={cn(
        "px-1.5 py-0 font-mono text-[10px]",
        level === "ERROR" && "bg-red-500/15 text-red-700 dark:text-red-400",
        level === "WARN" &&
          "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
        level === "INFO" && "bg-blue-500/15 text-blue-700 dark:text-blue-400",
        level !== "ERROR" &&
          level !== "WARN" &&
          level !== "INFO" &&
          "bg-muted text-muted-foreground"
      )}
    >
      {level}
    </Badge>
  )
}

function AgentLogTable({ entries }: { entries: AgentLogEntry[] }) {
  return (
    <div className="mt-2 max-h-52 overflow-auto rounded border">
      <Table className="min-w-215 table-fixed text-xs [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5">
        <colgroup>
          <col className="w-37.5" />
          <col className="w-16" />
          <col className="w-30" />
          <col className="w-16" />
          <col className="w-30" />
          <col className="w-40" />
          <col />
        </colgroup>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead>时间</TableHead>
            <TableHead>级别</TableHead>
            <TableHead>事件</TableHead>
            <TableHead>用户</TableHead>
            <TableHead>来源</TableHead>
            <TableHead>目标</TableHead>
            <TableHead>错误 / 详情</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry, index) => {
            const source = getLogDetail(entry, "addr")
            const target =
              getLogDetail(entry, "reqAddr") !== "-"
                ? getLogDetail(entry, "reqAddr")
                : (entry.service ?? "-")
            const detail =
              getLogDetail(entry, "error") !== "-"
                ? getLogDetail(entry, "error")
                : entry.detail
                  ? JSON.stringify(entry.detail)
                  : (entry.prefix ?? entry.raw)

            return (
              <TableRow key={`${entry.time ?? "raw"}-${index}`}>
                <TableCell className="font-mono text-[11px] whitespace-nowrap">
                  <TruncatedLogCell value={entry.time ?? "-"} />
                </TableCell>
                <TableCell>
                  <LogLevelBadge level={entry.level} />
                </TableCell>
                <TableCell className="font-medium">
                  <TruncatedLogCell value={entry.message || "-"} />
                </TableCell>
                <TableCell className="font-mono text-[11px]">
                  <TruncatedLogCell value={getLogDetail(entry, "id")} />
                </TableCell>
                <TableCell className="font-mono text-[11px]">
                  <TruncatedLogCell value={source} />
                </TableCell>
                <TableCell className="font-mono text-[11px]">
                  <TruncatedLogCell value={target} />
                </TableCell>
                <TableCell className="font-mono text-[11px]">
                  <TruncatedLogCell value={detail} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
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
  const displayHy2Version = formatHy2Version(row.hy2_version)
  const supportsHy2Update = hasAgentCapability(row, "hy2-update")
  const onlineCount = row.online_count ?? 0
  const dnsStatusMeta = getDnsStatusMeta(row.dns_status)
  const dnsStatusTitle = row.dns_status_detail || dnsStatusMeta?.description
  const countryFlagUrl = getCountryFlagUrl(row.geo_country_code)
  const geoTitle = getNodeGeoTitle(row, hideIp)
  const statusLight = getNodeStatusLight(fresh, agentFresh, row.hy2_status)

  // 计算今日上传/下载
  const todayTx = hourly.reduce((sum, h) => sum + h.txBytes, 0)
  const todayRx = hourly.reduce((sum, h) => sum + h.rxBytes, 0)
  const hostTrafficLimit = row.host_traffic_limit_bytes ?? 0
  const hostTrafficRemaining = row.host_traffic_remaining_bytes ?? 0
  const hostTrafficOverLimit = row.host_traffic_over_limit

  return (
    <Card className="relative h-48 overflow-hidden select-none">
      {/* 流量图 - 作为卡片背景 */}
      <NodeTrafficChart hourly={hourly} />

      {/* 渐变遮罩 - 确保文字可读 */}
      <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-card/95 via-card/70 to-card/30" />

      <div className="absolute right-3 bottom-3 z-10 flex flex-col items-end gap-1">
        {displayHy2Version && (
          <Badge
            className="inline-flex items-center gap-1 bg-muted px-1.5 py-0 font-mono text-[10px] text-muted-foreground"
            title={`Hysteria2 版本：${displayHy2Version}`}
          >
            <Server className="h-2.5 w-2.5" />
            {displayHy2Version}
          </Badge>
        )}
        {displayAgentVersion && (
          <Badge
            className="inline-flex items-center gap-1 bg-muted px-1.5 py-0 font-mono text-[10px] text-muted-foreground"
            title={`Agent 版本：${displayAgentVersion}`}
          >
            <Bot className="h-2.5 w-2.5" />
            {displayAgentVersion}
          </Badge>
        )}
      </div>

      {/* 节点信息 - 叠加在图表上 */}
      <div className="relative flex h-full flex-col justify-between p-3">
        {/* 顶部：名称 + 状态 */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              {countryFlagUrl && (
                <span
                  aria-label={
                    row.geo_country_name ?? row.geo_country_code ?? "节点位置"
                  }
                  title={geoTitle}
                  className="inline-block h-3.5 w-5 shrink-0 rounded-xs bg-cover bg-center shadow-sm"
                  style={{ backgroundImage: `url(${countryFlagUrl})` }}
                />
              )}
              <h3 className="truncate text-sm font-semibold">{row.name}</h3>
              {row.remark && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex shrink-0 cursor-help text-muted-foreground hover:text-foreground">
                      <Info className="h-3.5 w-3.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-70 wrap-break-word whitespace-pre-wrap">
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
                      disabled={!supportsHy2Update}
                      title={
                        supportsHy2Update
                          ? undefined
                          : "请先更新 Agent 后再更新 Hysteria2"
                      }
                      onClick={() => onQueueAgentTask(row, "HY2_SELF_UPDATE")}
                    >
                      <RefreshCw className="h-4 w-4" />
                      更新 Hysteria2
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onQueueAgentTask(row, "HY2_LOGS")}
                    >
                      <FileText className="h-4 w-4" />
                      Hysteria2 日志
                    </DropdownMenuItem>
                    {(row.node_ipv4 || row.node_ipv6) &&
                      row.dns_status !== "skip" &&
                      row.ip !== row.node_ipv4 &&
                      row.ip !== row.node_ipv6 && (
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
                      更新 Agent
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
                  "inline-flex items-center gap-1 px-1.5 py-0 text-[10px]",
                  dnsStatusMeta.badgeClassName
                )}
                title={dnsStatusTitle}
              >
                <Globe className="h-2.5 w-2.5" />
                {dnsStatusMeta.label}
              </Badge>
            )}
            {fresh && (
              <Badge className="inline-flex items-center gap-1 bg-blue-500/15 px-1.5 py-0 text-[10px] text-blue-700 dark:text-blue-400">
                <Activity className="h-2.5 w-2.5" />
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
            {row.acl_profile_name && (
              <Badge
                className="bg-purple-500/15 px-1.5 py-0 text-[10px] text-purple-700 dark:text-purple-300"
                title={
                  row.outbound_profile_name
                    ? `出站配置：${row.outbound_profile_name}`
                    : "仅使用内置出口"
                }
              >
                ACL: {row.acl_profile_name}
              </Badge>
            )}
          </div>

          {/* 今日流量 */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pr-20 text-[11px]">
            <span className="text-muted-foreground">今日</span>
            <span className="font-medium text-violet-600 dark:text-violet-400">
              ↑ {formatBytes(todayTx)}
            </span>
            <span className="font-medium text-blue-600 dark:text-blue-400">
              ↓ {formatBytes(todayRx)}
            </span>
            {hostTrafficLimit > 0 && (
              <span
                className={cn(
                  "font-medium",
                  hostTrafficOverLimit
                    ? "text-red-600 dark:text-red-400"
                    : "text-emerald-700 dark:text-emerald-400"
                )}
              >
                {hostTrafficOverLimit
                  ? `超出 ${formatBytes(Math.abs(hostTrafficRemaining))}`
                  : `剩余 ${formatBytes(hostTrafficRemaining)}`}
              </span>
            )}
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
  obfsMinPacketSize,
  setObfsMinPacketSize,
  obfsMaxPacketSize,
  setObfsMaxPacketSize,
  insecure,
  setInsecure,
  pinSha256,
  setPinSha256,
  // 节点配置
  nodeIpv4,
  setNodeIpv4,
  nodeIpv6,
  setNodeIpv6,
  nodePortInput,
  setNodePortInput,
  geoOverride,
  setGeoOverride,
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
  acmeCaProvider,
  setAcmeCaProvider,
  acmeCaUrl,
  setAcmeCaUrl,
  acmeDnsProvider,
  setAcmeDnsProvider,
  acmeDnsConfig,
  setAcmeDnsConfig,
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
  // Hy2 高级网络
  serverBandwidthUpMbps,
  setServerBandwidthUpMbps,
  serverBandwidthDownMbps,
  setServerBandwidthDownMbps,
  ignoreClientBandwidth,
  setIgnoreClientBandwidth,
  quicInitStreamReceiveWindow,
  setQuicInitStreamReceiveWindow,
  quicMaxStreamReceiveWindow,
  setQuicMaxStreamReceiveWindow,
  quicInitConnReceiveWindow,
  setQuicInitConnReceiveWindow,
  quicMaxConnReceiveWindow,
  setQuicMaxConnReceiveWindow,
  quicMaxIdleTimeoutSeconds,
  setQuicMaxIdleTimeoutSeconds,
  quicMaxIncomingStreams,
  setQuicMaxIncomingStreams,
  quicDisablePathMtuDiscovery,
  setQuicDisablePathMtuDiscovery,
  congestionType,
  setCongestionType,
  congestionBbrProfile,
  setCongestionBbrProfile,
  // 宿主机流量
  hostTrafficEnabled,
  setHostTrafficEnabled,
  hostTrafficLimit,
  setHostTrafficLimit,
  hostTrafficUsed,
  setHostTrafficUsed,
  hostTrafficUnit,
  setHostTrafficUnit,
  hostTrafficBillingMode,
  setHostTrafficBillingMode,
  hostTrafficResetCycle,
  setHostTrafficResetCycle,
  hostTrafficResetIntervalDays,
  setHostTrafficResetIntervalDays,
  hostTrafficResetAnchor,
  setHostTrafficResetAnchor,
  // Agent 配置
  agentInterval,
  setAgentInterval,
  agentAutoUpdateEnabled,
  setAgentAutoUpdateEnabled,
  hy2AutoUpdateEnabled,
  setHy2AutoUpdateEnabled,
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
  obfsMinPacketSize: string
  setObfsMinPacketSize: (v: string) => void
  obfsMaxPacketSize: string
  setObfsMaxPacketSize: (v: string) => void
  insecure: boolean
  setInsecure: (v: boolean) => void
  pinSha256: string
  setPinSha256: (v: string) => void
  // 节点配置
  nodeIpv4: string
  setNodeIpv4: (v: string) => void
  nodeIpv6: string
  setNodeIpv6: (v: string) => void
  nodePortInput: string
  setNodePortInput: (v: string) => void
  geoOverride: GeoOverrideDraft
  setGeoOverride: (v: GeoOverrideDraft) => void
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
  acmeCaProvider: NodeAcmeCaProvider
  setAcmeCaProvider: (v: NodeAcmeCaProvider) => void
  acmeCaUrl: string
  setAcmeCaUrl: (v: string) => void
  acmeDnsProvider: string
  setAcmeDnsProvider: (v: string) => void
  acmeDnsConfig: AcmeDnsConfigDraft
  setAcmeDnsConfig: (v: AcmeDnsConfigDraft) => void
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
  // Hy2 高级网络
  serverBandwidthUpMbps: string
  setServerBandwidthUpMbps: (v: string) => void
  serverBandwidthDownMbps: string
  setServerBandwidthDownMbps: (v: string) => void
  ignoreClientBandwidth: boolean
  setIgnoreClientBandwidth: (v: boolean) => void
  quicInitStreamReceiveWindow: string
  setQuicInitStreamReceiveWindow: (v: string) => void
  quicMaxStreamReceiveWindow: string
  setQuicMaxStreamReceiveWindow: (v: string) => void
  quicInitConnReceiveWindow: string
  setQuicInitConnReceiveWindow: (v: string) => void
  quicMaxConnReceiveWindow: string
  setQuicMaxConnReceiveWindow: (v: string) => void
  quicMaxIdleTimeoutSeconds: string
  setQuicMaxIdleTimeoutSeconds: (v: string) => void
  quicMaxIncomingStreams: string
  setQuicMaxIncomingStreams: (v: string) => void
  quicDisablePathMtuDiscovery: boolean
  setQuicDisablePathMtuDiscovery: (v: boolean) => void
  congestionType: CongestionType
  setCongestionType: (v: CongestionType) => void
  congestionBbrProfile: CongestionBbrProfile
  setCongestionBbrProfile: (v: CongestionBbrProfile) => void
  // 宿主机流量
  hostTrafficEnabled: boolean
  setHostTrafficEnabled: (v: boolean) => void
  hostTrafficLimit: string
  setHostTrafficLimit: (v: string) => void
  hostTrafficUsed: string
  setHostTrafficUsed: (v: string) => void
  hostTrafficUnit: HostTrafficUnit
  setHostTrafficUnit: (v: HostTrafficUnit) => void
  hostTrafficBillingMode: HostTrafficBillingMode
  setHostTrafficBillingMode: (v: HostTrafficBillingMode) => void
  hostTrafficResetCycle: HostTrafficResetCycle
  setHostTrafficResetCycle: (v: HostTrafficResetCycle) => void
  hostTrafficResetIntervalDays: string
  setHostTrafficResetIntervalDays: (v: string) => void
  hostTrafficResetAnchor: string
  setHostTrafficResetAnchor: (v: string) => void
  // Agent 配置
  agentInterval: string
  setAgentInterval: (v: string) => void
  agentAutoUpdateEnabled: boolean
  setAgentAutoUpdateEnabled: (v: boolean) => void
  hy2AutoUpdateEnabled: boolean
  setHy2AutoUpdateEnabled: (v: boolean) => void
  agentControlEnabled: boolean
  setAgentControlEnabled: (v: boolean) => void
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  submitLabel: string
  onCancel?: () => void
}) {
  const sniRef = useRef(sni)
  const acmeDomainsInputRef = useRef(acmeDomainsInput)
  const lastAutoDomainRef = useRef<string | null>(null)

  useEffect(() => {
    sniRef.current = sni
  }, [sni])

  useEffect(() => {
    acmeDomainsInputRef.current = acmeDomainsInput
  }, [acmeDomainsInput])

  useEffect(() => {
    const domain = getAutoFillDomain(ip)
    const lastAutoDomain = lastAutoDomainRef.current

    if (!domain) return

    const currentSni = sniRef.current.trim()
    if (!currentSni || (lastAutoDomain && currentSni === lastAutoDomain)) {
      setSni(domain)
      sniRef.current = domain
    }

    if (certMode === "acme-http" || certMode === "acme-dns") {
      const currentAcmeDomains = acmeDomainsInputRef.current.trim()
      if (
        !currentAcmeDomains ||
        (lastAutoDomain && currentAcmeDomains === lastAutoDomain)
      ) {
        setAcmeDomainsInput(domain)
        acmeDomainsInputRef.current = domain
      }
    }

    lastAutoDomainRef.current = domain
  }, [certMode, ip, setAcmeDomainsInput, setSni])

  const selectedAcmeDnsProvider = isAcmeDnsProvider(acmeDnsProvider)
    ? acmeDnsProvider
    : null
  const selectedAcmeDnsFields = selectedAcmeDnsProvider
    ? ACME_DNS_PROVIDER_FIELDS[selectedAcmeDnsProvider]
    : []

  function setAcmeDnsConfigField(key: string, value: string) {
    setAcmeDnsConfig({ ...acmeDnsConfig, [key]: value })
  }

  return (
    <form
      className="space-y-4 **:data-[slot=label]:text-xs"
      onSubmit={onSubmit}
    >
      {/* === 基础信息 === */}
      <NodeFormSection title="基础信息">
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
          <Label>国家覆盖</Label>
          <Select
            value={geoOverride.countryCode || "auto"}
            onValueChange={(value) => {
              if (value === "auto") {
                setGeoOverride(emptyGeoOverrideDraft())
                return
              }
              const option = getCountryOption(value)
              setGeoOverride({
                ...emptyGeoOverrideDraft(),
                countryCode: value,
                countryName: option?.name ?? value,
              })
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="自动 GeoIP" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                <SelectItem value="auto">自动 GeoIP</SelectItem>
                {COUNTRY_OPTIONS.map((country) => (
                  <SelectItem key={country.code} value={country.code}>
                    {country.code} · {country.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            如需修正 GeoIP 识别结果，可手动选择国家；留空时自动识别。
          </p>
        </div>
      </NodeFormSection>

      {/* === 连接地址 === */}
      <NodeFormSection title="连接地址" contentClassName="space-y-4">
        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">订阅连接地址</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              用于生成订阅配置中的服务器地址与端口，客户端将依据该信息建立连接。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>订阅地址</Label>
              <Input
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="hy2.example.com"
                required
              />
            </div>
            <div className="space-y-1">
              <Label>订阅端口</Label>
              <Input
                value={portInput}
                onChange={(e) => setPortInput(e.target.value)}
                placeholder="443 或 5000-6000"
                required
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">节点公网地址</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              用于 Cloudflare DNS 解析；IPv4 与 IPv6 可单独或同时填写。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>公网 IPv4</Label>
                <Input
                  value={nodeIpv4}
                  onChange={(e) => setNodeIpv4(e.target.value)}
                  placeholder="如 1.2.3.4"
                />
              </div>
              <div className="space-y-1">
                <Label>公网 IPv6</Label>
                <Input
                  value={nodeIpv6}
                  onChange={(e) => setNodeIpv6(e.target.value)}
                  placeholder="如 2001:db8::1"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>节点端口</Label>
              <Input
                value={nodePortInput}
                onChange={(e) => setNodePortInput(e.target.value)}
                placeholder="留空继承订阅端口"
              />
            </div>
          </div>
        </div>
      </NodeFormSection>

      {/* === TLS 与证书 === */}
      <NodeFormSection title="TLS 与证书">
        <div className="space-y-1">
          <Label>SNI</Label>
          <Input
            value={sni}
            onChange={(e) => setSni(e.target.value)}
            placeholder="可选，TLS SNI"
          />
          <p className="text-[11px] text-muted-foreground">
            TLS 握手使用的服务器名称；订阅地址为域名时将自动同步该值。
          </p>
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

        <div className="space-y-1 pt-1">
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
                  ? "HTTP-01 验证仅支持普通域名，不支持通配符证书。"
                  : "DNS-01 验证支持普通域名与通配符证书。"}
                订阅地址为域名时将自动填入首个域名。
              </p>
            </div>
            <div className="space-y-1">
              <Label>ACME 邮箱</Label>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={acmeEmail}
                  onChange={(e) => setAcmeEmail(e.target.value)}
                  placeholder="留空则使用全局设置"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setAcmeEmail(generateAcmeEmail(getAutoFillDomain(ip)))
                  }
                >
                  随机
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>ACME CA</Label>
              <Select
                value={acmeCaProvider}
                onValueChange={(value) =>
                  setAcmeCaProvider(value as NodeAcmeCaProvider)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    {NODE_ACME_CA_PROVIDERS.map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {NODE_ACME_CA_PROVIDER_LABELS[provider]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                选择签发证书使用的 ACME CA，节点配置优先于全局设置。
              </p>
            </div>
            {acmeCaProvider === "custom" && (
              <div className="space-y-1">
                <Label>ACME Directory URL</Label>
                <Input
                  value={acmeCaUrl}
                  onChange={(e) => setAcmeCaUrl(e.target.value)}
                  placeholder="https://acme.example.com/directory"
                />
              </div>
            )}
          </>
        )}
        {certMode === "acme-dns" && (
          <>
            <div className="space-y-1">
              <Label>DNS 服务商</Label>
              <Select
                value={acmeDnsProvider}
                onValueChange={(value) => {
                  setAcmeDnsProvider(value)
                  setAcmeDnsConfig({})
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择 DNS 服务商" />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    {ACME_DNS_PROVIDERS.map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {ACME_DNS_PROVIDER_LABELS[provider]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                DNS-01 证书签发需要可用的 DNS
                服务商凭据；同一张证书的所有域名需使用同一服务商。 Cloudflare
                Token 留空时可使用全局设置。
              </p>
            </div>
            {selectedAcmeDnsFields.map((field) => (
              <div key={field.key} className="space-y-1">
                <Label>{field.label}</Label>
                <Input
                  type={field.secret ? "password" : "text"}
                  value={acmeDnsConfig[field.key] ?? ""}
                  onChange={(e) =>
                    setAcmeDnsConfigField(field.key, e.target.value)
                  }
                  placeholder={
                    field.placeholder ?? (field.required ? "必填" : "可选")
                  }
                />
              </div>
            ))}
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
      </NodeFormSection>

      {/* === 混淆与伪装 === */}
      <NodeFormSection
        title="混淆与伪装"
        defaultOpen={false}
        contentClassName="space-y-4"
      >
        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Obfs 混淆</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              配置 Hysteria2 Salamander / Gecko 混淆参数。Gecko
              为实验性功能，节点端与客户端均需支持。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
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
                    <SelectItem value="gecko">Gecko（实验性）</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Obfs 密码</Label>
              <div className="flex gap-2">
                <Input
                  value={obfsPassword}
                  onChange={(e) => setObfsPassword(e.target.value)}
                  placeholder={
                    obfsRequiresPassword(obfs)
                      ? "启用 obfs 时必填"
                      : "不使用 obfs 时可留空"
                  }
                  required={obfsRequiresPassword(obfs)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setObfsPassword(generateStrongObfsPassword())}
                >
                  随机
                </Button>
              </div>
            </div>
          </div>
          {obfs === "gecko" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>minPacketSize</Label>
                <Input
                  type="number"
                  min={1}
                  max={2048}
                  step={1}
                  value={obfsMinPacketSize}
                  onChange={(e) => setObfsMinPacketSize(e.target.value)}
                  placeholder="512"
                />
              </div>
              <div className="space-y-1">
                <Label>maxPacketSize</Label>
                <Input
                  type="number"
                  min={1}
                  max={2048}
                  step={1}
                  value={obfsMaxPacketSize}
                  onChange={(e) => setObfsMaxPacketSize(e.target.value)}
                  placeholder="1200"
                />
              </div>
              <p className="text-[11px] text-muted-foreground sm:col-span-2">
                建议保持默认范围 512 / 1200；maxPacketSize 不小于
                minPacketSize，且不超过 2048。
              </p>
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">伪装 Masquerade</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              配置非协议流量的 HTTP/HTTPS 响应，用于服务端伪装。
            </p>
          </div>
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
              <div className="grid gap-3 sm:grid-cols-2">
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
                <span>跳过代理目标证书校验 (Insecure)</span>
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
        </div>
      </NodeFormSection>

      {/* === Hy2 高级网络 === */}
      <NodeFormSection title="Hy2 高级网络" defaultOpen={false}>
        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">服务端带宽</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              设置服务端上下行带宽限制；0 或留空表示不限速。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>服务端上传限速 (Mbps)</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={serverBandwidthUpMbps}
                onChange={(e) => setServerBandwidthUpMbps(e.target.value)}
                placeholder="0 = 不配置"
              />
            </div>
            <div className="space-y-1">
              <Label>服务端下载限速 (Mbps)</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={serverBandwidthDownMbps}
                onChange={(e) => setServerBandwidthDownMbps(e.target.value)}
                placeholder="0 = 不配置"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 p-2">
            <div>
              <Label>忽略客户端带宽配置</Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                启用后统一采用服务端带宽策略，并使用非 Brutal 拥塞控制。
              </p>
            </div>
            <Switch
              checked={ignoreClientBandwidth}
              onCheckedChange={setIgnoreClientBandwidth}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">拥塞控制</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              未选择控制器时使用默认拥塞控制；选择 BBR 后可配置预设参数。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>控制器</Label>
              <Select
                value={congestionType}
                onValueChange={(v) => setCongestionType(v as CongestionType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="default">默认（不配置）</SelectItem>
                  <SelectItem value="bbr">BBR</SelectItem>
                  <SelectItem value="reno">Reno</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>BBR 预设</Label>
              <Select
                value={congestionBbrProfile}
                onValueChange={(v) =>
                  setCongestionBbrProfile(v as CongestionBbrProfile)
                }
                disabled={congestionType !== "bbr"}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="standard">standard</SelectItem>
                  <SelectItem value="conservative">conservative</SelectItem>
                  <SelectItem value="aggressive">aggressive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">QUIC 参数</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              未配置时使用默认参数。请根据实际网络环境调整窗口大小。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>initStreamReceiveWindow</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={quicInitStreamReceiveWindow}
                onChange={(e) => setQuicInitStreamReceiveWindow(e.target.value)}
                placeholder="默认 8388608"
              />
            </div>
            <div className="space-y-1">
              <Label>maxStreamReceiveWindow</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={quicMaxStreamReceiveWindow}
                onChange={(e) => setQuicMaxStreamReceiveWindow(e.target.value)}
                placeholder="默认 8388608"
              />
            </div>
            <div className="space-y-1">
              <Label>initConnReceiveWindow</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={quicInitConnReceiveWindow}
                onChange={(e) => setQuicInitConnReceiveWindow(e.target.value)}
                placeholder="默认 20971520"
              />
            </div>
            <div className="space-y-1">
              <Label>maxConnReceiveWindow</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={quicMaxConnReceiveWindow}
                onChange={(e) => setQuicMaxConnReceiveWindow(e.target.value)}
                placeholder="默认 20971520"
              />
            </div>
            <div className="space-y-1">
              <Label>maxIdleTimeout（秒）</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={quicMaxIdleTimeoutSeconds}
                onChange={(e) => setQuicMaxIdleTimeoutSeconds(e.target.value)}
                placeholder="默认 30"
              />
            </div>
            <div className="space-y-1">
              <Label>maxIncomingStreams</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={quicMaxIncomingStreams}
                onChange={(e) => setQuicMaxIncomingStreams(e.target.value)}
                placeholder="默认 1024"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 p-2">
            <div>
              <Label>禁用 Path MTU Discovery</Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                开启后将关闭路径 MTU 探测，适用于特定网络兼容场景。
              </p>
            </div>
            <Switch
              checked={quicDisablePathMtuDiscovery}
              onCheckedChange={setQuicDisablePathMtuDiscovery}
            />
          </div>
        </div>
      </NodeFormSection>

      {/* === 宿主机流量 === */}
      <NodeFormSection title="宿主机流量" defaultOpen={false}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>显示剩余流量</Label>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              基于 Agent
              上报的节点实际流量统计额度与剩余量，套餐用量仍按订阅计费口径计算。
            </p>
          </div>
          <Switch
            checked={hostTrafficEnabled}
            onCheckedChange={setHostTrafficEnabled}
          />
        </div>
        {hostTrafficEnabled && (
          <>
            <div className="grid grid-cols-[1fr_1fr_96px] gap-3">
              <div className="space-y-1">
                <Label>总流量</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={hostTrafficLimit}
                  onChange={(e) => setHostTrafficLimit(e.target.value)}
                  placeholder="如 1"
                />
              </div>
              <div className="space-y-1">
                <Label>已用流量</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={hostTrafficUsed}
                  onChange={(e) => setHostTrafficUsed(e.target.value)}
                  placeholder="如 0.2"
                />
              </div>
              <div className="space-y-1">
                <Label>单位</Label>
                <Select
                  value={hostTrafficUnit}
                  onValueChange={(v) =>
                    setHostTrafficUnit(v as HostTrafficUnit)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="GB">GB</SelectItem>
                    <SelectItem value="TB">TB</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>统计口径</Label>
              <Select
                value={hostTrafficBillingMode}
                onValueChange={(v) =>
                  setHostTrafficBillingMode(v as HostTrafficBillingMode)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="tx_rx">
                    {HOST_TRAFFIC_BILLING_LABEL.tx_rx}
                  </SelectItem>
                  <SelectItem value="tx">
                    {HOST_TRAFFIC_BILLING_LABEL.tx}
                  </SelectItem>
                  <SelectItem value="rx">
                    {HOST_TRAFFIC_BILLING_LABEL.rx}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                仅用于节点宿主机额度统计，不参与用户套餐流量计算；VPS
                厂商面板通常还会包含系统、更新、回源等非 Hy2 流量。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>自动重置</Label>
                <Select
                  value={hostTrafficResetCycle}
                  onValueChange={(v) =>
                    setHostTrafficResetCycle(v as HostTrafficResetCycle)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="monthly">每月</SelectItem>
                    <SelectItem value="weekly">每周</SelectItem>
                    <SelectItem value="daily">每天</SelectItem>
                    <SelectItem value="custom_days">每 N 天</SelectItem>
                    <SelectItem value="none">不自动重置</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {hostTrafficResetCycle === "custom_days" ? (
                <div className="space-y-1">
                  <Label>周期天数</Label>
                  <Input
                    type="number"
                    min="1"
                    max="366"
                    value={hostTrafficResetIntervalDays}
                    onChange={(e) =>
                      setHostTrafficResetIntervalDays(e.target.value)
                    }
                    placeholder="如 30"
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <Label>周期</Label>
                  <Input
                    value={HOST_TRAFFIC_RESET_LABEL[hostTrafficResetCycle]}
                    disabled
                  />
                </div>
              )}
            </div>
            {hostTrafficResetCycle !== "none" && (
              <div className="space-y-1">
                <Label>周期起始时间</Label>
                <Input
                  type="datetime-local"
                  step="1"
                  value={hostTrafficResetAnchor}
                  onChange={(e) => setHostTrafficResetAnchor(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  系统将以该时间为周期锚点，在进入下一计费周期后重置宿主机已用流量。
                </p>
              </div>
            )}
          </>
        )}
      </NodeFormSection>

      {/* === Agent 配置 === */}
      <NodeFormSection title="Agent 配置" defaultOpen={false}>
        <div className="space-y-1">
          <Label>上报间隔（秒）</Label>
          <Input
            type="number"
            value={agentInterval}
            onChange={(e) => setAgentInterval(e.target.value)}
            placeholder="留空默认 120"
          />
          <p className="text-[11px] text-muted-foreground">
            Agent 执行流量上报、在线状态同步与控制面轮询的间隔时间。
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>控制面同步</Label>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              启用后，Agent 可从面板拉取目标配置并执行受支持的 Hysteria2
              管理操作。
            </p>
          </div>
          <Switch
            checked={agentControlEnabled}
            onCheckedChange={setAgentControlEnabled}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>Agent 每日自动更新</Label>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              启用后，Agent 将按计划检查发布版本并更新当前系统架构对应的程序包。
            </p>
          </div>
          <Switch
            checked={agentAutoUpdateEnabled}
            onCheckedChange={setAgentAutoUpdateEnabled}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>Hysteria2 每日自动更新</Label>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              启用后，Agent 将每日检查 Hysteria2 新版本；更新成功后会重启服务。
            </p>
          </div>
          <Switch
            checked={hy2AutoUpdateEnabled}
            onCheckedChange={setHy2AutoUpdateEnabled}
          />
        </div>
      </NodeFormSection>

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
  const [countryFilter, setCountryFilter] = useState<string | null>(null)
  const [sortingMode, setSortingMode] = useState(false)
  const [draggingNodeId, setDraggingNodeId] = useState<number | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)
  const rowsRef = useRef<NodeRow[]>([])
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
  const [obfsMinPacketSize, setObfsMinPacketSize] = useState("")
  const [obfsMaxPacketSize, setObfsMaxPacketSize] = useState("")
  const [insecure, setInsecure] = useState(false)
  const [pinSha256, setPinSha256] = useState("")
  const [nodeIpv4, setNodeIpv4] = useState("")
  const [nodeIpv6, setNodeIpv6] = useState("")
  const [nodePortInput, setNodePortInput] = useState("")
  const [geoOverride, setGeoOverride] = useState<GeoOverrideDraft>(
    emptyGeoOverrideDraft()
  )
  const [certMode, setCertMode] = useState("self-signed")
  const [certPath, setCertPath] = useState("")
  const [keyPath, setKeyPath] = useState("")
  const [acmeDomainsInput, setAcmeDomainsInput] = useState("")
  const [acmeEmail, setAcmeEmail] = useState("")
  const [acmeCaProvider, setAcmeCaProvider] =
    useState<NodeAcmeCaProvider>("inherit")
  const [acmeCaUrl, setAcmeCaUrl] = useState("")
  const [acmeDnsProvider, setAcmeDnsProvider] = useState("")
  const [acmeDnsConfig, setAcmeDnsConfig] = useState<AcmeDnsConfigDraft>({})
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
  const [serverBandwidthUpMbps, setServerBandwidthUpMbps] = useState("0")
  const [serverBandwidthDownMbps, setServerBandwidthDownMbps] = useState("0")
  const [ignoreClientBandwidth, setIgnoreClientBandwidth] = useState(false)
  const [quicInitStreamReceiveWindow, setQuicInitStreamReceiveWindow] =
    useState("")
  const [quicMaxStreamReceiveWindow, setQuicMaxStreamReceiveWindow] =
    useState("")
  const [quicInitConnReceiveWindow, setQuicInitConnReceiveWindow] = useState("")
  const [quicMaxConnReceiveWindow, setQuicMaxConnReceiveWindow] = useState("")
  const [quicMaxIdleTimeoutSeconds, setQuicMaxIdleTimeoutSeconds] = useState("")
  const [quicMaxIncomingStreams, setQuicMaxIncomingStreams] = useState("")
  const [quicDisablePathMtuDiscovery, setQuicDisablePathMtuDiscovery] =
    useState(false)
  const [congestionType, setCongestionType] =
    useState<CongestionType>("default")
  const [congestionBbrProfile, setCongestionBbrProfile] =
    useState<CongestionBbrProfile>("standard")
  const [hostTrafficEnabled, setHostTrafficEnabled] = useState(false)
  const [hostTrafficLimit, setHostTrafficLimit] = useState("")
  const [hostTrafficUsed, setHostTrafficUsed] = useState("")
  const [hostTrafficUnit, setHostTrafficUnit] = useState<HostTrafficUnit>("TB")
  const [hostTrafficBillingMode, setHostTrafficBillingMode] =
    useState<HostTrafficBillingMode>("tx_rx")
  const [hostTrafficResetCycle, setHostTrafficResetCycle] =
    useState<HostTrafficResetCycle>("monthly")
  const [hostTrafficResetIntervalDays, setHostTrafficResetIntervalDays] =
    useState("")
  const [hostTrafficResetAnchor, setHostTrafficResetAnchor] = useState("")
  const [agentInterval, setAgentInterval] = useState("")
  const [agentAutoUpdateEnabled, setAgentAutoUpdateEnabled] = useState(true)
  const [hy2AutoUpdateEnabled, setHy2AutoUpdateEnabled] = useState(true)
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
  const [editObfsMinPacketSize, setEditObfsMinPacketSize] = useState("")
  const [editObfsMaxPacketSize, setEditObfsMaxPacketSize] = useState("")
  const [editInsecure, setEditInsecure] = useState(false)
  const [editPinSha256, setEditPinSha256] = useState("")
  const [editNodeIpv4, setEditNodeIpv4] = useState("")
  const [editNodeIpv6, setEditNodeIpv6] = useState("")
  const [editNodePortInput, setEditNodePortInput] = useState("")
  const [editGeoOverride, setEditGeoOverride] = useState<GeoOverrideDraft>(
    emptyGeoOverrideDraft()
  )
  const [editCertMode, setEditCertMode] = useState("self-signed")
  const [editCertPath, setEditCertPath] = useState("")
  const [editKeyPath, setEditKeyPath] = useState("")
  const [editAcmeDomainsInput, setEditAcmeDomainsInput] = useState("")
  const [editAcmeEmail, setEditAcmeEmail] = useState("")
  const [editAcmeCaProvider, setEditAcmeCaProvider] =
    useState<NodeAcmeCaProvider>("inherit")
  const [editAcmeCaUrl, setEditAcmeCaUrl] = useState("")
  const [editAcmeDnsProvider, setEditAcmeDnsProvider] = useState("")
  const [editAcmeDnsConfig, setEditAcmeDnsConfig] =
    useState<AcmeDnsConfigDraft>({})
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
  const [editServerBandwidthUpMbps, setEditServerBandwidthUpMbps] =
    useState("0")
  const [editServerBandwidthDownMbps, setEditServerBandwidthDownMbps] =
    useState("0")
  const [editIgnoreClientBandwidth, setEditIgnoreClientBandwidth] =
    useState(false)
  const [editQuicInitStreamReceiveWindow, setEditQuicInitStreamReceiveWindow] =
    useState("")
  const [editQuicMaxStreamReceiveWindow, setEditQuicMaxStreamReceiveWindow] =
    useState("")
  const [editQuicInitConnReceiveWindow, setEditQuicInitConnReceiveWindow] =
    useState("")
  const [editQuicMaxConnReceiveWindow, setEditQuicMaxConnReceiveWindow] =
    useState("")
  const [editQuicMaxIdleTimeoutSeconds, setEditQuicMaxIdleTimeoutSeconds] =
    useState("")
  const [editQuicMaxIncomingStreams, setEditQuicMaxIncomingStreams] =
    useState("")
  const [editQuicDisablePathMtuDiscovery, setEditQuicDisablePathMtuDiscovery] =
    useState(false)
  const [editCongestionType, setEditCongestionType] =
    useState<CongestionType>("default")
  const [editCongestionBbrProfile, setEditCongestionBbrProfile] =
    useState<CongestionBbrProfile>("standard")
  const [editHostTrafficEnabled, setEditHostTrafficEnabled] = useState(false)
  const [editHostTrafficLimit, setEditHostTrafficLimit] = useState("")
  const [editHostTrafficUsed, setEditHostTrafficUsed] = useState("")
  const [editHostTrafficUnit, setEditHostTrafficUnit] =
    useState<HostTrafficUnit>("TB")
  const [editHostTrafficBillingMode, setEditHostTrafficBillingMode] =
    useState<HostTrafficBillingMode>("tx_rx")
  const [editHostTrafficResetCycle, setEditHostTrafficResetCycle] =
    useState<HostTrafficResetCycle>("monthly")
  const [
    editHostTrafficResetIntervalDays,
    setEditHostTrafficResetIntervalDays,
  ] = useState("")
  const [editHostTrafficResetAnchor, setEditHostTrafficResetAnchor] =
    useState("")
  const [editAgentInterval, setEditAgentInterval] = useState("")
  const [editAgentAutoUpdateEnabled, setEditAgentAutoUpdateEnabled] =
    useState(true)
  const [editHy2AutoUpdateEnabled, setEditHy2AutoUpdateEnabled] = useState(true)
  const [editAgentControlEnabled, setEditAgentControlEnabled] = useState(true)
  const [agentDetailRow, setAgentDetailRow] = useState<NodeRow | null>(null)
  const [agentDetail, setAgentDetail] = useState<AgentDetail | null>(null)
  const [agentDetailLoading, setAgentDetailLoading] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  )

  const countryFilters = useMemo(() => {
    const filters = new Map<
      string,
      { code: string; name: string; count: number }
    >()
    for (const row of rows) {
      const code = normalizeCountryFilter(row.geo_country_code)
      if (!code) continue

      const option = getCountryOption(code)
      const name = option?.name || row.geo_country_name?.trim() || code
      const existing = filters.get(code)
      if (existing) {
        existing.count += 1
        if (existing.name === code && name !== code) existing.name = name
        continue
      }
      filters.set(code, { code, name, count: 1 })
    }

    return Array.from(filters.values()).sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN")
    )
  }, [rows])
  const effectiveCountryFilter = countryFilter
    ? countryFilters.find((item) => item.code === countryFilter)
    : null
  const visibleRows = useMemo(() => {
    if (!effectiveCountryFilter) return rows
    return rows.filter(
      (row) =>
        normalizeCountryFilter(row.geo_country_code) ===
        effectiveCountryFilter.code
    )
  }, [effectiveCountryFilter, rows])
  const activeSortingMode = sortingMode && !effectiveCountryFilter
  const countryFilterLabel = effectiveCountryFilter?.name ?? null
  const visibleOnlineCount = visibleRows.filter((row) =>
    isFresh(row.last_report_at)
  ).length

  function setNodeRows(nextRows: NodeRow[]) {
    rowsRef.current = nextRows
    setRows(nextRows)
  }

  async function refreshNodes() {
    const response = await fetch("/api/admin/nodes")
    const json = await response.json()

    if (!json?.ok || !Array.isArray(json.data)) {
      setNodeRows([])
      setHistoryByNode({})
      return
    }

    const nextRows = json.data as NodeRow[]
    setNodeRows(nextRows)
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

        if (!sortingMode && draggingNodeId === null && !savingOrder) {
          setNodeRows(nextRows)
        }
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
  }, [draggingNodeId, savingOrder, sortingMode])

  // 解析 acmeDnsConfig
  function buildAcmeDnsConfig(
    src: "create" | "edit"
  ): Record<string, string> | null {
    const provider = src === "create" ? acmeDnsProvider : editAcmeDnsProvider
    if (!isAcmeDnsProvider(provider)) return null

    const draft = src === "create" ? acmeDnsConfig : editAcmeDnsConfig
    const out: Record<string, string> = {}
    for (const field of ACME_DNS_PROVIDER_FIELDS[provider]) {
      const value = draft[field.key]?.trim()
      if (value) out[field.key] = value
    }
    return Object.keys(out).length > 0 ? out : null
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
      const records = Array.isArray(d?.records) ? d.records : []
      const actionLabel: Record<string, string> = {
        created: "已创建",
        updated: "已更新",
        unchanged: "已是最新",
      }
      const description = records.length
        ? records
            .map(
              (record: {
                dnsType?: string
                ip?: string
                action?: string
                zone?: string
              }) =>
                `${d.domain} ${record.dnsType ?? "DNS"} → ${record.ip ?? "-"}（${actionLabel[record.action ?? ""] ?? "已处理"}，Zone: ${record.zone ?? "-"}）`
            )
            .join("\n")
        : "DNS 记录已处理"
      if (showSuccessAlert) {
        await alert({
          title: "DNS 解析成功",
          description,
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

  function toggleSortingMode() {
    if (sortingMode) {
      setSortingMode(false)
      toast.success("已退出排序模式", {
        description: "节点顺序已保存",
      })
      void refreshNodes()
      return
    }
    setSortingMode(true)
    toast.info("排序模式已开启", {
      description: "拖动卡片调整节点顺序，完成后再次点击排序图标。",
    })
  }

  function handleDragStart(event: DragStartEvent) {
    const id = Number(event.active.id)
    setDraggingNodeId(Number.isInteger(id) ? id : null)
  }

  async function handleDragEnd(event: DragEndEvent) {
    setDraggingNodeId(null)

    const activeId = Number(event.active.id)
    const overId = event.over ? Number(event.over.id) : null
    if (!overId || activeId === overId) return

    const currentRows = rowsRef.current
    const oldIndex = currentRows.findIndex((row) => row.id === activeId)
    const newIndex = currentRows.findIndex((row) => row.id === overId)
    if (oldIndex < 0 || newIndex < 0) return

    const previousRows = currentRows
    const nextRows = arrayMove(currentRows, oldIndex, newIndex).map(
      (row, index) => ({ ...row, sort_order: index + 1 })
    )

    setNodeRows(nextRows)
    setSavingOrder(true)
    try {
      const response = await fetch("/api/admin/nodes/order", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: nextRows.map((row) => row.id) }),
      })
      const json = await response.json()

      if (!response.ok || !json?.ok) {
        setNodeRows(previousRows)
        await alert({
          title: "排序保存失败",
          description: json?.error?.message ?? "请稍后重试",
          variant: "destructive",
        })
        return
      }
    } catch {
      setNodeRows(previousRows)
      await alert({
        title: "排序保存失败",
        description: "网络错误，请稍后重试",
        variant: "destructive",
      })
    } finally {
      setSavingOrder(false)
    }
  }

  function handleDragCancel() {
    setDraggingNodeId(null)
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (obfsRequiresPassword(obfs) && !obfsPassword.trim()) {
      toast.error("无法创建节点", {
        description: "启用 obfs 时必须填写 Obfs 密码",
      })
      return
    }

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
        obfsMinPacketSize: obfs === "gecko" ? obfsMinPacketSize || null : null,
        obfsMaxPacketSize: obfs === "gecko" ? obfsMaxPacketSize || null : null,
        insecure,
        pinSha256: pinSha256 || null,
        nodeIpv4: nodeIpv4 || null,
        nodeIpv6: nodeIpv6 || null,
        nodePort: nodePortInput || null,
        geoOverride: buildGeoOverridePayload(geoOverride),
        certMode,
        certPath: certPath || null,
        keyPath: keyPath || null,
        acmeDomains: acmeDomains.length > 0 ? acmeDomains : null,
        acmeEmail: acmeEmail || null,
        acmeCaProvider,
        acmeCaUrl: acmeCaProvider === "custom" ? acmeCaUrl || null : null,
        acmeDnsProvider: acmeDnsProvider || null,
        acmeDnsConfig: buildAcmeDnsConfig("create"),
        masqueradeType,
        masqueradeConfig: buildMasqueradeConfigObj("create"),
        serverBandwidthUpMbps: serverBandwidthUpMbps
          ? Number(serverBandwidthUpMbps)
          : 0,
        serverBandwidthDownMbps: serverBandwidthDownMbps
          ? Number(serverBandwidthDownMbps)
          : 0,
        ignoreClientBandwidth,
        quicInitStreamReceiveWindow: quicInitStreamReceiveWindow
          ? Number(quicInitStreamReceiveWindow)
          : null,
        quicMaxStreamReceiveWindow: quicMaxStreamReceiveWindow
          ? Number(quicMaxStreamReceiveWindow)
          : null,
        quicInitConnReceiveWindow: quicInitConnReceiveWindow
          ? Number(quicInitConnReceiveWindow)
          : null,
        quicMaxConnReceiveWindow: quicMaxConnReceiveWindow
          ? Number(quicMaxConnReceiveWindow)
          : null,
        quicMaxIdleTimeoutSeconds: quicMaxIdleTimeoutSeconds
          ? Number(quicMaxIdleTimeoutSeconds)
          : null,
        quicMaxIncomingStreams: quicMaxIncomingStreams
          ? Number(quicMaxIncomingStreams)
          : null,
        quicDisablePathMtuDiscovery,
        congestionType: congestionType === "default" ? null : congestionType,
        congestionBbrProfile:
          congestionType === "bbr" ? congestionBbrProfile : null,
        hostTrafficLimitBytes: hostTrafficEnabled
          ? buildHostTrafficLimitBytes(hostTrafficLimit, hostTrafficUnit)
          : null,
        hostTrafficUsedBytes: hostTrafficEnabled
          ? buildHostTrafficLimitBytes(hostTrafficUsed, hostTrafficUnit)
          : 0,
        hostTrafficBillingMode,
        hostTrafficResetCycle,
        hostTrafficResetIntervalDays:
          hostTrafficResetCycle === "custom_days" &&
          hostTrafficResetIntervalDays
            ? Number(hostTrafficResetIntervalDays)
            : null,
        hostTrafficResetAnchor: serializeLocalDateTimeInput(
          hostTrafficResetAnchor
        ),
        agentInterval: agentInterval ? Number(agentInterval) : null,
        agentAutoUpdateEnabled,
        hy2AutoUpdateEnabled,
        agentControlEnabled,
      }),
    })

    const json = await response.json()
    if (!response.ok || !json.ok) {
      toast.error("无法创建节点", {
        description: json?.error?.message ?? "请稍后重试",
      })
      return
    }

    setName("")
    setRemark("")
    setIp("")
    setPortInput("443")
    setSni("")
    setObfs("")
    setObfsPassword("")
    setObfsMinPacketSize("")
    setObfsMaxPacketSize("")
    setInsecure(false)
    setPinSha256("")
    setNodeIpv4("")
    setNodeIpv6("")
    setNodePortInput("")
    setGeoOverride(emptyGeoOverrideDraft())
    setCertMode("self-signed")
    setCertPath("")
    setKeyPath("")
    setAcmeDomainsInput("")
    setAcmeEmail("")
    setAcmeCaProvider("inherit")
    setAcmeCaUrl("")
    setAcmeDnsProvider("")
    setAcmeDnsConfig({})
    setMasqueradeType("string")
    setMasqContent("ok")
    setMasqContentType("text/plain; charset=utf-8")
    setMasqStatusCode("200")
    setMasqProxyUrl("")
    setMasqProxyRewriteHost(true)
    setMasqProxyInsecure(false)
    setMasqProxyXForwarded(false)
    setMasqFileDir("/www/masq")
    setServerBandwidthUpMbps("0")
    setServerBandwidthDownMbps("0")
    setIgnoreClientBandwidth(false)
    setQuicInitStreamReceiveWindow("")
    setQuicMaxStreamReceiveWindow("")
    setQuicInitConnReceiveWindow("")
    setQuicMaxConnReceiveWindow("")
    setQuicMaxIdleTimeoutSeconds("")
    setQuicMaxIncomingStreams("")
    setQuicDisablePathMtuDiscovery(false)
    setCongestionType("default")
    setCongestionBbrProfile("standard")
    setHostTrafficEnabled(false)
    setHostTrafficLimit("")
    setHostTrafficUsed("")
    setHostTrafficUnit("TB")
    setHostTrafficBillingMode("tx_rx")
    setHostTrafficResetCycle("monthly")
    setHostTrafficResetIntervalDays("")
    setHostTrafficResetAnchor("")
    setAgentInterval("")
    setAgentAutoUpdateEnabled(true)
    setHy2AutoUpdateEnabled(true)
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
    if (!response.ok || !json.ok) {
      toast.error("无法保存节点", {
        description: json?.error?.message ?? "请稍后重试",
      })
      return false
    }
    await load()
    return true
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
    setEditObfsMinPacketSize(
      row.obfs_min_packet_size != null ? String(row.obfs_min_packet_size) : ""
    )
    setEditObfsMaxPacketSize(
      row.obfs_max_packet_size != null ? String(row.obfs_max_packet_size) : ""
    )
    setEditInsecure(row.insecure === 1)
    setEditPinSha256(row.pin_sha256 ?? "")
    // 节点配置
    setEditNodeIpv4(row.node_ipv4 ?? "")
    setEditNodeIpv6(row.node_ipv6 ?? "")
    setEditNodePortInput(
      row.node_port_hopping ?? (row.node_port ? String(row.node_port) : "")
    )
    setEditGeoOverride(parseGeoOverrideDraft(row.geo_override))
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
    setEditAcmeCaProvider(row.acme_ca_provider ?? "inherit")
    setEditAcmeCaUrl(row.acme_ca_url ?? "")
    setEditAcmeDnsProvider(row.acme_dns_provider ?? "")
    // acme_dns_config 是 JSON 字符串
    try {
      const config = row.acme_dns_config
        ? (JSON.parse(row.acme_dns_config) as Record<string, string>)
        : {}
      setEditAcmeDnsConfig(config)
    } catch {
      setEditAcmeDnsConfig({})
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
    // Hy2 高级网络
    setEditServerBandwidthUpMbps(String(row.server_bandwidth_up_mbps ?? 0))
    setEditServerBandwidthDownMbps(String(row.server_bandwidth_down_mbps ?? 0))
    setEditIgnoreClientBandwidth(row.ignore_client_bandwidth === 1)
    setEditQuicInitStreamReceiveWindow(
      row.quic_init_stream_receive_window != null
        ? String(row.quic_init_stream_receive_window)
        : ""
    )
    setEditQuicMaxStreamReceiveWindow(
      row.quic_max_stream_receive_window != null
        ? String(row.quic_max_stream_receive_window)
        : ""
    )
    setEditQuicInitConnReceiveWindow(
      row.quic_init_conn_receive_window != null
        ? String(row.quic_init_conn_receive_window)
        : ""
    )
    setEditQuicMaxConnReceiveWindow(
      row.quic_max_conn_receive_window != null
        ? String(row.quic_max_conn_receive_window)
        : ""
    )
    setEditQuicMaxIdleTimeoutSeconds(
      row.quic_max_idle_timeout_seconds != null
        ? String(row.quic_max_idle_timeout_seconds)
        : ""
    )
    setEditQuicMaxIncomingStreams(
      row.quic_max_incoming_streams != null
        ? String(row.quic_max_incoming_streams)
        : ""
    )
    setEditQuicDisablePathMtuDiscovery(
      row.quic_disable_path_mtu_discovery === 1
    )
    setEditCongestionType(row.congestion_type ?? "default")
    setEditCongestionBbrProfile(row.congestion_bbr_profile ?? "standard")
    // 宿主机流量
    const enabledHostTraffic = (row.host_traffic_limit_bytes ?? 0) > 0
    const preferredHostTrafficUnit =
      (row.host_traffic_limit_bytes ?? 0) >= HOST_TRAFFIC_UNIT_MULTIPLIER.TB
        ? "TB"
        : "GB"
    setEditHostTrafficEnabled(enabledHostTraffic)
    setEditHostTrafficUnit(preferredHostTrafficUnit)
    setEditHostTrafficLimit(
      getHostTrafficLimitValue(
        row.host_traffic_limit_bytes,
        preferredHostTrafficUnit
      )
    )
    setEditHostTrafficUsed(
      getHostTrafficLimitValue(
        row.host_traffic_used_bytes,
        preferredHostTrafficUnit
      )
    )
    setEditHostTrafficBillingMode(row.host_traffic_billing_mode ?? "tx_rx")
    setEditHostTrafficResetCycle(row.host_traffic_reset_cycle ?? "monthly")
    setEditHostTrafficResetIntervalDays(
      row.host_traffic_reset_interval_days != null
        ? String(row.host_traffic_reset_interval_days)
        : ""
    )
    setEditHostTrafficResetAnchor(
      formatLocalDateTimeInput(row.host_traffic_reset_anchor)
    )
    // Agent 配置
    setEditAgentInterval(
      row.agent_interval != null ? String(row.agent_interval) : ""
    )
    setEditAgentAutoUpdateEnabled(row.agent_auto_update_enabled !== 0)
    setEditHy2AutoUpdateEnabled(row.hy2_auto_update_enabled !== 0)
    setEditAgentControlEnabled(row.agent_control_enabled !== 0)
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingRow) return
    if (obfsRequiresPassword(editObfs) && !editObfsPassword.trim()) {
      toast.error("无法保存节点", {
        description: "启用 obfs 时必须填写 Obfs 密码",
      })
      return
    }

    const editAcmeDomains =
      editCertMode === "acme-http" || editCertMode === "acme-dns"
        ? parseAcmeDomainsInput(editAcmeDomainsInput)
        : []
    const saved = await updateNode(editingRow.id, {
      name: editName,
      remark: editRemark || null,
      ip: editIp,
      port: editPortInput,
      sni: editSni,
      obfs: editObfs,
      obfsPassword: editObfsPassword,
      obfsMinPacketSize:
        editObfs === "gecko" ? editObfsMinPacketSize || null : null,
      obfsMaxPacketSize:
        editObfs === "gecko" ? editObfsMaxPacketSize || null : null,
      insecure: editInsecure,
      pinSha256: editPinSha256,
      nodeIpv4: editNodeIpv4 || null,
      nodeIpv6: editNodeIpv6 || null,
      nodePort: editNodePortInput || null,
      geoOverride: buildGeoOverridePayload(editGeoOverride),
      certMode: editCertMode,
      certPath: editCertPath || null,
      keyPath: editKeyPath || null,
      acmeDomains: editAcmeDomains.length > 0 ? editAcmeDomains : null,
      acmeEmail: editAcmeEmail || null,
      acmeCaProvider: editAcmeCaProvider,
      acmeCaUrl: editAcmeCaProvider === "custom" ? editAcmeCaUrl || null : null,
      acmeDnsProvider: editAcmeDnsProvider || null,
      acmeDnsConfig: buildAcmeDnsConfig("edit"),
      masqueradeType: editMasqueradeType,
      masqueradeConfig: buildMasqueradeConfigObj("edit"),
      serverBandwidthUpMbps: editServerBandwidthUpMbps
        ? Number(editServerBandwidthUpMbps)
        : 0,
      serverBandwidthDownMbps: editServerBandwidthDownMbps
        ? Number(editServerBandwidthDownMbps)
        : 0,
      ignoreClientBandwidth: editIgnoreClientBandwidth,
      quicInitStreamReceiveWindow: editQuicInitStreamReceiveWindow
        ? Number(editQuicInitStreamReceiveWindow)
        : null,
      quicMaxStreamReceiveWindow: editQuicMaxStreamReceiveWindow
        ? Number(editQuicMaxStreamReceiveWindow)
        : null,
      quicInitConnReceiveWindow: editQuicInitConnReceiveWindow
        ? Number(editQuicInitConnReceiveWindow)
        : null,
      quicMaxConnReceiveWindow: editQuicMaxConnReceiveWindow
        ? Number(editQuicMaxConnReceiveWindow)
        : null,
      quicMaxIdleTimeoutSeconds: editQuicMaxIdleTimeoutSeconds
        ? Number(editQuicMaxIdleTimeoutSeconds)
        : null,
      quicMaxIncomingStreams: editQuicMaxIncomingStreams
        ? Number(editQuicMaxIncomingStreams)
        : null,
      quicDisablePathMtuDiscovery: editQuicDisablePathMtuDiscovery,
      congestionType:
        editCongestionType === "default" ? null : editCongestionType,
      congestionBbrProfile:
        editCongestionType === "bbr" ? editCongestionBbrProfile : null,
      hostTrafficLimitBytes: editHostTrafficEnabled
        ? buildHostTrafficLimitBytes(editHostTrafficLimit, editHostTrafficUnit)
        : null,
      hostTrafficUsedBytes: editHostTrafficEnabled
        ? buildHostTrafficLimitBytes(editHostTrafficUsed, editHostTrafficUnit)
        : 0,
      hostTrafficBillingMode: editHostTrafficBillingMode,
      hostTrafficResetCycle: editHostTrafficResetCycle,
      hostTrafficResetIntervalDays:
        editHostTrafficResetCycle === "custom_days" &&
        editHostTrafficResetIntervalDays
          ? Number(editHostTrafficResetIntervalDays)
          : null,
      hostTrafficResetAnchor: serializeLocalDateTimeInput(
        editHostTrafficResetAnchor
      ),
      agentInterval: editAgentInterval ? Number(editAgentInterval) : null,
      agentAutoUpdateEnabled: editAgentAutoUpdateEnabled,
      hy2AutoUpdateEnabled: editHy2AutoUpdateEnabled,
      agentControlEnabled: editAgentControlEnabled,
    })

    if (saved) setEditingRow(null)
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
      title: `${row.name} 的 Agent 配置${copied ? "（已复制）" : ""}`,
      description: (
        <pre className="max-h-100 min-w-0 overflow-auto rounded bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
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
      AGENT_SELF_UPDATE: "更新 Agent 成功后会自动重启服务，确认继续？",
      HY2_SELF_UPDATE:
        "更新 Hysteria2 会重启服务并短暂中断节点连接，确认继续？",
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

  const loadAgentDetail = useCallback(
    async (row: NodeRow, opts?: { silent?: boolean }) => {
      setAgentDetailRow(row)
      if (!opts?.silent) {
        setAgentDetail(null)
        setAgentDetailLoading(true)
      }
      try {
        const response = await fetch(`/api/admin/nodes/${row.id}/agent`)
        const json = await response.json()
        if (!response.ok || !json?.ok) {
          if (!opts?.silent) {
            await alert({
              title: "获取 Agent 状态失败",
              description: json?.error?.message ?? "请稍后重试",
              variant: "destructive",
            })
          }
          return
        }
        setAgentDetail(json.data as AgentDetail)
      } finally {
        if (!opts?.silent) setAgentDetailLoading(false)
      }
    },
    [alert]
  )

  useEffect(() => {
    if (!agentDetailRow) return
    const timer = setInterval(() => {
      void loadAgentDetail(agentDetailRow, { silent: true })
    }, 5_000)
    return () => clearInterval(timer)
  }, [agentDetailRow, loadAgentDetail])

  async function showDeployCommand(row: NodeRow) {
    // ACME 节点先检查 DNS 解析状态
    const isAcmeMode =
      row.cert_mode === "acme" ||
      row.cert_mode === "acme-dns" ||
      row.cert_mode === "acme-http"
    if (isAcmeMode && row.dns_status !== "skip" && row.dns_status !== "match") {
      const statusText =
        row.dns_status === "mismatch"
          ? "DNS 指向的 IP 与节点公网地址不一致"
          : row.dns_status === "partial"
            ? "DNS 解析未完全生效"
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
        description: "未获取到部署命令，请稍后重试或联系管理员。",
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

    const tokenExpiresAt =
      typeof json.data?.deploy_token_expires_at === "string"
        ? json.data.deploy_token_expires_at
        : null

    const meta = json.data?.meta as
      | {
          cert_mode?: string
          cert_path?: string
          key_path?: string
          interval_seconds?: number
          deploy_port?: number
          deploy_port_hopping?: string | null
          obfs?: string | null
          server_bandwidth_up_mbps?: number
          server_bandwidth_down_mbps?: number
          ignore_client_bandwidth?: boolean
          quic_init_stream_receive_window?: number | null
          quic_max_stream_receive_window?: number | null
          quic_init_conn_receive_window?: number | null
          quic_max_conn_receive_window?: number | null
          quic_max_idle_timeout_seconds?: number | null
          quic_max_incoming_streams?: number | null
          quic_disable_path_mtu_discovery?: boolean
          congestion_type?: string | null
          congestion_bbr_profile?: string | null
          acme_domains?: string[]
          acme_email?: string | null
          acme_ca?: {
            provider?: string
            url?: string | null
            source?: "node" | "global"
          }
          acme_dns_provider?: string | null
        }
      | undefined

    const isAcme =
      meta?.cert_mode === "acme-http" ||
      meta?.cert_mode === "acme-dns" ||
      meta?.cert_mode === "acme"
    const expireText = tokenExpiresAt
      ? formatLocalDateTime(tokenExpiresAt)
      : "30 分钟内有效"
    const portText = meta?.deploy_port_hopping
      ? `${meta?.deploy_port ?? 443} / ${meta.deploy_port_hopping}`
      : String(meta?.deploy_port ?? 443)
    const hasServerBandwidth =
      (meta?.server_bandwidth_up_mbps ?? 0) > 0 ||
      (meta?.server_bandwidth_down_mbps ?? 0) > 0
    const hasQuicConfig = Boolean(
      meta?.quic_init_stream_receive_window ||
      meta?.quic_max_stream_receive_window ||
      meta?.quic_init_conn_receive_window ||
      meta?.quic_max_conn_receive_window ||
      meta?.quic_max_idle_timeout_seconds ||
      meta?.quic_max_incoming_streams ||
      meta?.quic_disable_path_mtu_discovery
    )
    const congestionText = meta?.congestion_type
      ? meta.congestion_type === "bbr" && meta.congestion_bbr_profile
        ? `BBR / ${meta.congestion_bbr_profile}`
        : meta.congestion_type
      : null

    await alert({
      title: `${row.name} 的一键部署命令`,
      confirmText: "我知道了",
      contentClassName: "sm:max-w-2xl",
      description: (
        <div className="space-y-4 text-left">
          <div className="rounded-xl border bg-muted/35 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                {copied ? "已自动复制" : "请手动复制"}
              </Badge>
              <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400">
                Token 部署
              </Badge>
              <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-300">
                {expireText} 过期
              </Badge>
            </div>
            <p className="mt-3 text-sm text-foreground">
              在节点服务器以 <span className="font-mono">root</span>{" "}
              执行下面命令，将自动安装并配置 Hysteria2 与 H2O Agent。
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              该命令仅包含短期部署凭证，节点密钥与配置将在执行时安全获取。
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border">
            <div className="flex items-center justify-between gap-3 border-b bg-muted/50 px-3 py-2">
              <div>
                <div className="text-xs font-medium text-foreground">
                  一键部署命令
                </div>
                <div className="text-[11px] text-muted-foreground">
                  粘贴到目标节点终端执行
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(command).then(
                    () => toast.success("部署命令已复制"),
                    () => toast.error("复制失败，请手动复制")
                  )
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                复制
              </Button>
            </div>
            <pre className="max-h-55 min-w-0 overflow-auto bg-background p-4 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-foreground">
              {command}
            </pre>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-foreground">部署摘要</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <DeployInfoItem label="节点" value={`#${row.id} ${row.name}`} />
              <DeployInfoItem label="部署端口" value={portText} mono />
              <DeployInfoItem
                label="证书模式"
                value={certModeLabel(meta?.cert_mode)}
              />
              <DeployInfoItem
                label="上报间隔"
                value={`${meta?.interval_seconds ?? 120} 秒`}
              />
              {hasServerBandwidth && (
                <DeployInfoItem
                  label="服务端限速"
                  value={`↑ ${meta?.server_bandwidth_up_mbps || "不限"} / ↓ ${meta?.server_bandwidth_down_mbps || "不限"} Mbps`}
                />
              )}
              {meta?.ignore_client_bandwidth && (
                <DeployInfoItem label="忽略客户端限速" value="已启用" />
              )}
              {congestionText && (
                <DeployInfoItem label="拥塞控制" value={congestionText} />
              )}
              {hasQuicConfig && (
                <DeployInfoItem label="QUIC 参数" value="已配置" />
              )}
              {meta?.obfs === "salamander" && (
                <DeployInfoItem label="混淆" value="Salamander" />
              )}
              {isAcme ? (
                <>
                  <DeployInfoItem
                    label="ACME 域名"
                    value={
                      meta?.acme_domains?.length
                        ? meta.acme_domains.join("，")
                        : "未设置"
                    }
                  />
                  <DeployInfoItem
                    label="ACME 邮箱"
                    value={meta?.acme_email ?? "未设置"}
                  />
                  <DeployInfoItem
                    label="ACME CA"
                    value={acmeCaLabel(meta?.acme_ca)}
                  />
                  {meta?.cert_mode === "acme-dns" && (
                    <DeployInfoItem
                      label="DNS 服务商"
                      value={acmeDnsProviderLabel(meta?.acme_dns_provider)}
                    />
                  )}
                </>
              ) : (
                <>
                  <DeployInfoItem
                    label="证书路径"
                    value={meta?.cert_path ?? "/etc/hysteria/server.crt"}
                    mono
                  />
                  <DeployInfoItem
                    label="私钥路径"
                    value={meta?.key_path ?? "/etc/hysteria/server.key"}
                    mono
                  />
                </>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-yellow-500/25 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-800 dark:text-yellow-200">
            如部署命令过期或可能泄露，请重新生成；新命令将使旧部署凭证失效。
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

      <div className="mx-auto flex w-full max-w-450 flex-col gap-4 p-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">节点管理</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {effectiveCountryFilter ? (
                <>
                  {countryFilterLabel} · 该地区有 {visibleRows.length} 个节点
                </>
              ) : (
                <>共 {rows.length} 个节点</>
              )}
              {visibleOnlineCount > 0 && (
                <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                  · {visibleOnlineCount} 个在线
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {countryFilters.length > 0 ? (
              <div className="flex flex-wrap items-center justify-end gap-1 pr-1 sm:pr-2">
                {countryFilters.map((country) => {
                  const active = effectiveCountryFilter?.code === country.code
                  const flagUrl = getCountryFlagUrl(country.code)
                  return (
                    <Button
                      key={country.code}
                      type="button"
                      variant={active ? "default" : "outline"}
                      size="icon"
                      onClick={() =>
                        setCountryFilter(active ? null : country.code)
                      }
                      disabled={savingOrder || sortingMode}
                      title={`${active ? "取消筛选" : "筛选"}${country.name}节点（${country.count} 个）`}
                      aria-label={`${active ? "取消筛选" : "筛选"}${country.name}节点`}
                    >
                      {flagUrl ? (
                        <span
                          aria-hidden="true"
                          className="inline-block h-3 w-4 rounded-xs bg-cover bg-center shadow-sm"
                          style={{ backgroundImage: `url(${flagUrl})` }}
                        />
                      ) : (
                        <span className="text-[10px] font-semibold">
                          {country.code}
                        </span>
                      )}
                    </Button>
                  )
                })}
              </div>
            ) : null}
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
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
                variant={activeSortingMode ? "default" : "outline"}
                size="icon"
                onClick={toggleSortingMode}
                disabled={
                  loading ||
                  visibleRows.length < 2 ||
                  savingOrder ||
                  Boolean(effectiveCountryFilter)
                }
                title={
                  effectiveCountryFilter
                    ? "国家筛选下暂不支持排序"
                    : activeSortingMode
                      ? "完成排序"
                      : "进入排序模式"
                }
              >
                <ArrowUpDown className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => void handleRefresh()}
                disabled={refreshing || savingOrder || activeSortingMode}
                title={
                  activeSortingMode
                    ? "排序模式下暂不刷新"
                    : savingOrder
                      ? "正在保存排序"
                      : "刷新节点数据"
                }
              >
                <RefreshCw
                  className={cn(
                    "h-4 w-4",
                    (refreshing || savingOrder) && "animate-spin"
                  )}
                />
              </Button>
            </div>
            <Button
              onClick={() => setCreateOpen(true)}
              disabled={activeSortingMode || savingOrder}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              添加节点
            </Button>
          </div>
        </div>

        {/* 节点卡片网格 */}
        {loading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
        ) : visibleRows.length === 0 ? (
          <Card className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Server className="mb-3 h-10 w-10 opacity-40" />
            <p className="text-sm">
              {rows.length === 0 ? "暂无节点" : "暂无匹配节点"}
            </p>
            <p className="mt-1 text-xs">
              {rows.length === 0
                ? "点击右上角「添加节点」创建第一个节点"
                : `当前没有 ${countryFilterLabel ?? "该国家/地区"} 节点`}
            </p>
          </Card>
        ) : activeSortingMode ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            autoScroll={false}
            onDragStart={handleDragStart}
            onDragEnd={(event) => void handleDragEnd(event)}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={visibleRows.map((row) => row.id)}
              strategy={rectSortingStrategy}
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visibleRows.map((row) => {
                  const displayRow = {
                    ...row,
                    dns_status: dnsStatusMap[row.id]?.status ?? "skip",
                    dns_status_detail: dnsStatusMap[row.id]?.detail ?? null,
                  }

                  return (
                    <SortableNodeCard key={row.id} row={row}>
                      <NodeCard
                        row={displayRow}
                        hourly={historyByNode[row.id] ?? buildEmptyHourly()}
                        hideIp={hideIp}
                        onEdit={startEdit}
                        onRemove={removeNode}
                        onToggleStatus={(r) =>
                          void updateNode(r.id, {
                            status:
                              r.status === "enabled" ? "disabled" : "enabled",
                          })
                        }
                        onShowAgentConfig={(r) => void showAgentConfig(r)}
                        onShowDeployCommand={(r) => void showDeployCommand(r)}
                        onDnsResolve={(r) => void resolveDns(r)}
                        onQueueAgentTask={(r, type) =>
                          void queueAgentTask(r, type)
                        }
                        onShowAgentDetail={(r) => void loadAgentDetail(r)}
                      />
                    </SortableNodeCard>
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visibleRows.map((row) => {
              const displayRow = {
                ...row,
                dns_status: dnsStatusMap[row.id]?.status ?? "skip",
                dns_status_detail: dnsStatusMap[row.id]?.detail ?? null,
              }

              return (
                <NodeCard
                  key={row.id}
                  row={displayRow}
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
              )
            })}
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
                obfsMinPacketSize={obfsMinPacketSize}
                setObfsMinPacketSize={setObfsMinPacketSize}
                obfsMaxPacketSize={obfsMaxPacketSize}
                setObfsMaxPacketSize={setObfsMaxPacketSize}
                insecure={insecure}
                setInsecure={setInsecure}
                pinSha256={pinSha256}
                setPinSha256={setPinSha256}
                nodeIpv4={nodeIpv4}
                setNodeIpv4={setNodeIpv4}
                nodeIpv6={nodeIpv6}
                setNodeIpv6={setNodeIpv6}
                nodePortInput={nodePortInput}
                setNodePortInput={setNodePortInput}
                geoOverride={geoOverride}
                setGeoOverride={setGeoOverride}
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
                acmeCaProvider={acmeCaProvider}
                setAcmeCaProvider={setAcmeCaProvider}
                acmeCaUrl={acmeCaUrl}
                setAcmeCaUrl={setAcmeCaUrl}
                acmeDnsProvider={acmeDnsProvider}
                setAcmeDnsProvider={setAcmeDnsProvider}
                acmeDnsConfig={acmeDnsConfig}
                setAcmeDnsConfig={setAcmeDnsConfig}
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
                serverBandwidthUpMbps={serverBandwidthUpMbps}
                setServerBandwidthUpMbps={setServerBandwidthUpMbps}
                serverBandwidthDownMbps={serverBandwidthDownMbps}
                setServerBandwidthDownMbps={setServerBandwidthDownMbps}
                ignoreClientBandwidth={ignoreClientBandwidth}
                setIgnoreClientBandwidth={setIgnoreClientBandwidth}
                quicInitStreamReceiveWindow={quicInitStreamReceiveWindow}
                setQuicInitStreamReceiveWindow={setQuicInitStreamReceiveWindow}
                quicMaxStreamReceiveWindow={quicMaxStreamReceiveWindow}
                setQuicMaxStreamReceiveWindow={setQuicMaxStreamReceiveWindow}
                quicInitConnReceiveWindow={quicInitConnReceiveWindow}
                setQuicInitConnReceiveWindow={setQuicInitConnReceiveWindow}
                quicMaxConnReceiveWindow={quicMaxConnReceiveWindow}
                setQuicMaxConnReceiveWindow={setQuicMaxConnReceiveWindow}
                quicMaxIdleTimeoutSeconds={quicMaxIdleTimeoutSeconds}
                setQuicMaxIdleTimeoutSeconds={setQuicMaxIdleTimeoutSeconds}
                quicMaxIncomingStreams={quicMaxIncomingStreams}
                setQuicMaxIncomingStreams={setQuicMaxIncomingStreams}
                quicDisablePathMtuDiscovery={quicDisablePathMtuDiscovery}
                setQuicDisablePathMtuDiscovery={setQuicDisablePathMtuDiscovery}
                congestionType={congestionType}
                setCongestionType={setCongestionType}
                congestionBbrProfile={congestionBbrProfile}
                setCongestionBbrProfile={setCongestionBbrProfile}
                hostTrafficEnabled={hostTrafficEnabled}
                setHostTrafficEnabled={setHostTrafficEnabled}
                hostTrafficLimit={hostTrafficLimit}
                setHostTrafficLimit={setHostTrafficLimit}
                hostTrafficUsed={hostTrafficUsed}
                setHostTrafficUsed={setHostTrafficUsed}
                hostTrafficUnit={hostTrafficUnit}
                setHostTrafficUnit={setHostTrafficUnit}
                hostTrafficBillingMode={hostTrafficBillingMode}
                setHostTrafficBillingMode={setHostTrafficBillingMode}
                hostTrafficResetCycle={hostTrafficResetCycle}
                setHostTrafficResetCycle={setHostTrafficResetCycle}
                hostTrafficResetIntervalDays={hostTrafficResetIntervalDays}
                setHostTrafficResetIntervalDays={
                  setHostTrafficResetIntervalDays
                }
                hostTrafficResetAnchor={hostTrafficResetAnchor}
                setHostTrafficResetAnchor={setHostTrafficResetAnchor}
                agentInterval={agentInterval}
                setAgentInterval={setAgentInterval}
                agentAutoUpdateEnabled={agentAutoUpdateEnabled}
                setAgentAutoUpdateEnabled={setAgentAutoUpdateEnabled}
                hy2AutoUpdateEnabled={hy2AutoUpdateEnabled}
                setHy2AutoUpdateEnabled={setHy2AutoUpdateEnabled}
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
                            Hy2 版本
                          </span>
                          <p className="font-mono">
                            {formatHy2Version(
                              (agentDetail.state?.hy2_version as
                                | string
                                | null) ?? null
                            ) ?? "-"}
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
                          const taskOutput = parseAgentTaskOutput(
                            task.result,
                            task.error
                          )
                          const output = taskOutput?.value ?? ""
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
                                    getTaskStatusClass(task)
                                  )}
                                >
                                  {getTaskStatusLabel(task)}
                                </Badge>
                              </div>
                              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                                {task.created_at}
                              </p>
                              {taskOutput?.logEntries ? (
                                <AgentLogTable
                                  entries={taskOutput.logEntries}
                                />
                              ) : output ? (
                                <pre className="mt-2 max-h-52 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">
                                  {output}
                                </pre>
                              ) : null}
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
                obfsMinPacketSize={editObfsMinPacketSize}
                setObfsMinPacketSize={setEditObfsMinPacketSize}
                obfsMaxPacketSize={editObfsMaxPacketSize}
                setObfsMaxPacketSize={setEditObfsMaxPacketSize}
                insecure={editInsecure}
                setInsecure={setEditInsecure}
                pinSha256={editPinSha256}
                setPinSha256={setEditPinSha256}
                nodeIpv4={editNodeIpv4}
                setNodeIpv4={setEditNodeIpv4}
                nodeIpv6={editNodeIpv6}
                setNodeIpv6={setEditNodeIpv6}
                nodePortInput={editNodePortInput}
                setNodePortInput={setEditNodePortInput}
                geoOverride={editGeoOverride}
                setGeoOverride={setEditGeoOverride}
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
                acmeCaProvider={editAcmeCaProvider}
                setAcmeCaProvider={setEditAcmeCaProvider}
                acmeCaUrl={editAcmeCaUrl}
                setAcmeCaUrl={setEditAcmeCaUrl}
                acmeDnsProvider={editAcmeDnsProvider}
                setAcmeDnsProvider={setEditAcmeDnsProvider}
                acmeDnsConfig={editAcmeDnsConfig}
                setAcmeDnsConfig={setEditAcmeDnsConfig}
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
                serverBandwidthUpMbps={editServerBandwidthUpMbps}
                setServerBandwidthUpMbps={setEditServerBandwidthUpMbps}
                serverBandwidthDownMbps={editServerBandwidthDownMbps}
                setServerBandwidthDownMbps={setEditServerBandwidthDownMbps}
                ignoreClientBandwidth={editIgnoreClientBandwidth}
                setIgnoreClientBandwidth={setEditIgnoreClientBandwidth}
                quicInitStreamReceiveWindow={editQuicInitStreamReceiveWindow}
                setQuicInitStreamReceiveWindow={
                  setEditQuicInitStreamReceiveWindow
                }
                quicMaxStreamReceiveWindow={editQuicMaxStreamReceiveWindow}
                setQuicMaxStreamReceiveWindow={
                  setEditQuicMaxStreamReceiveWindow
                }
                quicInitConnReceiveWindow={editQuicInitConnReceiveWindow}
                setQuicInitConnReceiveWindow={setEditQuicInitConnReceiveWindow}
                quicMaxConnReceiveWindow={editQuicMaxConnReceiveWindow}
                setQuicMaxConnReceiveWindow={setEditQuicMaxConnReceiveWindow}
                quicMaxIdleTimeoutSeconds={editQuicMaxIdleTimeoutSeconds}
                setQuicMaxIdleTimeoutSeconds={setEditQuicMaxIdleTimeoutSeconds}
                quicMaxIncomingStreams={editQuicMaxIncomingStreams}
                setQuicMaxIncomingStreams={setEditQuicMaxIncomingStreams}
                quicDisablePathMtuDiscovery={editQuicDisablePathMtuDiscovery}
                setQuicDisablePathMtuDiscovery={
                  setEditQuicDisablePathMtuDiscovery
                }
                congestionType={editCongestionType}
                setCongestionType={setEditCongestionType}
                congestionBbrProfile={editCongestionBbrProfile}
                setCongestionBbrProfile={setEditCongestionBbrProfile}
                hostTrafficEnabled={editHostTrafficEnabled}
                setHostTrafficEnabled={setEditHostTrafficEnabled}
                hostTrafficLimit={editHostTrafficLimit}
                setHostTrafficLimit={setEditHostTrafficLimit}
                hostTrafficUsed={editHostTrafficUsed}
                setHostTrafficUsed={setEditHostTrafficUsed}
                hostTrafficUnit={editHostTrafficUnit}
                setHostTrafficUnit={setEditHostTrafficUnit}
                hostTrafficBillingMode={editHostTrafficBillingMode}
                setHostTrafficBillingMode={setEditHostTrafficBillingMode}
                hostTrafficResetCycle={editHostTrafficResetCycle}
                setHostTrafficResetCycle={setEditHostTrafficResetCycle}
                hostTrafficResetIntervalDays={editHostTrafficResetIntervalDays}
                setHostTrafficResetIntervalDays={
                  setEditHostTrafficResetIntervalDays
                }
                hostTrafficResetAnchor={editHostTrafficResetAnchor}
                setHostTrafficResetAnchor={setEditHostTrafficResetAnchor}
                agentInterval={editAgentInterval}
                setAgentInterval={setEditAgentInterval}
                agentAutoUpdateEnabled={editAgentAutoUpdateEnabled}
                setAgentAutoUpdateEnabled={setEditAgentAutoUpdateEnabled}
                hy2AutoUpdateEnabled={editHy2AutoUpdateEnabled}
                setHy2AutoUpdateEnabled={setEditHy2AutoUpdateEnabled}
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
