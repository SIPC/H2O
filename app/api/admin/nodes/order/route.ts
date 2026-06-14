import { localizedJson } from "@/lib/i18n/api-response"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { writeAdminEvent } from "@/lib/logs-db"
import { getClientIp } from "@/lib/turnstile"

type UpdateNodeOrderBody = {
  ids?: unknown
}

export async function PUT(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const body = (await request.json()) as UpdateNodeOrderBody
  const ids = body.ids

  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.some((id) => !Number.isInteger(id) || id <= 0) ||
    new Set(ids).size !== ids.length
  ) {
    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "INVALID_PAYLOAD",
      detail: { action: "NODE_ORDER_UPDATE" },
    })
    return localizedJson(
      request,
      {
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: "节点排序参数不合法" },
      },
      { status: 400 }
    )
  }

  const nodeIds = ids as number[]
  const db = getDb()
  const placeholders = nodeIds.map(() => "?").join(",")
  const existingRows = db
    .prepare(`SELECT id FROM nodes WHERE id IN (${placeholders})`)
    .all(...nodeIds) as Array<{ id: number }>
  const existingIds = new Set(existingRows.map((row) => row.id))

  if (existingIds.size !== nodeIds.length) {
    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "NOT_FOUND",
      detail: {
        action: "NODE_ORDER_UPDATE",
        missingIds: nodeIds.filter((id) => !existingIds.has(id)),
      },
    })
    return localizedJson(
      request,
      { ok: false, error: { code: "NOT_FOUND", message: "部分节点不存在" } },
      { status: 404 }
    )
  }

  try {
    db.exec("BEGIN")
    const update = db.prepare(`UPDATE nodes SET sort_order = ? WHERE id = ?`)
    for (const [index, id] of nodeIds.entries()) {
      update.run(index + 1, id)
    }
    db.exec("COMMIT")

    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip,
      success: true,
      reason: "ORDER_UPDATE",
      detail: { ids: nodeIds },
    })

    return localizedJson(request, { ok: true, data: { ids: nodeIds } })
  } catch {
    try {
      db.exec("ROLLBACK")
    } catch {
      // 事务未开启或已结束
    }

    writeAdminEvent({
      event: "NODE_UPDATE",
      actor: auth.user,
      ip,
      success: false,
      reason: "UPDATE_FAILED",
      detail: { action: "NODE_ORDER_UPDATE" },
    })
    return localizedJson(
      request,
      {
        ok: false,
        error: { code: "UPDATE_FAILED", message: "节点排序保存失败" },
      },
      { status: 500 }
    )
  }
}
