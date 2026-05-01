import { isIPv6 } from "node:net"
import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import {
  createDnsRecord,
  findDnsRecord,
  findZone,
  isDomain,
  updateDnsRecord,
} from "@/lib/cloudflare"
import { getDb } from "@/lib/db"
import { writeAdminEvent } from "@/lib/logs-db"
import { getSetting, SETTING_KEYS } from "@/lib/settings"
import { getClientIp } from "@/lib/turnstile"

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
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_ID", message: "节点ID不合法" } },
      { status: 400 }
    )
  }

  const db = getDb()
  const node = db
    .prepare(`SELECT id, name, ip, node_ip FROM nodes WHERE id = ? LIMIT 1`)
    .get(nodeId) as
    | { id: number; name: string; ip: string; node_ip: string | null }
    | undefined

  if (!node) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "节点不存在" } },
      { status: 404 }
    )
  }

  // 确定要解析的域名：订阅地址（ip 字段）
  const domain = node.ip

  if (!isDomain(domain)) {
    return NextResponse.json(
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

  if (!node.node_ip) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NO_NODE_IP",
          message: "请先填写节点 IP（服务器实际 IP）",
        },
      },
      { status: 400 }
    )
  }

  // 自动识别 IP 类型：IPv6 → AAAA，IPv4 → A
  const dnsType = isIPv6(node.node_ip) ? "AAAA" : "A"

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
    return NextResponse.json(
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
    // 查找 zone
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
      return NextResponse.json(
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

    // 查找已有记录
    const existing = await findDnsRecord(cfToken, zone.zoneId, domain, dnsType)

    if (existing) {
      // 已存在且 IP 相同，跳过
      if (existing.content === node.node_ip) {
        return NextResponse.json({
          ok: true,
          data: {
            action: "unchanged",
            domain,
            dnsType,
            ip: node.node_ip,
            zone: zone.zoneName,
          },
        })
      }
      // IP 不同，更新
      await updateDnsRecord(
        cfToken,
        zone.zoneId,
        existing.id,
        domain,
        node.node_ip,
        dnsType
      )
      writeAdminEvent({
        event: "NODE_UPDATE",
        actor: auth.user,
        ip: clientIp,
        success: true,
        reason: "OK",
        detail: {
          nodeId,
          nodeName: node.name,
          dnsAction: "update",
          dnsType,
          domain,
          oldIp: existing.content,
          newIp: node.node_ip,
        },
      })
      return NextResponse.json({
        ok: true,
        data: {
          action: "updated",
          domain,
          dnsType,
          ip: node.node_ip,
          oldIp: existing.content,
          zone: zone.zoneName,
        },
      })
    }

    // 不存在，创建
    const created = await createDnsRecord(
      cfToken,
      zone.zoneId,
      domain,
      node.node_ip,
      dnsType
    )
    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip: clientIp,
      success: true,
      reason: "OK",
      detail: {
        nodeId,
        nodeName: node.name,
        dnsAction: "create",
        dnsType,
        domain,
        ip: node.node_ip,
        recordId: created.recordId,
      },
    })
    return NextResponse.json({
      ok: true,
      data: {
        action: "created",
        domain,
        dnsType,
        ip: node.node_ip,
        zone: zone.zoneName,
        recordId: created.recordId,
      },
    })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Cloudflare API 调用失败"
    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip: clientIp,
      success: false,
      reason: "CF_API_ERROR",
      detail: { nodeId, domain, error: message },
    })
    return NextResponse.json(
      { ok: false, error: { code: "CF_API_ERROR", message } },
      { status: 502 }
    )
  }
}
