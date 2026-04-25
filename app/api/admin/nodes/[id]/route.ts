import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { writeAdminEvent } from "@/lib/logs-db"
import { parseUnifiedPortInput } from "@/lib/port-hopping"
import { getClientIp } from "@/lib/turnstile"

type UpdateNodeBody = {
  name?: string
  ip?: string
  port?: string | number
  status?: "enabled" | "disabled"
  sni?: string | null
  obfs?: string | null
  obfsPassword?: string | null
  insecure?: boolean
  pinSha256?: string | null
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

  values.push(nodeId)
  const db = getDb()
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
