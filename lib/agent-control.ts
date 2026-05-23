import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

import type { DatabaseSync } from "node:sqlite"

import { getDb } from "@/lib/db"
import {
  buildHysteriaServerConfig,
  hashHysteriaServerConfig,
  normalizeCertMode,
} from "@/lib/hysteria-server-config"
import { resolveNodeRoutingConfig } from "@/lib/hysteria-routing"
import { getSetting, SETTING_KEYS } from "@/lib/settings"

export const AGENT_TASK_TYPES = [
  "HY2_STATUS",
  "HY2_START",
  "HY2_STOP",
  "HY2_RESTART",
  "HY2_LOGS",
  "AGENT_LOGS",
  "AGENT_RESTART",
  "APPLY_CONFIG",
  "AGENT_SELF_UPDATE",
] as const

export type AgentTaskType = (typeof AGENT_TASK_TYPES)[number]

const AGENT_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000
const AGENT_NONCE_TTL_SECONDS = 10 * 60

export type NodeDesiredConfig = {
  node: NodeRuntimeRow
  hy2StatsSecret: string
  agentSecret: string
  hy2Config: string
  hy2ConfigHash: string
  revision: number
  intervalSeconds: number
  configPath: string
  serviceName: string
  meta: {
    certMode: string
    certPath: string
    keyPath: string
    deployPort: number
    deployPortHopping: string | null
    acmeDomains: string[]
    acmeEmail: string | null
    acmeDnsProvider: string | null
    routing: {
      aclProfileId: number
      aclProfileName: string
      outboundProfileId: number | null
      outboundProfileName: string | null
    } | null
  }
}

export type NodeRuntimeRow = {
  id: number
  name: string
  ip: string
  port: number
  port_hopping: string | null
  auth_path: string
  status: string
  obfs: string | null
  obfs_password: string | null
  obfs_min_packet_size: number | null
  obfs_max_packet_size: number | null
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
  hy2_stats_secret: string | null
  agent_secret: string | null
  agent_control_enabled: 0 | 1 | null
  agent_config_revision: number | null
  agent_desired_config_hash: string | null
}

export function isAgentTaskType(value: unknown): value is AgentTaskType {
  return (
    typeof value === "string" &&
    AGENT_TASK_TYPES.includes(value as AgentTaskType)
  )
}

export function detectOrigin(request: Request): string {
  const url = new URL(request.url)
  const xfp = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
  const xfh = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()

  if (xfp && xfh) return `${xfp}://${xfh}`
  return `${url.protocol}//${url.host}`
}

export function normalizeOrigin(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== "http:" && u.protocol !== "https:") return null
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

export function createAgentSecret() {
  return randomBytes(32).toString("hex")
}

export function createHy2StatsSecret() {
  return randomBytes(24).toString("hex")
}

function isUsableSecret(value: string | null | undefined, minLength: number) {
  return !!value && value.length >= minLength && !/[\r\n]/.test(value)
}

export function ensureNodeAgentSecrets(
  node: Pick<NodeRuntimeRow, "id" | "hy2_stats_secret" | "agent_secret">,
  database: DatabaseSync = getDb()
) {
  const hy2StatsSecret = isUsableSecret(node.hy2_stats_secret, 8)
    ? node.hy2_stats_secret!
    : createHy2StatsSecret()
  const agentSecret = isUsableSecret(node.agent_secret, 32)
    ? node.agent_secret!
    : createAgentSecret()

  if (
    hy2StatsSecret !== node.hy2_stats_secret ||
    agentSecret !== node.agent_secret
  ) {
    database
      .prepare(
        `UPDATE nodes
         SET hy2_stats_secret = ?, agent_secret = ?
         WHERE id = ?`
      )
      .run(hy2StatsSecret, agentSecret, node.id)
  }

  return { hy2StatsSecret, agentSecret }
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string")
      : []
  } catch {
    return []
  }
}

function parseJsonRecord(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function parseStringRecord(raw: string | null): Record<string, string> {
  const parsed = parseJsonRecord(raw)
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") out[key] = value
  }
  return out
}

function getNodeRuntimeRow(nodeId: number, database: DatabaseSync) {
  return database
    .prepare(
      `SELECT id, name, ip, port, port_hopping, auth_path, status, obfs,
              obfs_password, obfs_min_packet_size, obfs_max_packet_size,
              node_port, node_port_hopping,
              cert_mode, cert_path, key_path,
              acme_domains, acme_email, acme_dns_provider, acme_dns_config,
              masquerade_type, masquerade_config, agent_interval, agent_auto_update_enabled,
              hy2_stats_secret, agent_secret, agent_control_enabled,
              agent_config_revision, agent_desired_config_hash
       FROM nodes
       WHERE id = ?
       LIMIT 1`
    )
    .get(nodeId) as NodeRuntimeRow | undefined
}

export function buildNodeDesiredConfig(params: {
  nodeId: number
  panelUrl: string
  database?: DatabaseSync
}): NodeDesiredConfig | null {
  const database = params.database ?? getDb()
  const node = getNodeRuntimeRow(params.nodeId, database)
  if (!node) return null

  const { hy2StatsSecret, agentSecret } = ensureNodeAgentSecrets(node, database)

  const certMode = normalizeCertMode(node.cert_mode)
  const certPath = node.cert_path?.trim() || "/etc/hysteria/server.crt"
  const keyPath = node.key_path?.trim() || "/etc/hysteria/server.key"
  const deployPort = node.node_port ?? node.port
  const deployPortHopping =
    node.node_port != null ? node.node_port_hopping : node.port_hopping

  const acmeDomains = parseJsonArray(node.acme_domains)
  const acmeEmail =
    node.acme_email?.trim() ||
    getSetting<string>(SETTING_KEYS.acmeEmail, "").trim()

  let acmeDnsConfig = parseStringRecord(node.acme_dns_config)
  if (
    (node.acme_dns_provider === "cloudflare" || certMode === "acme-dns") &&
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

  const masqueradeConfig = parseJsonRecord(node.masquerade_config)
  const routingConfig = resolveNodeRoutingConfig({
    nodeId: node.id,
    database,
  })

  const baseRevision = node.agent_config_revision ?? 1
  const provisionalConfig = buildHysteriaServerConfig({
    panelUrl: params.panelUrl,
    authPath: node.auth_path,
    port: deployPort,
    portHopping: deployPortHopping,
    certPath,
    keyPath,
    statsSecret: hy2StatsSecret,
    obfs: node.obfs,
    obfsPassword: node.obfs_password,
    obfsMinPacketSize: node.obfs_min_packet_size,
    obfsMaxPacketSize: node.obfs_max_packet_size,
    certMode,
    acmeDomains,
    acmeEmail,
    acmeDnsProvider: node.acme_dns_provider,
    acmeDnsConfig,
    masqueradeType: node.masquerade_type,
    masqueradeConfig,
    outboundsBlock: routingConfig?.outboundsBlock,
    aclBlock: routingConfig?.aclBlock,
  })
  let revision = baseRevision
  let revisionedConfig = `# h2o-agent-revision: ${revision}\n${provisionalConfig}`
  let hy2ConfigHash = hashHysteriaServerConfig(revisionedConfig)
  const hashChanged =
    !!node.agent_desired_config_hash &&
    hy2ConfigHash !== node.agent_desired_config_hash &&
    revision === (node.agent_config_revision ?? 1)

  if (hashChanged) {
    revision = baseRevision + 1
    revisionedConfig = `# h2o-agent-revision: ${revision}\n${provisionalConfig}`
    hy2ConfigHash = hashHysteriaServerConfig(revisionedConfig)
    database
      .prepare(
        `UPDATE nodes
         SET agent_config_revision = ?,
             agent_desired_config_hash = ?,
             agent_last_config_built_at = datetime('now')
         WHERE id = ?`
      )
      .run(revision, hy2ConfigHash, node.id)
  } else if (hy2ConfigHash !== node.agent_desired_config_hash) {
    database
      .prepare(
        `UPDATE nodes
         SET agent_desired_config_hash = ?, agent_last_config_built_at = datetime('now')
         WHERE id = ?`
      )
      .run(hy2ConfigHash, node.id)
  }

  node.agent_config_revision = revision
  node.agent_desired_config_hash = hy2ConfigHash

  return {
    node,
    hy2StatsSecret,
    agentSecret,
    hy2Config: revisionedConfig,
    hy2ConfigHash,
    revision,
    intervalSeconds: node.agent_interval ?? 120,
    configPath: "/etc/hysteria/config.yaml",
    serviceName: "hysteria-server",
    meta: {
      certMode,
      certPath,
      keyPath,
      deployPort,
      deployPortHopping,
      acmeDomains,
      acmeEmail: acmeEmail || null,
      acmeDnsProvider: node.acme_dns_provider || null,
      routing: routingConfig
        ? {
            aclProfileId: routingConfig.aclProfile.id,
            aclProfileName: routingConfig.aclProfile.name,
            outboundProfileId: routingConfig.outboundProfile?.id ?? null,
            outboundProfileName: routingConfig.outboundProfile?.name ?? null,
          }
        : null,
    },
  }
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function safeEqualHex(a: string, b: string) {
  const left = Buffer.from(a, "hex")
  const right = Buffer.from(b, "hex")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function buildAgentSignatureMessage(params: {
  timestamp: string
  nonce: string
  method: string
  pathname: string
  rawBody: string
}) {
  return [
    params.timestamp,
    params.nonce,
    params.method.toUpperCase(),
    params.pathname,
    sha256Hex(params.rawBody),
  ].join("\n")
}

export function verifyAgentRequestSignature(params: {
  request: Request
  rawBody: string
  agentSecret: string
}):
  | { ok: true; timestamp: number; nonce: string }
  | { ok: false; reason: string } {
  const timestampRaw = params.request.headers
    .get("x-h2o-agent-timestamp")
    ?.trim()
  const nonce = params.request.headers.get("x-h2o-agent-nonce")?.trim()
  const signature = params.request.headers
    .get("x-h2o-agent-signature")
    ?.trim()
    .toLowerCase()

  if (!timestampRaw || !nonce || !signature) {
    return { ok: false, reason: "MISSING_SIGNATURE" }
  }
  if (!/^\d{10,13}$/.test(timestampRaw)) {
    return { ok: false, reason: "INVALID_TIMESTAMP" }
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
    return { ok: false, reason: "INVALID_NONCE" }
  }
  if (!/^[a-f0-9]{64}$/.test(signature)) {
    return { ok: false, reason: "INVALID_SIGNATURE" }
  }

  const timestampNumber = Number(timestampRaw)
  const timestampMs =
    timestampRaw.length === 13 ? timestampNumber : timestampNumber * 1000
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > AGENT_SIGNATURE_MAX_SKEW_MS
  ) {
    return { ok: false, reason: "TIMESTAMP_EXPIRED" }
  }

  const url = new URL(params.request.url)
  const message = buildAgentSignatureMessage({
    timestamp: timestampRaw,
    nonce,
    method: params.request.method,
    pathname: url.pathname,
    rawBody: params.rawBody,
  })
  const expected = createHmac("sha256", params.agentSecret)
    .update(message, "utf8")
    .digest("hex")

  if (!safeEqualHex(signature, expected)) {
    return { ok: false, reason: "SIGNATURE_MISMATCH" }
  }

  return { ok: true, timestamp: timestampMs, nonce }
}

export function rememberAgentNonce(params: {
  nodeId: number
  nonce: string
  database?: DatabaseSync
}) {
  const database = params.database ?? getDb()
  database
    .prepare(
      `DELETE FROM agent_request_nonces WHERE expires_at <= datetime('now')`
    )
    .run()

  try {
    database
      .prepare(
        `INSERT INTO agent_request_nonces(node_id, nonce, expires_at)
         VALUES (?, ?, datetime('now', ?))`
      )
      .run(params.nodeId, params.nonce, `+${AGENT_NONCE_TTL_SECONDS} seconds`)
    return true
  } catch {
    return false
  }
}

export function getTaskLeaseSeconds(type: AgentTaskType) {
  if (type === "HY2_LOGS" || type === "AGENT_LOGS") return 60
  if (type === "AGENT_RESTART" || type === "AGENT_SELF_UPDATE") return 10 * 60
  if (type === "APPLY_CONFIG") return 5 * 60
  return 2 * 60
}
