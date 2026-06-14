import { isIPv4, isIPv6 } from "node:net"
import { localizedJson } from "@/lib/i18n/api-response"

import { requireAdmin } from "@/lib/auth"
import {
  createDnsRecord,
  findDnsRecord,
  findZone,
  isDomain,
  PANEL_DNS_TTL_SECONDS,
  updateDnsRecord,
} from "@/lib/cloudflare"
import { getDb } from "@/lib/db"
import { writeAdminEvent } from "@/lib/logs-db"
import { getSetting, SETTING_KEYS } from "@/lib/settings"
import { getClientIp } from "@/lib/turnstile"

type DnsTarget = {
  dnsType: "A" | "AAAA"
  ip: string
}

type DnsActionResult = {
  action: "created" | "updated" | "unchanged"
  domain: string
  dnsType: "A" | "AAAA"
  ip: string
  oldIp?: string
  oldTtl?: number
  ttl: number
  proxied?: boolean
  zone: string
  recordId?: string
}

function buildDnsTargets(node: {
  node_ipv4: string | null
  node_ipv6: string | null
}) {
  const targets: DnsTarget[] = []
  const ipv4 = node.node_ipv4?.trim()
  const ipv6 = node.node_ipv6?.trim()

  if (ipv4) {
    if (!isIPv4(ipv4))
      return { ok: false as const, message: "节点 IPv4 不合法" }
    targets.push({ dnsType: "A", ip: ipv4 })
  }

  if (ipv6) {
    if (!isIPv6(ipv6))
      return { ok: false as const, message: "节点 IPv6 不合法" }
    targets.push({ dnsType: "AAAA", ip: ipv6 })
  }

  return { ok: true as const, targets }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const clientIp = getClientIp(request)
  const { id } = await params
  const nodeId = Number(id)

  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    return localizedJson(
      request,
      { ok: false, error: { code: "INVALID_ID", message: "节点ID不合法" } },
      { status: 400 }
    )
  }

  const db = getDb()
  const node = db
    .prepare(
      `SELECT id, name, ip, node_ipv4, node_ipv6
       FROM nodes
       WHERE id = ?
       LIMIT 1`
    )
    .get(nodeId) as
    | {
        id: number
        name: string
        ip: string
        node_ipv4: string | null
        node_ipv6: string | null
      }
    | undefined

  if (!node) {
    return localizedJson(
      request,
      { ok: false, error: { code: "NOT_FOUND", message: "节点不存在" } },
      { status: 404 }
    )
  }

  // 确定要解析的域名：订阅地址（ip 字段）
  const domain = node.ip

  if (!isDomain(domain)) {
    return localizedJson(
      request,
      {
        ok: false,
        error: {
          code: "NOT_A_DOMAIN",
          message: "订阅地址不是域名，无需 DNS 解析",
        },
      },
      { status: 400 }
    )
  }

  const targetResult = buildDnsTargets(node)
  if (!targetResult.ok) {
    return localizedJson(
      request,
      {
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: targetResult.message },
      },
      { status: 400 }
    )
  }

  if (targetResult.targets.length === 0) {
    return localizedJson(
      request,
      {
        ok: false,
        error: {
          code: "NO_NODE_IP",
          message: "请先填写公网 IPv4 或 IPv6",
        },
      },
      { status: 400 }
    )
  }

  // 读取 Cloudflare API Token：优先节点自身配置，其次全局设置
  let cfToken = ""
  const nodeConfig = db
    .prepare(`SELECT acme_dns_config FROM nodes WHERE id = ?`)
    .get(nodeId) as { acme_dns_config: string | null } | undefined

  if (nodeConfig?.acme_dns_config) {
    try {
      const parsed = JSON.parse(nodeConfig.acme_dns_config) as Record<
        string,
        string
      >
      if (parsed.cloudflare_api_token) cfToken = parsed.cloudflare_api_token
    } catch {
      // 忽略解析错误
    }
  }

  if (!cfToken) {
    cfToken = getSetting<string>(SETTING_KEYS.cloudflareApiToken, "").trim()
  }

  if (!cfToken) {
    return localizedJson(
      request,
      {
        ok: false,
        error: {
          code: "NO_CF_TOKEN",
          message: "未配置 Cloudflare API Token，请在节点配置或全局设置中填写",
        },
      },
      { status: 400 }
    )
  }

  try {
    const zone = await findZone(cfToken, domain)
    if (!zone) {
      writeAdminEvent({
        event: "NODE_UPDATE",
        actor: auth.user,
        ip: clientIp,
        success: false,
        reason: "CF_ZONE_NOT_FOUND",
        detail: { nodeId, domain },
      })
      return localizedJson(
        request,
        {
          ok: false,
          error: {
            code: "CF_ZONE_NOT_FOUND",
            message: `未找到域名 ${domain} 所属的 Cloudflare Zone`,
          },
        },
        { status: 400 }
      )
    }

    const records: DnsActionResult[] = []
    for (const target of targetResult.targets) {
      const existing = await findDnsRecord(
        cfToken,
        zone.zoneId,
        domain,
        target.dnsType
      )

      if (existing) {
        const needsTtlUpdate = existing.ttl !== PANEL_DNS_TTL_SECONDS
        if (existing.content === target.ip && !needsTtlUpdate) {
          records.push({
            action: "unchanged",
            domain,
            dnsType: target.dnsType,
            ip: target.ip,
            ttl: PANEL_DNS_TTL_SECONDS,
            zone: zone.zoneName,
          })
          continue
        }

        await updateDnsRecord(
          cfToken,
          zone.zoneId,
          existing.id,
          domain,
          target.ip,
          target.dnsType,
          existing.proxied
        )
        records.push({
          action: "updated",
          domain,
          dnsType: target.dnsType,
          ip: target.ip,
          oldIp: existing.content,
          oldTtl: existing.ttl,
          ttl: PANEL_DNS_TTL_SECONDS,
          proxied: existing.proxied,
          zone: zone.zoneName,
        })
        continue
      }

      const created = await createDnsRecord(
        cfToken,
        zone.zoneId,
        domain,
        target.ip,
        target.dnsType
      )
      records.push({
        action: "created",
        domain,
        dnsType: target.dnsType,
        ip: target.ip,
        ttl: PANEL_DNS_TTL_SECONDS,
        proxied: false,
        zone: zone.zoneName,
        recordId: created.recordId,
      })
    }

    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip: clientIp,
      success: true,
      reason: "OK",
      detail: {
        nodeId,
        nodeName: node.name,
        dnsRecords: records.map((record) => ({
          action: record.action,
          dnsType: record.dnsType,
          domain,
          ip: record.ip,
          oldIp: record.oldIp ?? null,
          ttl: record.ttl,
          proxied: record.proxied ?? null,
          recordId: record.recordId ?? null,
        })),
      },
    })

    const action = records.some((record) => record.action !== "unchanged")
      ? "changed"
      : "unchanged"

    return localizedJson(request, {
      ok: true,
      data: {
        action,
        domain,
        records,
      },
    })
  } catch (error) {
    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip: clientIp,
      success: false,
      reason: "CF_API_ERROR",
      detail: {
        nodeId,
        domain,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    return localizedJson(
      request,
      {
        ok: false,
        error: {
          code: "CF_API_ERROR",
          message:
            error instanceof Error ? error.message : "Cloudflare API 请求失败",
        },
      },
      { status: 500 }
    )
  }
}
