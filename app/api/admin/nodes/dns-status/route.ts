import { promises as dnsPromises } from "node:dns"
import { isIPv4, isIPv6 } from "node:net"

import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"

const DNS_QUERY_TIMEOUT_MS = 3000
const DNS_QUERY_ATTEMPTS = 2

const DNS_SOURCES: Array<{ name: string; servers?: string[] }> = [
  { name: "系统 DNS" },
  { name: "Cloudflare", servers: ["1.1.1.1", "1.0.0.1"] },
  { name: "Google", servers: ["8.8.8.8", "8.8.4.4"] },
  { name: "AliDNS", servers: ["223.5.5.5", "223.6.6.6"] },
  { name: "DNSPod", servers: ["119.29.29.29"] },
]

type DnsStatus = "match" | "partial" | "mismatch" | "unresolved" | "skip"

type DnsSource = (typeof DNS_SOURCES)[number]

type DnsSourceResult = {
  name: string
  status: Exclude<DnsStatus, "partial" | "skip">
  records: string[]
  error?: string
}

function normalizeIp(value: string) {
  return value.trim().toLowerCase()
}

function resolveFromSource(source: DnsSource, hostname: string, isV6: boolean) {
  if (!source.servers) {
    return isV6
      ? dnsPromises.resolve6(hostname)
      : dnsPromises.resolve4(hostname)
  }

  const resolver = new dnsPromises.Resolver()
  resolver.setServers(source.servers)
  return isV6 ? resolver.resolve6(hostname) : resolver.resolve4(hostname)
}

async function resolveWithTimeout(
  source: DnsSource,
  hostname: string,
  isV6: boolean
) {
  return Promise.race([
    resolveFromSource(source, hostname, isV6),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), DNS_QUERY_TIMEOUT_MS)
    ),
  ])
}

async function resolveWithRetry(
  source: DnsSource,
  hostname: string,
  isV6: boolean
) {
  let lastError: unknown
  for (let i = 0; i < DNS_QUERY_ATTEMPTS; i += 1) {
    try {
      return await resolveWithTimeout(source, hostname, isV6)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

async function checkSource(
  source: DnsSource,
  hostname: string,
  targetIp: string,
  isV6: boolean
): Promise<DnsSourceResult> {
  try {
    const records = await resolveWithRetry(source, hostname, isV6)
    const normalizedTarget = normalizeIp(targetIp)
    const normalizedRecords = records.map(normalizeIp)
    return {
      name: source.name,
      status: normalizedRecords.includes(normalizedTarget)
        ? "match"
        : "mismatch",
      records,
    }
  } catch (err) {
    return {
      name: source.name,
      status: "unresolved",
      records: [],
      error: err instanceof Error ? err.message : "解析失败",
    }
  }
}

function summarizeStatus(sources: DnsSourceResult[]): DnsStatus {
  const matchCount = sources.filter((item) => item.status === "match").length
  if (matchCount === sources.length) return "match"
  if (matchCount > 0) return "partial"
  if (sources.some((item) => item.status === "mismatch")) return "mismatch"
  return "unresolved"
}

function formatSourceStatus(status: DnsSourceResult["status"]) {
  if (status === "match") return "匹配"
  if (status === "mismatch") return "不匹配"
  return "未解析"
}

function buildDetail(
  domain: string,
  targetIp: string,
  sources: DnsSourceResult[]
) {
  return [
    `域名：${domain}`,
    `目标 IP：${targetIp}`,
    ...sources.map((source) => {
      const records = source.records.length ? source.records.join(", ") : "-"
      const error = source.error ? `（${source.error}）` : ""
      return `${source.name}：${formatSourceStatus(source.status)} → ${records}${error}`
    }),
  ].join("\n")
}

// GET /api/admin/nodes/dns-status
// 返回每个节点的 DNS 解析状态，前端独立调用，不阻塞节点列表加载
export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const db = getDb()
  const rows = db.prepare(`SELECT id, ip, node_ip FROM nodes`).all() as Array<{
    id: number
    ip: string
    node_ip: string | null
  }>

  // 并行检查所有节点的 DNS 解析状态
  const results = await Promise.all(
    rows.map(async (row) => {
      // ip 是 IP 地址或未设置 node_ip → 跳过
      if (!row.node_ip || isIPv4(row.ip) || isIPv6(row.ip)) {
        return {
          id: row.id,
          dns_status: "skip" as const,
          detail: "订阅地址不是域名或未填写节点 IP，跳过 DNS 检查",
          sources: [] as DnsSourceResult[],
        }
      }

      const isV6 = isIPv6(row.node_ip)
      const sources = await Promise.all(
        DNS_SOURCES.map((source) =>
          checkSource(source, row.ip, row.node_ip!, isV6)
        )
      )
      const dnsStatus = summarizeStatus(sources)
      return {
        id: row.id,
        dns_status: dnsStatus,
        detail: buildDetail(row.ip, row.node_ip, sources),
        sources,
      }
    })
  )

  // 以 id 为 key 返回，方便前端合并
  const statusMap: Record<
    number,
    {
      status: DnsStatus
      detail: string
      sources: DnsSourceResult[]
    }
  > = {}
  for (const r of results) {
    statusMap[r.id] = {
      status: r.dns_status,
      detail: r.detail,
      sources: r.sources,
    }
  }

  return NextResponse.json({ ok: true, data: statusMap })
}
