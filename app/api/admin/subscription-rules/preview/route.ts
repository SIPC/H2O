import { localizedJson } from "@/lib/i18n/api-response"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { buildClashConfig } from "@/lib/subscription/build-clash"
import { buildSingboxConfig } from "@/lib/subscription/build-singbox"
import { validateSubscriptionRuleConfig } from "@/lib/subscription/rule-config"
import type { NodeForUri } from "@/lib/hysteria-uri"

const PREVIEW_TOKEN = "preview_token_for_subscription_rule_preview"

type PreviewNode = NodeForUri & { id: number }

function getPreviewNodes(): PreviewNode[] {
  const db = getDb()
  return db
    .prepare(
      `SELECT id, name, ip, port, port_hopping, sni, obfs, obfs_password,
              obfs_min_packet_size, obfs_max_packet_size, insecure, pin_sha256
       FROM nodes
       WHERE status = 'enabled'
       ORDER BY sort_order ASC, id ASC`
    )
    .all()
    .map((row) => {
      const node = row as Record<string, unknown>
      return {
        id: Number(node.id),
        name: String(node.name ?? ""),
        ip: String(node.ip ?? ""),
        port: Number(node.port),
        port_hopping:
          typeof node.port_hopping === "string" ? node.port_hopping : null,
        sni: typeof node.sni === "string" ? node.sni : null,
        obfs: typeof node.obfs === "string" ? node.obfs : null,
        obfs_password:
          typeof node.obfs_password === "string" ? node.obfs_password : null,
        obfs_min_packet_size:
          typeof node.obfs_min_packet_size === "number"
            ? node.obfs_min_packet_size
            : null,
        obfs_max_packet_size:
          typeof node.obfs_max_packet_size === "number"
            ? node.obfs_max_packet_size
            : null,
        insecure: node.insecure === 1 ? 1 : 0,
        pin_sha256:
          typeof node.pin_sha256 === "string" ? node.pin_sha256 : null,
        up_mbps: 0,
        down_mbps: 0,
      }
    })
}

type PreviewBody = {
  format?: unknown
  config?: unknown
}

function jsonError(
  request: Request,
  code: string,
  message: string,
  status: number
) {
  return localizedJson(
    request,
    { ok: false, error: { code, message } },
    { status }
  )
}

export async function POST(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const body = (await request.json()) as PreviewBody
  const format = body.format
  if (format !== "clash" && format !== "singbox") {
    return jsonError(request, "INVALID_PAYLOAD", "预览格式不合法", 400)
  }

  const validation = validateSubscriptionRuleConfig(body.config)
  if (!validation.ok) {
    return jsonError(request, "INVALID_PAYLOAD", validation.error, 400)
  }

  const nodes = getPreviewNodes()
  if (nodes.length === 0) {
    return jsonError(
      request,
      "NO_NODES",
      "暂无可预览节点，请先添加并启用节点",
      404
    )
  }

  const content =
    format === "clash"
      ? buildClashConfig(PREVIEW_TOKEN, nodes, validation.config)
      : buildSingboxConfig(PREVIEW_TOKEN, nodes, validation.config)

  return localizedJson(request, { ok: true, data: { content } })
}
