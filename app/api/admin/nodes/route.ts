import { randomBytes } from "node:crypto"

import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { writeAdminEvent } from "@/lib/logs-db"
import { parseUnifiedPortInput } from "@/lib/port-hopping"
import { getClientIp } from "@/lib/turnstile"

type CreateNodeBody = {
  name?: string
  ip?: string
  port?: string | number
  sni?: string | null
  obfs?: string | null
  obfsPassword?: string | null
  insecure?: boolean
  pinSha256?: string | null
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const db = getDb()
  const rows = db
    .prepare(
      `SELECT n.id, n.name, n.ip, n.port, n.port_hopping, n.auth_path, n.status, n.sni, n.obfs,
              n.obfs_password, n.insecure, n.pin_sha256, n.created_at,
              ns.last_report_at, ns.online_count
       FROM nodes n
       LEFT JOIN node_stats ns ON ns.node_id = n.id
       ORDER BY n.id DESC`
    )
    .all()
  return NextResponse.json({ ok: true, data: rows })
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

  const sni = body.sni?.trim() || null
  const obfs = body.obfs?.trim() || null
  const obfsPassword = body.obfsPassword?.trim() || null
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

  try {
    const result = db
      .prepare(
        `INSERT INTO nodes(name, ip, port, port_hopping, auth_path, status, sni, obfs, obfs_password, insecure, pin_sha256)
         VALUES (?, ?, ?, ?, ?, 'enabled', ?, ?, ?, ?, ?)`
      )
      .run(
        body.name,
        body.ip,
        resolvedPort,
        resolvedPortHopping,
        authPath,
        sni,
        obfs,
        obfsPassword,
        insecure,
        pinSha256
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
