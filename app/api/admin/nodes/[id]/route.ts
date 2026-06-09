import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import {
  isSupportedHysteriaObfs,
  normalizeHysteriaObfs,
  requiresObfsPassword,
  validateGeckoPacketSizes,
} from "@/lib/hysteria-obfs"
import {
  parseHysteriaNetworkConfig,
  type HysteriaNetworkConfig,
} from "@/lib/hysteria-network-config"
import { writeAdminEvent } from "@/lib/logs-db"
import { normalizeNodeName, validateNodeName } from "@/lib/node-name"
import {
  parseOptionalNodeIpv4,
  parseOptionalNodeIpv6,
} from "@/lib/node-public-address"
import {
  isHostTrafficResetCycle,
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

function normalizeDateSecondKey(value: string | null) {
  if (!value) return null

  const raw = value.trim()
  if (!raw) return null

  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T")
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
    ? normalized
    : `${normalized}Z`
  const date = new Date(withZone)
  if (!Number.isFinite(date.getTime())) return null

  return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString()
}

type UpdateNodeBody = {
  // 订阅配置
  name?: string
  remark?: string | null
  ip?: string
  port?: string | number
  status?: "enabled" | "disabled"
  sni?: string | null
  obfs?: string | null
  obfsPassword?: string | null
  obfsMinPacketSize?: number | string | null
  obfsMaxPacketSize?: number | string | null
  insecure?: boolean
  pinSha256?: string | null
  // 节点配置
  nodeIpv4?: string | null
  nodeIpv6?: string | null
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
  hy2AutoUpdateEnabled?: boolean
  agentControlEnabled?: boolean
  serverBandwidthUpMbps?: number | string | null
  serverBandwidthDownMbps?: number | string | null
  ignoreClientBandwidth?: boolean
  quicInitStreamReceiveWindow?: number | string | null
  quicMaxStreamReceiveWindow?: number | string | null
  quicInitConnReceiveWindow?: number | string | null
  quicMaxConnReceiveWindow?: number | string | null
  quicMaxIdleTimeoutSeconds?: number | string | null
  quicMaxIncomingStreams?: number | string | null
  quicDisablePathMtuDiscovery?: boolean
  congestionType?: string | null
  congestionBbrProfile?: string | null
  hostTrafficLimitBytes?: number | null
  hostTrafficUsedBytes?: number | null
  hostTrafficBillingMode?: string | null
  hostTrafficResetCycle?: string | null
  hostTrafficResetIntervalDays?: number | null
  hostTrafficResetAnchor?: string | null
  resetHostTrafficUsed?: boolean
}

export async function PATCH(
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

  const body = (await request.json()) as UpdateNodeBody
  const updates: string[] = []
  const values: Array<string | number | null> = []
  const changedFields: string[] = []
  let nextNodeName: string | null = null

  if (body.name !== undefined) {
    const nodeName = normalizeNodeName(body.name)
    const nodeNameError = validateNodeName(nodeName)
    if (nodeNameError) {
      writeAdminEvent({
        event: "NODE_UPDATE",
        actor: auth.user,
        ip: clientIp,
        success: false,
        reason: "INVALID_PAYLOAD",
        detail: { nodeId, name: nodeName || body.name || null },
      })
      return NextResponse.json(
        {
          ok: false,
          error: { code: "INVALID_PAYLOAD", message: nodeNameError },
        },
        { status: 400 }
      )
    }

    updates.push("name = ?")
    values.push(nodeName)
    changedFields.push("name")
    nextNodeName = nodeName
  }

  if (body.remark !== undefined) {
    updates.push("remark = ?")
    values.push(body.remark && body.remark.trim() ? body.remark.trim() : null)
    changedFields.push("remark")
  }

  if (body.ip) {
    updates.push("ip = ?")
    values.push(body.ip)
    changedFields.push("ip")
  }

  if (body.port !== undefined && body.port !== null) {
    const resolvedPortInput = parseUnifiedPortInput(String(body.port))
    if (!resolvedPortInput.ok) {
      writeAdminEvent({
        event: "NODE_UPDATE",
        actor: auth.user,
        ip: clientIp,
        success: false,
        reason: "INVALID_PORT",
        detail: { nodeId, port: body.port ?? null },
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

    updates.push("port = ?")
    values.push(resolvedPortInput.port)
    changedFields.push("port")

    updates.push("port_hopping = ?")
    values.push(resolvedPortInput.portHopping)
    changedFields.push("port_hopping")
  }

  if (body.status) {
    updates.push("status = ?")
    values.push(body.status)
    changedFields.push("status")
  }

  // 可选字段：传入 null / 空字符串时清空，传入有效值时更新
  if (body.sni !== undefined) {
    updates.push("sni = ?")
    values.push(body.sni && body.sni.trim() ? body.sni.trim() : null)
    changedFields.push("sni")
  }

  if (body.obfs !== undefined) {
    const obfsInput = body.obfs?.trim() || null
    if (obfsInput && !isSupportedHysteriaObfs(obfsInput)) {
      writeAdminEvent({
        event: "NODE_UPDATE",
        actor: auth.user,
        ip: clientIp,
        success: false,
        reason: "UNSUPPORTED_OBFS",
        detail: { nodeId, obfs: obfsInput },
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
    updates.push("obfs = ?")
    values.push(normalizeHysteriaObfs(obfsInput))
    changedFields.push("obfs")
  }

  if (body.obfsPassword !== undefined) {
    updates.push("obfs_password = ?")
    values.push(
      body.obfsPassword && body.obfsPassword.trim()
        ? body.obfsPassword.trim()
        : null
    )
    changedFields.push("obfs_password")
  }

  if (typeof body.insecure === "boolean") {
    updates.push("insecure = ?")
    values.push(body.insecure ? 1 : 0)
    changedFields.push("insecure")
  }

  if (body.pinSha256 !== undefined) {
    updates.push("pin_sha256 = ?")
    values.push(
      body.pinSha256 && body.pinSha256.trim() ? body.pinSha256.trim() : null
    )
    changedFields.push("pin_sha256")
  }

  // 节点配置字段
  if (body.nodeIpv4 !== undefined) {
    const nodeIpv4 = parseOptionalNodeIpv4(body.nodeIpv4)
    if (!nodeIpv4.ok) {
      writeAdminEvent({
        event: "NODE_UPDATE",
        actor: auth.user,
        ip: clientIp,
        success: false,
        reason: "INVALID_PAYLOAD",
        detail: { nodeId, nodeIpv4: body.nodeIpv4 ?? null },
      })
      return NextResponse.json(
        {
          ok: false,
          error: { code: "INVALID_PAYLOAD", message: nodeIpv4.message },
        },
        { status: 400 }
      )
    }
    updates.push("node_ipv4 = ?")
    values.push(nodeIpv4.value)
    changedFields.push("node_ipv4")
  }

  if (body.nodeIpv6 !== undefined) {
    const nodeIpv6 = parseOptionalNodeIpv6(body.nodeIpv6)
    if (!nodeIpv6.ok) {
      writeAdminEvent({
        event: "NODE_UPDATE",
        actor: auth.user,
        ip: clientIp,
        success: false,
        reason: "INVALID_PAYLOAD",
        detail: { nodeId, nodeIpv6: body.nodeIpv6 ?? null },
      })
      return NextResponse.json(
        {
          ok: false,
          error: { code: "INVALID_PAYLOAD", message: nodeIpv6.message },
        },
        { status: 400 }
      )
    }
    updates.push("node_ipv6 = ?")
    values.push(nodeIpv6.value)
    changedFields.push("node_ipv6")
  }

  if (
    body.nodePort !== undefined &&
    body.nodePort !== null &&
    String(body.nodePort).trim()
  ) {
    const resolvedNode = parseUnifiedPortInput(String(body.nodePort))
    if (!resolvedNode.ok) {
      writeAdminEvent({
        event: "NODE_UPDATE",
        actor: auth.user,
        ip: clientIp,
        success: false,
        reason: "INVALID_NODE_PORT",
        detail: { nodeId, nodePort: body.nodePort },
      })
      return NextResponse.json(
        {
          ok: false,
          error: { code: "INVALID_NODE_PORT", message: resolvedNode.error },
        },
        { status: 400 }
      )
    }
    updates.push("node_port = ?", "node_port_hopping = ?")
    values.push(resolvedNode.port, resolvedNode.portHopping)
    changedFields.push("node_port", "node_port_hopping")
  } else if (body.nodePort !== undefined) {
    // nodePort 显式为空 → 清除节点端口，回退到订阅端口
    updates.push("node_port = ?", "node_port_hopping = ?")
    values.push(null, null)
    changedFields.push("node_port", "node_port_hopping")
  } else if (body.nodePortHopping !== undefined) {
    updates.push("node_port_hopping = ?")
    values.push(
      body.nodePortHopping && body.nodePortHopping.trim()
        ? body.nodePortHopping.trim()
        : null
    )
    changedFields.push("node_port_hopping")
  }

  if (body.certMode !== undefined) {
    updates.push("cert_mode = ?")
    values.push(body.certMode)
    changedFields.push("cert_mode")
  }

  if (body.certPath !== undefined) {
    updates.push("cert_path = ?")
    values.push(
      body.certPath && body.certPath.trim() ? body.certPath.trim() : null
    )
    changedFields.push("cert_path")
  }

  if (body.keyPath !== undefined) {
    updates.push("key_path = ?")
    values.push(
      body.keyPath && body.keyPath.trim() ? body.keyPath.trim() : null
    )
    changedFields.push("key_path")
  }

  if (body.acmeDomains !== undefined) {
    updates.push("acme_domains = ?")
    values.push(
      body.acmeDomains && body.acmeDomains.length > 0
        ? JSON.stringify(body.acmeDomains)
        : null
    )
    changedFields.push("acme_domains")
  }

  if (body.acmeEmail !== undefined) {
    updates.push("acme_email = ?")
    values.push(
      body.acmeEmail && body.acmeEmail.trim() ? body.acmeEmail.trim() : null
    )
    changedFields.push("acme_email")
  }

  if (body.acmeDnsProvider !== undefined) {
    updates.push("acme_dns_provider = ?")
    values.push(
      body.acmeDnsProvider && body.acmeDnsProvider.trim()
        ? body.acmeDnsProvider.trim()
        : null
    )
    changedFields.push("acme_dns_provider")
  }

  if (body.acmeDnsConfig !== undefined) {
    updates.push("acme_dns_config = ?")
    values.push(body.acmeDnsConfig ? JSON.stringify(body.acmeDnsConfig) : null)
    changedFields.push("acme_dns_config")
  }

  if (body.masqueradeType !== undefined) {
    updates.push("masquerade_type = ?")
    values.push(body.masqueradeType?.trim() || null)
    changedFields.push("masquerade_type")
  }

  if (body.masqueradeConfig !== undefined) {
    updates.push("masquerade_config = ?")
    values.push(
      body.masqueradeConfig ? JSON.stringify(body.masqueradeConfig) : null
    )
    changedFields.push("masquerade_config")
  }

  const db = getDb()
  const currentNode = db
    .prepare(
      `SELECT port, port_hopping, obfs, obfs_password, obfs_min_packet_size,
              obfs_max_packet_size, node_port, node_port_hopping,
              cert_mode, cert_path, key_path, acme_domains, acme_email,
              acme_dns_provider, acme_dns_config, masquerade_type,
              masquerade_config, agent_interval, agent_auto_update_enabled,
              hy2_auto_update_enabled,
              server_bandwidth_up_mbps, server_bandwidth_down_mbps,
              ignore_client_bandwidth,
              quic_init_stream_receive_window, quic_max_stream_receive_window,
              quic_init_conn_receive_window, quic_max_conn_receive_window,
              quic_max_idle_timeout_seconds, quic_max_incoming_streams,
              quic_disable_path_mtu_discovery,
              congestion_type, congestion_bbr_profile,
              host_traffic_limit_bytes, host_traffic_used_bytes,
              host_traffic_billing_mode, host_traffic_reset_cycle,
              host_traffic_reset_interval_days, host_traffic_reset_anchor
       FROM nodes
       WHERE id = ?
       LIMIT 1`
    )
    .get(nodeId) as Record<string, string | number | null> | undefined

  if (!currentNode) {
    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip: clientIp,
      success: false,
      reason: "NOT_FOUND",
      detail: { nodeId },
    })
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "节点不存在" } },
      { status: 404 }
    )
  }

  if (nextNodeName) {
    const duplicateNode = db
      .prepare(`SELECT id FROM nodes WHERE name = ? AND id <> ? LIMIT 1`)
      .get(nextNodeName, nodeId) as { id: number } | undefined
    if (duplicateNode) {
      writeAdminEvent({
        event: "NODE_UPDATE",
        actor: auth.user,
        ip: clientIp,
        success: false,
        reason: "INVALID_PAYLOAD",
        detail: {
          nodeId,
          name: nextNodeName,
          duplicateNodeId: duplicateNode.id,
        },
      })
      return NextResponse.json(
        {
          ok: false,
          error: { code: "INVALID_PAYLOAD", message: "节点名称已存在" },
        },
        { status: 400 }
      )
    }
  }

  const nextObfs =
    body.obfs !== undefined
      ? normalizeHysteriaObfs(body.obfs)
      : typeof currentNode.obfs === "string"
        ? normalizeHysteriaObfs(currentNode.obfs)
        : null
  const nextObfsPassword =
    body.obfsPassword !== undefined
      ? body.obfsPassword?.trim() || null
      : typeof currentNode.obfs_password === "string" &&
          currentNode.obfs_password.trim()
        ? currentNode.obfs_password.trim()
        : null

  if (
    (body.obfs !== undefined ||
      body.obfsPassword !== undefined ||
      body.obfsMinPacketSize !== undefined ||
      body.obfsMaxPacketSize !== undefined) &&
    requiresObfsPassword(nextObfs) &&
    !nextObfsPassword
  ) {
    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip: clientIp,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { nodeId, obfs: nextObfs },
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

  if (
    body.obfs !== undefined ||
    body.obfsMinPacketSize !== undefined ||
    body.obfsMaxPacketSize !== undefined
  ) {
    const geckoPacketSizes = validateGeckoPacketSizes({
      obfs: nextObfs,
      minPacketSize:
        body.obfsMinPacketSize !== undefined
          ? body.obfsMinPacketSize
          : currentNode.obfs_min_packet_size,
      maxPacketSize:
        body.obfsMaxPacketSize !== undefined
          ? body.obfsMaxPacketSize
          : currentNode.obfs_max_packet_size,
    })
    if (!geckoPacketSizes.ok) {
      writeAdminEvent({
        event: "NODE_UPDATE",
        actor: auth.user,
        ip: clientIp,
        success: false,
        reason: "INVALID_PAYLOAD",
        detail: { nodeId, obfs: nextObfs },
      })
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: geckoPacketSizes.message,
          },
        },
        { status: 400 }
      )
    }

    updates.push("obfs_min_packet_size = ?")
    values.push(geckoPacketSizes.minPacketSize)
    changedFields.push("obfs_min_packet_size")

    updates.push("obfs_max_packet_size = ?")
    values.push(geckoPacketSizes.maxPacketSize)
    changedFields.push("obfs_max_packet_size")
  }

  if (body.agentInterval !== undefined) {
    updates.push("agent_interval = ?")
    values.push(
      body.agentInterval != null && body.agentInterval > 0
        ? body.agentInterval
        : null
    )
    changedFields.push("agent_interval")
  }

  if (body.agentAutoUpdateEnabled !== undefined) {
    updates.push("agent_auto_update_enabled = ?")
    values.push(body.agentAutoUpdateEnabled ? 1 : 0)
    changedFields.push("agent_auto_update_enabled")
  }

  if (body.hy2AutoUpdateEnabled !== undefined) {
    updates.push("hy2_auto_update_enabled = ?")
    values.push(body.hy2AutoUpdateEnabled ? 1 : 0)
    changedFields.push("hy2_auto_update_enabled")
  }

  if (body.agentControlEnabled !== undefined) {
    updates.push("agent_control_enabled = ?")
    values.push(body.agentControlEnabled ? 1 : 0)
    changedFields.push("agent_control_enabled")
  }

  const networkConfigKeys: Array<keyof UpdateNodeBody> = [
    "serverBandwidthUpMbps",
    "serverBandwidthDownMbps",
    "ignoreClientBandwidth",
    "quicInitStreamReceiveWindow",
    "quicMaxStreamReceiveWindow",
    "quicInitConnReceiveWindow",
    "quicMaxConnReceiveWindow",
    "quicMaxIdleTimeoutSeconds",
    "quicMaxIncomingStreams",
    "quicDisablePathMtuDiscovery",
    "congestionType",
    "congestionBbrProfile",
  ]
  const hasNetworkConfigChanges = networkConfigKeys.some(
    (key) => body[key] !== undefined
  )
  if (hasNetworkConfigChanges) {
    const currentNetworkConfig: HysteriaNetworkConfig = {
      serverBandwidthUpMbps:
        typeof currentNode.server_bandwidth_up_mbps === "number"
          ? currentNode.server_bandwidth_up_mbps
          : 0,
      serverBandwidthDownMbps:
        typeof currentNode.server_bandwidth_down_mbps === "number"
          ? currentNode.server_bandwidth_down_mbps
          : 0,
      ignoreClientBandwidth: currentNode.ignore_client_bandwidth === 1,
      quicInitStreamReceiveWindow:
        typeof currentNode.quic_init_stream_receive_window === "number"
          ? currentNode.quic_init_stream_receive_window
          : null,
      quicMaxStreamReceiveWindow:
        typeof currentNode.quic_max_stream_receive_window === "number"
          ? currentNode.quic_max_stream_receive_window
          : null,
      quicInitConnReceiveWindow:
        typeof currentNode.quic_init_conn_receive_window === "number"
          ? currentNode.quic_init_conn_receive_window
          : null,
      quicMaxConnReceiveWindow:
        typeof currentNode.quic_max_conn_receive_window === "number"
          ? currentNode.quic_max_conn_receive_window
          : null,
      quicMaxIdleTimeoutSeconds:
        typeof currentNode.quic_max_idle_timeout_seconds === "number"
          ? currentNode.quic_max_idle_timeout_seconds
          : null,
      quicMaxIncomingStreams:
        typeof currentNode.quic_max_incoming_streams === "number"
          ? currentNode.quic_max_incoming_streams
          : null,
      quicDisablePathMtuDiscovery:
        currentNode.quic_disable_path_mtu_discovery === 1,
      congestionType:
        currentNode.congestion_type === "bbr" ||
        currentNode.congestion_type === "reno"
          ? currentNode.congestion_type
          : null,
      congestionBbrProfile:
        currentNode.congestion_bbr_profile === "standard" ||
        currentNode.congestion_bbr_profile === "conservative" ||
        currentNode.congestion_bbr_profile === "aggressive"
          ? currentNode.congestion_bbr_profile
          : null,
    }
    const networkConfig = parseHysteriaNetworkConfig(
      {
        serverBandwidthUpMbps: body.serverBandwidthUpMbps,
        serverBandwidthDownMbps: body.serverBandwidthDownMbps,
        ignoreClientBandwidth: body.ignoreClientBandwidth,
        quicInitStreamReceiveWindow: body.quicInitStreamReceiveWindow,
        quicMaxStreamReceiveWindow: body.quicMaxStreamReceiveWindow,
        quicInitConnReceiveWindow: body.quicInitConnReceiveWindow,
        quicMaxConnReceiveWindow: body.quicMaxConnReceiveWindow,
        quicMaxIdleTimeoutSeconds: body.quicMaxIdleTimeoutSeconds,
        quicMaxIncomingStreams: body.quicMaxIncomingStreams,
        quicDisablePathMtuDiscovery: body.quicDisablePathMtuDiscovery,
        congestionType: body.congestionType,
        congestionBbrProfile: body.congestionBbrProfile,
      },
      currentNetworkConfig
    )
    if (!networkConfig.ok) {
      writeAdminEvent({
        event: "NODE_UPDATE",
        actor: auth.user,
        ip: clientIp,
        success: false,
        reason: networkConfig.code ?? "INVALID_PAYLOAD",
        detail: { nodeId },
      })
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: networkConfig.code ?? "INVALID_PAYLOAD",
            message: networkConfig.message,
          },
        },
        { status: 400 }
      )
    }

    for (const [col, value] of [
      ["server_bandwidth_up_mbps", networkConfig.value.serverBandwidthUpMbps],
      [
        "server_bandwidth_down_mbps",
        networkConfig.value.serverBandwidthDownMbps,
      ],
      [
        "ignore_client_bandwidth",
        networkConfig.value.ignoreClientBandwidth ? 1 : 0,
      ],
      [
        "quic_init_stream_receive_window",
        networkConfig.value.quicInitStreamReceiveWindow,
      ],
      [
        "quic_max_stream_receive_window",
        networkConfig.value.quicMaxStreamReceiveWindow,
      ],
      [
        "quic_init_conn_receive_window",
        networkConfig.value.quicInitConnReceiveWindow,
      ],
      [
        "quic_max_conn_receive_window",
        networkConfig.value.quicMaxConnReceiveWindow,
      ],
      [
        "quic_max_idle_timeout_seconds",
        networkConfig.value.quicMaxIdleTimeoutSeconds,
      ],
      ["quic_max_incoming_streams", networkConfig.value.quicMaxIncomingStreams],
      [
        "quic_disable_path_mtu_discovery",
        networkConfig.value.quicDisablePathMtuDiscovery ? 1 : 0,
      ],
      ["congestion_type", networkConfig.value.congestionType],
      ["congestion_bbr_profile", networkConfig.value.congestionBbrProfile],
    ] as const) {
      updates.push(`${col} = ?`)
      values.push(value)
      changedFields.push(col)
    }
  }

  const hostTrafficLimit =
    body.hostTrafficLimitBytes !== undefined
      ? parseHostTrafficLimitBytes(body.hostTrafficLimitBytes)
      : null
  if (hostTrafficLimit && !hostTrafficLimit.ok) {
    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip: clientIp,
      success: false,
      reason: "INVALID_TRAFFIC",
      detail: { nodeId },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_TRAFFIC", message: hostTrafficLimit.message },
      },
      { status: 400 }
    )
  }

  const hostTrafficUsed =
    body.hostTrafficUsedBytes !== undefined
      ? parseHostTrafficUsedBytes(body.hostTrafficUsedBytes)
      : null
  if (hostTrafficUsed && !hostTrafficUsed.ok) {
    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip: clientIp,
      success: false,
      reason: "INVALID_TRAFFIC",
      detail: { nodeId },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_TRAFFIC", message: hostTrafficUsed.message },
      },
      { status: 400 }
    )
  }

  const hostTrafficBillingMode =
    body.hostTrafficBillingMode !== undefined
      ? parseHostTrafficBillingMode(body.hostTrafficBillingMode)
      : null
  if (hostTrafficBillingMode && !hostTrafficBillingMode.ok) {
    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip: clientIp,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { nodeId },
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

  const hostTrafficCycle =
    body.hostTrafficResetCycle !== undefined
      ? parseHostTrafficResetCycle(body.hostTrafficResetCycle)
      : null
  if (hostTrafficCycle && !hostTrafficCycle.ok) {
    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip: clientIp,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { nodeId },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: hostTrafficCycle.message },
      },
      { status: 400 }
    )
  }

  const hostTrafficInterval =
    body.hostTrafficResetIntervalDays !== undefined
      ? parseHostTrafficResetIntervalDays(body.hostTrafficResetIntervalDays)
      : null
  if (hostTrafficInterval && !hostTrafficInterval.ok) {
    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip: clientIp,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { nodeId },
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

  const hostTrafficAnchor =
    body.hostTrafficResetAnchor !== undefined
      ? parseHostTrafficResetAnchor(body.hostTrafficResetAnchor)
      : null
  if (hostTrafficAnchor && !hostTrafficAnchor.ok) {
    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip: clientIp,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { nodeId },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: hostTrafficAnchor.message },
      },
      { status: 400 }
    )
  }

  const currentHostTrafficCycle = isHostTrafficResetCycle(
    currentNode.host_traffic_reset_cycle
  )
    ? currentNode.host_traffic_reset_cycle
    : "monthly"
  const nextHostTrafficCycle = hostTrafficCycle?.ok
    ? hostTrafficCycle.value
    : currentHostTrafficCycle
  const currentHostTrafficInterval =
    typeof currentNode.host_traffic_reset_interval_days === "number"
      ? currentNode.host_traffic_reset_interval_days
      : null
  const nextHostTrafficInterval = hostTrafficInterval?.ok
    ? hostTrafficInterval.value
    : currentHostTrafficInterval

  const currentHostTrafficLimitForValidation =
    typeof currentNode.host_traffic_limit_bytes === "number"
      ? currentNode.host_traffic_limit_bytes
      : 0
  const nextHostTrafficLimitForValidation = hostTrafficLimit?.ok
    ? (hostTrafficLimit.value ?? 0)
    : currentHostTrafficLimitForValidation

  if (nextHostTrafficLimitForValidation > 0) {
    const hostTrafficConfig = validateHostTrafficResetConfig(
      nextHostTrafficCycle,
      nextHostTrafficInterval
    )
    if (!hostTrafficConfig.ok) {
      writeAdminEvent({
        event: "NODE_UPDATE",
        actor: auth.user,
        ip: clientIp,
        success: false,
        reason: "INVALID_PAYLOAD",
        detail: { nodeId },
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

  const hostTrafficResetNow = new Date().toISOString()
  let hostTrafficAnchorUpdated = false
  const currentHostTrafficAnchor =
    typeof currentNode.host_traffic_reset_anchor === "string"
      ? currentNode.host_traffic_reset_anchor
      : null
  const nextHostTrafficAnchor = hostTrafficAnchor?.ok
    ? hostTrafficAnchor.value
    : currentHostTrafficAnchor
  const currentHostTrafficAnchorKey = normalizeDateSecondKey(
    currentHostTrafficAnchor
  )
  const nextHostTrafficAnchorKey = hostTrafficAnchor?.ok
    ? normalizeDateSecondKey(hostTrafficAnchor.value)
    : currentHostTrafficAnchorKey
  const hostTrafficPeriodChanged =
    (hostTrafficCycle?.ok &&
      hostTrafficCycle.value !== currentHostTrafficCycle) ||
    (hostTrafficInterval?.ok &&
      hostTrafficInterval.value !== currentHostTrafficInterval) ||
    (hostTrafficAnchor?.ok &&
      nextHostTrafficAnchorKey !== currentHostTrafficAnchorKey)

  if (hostTrafficLimit?.ok) {
    updates.push("host_traffic_limit_bytes = ?")
    values.push(hostTrafficLimit.value)
    changedFields.push("host_traffic_limit_bytes")
  }

  if (hostTrafficUsed?.ok) {
    updates.push("host_traffic_used_bytes = ?")
    values.push(
      nextHostTrafficLimitForValidation > 0 ? hostTrafficUsed.value : 0
    )
    changedFields.push("host_traffic_used_bytes")
  }

  if (hostTrafficBillingMode?.ok) {
    updates.push("host_traffic_billing_mode = ?")
    values.push(hostTrafficBillingMode.value)
    changedFields.push("host_traffic_billing_mode")
  }

  if (hostTrafficCycle?.ok) {
    updates.push("host_traffic_reset_cycle = ?")
    values.push(hostTrafficCycle.value)
    changedFields.push("host_traffic_reset_cycle")
  }

  if (hostTrafficInterval?.ok) {
    updates.push("host_traffic_reset_interval_days = ?")
    values.push(hostTrafficInterval.value)
    changedFields.push("host_traffic_reset_interval_days")
  }

  if (
    !hostTrafficInterval?.ok &&
    nextHostTrafficCycle !== "custom_days" &&
    currentNode.host_traffic_reset_interval_days !== null
  ) {
    updates.push("host_traffic_reset_interval_days = ?")
    values.push(null)
    changedFields.push("host_traffic_reset_interval_days")
  }

  if (hostTrafficAnchor?.ok) {
    updates.push("host_traffic_reset_anchor = ?")
    values.push(hostTrafficAnchor.value)
    changedFields.push("host_traffic_reset_anchor")
    hostTrafficAnchorUpdated = true
  }

  const currentHostTrafficLimit = currentHostTrafficLimitForValidation
  const nextHostTrafficLimit = nextHostTrafficLimitForValidation
  const shouldResetHostTraffic =
    hostTrafficUsed === null &&
    (body.resetHostTrafficUsed === true ||
      hostTrafficPeriodChanged ||
      (hostTrafficLimit?.ok && !hostTrafficLimit.value))

  if (
    !hostTrafficAnchorUpdated &&
    (body.resetHostTrafficUsed === true ||
      hostTrafficPeriodChanged ||
      (currentHostTrafficLimit <= 0 && nextHostTrafficLimit > 0) ||
      (nextHostTrafficLimit > 0 && !nextHostTrafficAnchor))
  ) {
    updates.push("host_traffic_reset_anchor = ?")
    values.push(hostTrafficResetNow)
    changedFields.push("host_traffic_reset_anchor")
  }

  if (shouldResetHostTraffic) {
    updates.push("host_traffic_used_bytes = ?")
    values.push(0)
    changedFields.push("host_traffic_used_bytes")

    updates.push("host_traffic_last_reset_at = ?")
    values.push(hostTrafficResetNow)
    changedFields.push("host_traffic_last_reset_at")
  }

  if (updates.length === 0) {
    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip: clientIp,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { nodeId },
    })
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: "没有可更新字段" },
      },
      { status: 400 }
    )
  }

  const runtimeConfigFields = new Set([
    "port",
    "port_hopping",
    "obfs",
    "obfs_password",
    "obfs_min_packet_size",
    "obfs_max_packet_size",
    "node_port",
    "node_port_hopping",
    "cert_mode",
    "cert_path",
    "key_path",
    "acme_domains",
    "acme_email",
    "acme_dns_provider",
    "acme_dns_config",
    "masquerade_type",
    "masquerade_config",
    "agent_interval",
    "agent_auto_update_enabled",
    "server_bandwidth_up_mbps",
    "server_bandwidth_down_mbps",
    "ignore_client_bandwidth",
    "quic_init_stream_receive_window",
    "quic_max_stream_receive_window",
    "quic_init_conn_receive_window",
    "quic_max_conn_receive_window",
    "quic_max_idle_timeout_seconds",
    "quic_max_incoming_streams",
    "quic_disable_path_mtu_discovery",
    "congestion_type",
    "congestion_bbr_profile",
  ])
  const valueByField = new Map<string, string | number | null>()
  updates.forEach((update, index) => {
    const match = update.match(/^([a-z_]+) = \?$/)
    if (match) valueByField.set(match[1], values[index])
  })
  const shouldBumpRevision = changedFields.some((field) => {
    if (!runtimeConfigFields.has(field)) return false
    if (!valueByField.has(field)) return true
    return currentNode[field] !== valueByField.get(field)
  })
  if (shouldBumpRevision) {
    updates.push(
      "agent_config_revision = COALESCE(agent_config_revision, 1) + 1",
      "agent_desired_config_hash = NULL",
      "agent_last_config_built_at = NULL"
    )
    changedFields.push("agent_config_revision")
  }

  values.push(nodeId)
  const result = db
    .prepare(`UPDATE nodes SET ${updates.join(", ")} WHERE id = ?`)
    .run(...values)

  if (result.changes === 0) {
    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip: clientIp,
      success: false,
      reason: "NOT_FOUND",
      detail: { nodeId },
    })
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "节点不存在" } },
      { status: 404 }
    )
  }

  const target = db
    .prepare(`SELECT name FROM nodes WHERE id = ? LIMIT 1`)
    .get(nodeId) as { name: string } | undefined

  writeAdminEvent({
    event: "NODE_UPDATE",
    actor: auth.user,
    ip: clientIp,
    success: true,
    reason: "OK",
    detail: { nodeId, nodeName: target?.name ?? null, fields: changedFields },
  })

  return NextResponse.json({ ok: true, data: { id: nodeId } })
}

export async function DELETE(
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
  // 先查出节点名用于日志，删除后就拿不到了
  const target = db
    .prepare(`SELECT name FROM nodes WHERE id = ? LIMIT 1`)
    .get(nodeId) as { name: string } | undefined

  // plan_nodes 有 ON DELETE CASCADE，会自动清理套餐节点关联；历史 auth_logs 冗余了节点名，不受影响
  try {
    const result = db.prepare(`DELETE FROM nodes WHERE id = ?`).run(nodeId)

    if (result.changes === 0) {
      writeAdminEvent({
        event: "NODE_DELETE",
        actor: auth.user,
        ip: clientIp,
        success: false,
        reason: "NOT_FOUND",
        detail: { nodeId },
      })
      return NextResponse.json(
        { ok: false, error: { code: "NOT_FOUND", message: "节点不存在" } },
        { status: 404 }
      )
    }

    writeAdminEvent({
      event: "NODE_DELETE",
      actor: auth.user,
      ip: clientIp,
      success: true,
      reason: "OK",
      detail: { nodeId, nodeName: target?.name ?? null },
    })
    return NextResponse.json({ ok: true, data: { id: nodeId } })
  } catch {
    writeAdminEvent({
      event: "NODE_DELETE",
      actor: auth.user,
      ip: clientIp,
      success: false,
      reason: "DELETE_FAILED",
      detail: { nodeId },
    })
    return NextResponse.json(
      { ok: false, error: { code: "DELETE_FAILED", message: "节点删除失败" } },
      { status: 400 }
    )
  }
}
