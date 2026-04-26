import { randomBytes } from "node:crypto"

import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { getSetting, SETTING_KEYS } from "@/lib/settings"

type NodeRow = {
  id: number
  name: string
  ip: string
  port: number
  port_hopping: string | null
  auth_path: string
  status: "enabled" | "disabled"
  obfs: string | null
  obfs_password: string | null
}

const DEFAULT_AGENT_BUNDLE_URL =
  "https://github.com/SIPC/H2O/releases/latest/download/h2o-agent-bundle.tar.gz"

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

function normalizeOrigin(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== "http:" && u.protocol !== "https:") return null
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

function detectOrigin(request: Request): string {
  const url = new URL(request.url)
  const xfp = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
  const xfh = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()

  if (xfp && xfh) return `${xfp}://${xfh}`
  return `${url.protocol}//${url.host}`
}

function normalizeAbsPath(raw: string | null, fallback: string): string {
  const value = raw?.trim() ?? ""
  if (!value) return fallback
  if (!value.startsWith("/")) return fallback
  if (/[\r\n]/.test(value)) return fallback
  return value
}

function parseIntervalSeconds(raw: string | null): number | null {
  const text = raw?.trim() ?? ""
  if (!text) return 120
  if (!/^\d+$/.test(text)) return null
  const n = Number(text)
  if (!Number.isInteger(n) || n < 30 || n > 3600) return null
  return n
}

function parseStatsSecret(raw: string | null): string | null {
  const value = (raw?.trim() || randomBytes(24).toString("hex")).trim()
  if (value.length < 8 || value.length > 256) return null
  if (/[\r\n]/.test(value)) return null
  return value
}

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

function normalizeAgentBundleUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return DEFAULT_AGENT_BUNDLE_URL
  if (!isHttpUrl(value)) return null

  const normalized = value.replace(/\/+$/, "")
  const releaseBase = "https://github.com/SIPC/H2O/releases"

  if (normalized === releaseBase || normalized === `${releaseBase}/latest`) {
    return `${releaseBase}/latest/download/h2o-agent-bundle.tar.gz`
  }

  const tagMatch = normalized.match(
    /^https:\/\/github\.com\/SIPC\/H2O\/releases\/tag\/([^/]+)$/i
  )
  if (tagMatch?.[1]) {
    return `https://github.com/SIPC/H2O/releases/download/${tagMatch[1]}/h2o-agent-bundle.tar.gz`
  }

  return value
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const { id } = await params
  const nodeId = Number(id)
  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    return jsonError("INVALID_ID", "节点ID不合法", 400)
  }

  const db = getDb()
  const node = db
    .prepare(
      `SELECT id, name, ip, port, port_hopping, auth_path, status, obfs, obfs_password
       FROM nodes
       WHERE id = ?
       LIMIT 1`
    )
    .get(nodeId) as NodeRow | undefined

  if (!node) {
    return jsonError("NOT_FOUND", "节点不存在", 404)
  }

  const reqUrl = new URL(request.url)
  const panelUrl = normalizeOrigin(
    reqUrl.searchParams.get("panel_url")?.trim() || detectOrigin(request)
  )
  if (!panelUrl) {
    return jsonError("INVALID_PANEL_URL", "panel_url 不合法", 400)
  }

  const certPath = normalizeAbsPath(
    reqUrl.searchParams.get("cert_path"),
    "/etc/hysteria/server.crt"
  )
  const keyPath = normalizeAbsPath(
    reqUrl.searchParams.get("key_path"),
    "/etc/hysteria/server.key"
  )

  const intervalSeconds = parseIntervalSeconds(
    reqUrl.searchParams.get("interval_seconds")
  )
  if (intervalSeconds == null) {
    return jsonError(
      "INVALID_INTERVAL",
      "interval_seconds 必须是 30~3600 的整数",
      400
    )
  }

  const statsSecret = parseStatsSecret(reqUrl.searchParams.get("stats_secret"))
  if (!statsSecret) {
    return jsonError(
      "INVALID_STATS_SECRET",
      "stats_secret 不合法（长度 8~256，且不能包含换行）",
      400
    )
  }

  const settingsAgentBundleUrl = getSetting<string>(
    SETTING_KEYS.agentBundleUrl,
    ""
  ).trim()
  const rawAgentBundleUrl =
    settingsAgentBundleUrl ||
    reqUrl.searchParams.get("agent_bundle_url")?.trim() ||
    DEFAULT_AGENT_BUNDLE_URL
  const agentBundleUrl = normalizeAgentBundleUrl(rawAgentBundleUrl)

  if (!agentBundleUrl || !isHttpUrl(agentBundleUrl)) {
    return jsonError("INVALID_AGENT_BUNDLE_URL", "agent_bundle_url 不合法", 400)
  }

  if (node.obfs && node.obfs !== "salamander") {
    return jsonError(
      "UNSUPPORTED_OBFS",
      "当前一键部署仅支持 obfs 为空或 salamander",
      400
    )
  }

  if (node.obfs === "salamander" && !node.obfs_password) {
    return jsonError(
      "INVALID_NODE_CONFIG",
      "节点 obfs=salamander 但 obfs_password 为空，请先补全节点配置",
      400
    )
  }

  const rawParams = new URLSearchParams()
  rawParams.set("panel_url", panelUrl)
  rawParams.set("auth_path", node.auth_path)
  rawParams.set("port", String(node.port))
  if (node.port_hopping) {
    rawParams.set("port_hopping", node.port_hopping)
  }
  rawParams.set("cert_path", certPath)
  rawParams.set("key_path", keyPath)
  rawParams.set("stats_secret", statsSecret)
  rawParams.set("interval_seconds", String(intervalSeconds))
  rawParams.set("agent_bundle_url", agentBundleUrl)

  if (node.obfs === "salamander") {
    rawParams.set("obfs", "salamander")
    rawParams.set("obfs_password", node.obfs_password ?? "")
  }

  // 将原始 query 整体做 base64url 编码，避免命令里明文展开所有参数
  const payloadBase64 = toBase64Url(rawParams.toString())

  const scriptUrl = new URL("/api/deploy/node-install", panelUrl)
  scriptUrl.searchParams.set("payload", payloadBase64)

  const command = `curl -fsSL "${scriptUrl.toString()}" | bash`

  return NextResponse.json({
    ok: true,
    data: {
      node: {
        id: node.id,
        name: node.name,
        ip: node.ip,
        status: node.status,
      },
      command,
      script_url: `${scriptUrl.origin}${scriptUrl.pathname}`,
      payload_base64: payloadBase64,
      meta: {
        cert_path: certPath,
        key_path: keyPath,
        interval_seconds: intervalSeconds,
        // 仅供管理员核对
        stats_secret: statsSecret,
      },
    },
  })
}
