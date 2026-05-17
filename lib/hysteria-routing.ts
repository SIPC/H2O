import { createHash } from "node:crypto"
import { isIP } from "node:net"

import type { DatabaseSync } from "node:sqlite"

import { getDb } from "@/lib/db"
import {
  MAX_ACL_RULES,
  MAX_OUTBOUND_ITEMS,
  OUTBOUND_ID_PATTERN,
  OUTBOUND_NAME_PATTERN,
  type AclProtocol,
  type AclRule,
  type DirectOutboundMode,
  type HysteriaAclProfileConfig,
  type HysteriaOutboundItem,
  type HysteriaOutboundProfileConfig,
  isAclProtocol,
  isBuiltinOutboundName,
  isDirectOutboundMode,
  isHysteriaOutboundType,
} from "@/lib/hysteria-routing-types"

export type ValidationResult<T> =
  | { ok: true; config: T; hash: string }
  | { ok: false; error: string }

export type NodeRoutingConfig = {
  aclProfile: {
    id: number
    name: string
    revision: number
  }
  outboundProfile: {
    id: number
    name: string
    revision: number
  } | null
  outboundConfig: HysteriaOutboundProfileConfig | null
  aclConfig: HysteriaAclProfileConfig
  outboundsBlock: string | null
  aclBlock: string | null
}

function yamlString(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function stableHash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex")
}

function parseJsonObject(input: unknown): Record<string, unknown> {
  if (!input) return {}
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input)
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function optionalString(value: unknown) {
  const str = toTrimmedString(value)
  return str ? str : undefined
}

function hasNewline(value: string | undefined) {
  return !!value && /[\r\n]/.test(value)
}

function normalizeBool(value: unknown) {
  return value === true
}

function normalizeDirectMode(value: unknown): DirectOutboundMode {
  return isDirectOutboundMode(value) ? value : "auto"
}

function normalizeProtocol(value: unknown): AclProtocol {
  return isAclProtocol(value) ? value : "*"
}

export function normalizeOutboundProfileConfig(
  input: unknown
): HysteriaOutboundProfileConfig {
  const raw = Array.isArray(input) ? { outbounds: input } : parseJsonObject(input)
  const outboundsRaw = Array.isArray(raw.outbounds) ? raw.outbounds : []

  const outbounds = outboundsRaw.map((item, index) => {
    const obj = parseJsonObject(item)
    const fallbackId = `outbound_${index + 1}`
    const id = toTrimmedString(obj.id) || toTrimmedString(obj.name) || fallbackId
    const name = toTrimmedString(obj.name) || id
    const type = isHysteriaOutboundType(obj.type) ? obj.type : "direct"

    const directRaw = parseJsonObject(obj.direct)
    const socks5Raw = parseJsonObject(obj.socks5)
    const httpRaw = parseJsonObject(obj.http)

    const outbound: HysteriaOutboundItem = {
      id,
      name,
      type,
    }

    if (type === "direct") {
      outbound.direct = {
        mode: normalizeDirectMode(directRaw.mode),
        bindIPv4: optionalString(directRaw.bindIPv4),
        bindIPv6: optionalString(directRaw.bindIPv6),
        bindDevice: optionalString(directRaw.bindDevice),
        fastOpen: normalizeBool(directRaw.fastOpen),
      }
    }

    if (type === "socks5") {
      outbound.socks5 = {
        addr: toTrimmedString(socks5Raw.addr),
        username: optionalString(socks5Raw.username),
        password: optionalString(socks5Raw.password),
      }
    }

    if (type === "http") {
      outbound.http = {
        url: toTrimmedString(httpRaw.url),
        insecure: normalizeBool(httpRaw.insecure),
      }
    }

    return outbound
  })

  return { outbounds }
}

export function normalizeAclProfileConfig(
  input: unknown
): HysteriaAclProfileConfig {
  const raw = parseJsonObject(input)
  const rulesRaw = Array.isArray(raw.rules) ? raw.rules : []
  const rules = rulesRaw.map((item, index) => {
    const obj = parseJsonObject(item)
    const kind =
      obj.kind === "comment" || obj.kind === "raw" || obj.kind === "rule"
        ? obj.kind
        : "rule"

    const rule: AclRule = {
      id: toTrimmedString(obj.id) || `rule_${index + 1}`,
      kind,
      enabled: obj.enabled !== false,
    }

    if (kind === "comment") {
      rule.comment = toTrimmedString(obj.comment)
    } else if (kind === "raw") {
      rule.raw = toTrimmedString(obj.raw)
    } else {
      rule.outbound = toTrimmedString(obj.outbound) || "direct"
      rule.address = toTrimmedString(obj.address)
      rule.protocol = normalizeProtocol(obj.protocol)
      rule.port = toTrimmedString(obj.port) || "*"
      rule.hijackAddress = optionalString(obj.hijackAddress)
    }

    return rule
  })

  return {
    rules,
    geoip: optionalString(raw.geoip),
    geosite: optionalString(raw.geosite),
    geoUpdateInterval: optionalString(raw.geoUpdateInterval),
  }
}

function isValidHostPort(value: string) {
  if (hasNewline(value)) return false
  const bracket = value.match(/^\[[^\]\r\n]+\]:(\d{1,5})$/)
  if (bracket?.[1]) {
    const port = Number(bracket[1])
    return Number.isInteger(port) && port >= 1 && port <= 65535
  }

  const index = value.lastIndexOf(":")
  if (index <= 0 || index === value.length - 1) return false
  const host = value.slice(0, index)
  const portRaw = value.slice(index + 1)
  if (!host || host.includes(":") || /[\r\n\s]/.test(host)) return false
  if (!/^\d{1,5}$/.test(portRaw)) return false
  const port = Number(portRaw)
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

function isHttpProxyUrl(value: string) {
  if (hasNewline(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function isValidPortMatcher(value: string) {
  if (value === "*") return true
  const range = value.match(/^(\d{1,5})(?:-(\d{1,5}))?$/)
  if (!range) return false
  const start = Number(range[1])
  const end = range[2] ? Number(range[2]) : start
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 1 &&
    end >= start &&
    end <= 65535
  )
}

function validateNoNewline(value: string | undefined, label: string) {
  if (hasNewline(value)) return `${label} 不能包含换行`
  return null
}

function outboundLookup(config: HysteriaOutboundProfileConfig | null) {
  const byId = new Map<string, HysteriaOutboundItem>()
  const byName = new Map<string, HysteriaOutboundItem>()
  for (const outbound of config?.outbounds ?? []) {
    byId.set(outbound.id, outbound)
    byName.set(outbound.name, outbound)
  }
  return { byId, byName }
}

export function resolveAclOutboundName(
  outboundRef: string,
  outboundConfig: HysteriaOutboundProfileConfig | null
) {
  if (isBuiltinOutboundName(outboundRef)) return outboundRef
  const lookup = outboundLookup(outboundConfig)
  return lookup.byId.get(outboundRef)?.name ?? lookup.byName.get(outboundRef)?.name ?? null
}

export function validateOutboundProfileConfig(
  input: unknown
): ValidationResult<HysteriaOutboundProfileConfig> {
  const config = normalizeOutboundProfileConfig(input)

  if (config.outbounds.length > MAX_OUTBOUND_ITEMS) {
    return { ok: false, error: `出站数量不能超过 ${MAX_OUTBOUND_ITEMS} 个` }
  }

  const ids = new Set<string>()
  const names = new Set<string>()

  for (let index = 0; index < config.outbounds.length; index += 1) {
    const outbound = config.outbounds[index]
    const label = `第 ${index + 1} 个出站`

    if (!OUTBOUND_ID_PATTERN.test(outbound.id)) {
      return {
        ok: false,
        error: `${label} ID 只能包含字母、数字、下划线和短横线，长度 1~64`,
      }
    }
    if (ids.has(outbound.id)) {
      return { ok: false, error: `${label} ID 重复：${outbound.id}` }
    }
    ids.add(outbound.id)

    if (!OUTBOUND_NAME_PATTERN.test(outbound.name)) {
      return {
        ok: false,
        error: `${label} 名称只能包含字母、数字、下划线和短横线，长度 1~64`,
      }
    }
    if (isBuiltinOutboundName(outbound.name)) {
      return {
        ok: false,
        error: `${label} 名称不能使用内置出口名：${outbound.name}`,
      }
    }
    if (names.has(outbound.name)) {
      return { ok: false, error: `${label} 名称重复：${outbound.name}` }
    }
    names.add(outbound.name)

    if (!isHysteriaOutboundType(outbound.type)) {
      return { ok: false, error: `${label} 类型不合法` }
    }

    if (outbound.type === "direct") {
      const direct = outbound.direct ?? { mode: "auto" }
      if (!isDirectOutboundMode(direct.mode)) {
        return { ok: false, error: `${label} direct mode 不合法` }
      }
      for (const [key, value] of [
        ["bindIPv4", direct.bindIPv4],
        ["bindIPv6", direct.bindIPv6],
        ["bindDevice", direct.bindDevice],
      ] as const) {
        const error = validateNoNewline(value, `${label} ${key}`)
        if (error) return { ok: false, error }
      }
      if (direct.bindIPv4 && isIP(direct.bindIPv4) !== 4) {
        return { ok: false, error: `${label} bindIPv4 必须是 IPv4 地址` }
      }
      if (direct.bindIPv6 && isIP(direct.bindIPv6) !== 6) {
        return { ok: false, error: `${label} bindIPv6 必须是 IPv6 地址` }
      }
      if (direct.bindDevice && (direct.bindIPv4 || direct.bindIPv6)) {
        return {
          ok: false,
          error: `${label} bindDevice 不能与 bindIPv4/bindIPv6 同时使用`,
        }
      }
    }

    if (outbound.type === "socks5") {
      const socks5 = outbound.socks5
      if (!socks5?.addr || !isValidHostPort(socks5.addr)) {
        return {
          ok: false,
          error: `${label} SOCKS5 地址必须是 host:port 或 [IPv6]:port`,
        }
      }
      for (const [key, value] of [
        ["username", socks5.username],
        ["password", socks5.password],
      ] as const) {
        const error = validateNoNewline(value, `${label} ${key}`)
        if (error) return { ok: false, error }
      }
    }

    if (outbound.type === "http") {
      const http = outbound.http
      if (!http?.url || !isHttpProxyUrl(http.url)) {
        return {
          ok: false,
          error: `${label} HTTP 代理 URL 必须以 http:// 或 https:// 开头`,
        }
      }
    }
  }

  return { ok: true, config, hash: stableHash(config) }
}

function validateAclOutboundRef(
  outboundRef: string | undefined,
  outboundConfig: HysteriaOutboundProfileConfig | null,
  label: string
) {
  if (!outboundRef) return `${label} 必须选择出口`
  if (resolveAclOutboundName(outboundRef, outboundConfig)) return null
  return `${label} 引用了不存在的出口：${outboundRef}`
}

function rawRuleOutbound(raw: string) {
  const match = raw.match(/^\s*([A-Za-z0-9_-]+)\s*\(/)
  return match?.[1] ?? null
}

export function validateAclProfileConfig(
  input: unknown,
  outboundConfig: HysteriaOutboundProfileConfig | null = null
): ValidationResult<HysteriaAclProfileConfig> {
  const config = normalizeAclProfileConfig(input)

  if (config.rules.length > MAX_ACL_RULES) {
    return { ok: false, error: `ACL 规则数量不能超过 ${MAX_ACL_RULES} 条` }
  }

  for (const [key, value] of [
    ["geoip", config.geoip],
    ["geosite", config.geosite],
    ["geoUpdateInterval", config.geoUpdateInterval],
  ] as const) {
    const error = validateNoNewline(value, `ACL ${key}`)
    if (error) return { ok: false, error }
  }

  const ruleIds = new Set<string>()
  for (let index = 0; index < config.rules.length; index += 1) {
    const rule = config.rules[index]
    const label = `第 ${index + 1} 条 ACL 规则`

    if (!OUTBOUND_ID_PATTERN.test(rule.id)) {
      return {
        ok: false,
        error: `${label} ID 只能包含字母、数字、下划线和短横线，长度 1~64`,
      }
    }
    if (ruleIds.has(rule.id)) {
      return { ok: false, error: `${label} ID 重复：${rule.id}` }
    }
    ruleIds.add(rule.id)

    if (rule.kind === "comment") {
      const error = validateNoNewline(rule.comment, `${label} 注释`)
      if (error) return { ok: false, error }
      continue
    }

    if (rule.kind === "raw") {
      const raw = rule.raw?.trim() ?? ""
      if (!raw) return { ok: false, error: `${label} 原始规则不能为空` }
      if (hasNewline(raw)) return { ok: false, error: `${label} 不能包含换行` }
      if (!raw.startsWith("#")) {
        const outbound = rawRuleOutbound(raw)
        if (!outbound) {
          return { ok: false, error: `${label} 原始规则格式不合法` }
        }
        const error = validateAclOutboundRef(outbound, outboundConfig, label)
        if (error) return { ok: false, error }
      }
      continue
    }

    if (rule.kind !== "rule") {
      return { ok: false, error: `${label} 类型不合法` }
    }

    const outboundError = validateAclOutboundRef(
      rule.outbound,
      outboundConfig,
      label
    )
    if (outboundError) return { ok: false, error: outboundError }

    if (!rule.address) return { ok: false, error: `${label} 地址不能为空` }
    if (hasNewline(rule.address)) {
      return { ok: false, error: `${label} 地址不能包含换行` }
    }
    if (!isAclProtocol(rule.protocol)) {
      return { ok: false, error: `${label} 协议不合法` }
    }
    if (!rule.port || !isValidPortMatcher(rule.port)) {
      return { ok: false, error: `${label} 端口格式不合法` }
    }
    if (rule.hijackAddress && isIP(rule.hijackAddress) === 0) {
      return { ok: false, error: `${label} 劫持地址必须是 IP 地址` }
    }
  }

  return { ok: true, config, hash: stableHash(config) }
}

function pushYamlKey(lines: string[], indent: string, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return
  if (typeof value === "boolean") {
    lines.push(`${indent}${key}: ${value ? "true" : "false"}`)
    return
  }
  lines.push(`${indent}${key}: ${yamlString(String(value))}`)
}

export function buildOutboundsBlock(
  config: HysteriaOutboundProfileConfig | null | undefined
) {
  const outbounds = config?.outbounds ?? []
  if (outbounds.length === 0) return null

  const lines = ["outbounds:"]
  for (const outbound of outbounds) {
    lines.push(`  - name: ${yamlString(outbound.name)}`)
    lines.push(`    type: ${outbound.type}`)

    if (outbound.type === "direct") {
      const direct = outbound.direct ?? { mode: "auto" }
      lines.push("    direct:")
      pushYamlKey(lines, "      ", "mode", direct.mode)
      pushYamlKey(lines, "      ", "bindIPv4", direct.bindIPv4)
      pushYamlKey(lines, "      ", "bindIPv6", direct.bindIPv6)
      pushYamlKey(lines, "      ", "bindDevice", direct.bindDevice)
      if (direct.fastOpen) pushYamlKey(lines, "      ", "fastOpen", true)
    }

    if (outbound.type === "socks5" && outbound.socks5) {
      lines.push("    socks5:")
      pushYamlKey(lines, "      ", "addr", outbound.socks5.addr)
      pushYamlKey(lines, "      ", "username", outbound.socks5.username)
      pushYamlKey(lines, "      ", "password", outbound.socks5.password)
    }

    if (outbound.type === "http" && outbound.http) {
      lines.push("    http:")
      pushYamlKey(lines, "      ", "url", outbound.http.url)
      if (outbound.http.insecure) pushYamlKey(lines, "      ", "insecure", true)
    }
  }

  return lines.join("\n")
}

function formatProtoPort(protocol: AclProtocol | undefined, port: string | undefined) {
  const proto = protocol ?? "*"
  const normalizedPort = port || "*"
  if (proto === "*" && normalizedPort === "*") return "*"
  if (proto === "*") return `*/${normalizedPort}`
  if (normalizedPort === "*") return proto
  return `${proto}/${normalizedPort}`
}

export function buildAclRuleLine(
  rule: AclRule,
  outboundConfig: HysteriaOutboundProfileConfig | null | undefined
) {
  if (rule.enabled === false) return null
  if (rule.kind === "comment") {
    const comment = rule.comment?.trim() ?? ""
    return comment.startsWith("#") ? comment : `# ${comment}`
  }
  if (rule.kind === "raw") return rule.raw?.trim() || null

  const outbound = resolveAclOutboundName(rule.outbound ?? "", outboundConfig ?? null)
  if (!outbound || !rule.address) return null

  const protoPort = formatProtoPort(rule.protocol, rule.port)
  const args = [rule.address]
  if (rule.hijackAddress || protoPort !== "*") args.push(protoPort)
  if (rule.hijackAddress) args.push(rule.hijackAddress)
  return `${outbound}(${args.join(", ")})`
}

export function buildAclBlock(
  config: HysteriaAclProfileConfig | null | undefined,
  outboundConfig: HysteriaOutboundProfileConfig | null | undefined
) {
  const rules = config?.rules ?? []
  const lines = rules
    .map((rule) => buildAclRuleLine(rule, outboundConfig))
    .filter((line): line is string => !!line)

  if (lines.length === 0) return null

  const yaml = ["acl:", "  inline:"]
  for (const line of lines) {
    yaml.push(`    - ${yamlString(line)}`)
  }
  pushYamlKey(yaml, "  ", "geoip", config?.geoip)
  pushYamlKey(yaml, "  ", "geosite", config?.geosite)
  pushYamlKey(yaml, "  ", "geoUpdateInterval", config?.geoUpdateInterval)

  return yaml.join("\n")
}

type RoutingRow = {
  acl_id: number
  acl_name: string
  acl_revision: number
  acl_config: string
  outbound_id: number | null
  outbound_name: string | null
  outbound_revision: number | null
  outbound_config: string | null
}

export function resolveNodeRoutingConfig(params: {
  nodeId: number
  database?: DatabaseSync
}): NodeRoutingConfig | null {
  const database = params.database ?? getDb()
  const row = database
    .prepare(
      `SELECT ap.id AS acl_id, ap.name AS acl_name, ap.revision AS acl_revision,
              ap.config AS acl_config,
              op.id AS outbound_id, op.name AS outbound_name,
              op.revision AS outbound_revision, op.config AS outbound_config
       FROM node_acl_bindings nab
       JOIN acl_profiles ap ON ap.id = nab.acl_profile_id
       LEFT JOIN outbound_profiles op ON op.id = ap.outbound_profile_id
       WHERE nab.node_id = ?
       LIMIT 1`
    )
    .get(params.nodeId) as RoutingRow | undefined

  if (!row) return null

  const outboundValidation = row.outbound_config
    ? validateOutboundProfileConfig(row.outbound_config)
    : null
  if (outboundValidation && !outboundValidation.ok) return null

  const outboundConfig = outboundValidation?.ok ? outboundValidation.config : null
  const aclValidation = validateAclProfileConfig(row.acl_config, outboundConfig)
  if (!aclValidation.ok) return null

  return {
    aclProfile: {
      id: row.acl_id,
      name: row.acl_name,
      revision: row.acl_revision,
    },
    outboundProfile:
      row.outbound_id && row.outbound_name
        ? {
            id: row.outbound_id,
            name: row.outbound_name,
            revision: row.outbound_revision ?? 1,
          }
        : null,
    outboundConfig,
    aclConfig: aclValidation.config,
    outboundsBlock: buildOutboundsBlock(outboundConfig),
    aclBlock: buildAclBlock(aclValidation.config, outboundConfig),
  }
}

export function bumpNodesForRoutingChange(params: {
  database?: DatabaseSync
  outboundProfileId?: number
  aclProfileId?: number
  nodeIds?: number[]
}) {
  const database = params.database ?? getDb()
  const nodeIds = new Set<number>()

  for (const nodeId of params.nodeIds ?? []) {
    if (Number.isInteger(nodeId) && nodeId > 0) nodeIds.add(nodeId)
  }

  if (params.aclProfileId) {
    const rows = database
      .prepare(`SELECT node_id FROM node_acl_bindings WHERE acl_profile_id = ?`)
      .all(params.aclProfileId) as Array<{ node_id: number }>
    for (const row of rows) nodeIds.add(row.node_id)
  }

  if (params.outboundProfileId) {
    const rows = database
      .prepare(
        `SELECT nab.node_id
         FROM node_acl_bindings nab
         JOIN acl_profiles ap ON ap.id = nab.acl_profile_id
         WHERE ap.outbound_profile_id = ?`
      )
      .all(params.outboundProfileId) as Array<{ node_id: number }>
    for (const row of rows) nodeIds.add(row.node_id)
  }

  if (nodeIds.size === 0) return []

  const update = database.prepare(
    `UPDATE nodes
     SET agent_config_revision = COALESCE(agent_config_revision, 1) + 1,
         agent_desired_config_hash = NULL,
         agent_last_config_built_at = NULL
     WHERE id = ?`
  )
  for (const nodeId of nodeIds) update.run(nodeId)

  return Array.from(nodeIds).sort((a, b) => a - b)
}

export function findAclReferenceErrorsForOutboundProfile(params: {
  database?: DatabaseSync
  outboundProfileId: number
  nextOutboundConfig: HysteriaOutboundProfileConfig
}) {
  const database = params.database ?? getDb()
  const rows = database
    .prepare(
      `SELECT id, name, config
       FROM acl_profiles
       WHERE outbound_profile_id = ?
       ORDER BY id ASC`
    )
    .all(params.outboundProfileId) as Array<{
    id: number
    name: string
    config: string
  }>

  const errors: string[] = []
  for (const row of rows) {
    const validation = validateAclProfileConfig(
      row.config,
      params.nextOutboundConfig
    )
    if (!validation.ok) {
      errors.push(`ACL「${row.name}」：${validation.error}`)
    }
  }
  return errors
}
