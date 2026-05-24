import { NextResponse } from "next/server"

import {
  buildNodeDesiredConfig,
  detectOrigin,
  normalizeOrigin,
} from "@/lib/agent-control"
import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { writeAdminEvent } from "@/lib/logs-db"
import { getClientIp } from "@/lib/turnstile"

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const { id } = await params
  const nodeId = Number(id)
  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    return jsonError("INVALID_ID", "节点ID不合法", 400)
  }

  const reqUrl = new URL(request.url)
  const panelUrl = normalizeOrigin(
    reqUrl.searchParams.get("panel_url")?.trim() || detectOrigin(request)
  )
  if (!panelUrl) return jsonError("INVALID_PANEL_URL", "panel_url 不合法", 400)

  const desired = buildNodeDesiredConfig({
    nodeId,
    panelUrl,
    database: getDb(),
  })
  if (!desired) return jsonError("NOT_FOUND", "节点不存在", 404)

  writeAdminEvent({
    event: "AGENT_CONFIG_VIEW",
    actor: auth.user,
    ip,
    success: true,
    reason: "OK",
    detail: { nodeId, nodeName: desired.node.name },
  })

  const config = {
    h2o_url: panelUrl,
    auth_path: desired.node.auth_path,
    agent_secret: desired.agentSecret,
    control_enabled: desired.node.agent_control_enabled !== 0,
    hysteria_stats_url: "http://127.0.0.1:9999",
    hysteria_stats_secret: desired.hy2StatsSecret,
    interval_seconds: desired.intervalSeconds,
    auto_update_enabled: desired.node.agent_auto_update_enabled !== 0,
    hy2_auto_update_enabled: desired.node.hy2_auto_update_enabled !== 0,
    hysteria_config_path: desired.configPath,
    hysteria_service_name: desired.serviceName,
    agent_config_path: "/etc/h2o-agent/config.json",
  }

  return NextResponse.json({
    ok: true,
    data: {
      config,
      config_json: JSON.stringify(config, null, 2),
      desired_config: {
        revision: desired.revision,
        hash: desired.hy2ConfigHash,
      },
    },
  })
}
