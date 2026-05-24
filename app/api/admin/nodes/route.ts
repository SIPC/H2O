import { randomBytes } from "node:crypto"

import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { createAgentSecret, createHy2StatsSecret } from "@/lib/agent-control"
import { getDb } from "@/lib/db"
import {
  isSupportedHysteriaObfs,
  normalizeHysteriaObfs,
  requiresObfsPassword,
  validateGeckoPacketSizes,
} from "@/lib/hysteria-obfs"
import { writeAdminEvent } from "@/lib/logs-db"
import {
  buildNodeHostTrafficSummary,
  ensureAllNodeHostTrafficPeriods,
  parseHostTrafficBillingMode,
  parseHostTrafficLimitBytes,
  parseHostTrafficResetAnchor,
  parseHostTrafficUsedBytes,
  parseHostTrafficResetCycle,
  parseHostTrafficResetIntervalDays,
  validateHostTrafficResetConfig,
} from "@/lib/node-traffic-quota"
import { parseUnifiedPortInput } from "@/lib/port-hopping"
import { getClientIp } from "@/lib/turnstile"

type CreateNodeBody = {
  // 订阅配置
  name?: string
  remark?: string | null
  ip?: string
  port?: string | number
  sni?: string | null
  obfs?: string | null
  obfsPassword?: string | null
  obfsMinPacketSize?: number | string | null
  obfsMaxPacketSize?: number | string | null
  insecure?: boolean
  pinSha256?: string | null
  // 节点配置
  nodeIp?: string | null
  nodePort?: string | number | null
  nodePortHopping?: string | null
  certMode?: "self-signed" | "acme" | "acme-http" | "acme-dns" | "custom"
  certPath?: string | null
  keyPath?: string | null
  acmeDomains?: string[] | null
  acmeEmail?: string | null
  acmeDnsProvider?: string | null
  acmeDnsConfig?: Record<string, string> | null
  masqueradeType?: string | null
  masqueradeConfig?: Record<string, unknown> | null
  agentInterval?: number | null
  agentAutoUpdateEnabled?: boolean
  agentControlEnabled?: boolean
  hostTrafficLimitBytes?: number | null
  hostTrafficUsedBytes?: number | null
  hostTrafficBillingMode?: string | null
  hostTrafficResetCycle?: string | null
  hostTrafficResetIntervalDays?: number | null
  hostTrafficResetAnchor?: string | null
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const db = getDb()
  ensureAllNodeHostTrafficPeriods(db)

  const rows = db
    .prepare(
      `SELECT n.id, n.name, n.remark, n.ip, n.port, n.port_hopping, n.auth_path, n.status, n.sni, n.obfs,
              n.obfs_password, n.obfs_min_packet_size, n.obfs_max_packet_size,
              n.insecure, n.pin_sha256, n.sort_order, n.created_at,
              n.node_ip, n.node_port, n.node_port_hopping,
              n.cert_mode, n.cert_path, n.key_path,
              n.acme_domains, n.acme_email, n.acme_dns_provider, n.acme_dns_config,
              n.masquerade_type, n.masquerade_config, n.agent_interval, n.agent_auto_update_enabled,
              n.agent_control_enabled, n.agent_config_revision, n.agent_desired_config_hash,
              n.agent_last_config_built_at,
              n.host_traffic_limit_bytes, n.host_traffic_used_bytes,
              n.host_traffic_billing_mode,
              n.host_traffic_reset_cycle, n.host_traffic_reset_interval_days,
              n.host_traffic_reset_anchor, n.host_traffic_last_reset_at,
              ns.last_report_at, ns.online_count,
              nas.last_seen_at AS agent_last_seen_at,
              nas.agent_version AS control_agent_version,
              nas.hostname, nas.os, nas.arch, nas.service_manager,
              nas.hy2_status, nas.hy2_version, nas.hysteria_config_path,
              nas.hysteria_config_hash, nas.applied_config_revision,
              nas.last_config_apply_at, nas.last_error, nas.capabilities,
              nab.acl_profile_id, ap.name AS acl_profile_name,
              ap.outbound_profile_id, op.name AS outbound_profile_name
       FROM nodes n
       LEFT JOIN node_stats ns ON ns.node_id = n.id
       LEFT JOIN node_agent_state nas ON nas.node_id = n.id
       LEFT JOIN node_acl_bindings nab ON nab.node_id = n.id
       LEFT JOIN acl_profiles ap ON ap.id = nab.acl_profile_id
       LEFT JOIN outbound_profiles op ON op.id = ap.outbound_profile_id
       ORDER BY n.sort_order ASC, n.id DESC`
    )
    .all() as Array<Record<string, unknown>>

  return NextResponse.json({
    ok: true,
    data: rows.map((row) => ({
      ...row,
      ...buildNodeHostTrafficSummary(
        row as Parameters<typeof buildNodeHostTrafficSummary>[0]
      ),
    })),
  })
}

export async function POST(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const body = (await request.json()) as CreateNodeBody

  if (!body.name || !body.ip || body.port === undefined || body.port === null) {
    writeAdminEvent({
      event: "NODE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { name: body.name ?? null },
    })
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_PAYLOAD", message: "参数不完整" } },
      { status: 400 }
    )
  }

  // 创建节点时生成一次长随机认证路径，后续保持不变
  const authPath = randomBytes(24).toString("hex")
  const db = getDb()

  const remark = body.remark?.trim() || null
  const sni = body.sni?.trim() || null
  const obfsInput = body.obfs?.trim() || null
  if (obfsInput && !isSupportedHysteriaObfs(obfsInput)) {
    writeAdminEvent({
      event: "NODE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "UNSUPPORTED_OBFS",
      detail: { name: body.name ?? null, obfs: obfsInput },
    })
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "UNSUPPORTED_OBFS",
          message: "当前仅支持 obfs 为空、salamander 或 gecko",
        },
      },
      { status: 400 }
    )
  }
  const obfs = normalizeHysteriaObfs(obfsInput)
  const obfsPassword = body.obfsPassword?.trim() || null
  if (requiresObfsPassword(obfs) && !obfsPassword) {
    writeAdminEvent({
      event: "NODE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { name: body.name ?? null, obfs },
    })
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_PAYLOAD",
          message: "启用 obfs 时必须填写 Obfs 密码",
        },
      },
      { status: 400 }
    )
  }
  const geckoPacketSizes = validateGeckoPacketSizes({
    obfs,
    minPacketSize: body.obfsMinPacketSize,
    maxPacketSize: body.obfsMaxPacketSize,
  })
  if (!geckoPacketSizes.ok) {
    writeAdminEvent({
      event: "NODE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { name: body.name ?? null, obfs },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: geckoPacketSizes.message },
      },
      { status: 400 }
    )
  }
  const pinSha256 = body.pinSha256?.trim() || null
  const insecure = body.insecure ? 1 : 0

  const resolvedPortInput = parseUnifiedPortInput(String(body.port))
  if (!resolvedPortInput.ok) {
    writeAdminEvent({
      event: "NODE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PORT",
      detail: { name: body.name ?? null, port: body.port ?? null },
    })
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_PORT",
          message: resolvedPortInput.error,
        },
      },
      { status: 400 }
    )
  }

  const resolvedPort = resolvedPortInput.port
  const resolvedPortHopping = resolvedPortInput.portHopping

  // 节点配置：部署端口回退到订阅端口
  let nodePort: number | null = null
  let nodePortHopping: string | null = null
  if (
    body.nodePort !== undefined &&
    body.nodePort !== null &&
    String(body.nodePort).trim()
  ) {
    const resolvedNode = parseUnifiedPortInput(String(body.nodePort))
    if (!resolvedNode.ok) {
      writeAdminEvent({
        event: "NODE_CREATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "INVALID_NODE_PORT",
        detail: { name: body.name, nodePort: body.nodePort },
      })
      return NextResponse.json(
        {
          ok: false,
          error: { code: "INVALID_NODE_PORT", message: resolvedNode.error },
        },
        { status: 400 }
      )
    }
    nodePort = resolvedNode.port
    nodePortHopping = resolvedNode.portHopping
  }

  const nodeIp = body.nodeIp?.trim() || null
  const certMode = body.certMode || "self-signed"
  const certPath = body.certPath?.trim() || null
  const keyPath = body.keyPath?.trim() || null
  const acmeDomains =
    body.acmeDomains && body.acmeDomains.length > 0
      ? JSON.stringify(body.acmeDomains)
      : null
  const acmeEmail = body.acmeEmail?.trim() || null
  const acmeDnsProvider = body.acmeDnsProvider?.trim() || null
  const acmeDnsConfig = body.acmeDnsConfig
    ? JSON.stringify(body.acmeDnsConfig)
    : null

  const masqueradeType = body.masqueradeType?.trim() || null
  const masqueradeConfig = body.masqueradeConfig
    ? JSON.stringify(body.masqueradeConfig)
    : null
  const agentInterval =
    body.agentInterval != null && body.agentInterval > 0
      ? body.agentInterval
      : null
  const agentAutoUpdateEnabled = body.agentAutoUpdateEnabled === false ? 0 : 1
  const agentControlEnabled = body.agentControlEnabled === false ? 0 : 1

  const hostTrafficLimit = parseHostTrafficLimitBytes(
    body.hostTrafficLimitBytes
  )
  if (!hostTrafficLimit.ok) {
    writeAdminEvent({
      event: "NODE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_TRAFFIC",
      detail: { name: body.name ?? null },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_TRAFFIC", message: hostTrafficLimit.message },
      },
      { status: 400 }
    )
  }

  const hostTrafficUsed = parseHostTrafficUsedBytes(body.hostTrafficUsedBytes)
  if (!hostTrafficUsed.ok) {
    writeAdminEvent({
      event: "NODE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_TRAFFIC",
      detail: { name: body.name ?? null },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_TRAFFIC", message: hostTrafficUsed.message },
      },
      { status: 400 }
    )
  }

  const hostTrafficBillingMode = parseHostTrafficBillingMode(
    body.hostTrafficBillingMode
  )
  if (!hostTrafficBillingMode.ok) {
    writeAdminEvent({
      event: "NODE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { name: body.name ?? null },
    })
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_PAYLOAD",
          message: hostTrafficBillingMode.message,
        },
      },
      { status: 400 }
    )
  }

  const hostTrafficCycle = parseHostTrafficResetCycle(
    body.hostTrafficResetCycle ?? "monthly"
  )
  if (!hostTrafficCycle.ok) {
    writeAdminEvent({
      event: "NODE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { name: body.name ?? null },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: hostTrafficCycle.message },
      },
      { status: 400 }
    )
  }

  const hostTrafficInterval = parseHostTrafficResetIntervalDays(
    body.hostTrafficResetIntervalDays
  )
  if (!hostTrafficInterval.ok) {
    writeAdminEvent({
      event: "NODE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { name: body.name ?? null },
    })
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_PAYLOAD",
          message: hostTrafficInterval.message,
        },
      },
      { status: 400 }
    )
  }

  if (hostTrafficLimit.value) {
    const hostTrafficConfig = validateHostTrafficResetConfig(
      hostTrafficCycle.value,
      hostTrafficInterval.value
    )
    if (!hostTrafficConfig.ok) {
      writeAdminEvent({
        event: "NODE_CREATE",
        actor: auth.user,
        ip,
        success: false,
        reason: "INVALID_PAYLOAD",
        detail: { name: body.name ?? null },
      })
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: hostTrafficConfig.message,
          },
        },
        { status: 400 }
      )
    }
  }

  const hostTrafficAnchor = parseHostTrafficResetAnchor(
    body.hostTrafficResetAnchor
  )
  if (!hostTrafficAnchor.ok) {
    writeAdminEvent({
      event: "NODE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { name: body.name ?? null },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: hostTrafficAnchor.message },
      },
      { status: 400 }
    )
  }

  const hostTrafficAnchorValue = hostTrafficLimit.value
    ? (hostTrafficAnchor.value ?? new Date().toISOString())
    : hostTrafficAnchor.value

  const hy2StatsSecret = createHy2StatsSecret()
  const agentSecret = createAgentSecret()
  const sortRow = db
    .prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS sort_order FROM nodes`)
    .get() as { sort_order: number } | undefined
  const sortOrder = sortRow?.sort_order ?? 1

  try {
    const result = db
      .prepare(
        `INSERT INTO nodes(name, remark, ip, port, port_hopping, auth_path, status, sni, obfs, obfs_password,
           obfs_min_packet_size, obfs_max_packet_size, insecure, pin_sha256,
           node_ip, node_port, node_port_hopping, cert_mode, cert_path, key_path,
           acme_domains, acme_email, acme_dns_provider, acme_dns_config,
           masquerade_type, masquerade_config, agent_interval, agent_auto_update_enabled,
           hy2_stats_secret, agent_secret, agent_control_enabled,
           host_traffic_limit_bytes, host_traffic_used_bytes, host_traffic_billing_mode,
           host_traffic_reset_cycle, host_traffic_reset_interval_days, host_traffic_reset_anchor,
           sort_order)
         VALUES (?, ?, ?, ?, ?, ?, 'enabled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        body.name,
        remark,
        body.ip,
        resolvedPort,
        resolvedPortHopping,
        authPath,
        sni,
        obfs,
        obfsPassword,
        geckoPacketSizes.minPacketSize,
        geckoPacketSizes.maxPacketSize,
        insecure,
        pinSha256,
        nodeIp,
        nodePort,
        nodePortHopping,
        certMode,
        certPath,
        keyPath,
        acmeDomains,
        acmeEmail,
        acmeDnsProvider,
        acmeDnsConfig,
        masqueradeType,
        masqueradeConfig,
        agentInterval,
        agentAutoUpdateEnabled,
        hy2StatsSecret,
        agentSecret,
        agentControlEnabled,
        hostTrafficLimit.value,
        hostTrafficLimit.value ? hostTrafficUsed.value : 0,
        hostTrafficBillingMode.value,
        hostTrafficCycle.value,
        hostTrafficInterval.value,
        hostTrafficAnchorValue,
        sortOrder
      )

    const newNodeId = Number(result.lastInsertRowid)
    writeAdminEvent({
      event: "NODE_CREATE",
      actor: auth.user,
      ip,
      success: true,
      reason: "OK",
      detail: {
        nodeId: newNodeId,
        name: body.name,
        host: `${body.ip}:${resolvedPortHopping ?? resolvedPort}`,
      },
    })

    return NextResponse.json({
      ok: true,
      data: {
        id: newNodeId,
        name: body.name,
        ip: body.ip,
        port: resolvedPort,
        port_hopping: resolvedPortHopping,
        auth_path: authPath,
      },
    })
  } catch {
    writeAdminEvent({
      event: "NODE_CREATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "CREATE_FAILED",
      detail: { name: body.name },
    })
    return NextResponse.json(
      { ok: false, error: { code: "CREATE_FAILED", message: "节点创建失败" } },
      { status: 400 }
    )
  }
}
