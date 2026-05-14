import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { writeAdminEvent } from "@/lib/logs-db"
import { parseUnifiedPortInput } from "@/lib/port-hopping"
import { getClientIp } from "@/lib/turnstile"

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
  insecure?: boolean
  pinSha256?: string | null
  // 节点配置
  nodeIp?: string | null
  nodePort?: string | number | null
  nodePortHopping?: string | null
  certMode?: "self-signed" | "acme" | "custom"
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

  if (body.name) {
    updates.push("name = ?")
    values.push(body.name)
    changedFields.push("name")
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
    updates.push("obfs = ?")
    values.push(body.obfs && body.obfs.trim() ? body.obfs.trim() : null)
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
  if (body.nodeIp !== undefined) {
    updates.push("node_ip = ?")
    values.push(body.nodeIp && body.nodeIp.trim() ? body.nodeIp.trim() : null)
    changedFields.push("node_ip")
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
      `SELECT port, port_hopping, obfs, obfs_password, node_port, node_port_hopping,
              cert_mode, cert_path, key_path, acme_domains, acme_email,
              acme_dns_provider, acme_dns_config, masquerade_type,
              masquerade_config, agent_interval, agent_auto_update_enabled
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

  if (body.agentControlEnabled !== undefined) {
    updates.push("agent_control_enabled = ?")
    values.push(body.agentControlEnabled ? 1 : 0)
    changedFields.push("agent_control_enabled")
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
