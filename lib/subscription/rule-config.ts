import { isIP } from "node:net"

import { getSetting, setSetting, SETTING_KEYS } from "@/lib/settings"

export const BUILTIN_SUBSCRIPTION_RULE_TARGETS = [
  "proxy",
  "auto",
  "ai",
  "media",
  "telegram",
  "apple",
  "microsoft",
  "direct",
  "reject",
  "fallback",
] as const

export type BuiltinSubscriptionRuleTarget =
  (typeof BUILTIN_SUBSCRIPTION_RULE_TARGETS)[number]
export type SubscriptionRuleTarget = BuiltinSubscriptionRuleTarget | string

export const BUILTIN_SUBSCRIPTION_RULE_IDS = [
  "reject",
  "ai",
  "media",
  "telegram",
  "apple",
  "microsoft",
  "proxy",
  "direct",
] as const

export type BuiltinSubscriptionRuleId =
  (typeof BUILTIN_SUBSCRIPTION_RULE_IDS)[number]

export type SubscriptionBuiltinRuleOverride = {
  enabled: boolean
  target: SubscriptionRuleTarget
}

export const DEFAULT_BUILTIN_RULE_TARGETS: Record<
  BuiltinSubscriptionRuleId,
  SubscriptionRuleTarget
> = {
  reject: "reject",
  ai: "ai",
  media: "media",
  telegram: "telegram",
  apple: "apple",
  microsoft: "microsoft",
  proxy: "proxy",
  direct: "direct",
}

export const BUILTIN_SUBSCRIPTION_RULE_LABELS: Record<
  BuiltinSubscriptionRuleId,
  { name: string; description: string }
> = {
  reject: { name: "广告拦截", description: "广告、追踪与恶意域名规则" },
  ai: { name: "AI 服务", description: "OpenAI / Claude / Gemini 等服务规则" },
  media: {
    name: "国际媒体",
    description: "YouTube / Netflix / Disney / Spotify 等规则",
  },
  telegram: { name: "Telegram", description: "Telegram 域名与 IP 规则" },
  apple: { name: "苹果服务", description: "Apple / iCloud 规则" },
  microsoft: { name: "微软服务", description: "Microsoft 规则" },
  proxy: { name: "代理规则", description: "默认代理域名规则" },
  direct: { name: "直连规则", description: "局域网、中国域名与中国 IP 规则" },
}

export const SUBSCRIPTION_RULE_TYPES = [
  "domain",
  "domain_suffix",
  "domain_keyword",
  "ip_cidr",
  "geoip",
] as const

export type SubscriptionRuleType = (typeof SUBSCRIPTION_RULE_TYPES)[number]

export const SUBSCRIPTION_RULE_MODES = ["prepend", "append", "replace"] as const
export type SubscriptionRuleMode = (typeof SUBSCRIPTION_RULE_MODES)[number]

export const SUBSCRIPTION_POLICY_GROUP_TYPES = ["select", "url-test"] as const
export type SubscriptionPolicyGroupType =
  (typeof SUBSCRIPTION_POLICY_GROUP_TYPES)[number]

export const CLASH_RULE_BEHAVIORS = ["domain", "ipcidr", "classical"] as const
export type ClashRuleBehavior = (typeof CLASH_RULE_BEHAVIORS)[number]

export const SINGBOX_RULESET_FORMATS = ["binary", "source"] as const
export type SingboxRuleSetFormat = (typeof SINGBOX_RULESET_FORMATS)[number]

export type SubscriptionRule = {
  id: string
  enabled: boolean
  name: string
  type: SubscriptionRuleType
  value: string
  target: SubscriptionRuleTarget
  noResolve?: boolean
}

export type SubscriptionPolicyGroup = {
  id: string
  enabled: boolean
  name: string
  type: SubscriptionPolicyGroupType
  includeNodes: boolean
  selectedNodeIds: number[]
  includeProxy: boolean
  includeAuto: boolean
  includeDirect: boolean
  includeReject: boolean
  url: string
  interval: number
  tolerance: number
}

export type SubscriptionRemoteRuleSet = {
  id: string
  enabled: boolean
  name: string
  target: SubscriptionRuleTarget
  clash?: {
    enabled: boolean
    behavior: ClashRuleBehavior
    url: string
  }
  singbox?: {
    enabled: boolean
    format: SingboxRuleSetFormat
    url: string
  }
  noResolve?: boolean
}

export type SubscriptionRuleConfig = {
  enabled: boolean
  mode: SubscriptionRuleMode
  finalTarget: SubscriptionRuleTarget
  builtinPolicyOverrides: Partial<
    Record<BuiltinSubscriptionRuleTarget, SubscriptionPolicyGroup>
  >
  builtinRuleOverrides: Partial<
    Record<BuiltinSubscriptionRuleId, SubscriptionBuiltinRuleOverride>
  >
  policyGroups: SubscriptionPolicyGroup[]
  rules: SubscriptionRule[]
  remoteRuleSets: SubscriptionRemoteRuleSet[]
}

export type ClashCompiledSubscriptionRules = {
  providers: Record<string, Record<string, unknown>>
  rules: string[]
}

export type SingboxCompiledSubscriptionRules = {
  ruleSets: Array<Record<string, unknown>>
  rules: Array<Record<string, unknown>>
}

type SubscriptionNodeRef = {
  id?: number | null
  name: string
}

export const SUBSCRIPTION_RULE_CONFIG_DEFAULT: SubscriptionRuleConfig = {
  enabled: false,
  mode: "prepend",
  finalTarget: "fallback",
  builtinPolicyOverrides: {},
  builtinRuleOverrides: {},
  policyGroups: [],
  rules: [],
  remoteRuleSets: [],
}

export const MAX_SUBSCRIPTION_POLICY_GROUPS = 30
export const MAX_SUBSCRIPTION_RULES = 500
export const MAX_SUBSCRIPTION_REMOTE_RULESETS = 100
const MAX_RULE_NAME_LENGTH = 64
const MAX_RULE_VALUE_LENGTH = 256
const MAX_RULESET_URL_LENGTH = 1024
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const CLASH_BUILTIN_PROVIDER_NAMES = new Set([
  "reject",
  "icloud",
  "apple",
  "microsoft",
  "proxymedia",
  "telegram",
  "telegramcidr",
  "proxy",
  "chinadomain",
  "chinacompanyip",
  "chinaip",
  "lan",
])

const SINGBOX_BUILTIN_RULESET_NAMES = new Set([
  "geosite-category-ads-all",
  "geosite-openai",
  "geosite-youtube",
  "geosite-netflix",
  "geosite-disney",
  "geosite-spotify",
  "geosite-telegram",
  "geosite-apple",
  "geosite-icloud",
  "geosite-microsoft",
  "geosite-cn",
  "geoip-cn",
])

const CLASH_TARGETS: Record<BuiltinSubscriptionRuleTarget, string> = {
  proxy: "🚀 节点选择",
  auto: "♻️ 自动选择",
  ai: "🤖 AI",
  media: "📺 国际媒体",
  telegram: "📲 Telegram",
  apple: "🍎 苹果服务",
  microsoft: "Ⓜ️ 微软服务",
  direct: "DIRECT",
  reject: "🛑 广告拦截",
  fallback: "🐟 漏网之鱼",
}

const SINGBOX_TARGETS: Record<BuiltinSubscriptionRuleTarget, string> = {
  proxy: "proxy",
  auto: "auto",
  ai: "ai",
  media: "media",
  telegram: "telegram",
  apple: "apple",
  microsoft: "microsoft",
  direct: "direct",
  reject: "reject",
  fallback: "fallback",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isOneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T
): value is T[number] {
  return typeof value === "string" && allowed.includes(value)
}

function normalizeId(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : ""
  const normalized = raw || fallback
  return ID_PATTERN.test(normalized) ? normalized : fallback
}

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return ""
  return value
    .trim()
    .replace(/[\r\n\t]/g, " ")
    .slice(0, maxLength)
}

function normalizeUrl(value: unknown): string {
  const raw = normalizeText(value, MAX_RULESET_URL_LENGTH)
  if (!raw) return ""
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return ""
    return url.toString()
  } catch {
    return ""
  }
}

function normalizeTarget(value: unknown): SubscriptionRuleTarget {
  const raw = typeof value === "string" ? value.trim() : ""
  if (isOneOf(raw, BUILTIN_SUBSCRIPTION_RULE_TARGETS)) return raw
  if (ID_PATTERN.test(raw)) return raw
  return "proxy"
}

function normalizeRule(value: unknown, index: number): SubscriptionRule | null {
  if (!isRecord(value)) return null
  const type = isOneOf(value.type, SUBSCRIPTION_RULE_TYPES) ? value.type : null
  const target = normalizeTarget(value.target)
  const ruleValue = normalizeText(value.value, MAX_RULE_VALUE_LENGTH)
  if (!type || !ruleValue) return null

  return {
    id: normalizeId(value.id, `rule_${index + 1}`),
    enabled: value.enabled !== false,
    name: normalizeText(value.name, MAX_RULE_NAME_LENGTH),
    type,
    value: ruleValue,
    target,
    noResolve: value.noResolve === true,
  }
}

function normalizePolicyGroup(
  value: unknown,
  index: number,
  fixedId?: string,
  fallbackName?: string
): SubscriptionPolicyGroup | null {
  if (!isRecord(value)) return null
  const id = fixedId ?? normalizeId(value.id, `policy_${index + 1}`)
  const type = isOneOf(value.type, SUBSCRIPTION_POLICY_GROUP_TYPES)
    ? value.type
    : "select"
  const interval = typeof value.interval === "number" ? value.interval : 300
  const tolerance = typeof value.tolerance === "number" ? value.tolerance : 50

  return {
    id,
    enabled: value.enabled !== false,
    name: normalizeText(value.name, MAX_RULE_NAME_LENGTH) || fallbackName || id,
    type,
    includeNodes: value.includeNodes !== false,
    selectedNodeIds: Array.isArray(value.selectedNodeIds)
      ? value.selectedNodeIds
          .map((id) => (typeof id === "number" ? id : Number(id)))
          .filter((id) => Number.isInteger(id) && id > 0)
          .slice(0, 500)
      : [],
    includeProxy: value.includeProxy === true,
    includeAuto: value.includeAuto === true,
    includeDirect: value.includeDirect === true,
    includeReject: value.includeReject === true,
    url:
      normalizeText(value.url, MAX_RULESET_URL_LENGTH) ||
      "http://www.gstatic.com/generate_204",
    interval: Number.isInteger(interval)
      ? Math.min(86400, Math.max(30, interval))
      : 300,
    tolerance: Number.isInteger(tolerance)
      ? Math.min(1000, Math.max(0, tolerance))
      : 50,
  }
}

function normalizeBuiltinPolicyOverrides(
  value: unknown
): Partial<Record<BuiltinSubscriptionRuleTarget, SubscriptionPolicyGroup>> {
  if (!isRecord(value)) return {}
  const out: Partial<
    Record<BuiltinSubscriptionRuleTarget, SubscriptionPolicyGroup>
  > = {}
  for (const target of BUILTIN_SUBSCRIPTION_RULE_TARGETS) {
    const group = normalizePolicyGroup(
      value[target],
      0,
      target,
      CLASH_TARGETS[target]
    )
    if (group) out[target] = group
  }
  return out
}

function normalizeBuiltinRuleOverrides(
  value: unknown
): Partial<Record<BuiltinSubscriptionRuleId, SubscriptionBuiltinRuleOverride>> {
  if (!isRecord(value)) return {}
  const out: Partial<
    Record<BuiltinSubscriptionRuleId, SubscriptionBuiltinRuleOverride>
  > = {}
  for (const id of BUILTIN_SUBSCRIPTION_RULE_IDS) {
    const raw = value[id]
    if (!isRecord(raw)) continue
    out[id] = {
      enabled: raw.enabled !== false,
      target: normalizeTarget(raw.target ?? DEFAULT_BUILTIN_RULE_TARGETS[id]),
    }
  }
  return out
}

function normalizeRemoteRuleSet(
  value: unknown,
  index: number
): SubscriptionRemoteRuleSet | null {
  if (!isRecord(value)) return null
  const id = normalizeId(value.id, `ruleset_${index + 1}`)
  const target = normalizeTarget(value.target)
  const clashRaw = isRecord(value.clash) ? value.clash : null
  const singboxRaw = isRecord(value.singbox) ? value.singbox : null
  const clashUrl = normalizeUrl(clashRaw?.url)
  const singboxUrl = normalizeUrl(singboxRaw?.url)

  const item: SubscriptionRemoteRuleSet = {
    id,
    enabled: value.enabled !== false,
    name: normalizeText(value.name, MAX_RULE_NAME_LENGTH),
    target,
    noResolve: value.noResolve === true,
  }

  if (clashRaw) {
    item.clash = {
      enabled: clashRaw.enabled !== false,
      behavior: isOneOf(clashRaw.behavior, CLASH_RULE_BEHAVIORS)
        ? clashRaw.behavior
        : "classical",
      url: clashUrl,
    }
  }

  if (singboxRaw) {
    item.singbox = {
      enabled: singboxRaw.enabled !== false,
      format: isOneOf(singboxRaw.format, SINGBOX_RULESET_FORMATS)
        ? singboxRaw.format
        : "binary",
      url: singboxUrl,
    }
  }

  if (!item.clash && !item.singbox) return null
  return item
}

export function normalizeSubscriptionRuleConfig(
  value: unknown
): SubscriptionRuleConfig {
  if (!isRecord(value)) return { ...SUBSCRIPTION_RULE_CONFIG_DEFAULT }
  const mode = isOneOf(value.mode, SUBSCRIPTION_RULE_MODES)
    ? value.mode
    : SUBSCRIPTION_RULE_CONFIG_DEFAULT.mode
  const finalTarget =
    "finalTarget" in value
      ? normalizeTarget(value.finalTarget)
      : SUBSCRIPTION_RULE_CONFIG_DEFAULT.finalTarget
  const builtinPolicyOverrides = normalizeBuiltinPolicyOverrides(
    value.builtinPolicyOverrides
  )
  const builtinRuleOverrides = normalizeBuiltinRuleOverrides(
    value.builtinRuleOverrides
  )
  const rawPolicyGroups = Array.isArray(value.policyGroups)
    ? value.policyGroups
    : []
  const rawRules = Array.isArray(value.rules) ? value.rules : []
  const rawRuleSets = Array.isArray(value.remoteRuleSets)
    ? value.remoteRuleSets
    : []

  return {
    enabled: value.enabled === true,
    mode,
    finalTarget,
    builtinPolicyOverrides,
    builtinRuleOverrides,
    policyGroups: rawPolicyGroups
      .slice(0, MAX_SUBSCRIPTION_POLICY_GROUPS)
      .map((group, index) => normalizePolicyGroup(group, index))
      .filter((group): group is SubscriptionPolicyGroup => Boolean(group)),
    rules: rawRules
      .slice(0, MAX_SUBSCRIPTION_RULES)
      .map((rule, index) => normalizeRule(rule, index))
      .filter((rule): rule is SubscriptionRule => Boolean(rule)),
    remoteRuleSets: rawRuleSets
      .slice(0, MAX_SUBSCRIPTION_REMOTE_RULESETS)
      .map((ruleSet, index) => normalizeRemoteRuleSet(ruleSet, index))
      .filter((ruleSet): ruleSet is SubscriptionRemoteRuleSet =>
        Boolean(ruleSet)
      ),
  }
}

function validateDomainValue(value: string): boolean {
  return /^[A-Za-z0-9*_.-]+$/.test(value) && value.includes(".")
}

function validateKeywordValue(value: string): boolean {
  return /^[^,\s]{1,256}$/.test(value)
}

function validateIpCidr(value: string): boolean {
  const [ip, prefixRaw] = value.split("/")
  const version = isIP(ip)
  if (!version || !prefixRaw || !/^\d+$/.test(prefixRaw)) return false
  const prefix = Number(prefixRaw)
  return version === 4
    ? prefix >= 0 && prefix <= 32
    : prefix >= 0 && prefix <= 128
}

export function validateSubscriptionRuleConfig(
  value: unknown
): { ok: true; config: SubscriptionRuleConfig } | { ok: false; error: string } {
  const config = normalizeSubscriptionRuleConfig(value)

  if (
    Array.isArray((value as { policyGroups?: unknown })?.policyGroups) &&
    (value as { policyGroups: unknown[] }).policyGroups.length >
      MAX_SUBSCRIPTION_POLICY_GROUPS
  ) {
    return {
      ok: false,
      error: `策略组最多支持 ${MAX_SUBSCRIPTION_POLICY_GROUPS} 个`,
    }
  }

  const policyGroupIds = new Set<string>()
  const enabledPolicyGroupIds = new Set<string>()
  const clashPolicyGroupNames = new Set<string>()
  const builtinTargetSet = new Set<string>(BUILTIN_SUBSCRIPTION_RULE_TARGETS)
  const enabledBuiltinTargetSet = new Set<string>(
    BUILTIN_SUBSCRIPTION_RULE_TARGETS.filter(
      (target) => config.builtinPolicyOverrides[target]?.enabled !== false
    )
  )

  for (const target of enabledBuiltinTargetSet) {
    const name = clashTarget(target, config)
    if (clashPolicyGroupNames.has(name)) {
      return { ok: false, error: `内置策略组名称重复：${name}` }
    }
    clashPolicyGroupNames.add(name)
  }

  for (const group of config.policyGroups) {
    if (policyGroupIds.has(group.id)) {
      return { ok: false, error: `策略组 ID 重复：${group.id}` }
    }
    if (builtinTargetSet.has(group.id)) {
      return { ok: false, error: `策略组 ID 与内置策略冲突：${group.id}` }
    }
    policyGroupIds.add(group.id)
    if (group.enabled) {
      enabledPolicyGroupIds.add(group.id)
      if (clashPolicyGroupNames.has(group.name)) {
        return { ok: false, error: `策略组名称重复：${group.name}` }
      }
      clashPolicyGroupNames.add(group.name)
    }
    if (!/^https?:\/\//i.test(group.url)) {
      return { ok: false, error: `策略组 ${group.id} 的测速 URL 不合法` }
    }
  }

  const isValidTarget = (target: SubscriptionRuleTarget) =>
    enabledBuiltinTargetSet.has(target) || enabledPolicyGroupIds.has(target)

  if (!isValidTarget(config.finalTarget)) {
    return { ok: false, error: "最终兜底策略不存在" }
  }

  for (const id of BUILTIN_SUBSCRIPTION_RULE_IDS) {
    if (!isBuiltinRuleEnabled(config, id)) continue
    const target = getBuiltinRuleTarget(config, id)
    if (!isValidTarget(target)) {
      return { ok: false, error: `内置规则 ${id} 的目标策略不存在` }
    }
  }

  if (
    Array.isArray((value as { rules?: unknown })?.rules) &&
    (value as { rules: unknown[] }).rules.length > MAX_SUBSCRIPTION_RULES
  ) {
    return { ok: false, error: `规则最多支持 ${MAX_SUBSCRIPTION_RULES} 条` }
  }
  if (
    Array.isArray((value as { remoteRuleSets?: unknown })?.remoteRuleSets) &&
    (value as { remoteRuleSets: unknown[] }).remoteRuleSets.length >
      MAX_SUBSCRIPTION_REMOTE_RULESETS
  ) {
    return {
      ok: false,
      error: `远程规则集最多支持 ${MAX_SUBSCRIPTION_REMOTE_RULESETS} 个`,
    }
  }

  const ids = new Set<string>()
  for (const [index, rule] of config.rules.entries()) {
    if (!isValidTarget(rule.target)) {
      return { ok: false, error: `第 ${index + 1} 条规则的目标策略不存在` }
    }
    if (ids.has(rule.id))
      return { ok: false, error: `规则 ID 重复：${rule.id}` }
    ids.add(rule.id)
    if (rule.type === "domain" || rule.type === "domain_suffix") {
      if (!validateDomainValue(rule.value)) {
        return { ok: false, error: `第 ${index + 1} 条规则的域名不合法` }
      }
    }
    if (rule.type === "domain_keyword" && !validateKeywordValue(rule.value)) {
      return { ok: false, error: `第 ${index + 1} 条规则的域名关键字不合法` }
    }
    if (rule.type === "ip_cidr" && !validateIpCidr(rule.value)) {
      return { ok: false, error: `第 ${index + 1} 条规则的 IP-CIDR 不合法` }
    }
    if (rule.type === "geoip" && rule.value.toUpperCase() !== "CN") {
      return { ok: false, error: "第一版 GEOIP 仅支持 CN" }
    }
  }

  const ruleSetIds = new Set<string>()
  for (const ruleSet of config.remoteRuleSets) {
    if (!isValidTarget(ruleSet.target)) {
      return { ok: false, error: `远程规则集 ${ruleSet.id} 的目标策略不存在` }
    }
    if (ruleSetIds.has(ruleSet.id)) {
      return { ok: false, error: `远程规则集 ID 重复：${ruleSet.id}` }
    }
    if (
      CLASH_BUILTIN_PROVIDER_NAMES.has(ruleSet.id) ||
      SINGBOX_BUILTIN_RULESET_NAMES.has(ruleSet.id)
    ) {
      return {
        ok: false,
        error: `远程规则集 ID 与内置规则集冲突：${ruleSet.id}`,
      }
    }
    ruleSetIds.add(ruleSet.id)
    if (ruleSet.clash?.enabled && !ruleSet.clash.url) {
      return { ok: false, error: `远程规则集 ${ruleSet.id} 缺少 Clash URL` }
    }
    if (ruleSet.singbox?.enabled && !ruleSet.singbox.url) {
      return { ok: false, error: `远程规则集 ${ruleSet.id} 缺少 sing-box URL` }
    }
  }

  return { ok: true, config }
}

export function getSubscriptionRuleConfig(): SubscriptionRuleConfig {
  return normalizeSubscriptionRuleConfig(
    getSetting(
      SETTING_KEYS.subscriptionRuleConfig,
      SUBSCRIPTION_RULE_CONFIG_DEFAULT
    )
  )
}

export function setSubscriptionRuleConfig(
  config: SubscriptionRuleConfig
): void {
  setSetting(SETTING_KEYS.subscriptionRuleConfig, config)
}

function isBuiltinTarget(
  target: SubscriptionRuleTarget
): target is BuiltinSubscriptionRuleTarget {
  return BUILTIN_SUBSCRIPTION_RULE_TARGETS.includes(
    target as BuiltinSubscriptionRuleTarget
  )
}

function policyGroupName(
  config: SubscriptionRuleConfig,
  target: SubscriptionRuleTarget
): string | null {
  if (isBuiltinTarget(target)) {
    return config.builtinPolicyOverrides[target]?.name ?? null
  }
  return (
    config.policyGroups.find((group) => group.enabled && group.id === target)
      ?.name ?? null
  )
}

export function getBuiltinRuleTarget(
  config: SubscriptionRuleConfig | undefined,
  id: BuiltinSubscriptionRuleId
): SubscriptionRuleTarget {
  return (
    config?.builtinRuleOverrides[id]?.target ?? DEFAULT_BUILTIN_RULE_TARGETS[id]
  )
}

export function isBuiltinRuleEnabled(
  config: SubscriptionRuleConfig | undefined,
  id: BuiltinSubscriptionRuleId
): boolean {
  return config?.builtinRuleOverrides[id]?.enabled !== false
}

export function clashTarget(
  target: SubscriptionRuleTarget,
  config?: SubscriptionRuleConfig
): string {
  if (isBuiltinTarget(target)) {
    return config
      ? (policyGroupName(config, target) ?? CLASH_TARGETS[target])
      : CLASH_TARGETS[target]
  }
  return config ? (policyGroupName(config, target) ?? target) : target
}

export function singboxTarget(
  target: SubscriptionRuleTarget,
  _config?: SubscriptionRuleConfig
): string {
  void _config
  if (isBuiltinTarget(target)) return SINGBOX_TARGETS[target]
  return target
}

function selectGroupNodeNames(
  group: SubscriptionPolicyGroup,
  nodes: SubscriptionNodeRef[]
): string[] {
  if (!group.includeNodes) return []
  if (group.selectedNodeIds.length === 0) return nodes.map((node) => node.name)
  const selected = new Set(group.selectedNodeIds)
  return nodes
    .filter((node) => typeof node.id === "number" && selected.has(node.id))
    .map((node) => node.name)
}

export function buildClashPolicyGroup(
  group: SubscriptionPolicyGroup,
  nodes: SubscriptionNodeRef[],
  name = group.name,
  config?: SubscriptionRuleConfig
): Record<string, unknown> {
  const members: string[] = []
  if (group.includeProxy && group.id !== "proxy") {
    members.push(clashTarget("proxy", config))
  }
  if (group.includeAuto && group.id !== "auto") {
    members.push(clashTarget("auto", config))
  }
  members.push(...selectGroupNodeNames(group, nodes))
  if (group.includeDirect) members.push("DIRECT")
  if (group.includeReject) members.push("REJECT")
  const fallbackProxies =
    group.id === "proxy"
      ? nodes.map((node) => node.name)
      : [clashTarget("proxy", config)]
  const proxies =
    members.length > 0
      ? members
      : fallbackProxies.length > 0
        ? fallbackProxies
        : ["REJECT"]

  if (group.type === "url-test") {
    return {
      name,
      type: "url-test",
      proxies,
      url: group.url,
      interval: group.interval,
      tolerance: group.tolerance,
    }
  }

  return { name, type: "select", proxies }
}

export function compileClashPolicyGroups(
  config: SubscriptionRuleConfig,
  nodes: SubscriptionNodeRef[]
): Array<Record<string, unknown>> {
  if (!config.enabled) return []
  return config.policyGroups
    .filter((group) => group.enabled)
    .map((group) => buildClashPolicyGroup(group, nodes, group.name, config))
}

export function buildSingboxPolicyGroup(
  group: SubscriptionPolicyGroup,
  nodes: SubscriptionNodeRef[],
  tag = group.id
): Record<string, unknown> {
  const members: string[] = []
  if (group.includeProxy && tag !== "proxy") members.push("proxy")
  if (group.includeAuto && tag !== "auto") members.push("auto")
  members.push(...selectGroupNodeNames(group, nodes))
  if (group.includeDirect && tag !== "direct") members.push("direct")
  if (group.includeReject && tag !== "reject") members.push("reject")
  const fallbackOutbounds =
    tag === "proxy" ? nodes.map((node) => node.name) : ["proxy"]
  const groupOutbounds =
    members.length > 0
      ? members
      : fallbackOutbounds.length > 0
        ? fallbackOutbounds
        : ["reject"]

  if (group.type === "url-test") {
    return {
      type: "urltest",
      tag,
      outbounds: groupOutbounds,
      url: group.url,
      interval: `${group.interval}s`,
      tolerance: group.tolerance,
    }
  }

  return {
    type: "selector",
    tag,
    outbounds: groupOutbounds,
    default: groupOutbounds[0],
  }
}

export function compileSingboxPolicyGroups(
  config: SubscriptionRuleConfig,
  nodes: SubscriptionNodeRef[]
): Array<Record<string, unknown>> {
  if (!config.enabled) return []
  return config.policyGroups
    .filter((group) => group.enabled)
    .map((group) => buildSingboxPolicyGroup(group, nodes))
}

export function compileClashSubscriptionRules(
  config: SubscriptionRuleConfig
): ClashCompiledSubscriptionRules {
  if (!config.enabled) return { providers: {}, rules: [] }

  const providers: Record<string, Record<string, unknown>> = {}
  const rules: string[] = []

  for (const ruleSet of config.remoteRuleSets) {
    if (!ruleSet.enabled || !ruleSet.clash?.enabled || !ruleSet.clash.url)
      continue
    providers[ruleSet.id] = {
      type: "http",
      behavior: ruleSet.clash.behavior,
      url: ruleSet.clash.url,
      path: `./ruleset/${ruleSet.id}.yaml`,
      interval: 86400,
    }
    const noResolve = ruleSet.noResolve ? ",no-resolve" : ""
    rules.push(
      `RULE-SET,${ruleSet.id},${clashTarget(ruleSet.target, config)}${noResolve}`
    )
  }

  for (const rule of config.rules) {
    if (!rule.enabled) continue
    const target = clashTarget(rule.target, config)
    const noResolve = rule.noResolve ? ",no-resolve" : ""
    if (rule.type === "domain") rules.push(`DOMAIN,${rule.value},${target}`)
    if (rule.type === "domain_suffix")
      rules.push(`DOMAIN-SUFFIX,${rule.value},${target}`)
    if (rule.type === "domain_keyword")
      rules.push(`DOMAIN-KEYWORD,${rule.value},${target}`)
    if (rule.type === "ip_cidr")
      rules.push(`IP-CIDR,${rule.value},${target}${noResolve}`)
    if (rule.type === "geoip")
      rules.push(`GEOIP,${rule.value.toUpperCase()},${target}${noResolve}`)
  }

  return { providers, rules }
}

export function compileSingboxSubscriptionRules(
  config: SubscriptionRuleConfig
): SingboxCompiledSubscriptionRules {
  if (!config.enabled) return { ruleSets: [], rules: [] }

  const ruleSets: Array<Record<string, unknown>> = []
  const rules: Array<Record<string, unknown>> = []

  for (const ruleSet of config.remoteRuleSets) {
    if (!ruleSet.enabled || !ruleSet.singbox?.enabled || !ruleSet.singbox.url)
      continue
    ruleSets.push({
      type: "remote",
      tag: ruleSet.id,
      format: ruleSet.singbox.format,
      url: ruleSet.singbox.url,
    })
    rules.push({
      rule_set: ruleSet.id,
      outbound: singboxTarget(ruleSet.target, config),
    })
  }

  for (const rule of config.rules) {
    if (!rule.enabled) continue
    const outbound = singboxTarget(rule.target, config)
    if (rule.type === "domain") rules.push({ domain: [rule.value], outbound })
    if (rule.type === "domain_suffix") {
      rules.push({ domain_suffix: [rule.value], outbound })
    }
    if (rule.type === "domain_keyword") {
      rules.push({ domain_keyword: [rule.value], outbound })
    }
    if (rule.type === "ip_cidr") rules.push({ ip_cidr: [rule.value], outbound })
    if (rule.type === "geoip") {
      rules.push({ rule_set: `geoip-${rule.value.toLowerCase()}`, outbound })
    }
  }

  return { ruleSets, rules }
}
