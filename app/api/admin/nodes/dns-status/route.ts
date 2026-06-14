import { promises as dnsPromises } from "node:dns"
import { isIPv4, isIPv6 } from "node:net"

import { localizedJson } from "@/lib/i18n/api-response"
import { translateText } from "@/lib/i18n/messages"
import { resolveLocaleFromRequest } from "@/lib/i18n/server"
import type { Locale } from "@/lib/i18n/locales"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"

const DNS_QUERY_TIMEOUT_MS = 3000
const DNS_QUERY_ATTEMPTS = 2
const NODE_DNS_CHECK_CONCURRENCY = 8

const DNS_SOURCES: Array<{ name: string; servers?: string[] }> = [
  { name: "系统 DNS" },
  { name: "Cloudflare", servers: ["1.1.1.1", "1.0.0.1"] },
  { name: "Google", servers: ["8.8.8.8", "8.8.4.4"] },
  { name: "DNSPod", servers: ["119.29.29.29"] },
]

type DnsStatus = "match" | "partial" | "mismatch" | "unresolved" | "skip"

type DnsSource = (typeof DNS_SOURCES)[number]

type DnsTarget = {
  dnsType: "A" | "AAAA"
  label: "IPv4" | "IPv6"
  ip: string
  isV6: boolean
}

type DnsSourceResult = {
  name: string
  dnsType: "A" | "AAAA"
  status: Exclude<DnsStatus, "partial" | "skip">
  records: string[]
  error?: string
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
) {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await mapper(items[index])
      }
    }
  )
  await Promise.all(workers)
  return results
}

function normalizeIp(value: string) {
  return value.trim().toLowerCase()
}

function buildTargets(row: {
  node_ipv4: string | null
  node_ipv6: string | null
}) {
  const targets: DnsTarget[] = []
  const ipv4 = row.node_ipv4?.trim()
  const ipv6 = row.node_ipv6?.trim()

  if (ipv4) {
    if (!isIPv4(ipv4))
      return { ok: false as const, detail: "公网 IPv4 格式不合法" }
    targets.push({ dnsType: "A", label: "IPv4", ip: ipv4, isV6: false })
  }

  if (ipv6) {
    if (!isIPv6(ipv6))
      return { ok: false as const, detail: "公网 IPv6 格式不合法" }
    targets.push({ dnsType: "AAAA", label: "IPv6", ip: ipv6, isV6: true })
  }

  return { ok: true as const, targets }
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
  target: DnsTarget
): Promise<DnsSourceResult> {
  try {
    const records = await resolveWithRetry(source, hostname, target.isV6)
    const normalizedTarget = normalizeIp(target.ip)
    const normalizedRecords = records.map(normalizeIp)
    return {
      name: source.name,
      dnsType: target.dnsType,
      status: normalizedRecords.includes(normalizedTarget)
        ? "match"
        : "mismatch",
      records,
    }
  } catch (err) {
    return {
      name: source.name,
      dnsType: target.dnsType,
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

function formatSourceStatus(status: DnsSourceResult["status"], locale: Locale) {
  const label =
    status === "match" ? "匹配" : status === "mismatch" ? "不匹配" : "未解析"
  return translateText(label, locale)
}

function localizeDnsSourceResult(
  source: DnsSourceResult,
  locale: Locale
): DnsSourceResult {
  return {
    ...source,
    name: translateText(source.name, locale),
    error: source.error ? translateText(source.error, locale) : undefined,
  }
}

function formatSkipDetail(reason: string, locale: Locale) {
  if (locale === "zh-CN") return `${reason}，跳过 DNS 检查`
  return `${translateText(reason, locale)}. DNS check skipped.`
}

function buildDetail(
  domain: string,
  targets: DnsTarget[],
  sources: DnsSourceResult[],
  locale: Locale
) {
  const targetLines = targets.map((target) =>
    locale === "zh-CN"
      ? `目标 ${target.label}（${target.dnsType}）：${target.ip}`
      : `Target ${target.label} (${target.dnsType}): ${target.ip}`
  )

  return [
    locale === "zh-CN" ? `域名：${domain}` : `Domain: ${domain}`,
    ...targetLines,
    ...sources.map((source) => {
      const records = source.records.length ? source.records.join(", ") : "-"
      const localSource = localizeDnsSourceResult(source, locale)
      const error = localSource.error
        ? locale === "zh-CN"
          ? `（${localSource.error}）`
          : ` (${localSource.error})`
        : ""
      const separator = locale === "zh-CN" ? "：" : ": "
      return `${localSource.name} ${source.dnsType}${separator}${formatSourceStatus(source.status, locale)} → ${records}${error}`
    }),
  ].join("\n")
}

// GET /api/admin/nodes/dns-status
// 返回每个节点的 DNS 解析状态，前端独立调用，不阻塞节点列表加载
export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const locale = resolveLocaleFromRequest(request)
  const db = getDb()
  const rows = db
    .prepare(`SELECT id, ip, node_ipv4, node_ipv6 FROM nodes`)
    .all() as Array<{
    id: number
    ip: string
    node_ipv4: string | null
    node_ipv6: string | null
  }>

  // 限制节点并发，避免大量节点时瞬时打满 DNS 查询
  const results = await mapWithConcurrency(
    rows,
    NODE_DNS_CHECK_CONCURRENCY,
    async (row) => {
      // ip 是 IP 地址时跳过
      if (isIPv4(row.ip) || isIPv6(row.ip)) {
        return {
          id: row.id,
          dns_status: "skip" as const,
          detail: formatSkipDetail("订阅地址不是域名", locale),
          sources: [] as DnsSourceResult[],
        }
      }

      const targetResult = buildTargets(row)
      if (!targetResult.ok) {
        return {
          id: row.id,
          dns_status: "skip" as const,
          detail: formatSkipDetail(targetResult.detail, locale),
          sources: [] as DnsSourceResult[],
        }
      }

      if (targetResult.targets.length === 0) {
        return {
          id: row.id,
          dns_status: "skip" as const,
          detail: formatSkipDetail("未填写公网 IPv4 或 IPv6", locale),
          sources: [] as DnsSourceResult[],
        }
      }

      const nestedSources = await Promise.all(
        targetResult.targets.map((target) =>
          Promise.all(
            DNS_SOURCES.map((source) => checkSource(source, row.ip, target))
          )
        )
      )
      const sources = nestedSources.flat()
      const dnsStatus = summarizeStatus(sources)
      return {
        id: row.id,
        dns_status: dnsStatus,
        detail: buildDetail(row.ip, targetResult.targets, sources, locale),
        sources: sources.map((source) =>
          localizeDnsSourceResult(source, locale)
        ),
      }
    }
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

  return localizedJson(request, { ok: true, data: statusMap })
}
