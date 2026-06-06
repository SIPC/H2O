import { createHash, randomBytes } from "node:crypto"

import { NextResponse } from "next/server"

import { ensureNodeAgentSecrets } from "@/lib/agent-control"
import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { isSupportedHysteriaObfs } from "@/lib/hysteria-obfs"
import { resolveNodeRoutingConfig } from "@/lib/hysteria-routing"
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
  obfs_min_packet_size: number | null
  obfs_max_packet_size: number | null
  node_ip: string | null
  node_port: number | null
  node_port_hopping: string | null
  cert_mode: string
  cert_path: string | null
  key_path: string | null
  acme_domains: string | null
  acme_email: string | null
  acme_dns_provider: string | null
  acme_dns_config: string | null
  masquerade_type: string | null
  masquerade_config: string | null
  agent_interval: number | null
  agent_auto_update_enabled: 0 | 1 | null
  hy2_auto_update_enabled: 0 | 1 | null
  hy2_stats_secret: string | null
  agent_secret: string | null
  agent_control_enabled: 0 | 1 | null
}

const DEFAULT_AGENT_BUNDLE_URL =
  "https://github.com/SIPC/H2O/releases/latest/download/h2o-agent-bundle.tar.gz"

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

function hasShellUnsafeUrlChars(value: string) {
  return /[\s"'`$\\;]/.test(value)
}

function normalizeOrigin(raw: string): string | null {
  try {
    if (hasShellUnsafeUrlChars(raw)) return null
    const u = new URL(raw)
    const normalized = `${u.protocol}//${u.host}`
    if (u.protocol !== "http:" && u.protocol !== "https:") return null
    if (hasShellUnsafeUrlChars(normalized)) return null
    return normalized
  } catch {
    return null
  }
}

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function detectOrigin(request: Request): string {
  const url = new URL(request.url)
  const xfp = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
  const xfh = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()

  if (xfp && xfh) return `${xfp}://${xfh}`
  return `${url.protocol}//${url.host}`
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

function normalizeAgentBundleSha256Url(raw: string): string | null {
  const value = raw.trim()
  if (!value || !isHttpUrl(value) || hasShellUnsafeUrlChars(value)) return null
  return value
}

function deriveOfficialAgentBundleSha256Url(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" || url.host.toLowerCase() !== "github.com") {
      return null
    }
    if (
      !/^\/SIPC\/H2O\/releases\/(?:latest\/download|download\/[^/]+)\/h2o-agent-bundle\.tar\.gz$/i.test(
        url.pathname
      )
    ) {
      return null
    }
    url.pathname = `${url.pathname}.sha256`
    const derived = url.toString()
    return hasShellUnsafeUrlChars(derived) ? null : derived
  } catch {
    return null
  }
}

const DEPLOY_TOKEN_TTL_MINUTES = 30

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function toSqliteDateTime(date: Date) {
  return date.toISOString().replace("T", " ").slice(0, 19)
}

function createDeployToken(params: {
  nodeId: number
  payload: string
  createdBy: number
}) {
  const token = randomBytes(32).toString("base64url")
  const tokenHash = sha256(token)
  const expiresAt = toSqliteDateTime(
    new Date(Date.now() + DEPLOY_TOKEN_TTL_MINUTES * 60 * 1000)
  )

  const db = getDb()
  db.exec("BEGIN")
  try {
    db.prepare(
      `DELETE FROM node_deploy_tokens
       WHERE expires_at <= datetime('now') OR node_id = ?`
    ).run(params.nodeId)
    db.prepare(
      `INSERT INTO node_deploy_tokens(node_id, token_hash, payload, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?)`
    ).run(params.nodeId, tokenHash, params.payload, expiresAt, params.createdBy)
    db.exec("COMMIT")
  } catch (error) {
    try {
      db.exec("ROLLBACK")
    } catch {
      // 事务未开启或已结束
    }
    throw error
  }

  return { token, expiresAt }
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
      `SELECT id, name, ip, port, port_hopping, auth_path, status, obfs, obfs_password,
              obfs_min_packet_size, obfs_max_packet_size,
              node_ip, node_port, node_port_hopping,
              cert_mode, cert_path, key_path,
              acme_domains, acme_email, acme_dns_provider, acme_dns_config,
              masquerade_type, masquerade_config, agent_interval, agent_auto_update_enabled,
              hy2_auto_update_enabled, hy2_stats_secret, agent_secret, agent_control_enabled
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

  // 证书路径：从 DB 读取，回退默认值
  const certPath = node.cert_path?.trim() || "/etc/hysteria/server.crt"
  const keyPath = node.key_path?.trim() || "/etc/hysteria/server.key"

  const { hy2StatsSecret: statsSecret, agentSecret } = ensureNodeAgentSecrets(
    {
      id: node.id,
      hy2_stats_secret: node.hy2_stats_secret,
      agent_secret: node.agent_secret,
    },
    db
  )

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

  const rawAgentBundleSha256Url =
    reqUrl.searchParams.get("agent_bundle_sha256_url")?.trim() ?? ""
  const agentBundleSha256Url = rawAgentBundleSha256Url
    ? normalizeAgentBundleSha256Url(rawAgentBundleSha256Url)
    : deriveOfficialAgentBundleSha256Url(agentBundleUrl)
  if (rawAgentBundleSha256Url && !agentBundleSha256Url) {
    return jsonError(
      "INVALID_AGENT_BUNDLE_URL",
      "agent_bundle_sha256_url 不合法",
      400
    )
  }

  // 部署端口回退到订阅端口
  // 注意：仅当节点端口完全未配置时才回退；若节点端口已明确设置，
  // 端口跳跃以节点配置为准（null 表示不跳跃）
  const deployPort = node.node_port ?? node.port
  const deployPortHopping =
    node.node_port != null ? node.node_port_hopping : node.port_hopping

  if (node.obfs && !isSupportedHysteriaObfs(node.obfs)) {
    return jsonError(
      "UNSUPPORTED_OBFS",
      "当前一键部署仅支持 obfs 为空、salamander 或 gecko",
      400
    )
  }

  if (node.obfs && !node.obfs_password) {
    return jsonError(
      "INVALID_NODE_CONFIG",
      `节点 obfs=${node.obfs} 但 obfs_password 为空，请先补全节点配置`,
      400
    )
  }

  // ACME 配置解析
  let acmeDomains: string[] = []
  if (node.acme_domains) {
    try {
      acmeDomains = JSON.parse(node.acme_domains) as string[]
    } catch {
      acmeDomains = []
    }
  }

  // ACME 邮箱：节点级 > 全局设置
  const acmeEmail =
    node.acme_email?.trim() ||
    getSetting<string>(SETTING_KEYS.acmeEmail, "").trim()

  // ACME DNS 配置解析（节点级 > 全局设置回退）
  let acmeDnsConfig: Record<string, string> = {}
  if (node.acme_dns_config) {
    try {
      acmeDnsConfig = JSON.parse(node.acme_dns_config) as Record<string, string>
    } catch {
      acmeDnsConfig = {}
    }
  }
  // 节点未单独配置 CF Token 时回退到全局站点设置
  if (
    (node.acme_dns_provider === "cloudflare" ||
      node.cert_mode === "acme-dns" ||
      node.cert_mode === "acme") &&
    !acmeDnsConfig.cloudflare_api_token
  ) {
    const globalCfToken = getSetting<string>(
      SETTING_KEYS.cloudflareApiToken,
      ""
    ).trim()
    if (globalCfToken) {
      acmeDnsConfig = { cloudflare_api_token: globalCfToken }
    }
  }

  const routingConfig = resolveNodeRoutingConfig({
    nodeId: node.id,
    database: db,
  })

  const rawParams = new URLSearchParams()
  rawParams.set("panel_url", panelUrl)
  rawParams.set("auth_path", node.auth_path)
  rawParams.set("port", String(deployPort))
  if (deployPortHopping) {
    rawParams.set("port_hopping", deployPortHopping)
  }
  rawParams.set("cert_path", certPath)
  rawParams.set("key_path", keyPath)
  rawParams.set("stats_secret", statsSecret)
  rawParams.set("agent_secret", agentSecret)
  rawParams.set("interval_seconds", String(node.agent_interval ?? 120))
  rawParams.set("agent_bundle_url", agentBundleUrl)
  if (agentBundleSha256Url) {
    rawParams.set("agent_bundle_sha256_url", agentBundleSha256Url)
  }
  rawParams.set(
    "agent_auto_update_enabled",
    node.agent_auto_update_enabled !== 0 ? "true" : "false"
  )
  rawParams.set(
    "hy2_auto_update_enabled",
    node.hy2_auto_update_enabled !== 0 ? "true" : "false"
  )
  rawParams.set(
    "cert_mode",
    node.cert_mode === "acme" ? "acme-dns" : node.cert_mode || "self-signed"
  )

  if (node.obfs && isSupportedHysteriaObfs(node.obfs)) {
    rawParams.set("obfs", node.obfs)
    rawParams.set("obfs_password", node.obfs_password ?? "")
    if (node.obfs === "gecko") {
      if (node.obfs_min_packet_size != null) {
        rawParams.set("obfs_min_packet_size", String(node.obfs_min_packet_size))
      }
      if (node.obfs_max_packet_size != null) {
        rawParams.set("obfs_max_packet_size", String(node.obfs_max_packet_size))
      }
    }
  }

  // ACME 配置：acme-http 和 acme-dns 都需要域名和邮箱
  const isAcme =
    node.cert_mode === "acme-http" ||
    node.cert_mode === "acme-dns" ||
    node.cert_mode === "acme"
  if (isAcme) {
    if (acmeDomains.length > 0) {
      rawParams.set("acme_domains", JSON.stringify(acmeDomains))
    }
    if (acmeEmail) {
      rawParams.set("acme_email", acmeEmail)
    }
    // acme-dns 需要 DNS 服务商配置
    if (node.cert_mode === "acme-dns" || node.cert_mode === "acme") {
      const dnsProvider =
        node.acme_dns_provider ||
        (acmeDnsConfig.cloudflare_api_token ? "cloudflare" : "")
      if (dnsProvider) {
        rawParams.set("acme_dns_provider", dnsProvider)
      }
      if (Object.keys(acmeDnsConfig).length > 0) {
        rawParams.set("acme_dns_config", JSON.stringify(acmeDnsConfig))
      }
    }
  }

  // 伪装配置
  let masqueradeConfig: Record<string, unknown> = {}
  if (node.masquerade_config) {
    try {
      masqueradeConfig = JSON.parse(node.masquerade_config) as Record<
        string,
        unknown
      >
    } catch {
      masqueradeConfig = {}
    }
  }
  const masqueradeType = node.masquerade_type || "string"
  rawParams.set("masquerade_type", masqueradeType)
  if (Object.keys(masqueradeConfig).length > 0) {
    rawParams.set("masquerade_config", JSON.stringify(masqueradeConfig))
  }

  if (routingConfig?.outboundsBlock) {
    rawParams.set("outbounds_block", routingConfig.outboundsBlock)
  }
  if (routingConfig?.aclBlock) {
    rawParams.set("acl_block", routingConfig.aclBlock)
  }

  // 将完整部署参数保存在服务端，仅在命令里暴露短期 token，避免 URL 携带密钥明文或可逆 payload。
  const deployToken = createDeployToken({
    nodeId: node.id,
    payload: rawParams.toString(),
    createdBy: auth.user.id,
  })

  const scriptUrl = new URL("/api/deploy/node-install", panelUrl)
  scriptUrl.searchParams.set("token", deployToken.token)

  const command = `curl -A "Mozilla/5.0" -fsSL ${shellSingleQuote(scriptUrl.toString())} | bash`

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
      deploy_token_expires_at: deployToken.expiresAt,
      meta: {
        cert_mode: node.cert_mode || "self-signed",
        cert_path: certPath,
        key_path: keyPath,
        interval_seconds: node.agent_interval ?? 120,
        agent_auto_update_enabled: node.agent_auto_update_enabled !== 0,
        hy2_auto_update_enabled: node.hy2_auto_update_enabled !== 0,
        deploy_port: deployPort,
        deploy_port_hopping: deployPortHopping,
        obfs: node.obfs || null,
        obfs_min_packet_size: node.obfs_min_packet_size,
        obfs_max_packet_size: node.obfs_max_packet_size,
        acme_domains: acmeDomains,
        acme_email: acmeEmail || null,
        acme_dns_provider: node.acme_dns_provider || null,
        routing: routingConfig
          ? {
              acl_profile_id: routingConfig.aclProfile.id,
              acl_profile_name: routingConfig.aclProfile.name,
              outbound_profile_id: routingConfig.outboundProfile?.id ?? null,
              outbound_profile_name:
                routingConfig.outboundProfile?.name ?? null,
            }
          : null,
      },
    },
  })
}
