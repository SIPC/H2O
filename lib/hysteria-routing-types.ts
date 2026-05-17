export const OUTBOUND_TYPES = ["direct", "socks5", "http"] as const
export type HysteriaOutboundType = (typeof OUTBOUND_TYPES)[number]

export const DIRECT_OUTBOUND_MODES = ["auto", "64", "46", "6", "4"] as const
export type DirectOutboundMode = (typeof DIRECT_OUTBOUND_MODES)[number]

export const BUILTIN_OUTBOUND_NAMES = ["direct", "reject", "default"] as const
export type BuiltinOutboundName = (typeof BUILTIN_OUTBOUND_NAMES)[number]

export const ACL_RULE_KINDS = ["rule", "comment", "raw"] as const
export type AclRuleKind = (typeof ACL_RULE_KINDS)[number]

export const ACL_PROTOCOLS = ["*", "tcp", "udp"] as const
export type AclProtocol = (typeof ACL_PROTOCOLS)[number]

export type DirectOutboundOptions = {
  mode: DirectOutboundMode
  bindIPv4?: string
  bindIPv6?: string
  bindDevice?: string
  fastOpen?: boolean
}

export type Socks5OutboundOptions = {
  addr: string
  username?: string
  password?: string
}

export type HttpOutboundOptions = {
  url: string
  insecure?: boolean
}

export type HysteriaOutboundItem = {
  id: string
  name: string
  type: HysteriaOutboundType
  direct?: DirectOutboundOptions
  socks5?: Socks5OutboundOptions
  http?: HttpOutboundOptions
}

export type HysteriaOutboundProfileConfig = {
  outbounds: HysteriaOutboundItem[]
}

export type AclRule = {
  id: string
  kind: AclRuleKind
  outbound?: string
  address?: string
  protocol?: AclProtocol
  port?: string
  hijackAddress?: string
  comment?: string
  raw?: string
  enabled?: boolean
}

export type HysteriaAclProfileConfig = {
  rules: AclRule[]
  geoip?: string
  geosite?: string
  geoUpdateInterval?: string
}

export const OUTBOUND_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const OUTBOUND_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const MAX_OUTBOUND_ITEMS = 50
export const MAX_ACL_RULES = 500

export function isHysteriaOutboundType(
  value: unknown
): value is HysteriaOutboundType {
  return (
    typeof value === "string" &&
    OUTBOUND_TYPES.includes(value as HysteriaOutboundType)
  )
}

export function isDirectOutboundMode(
  value: unknown
): value is DirectOutboundMode {
  return (
    typeof value === "string" &&
    DIRECT_OUTBOUND_MODES.includes(value as DirectOutboundMode)
  )
}

export function isBuiltinOutboundName(
  value: unknown
): value is BuiltinOutboundName {
  return (
    typeof value === "string" &&
    BUILTIN_OUTBOUND_NAMES.includes(value as BuiltinOutboundName)
  )
}

export function isAclProtocol(value: unknown): value is AclProtocol {
  return typeof value === "string" && ACL_PROTOCOLS.includes(value as AclProtocol)
}
