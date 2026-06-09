import { isIPv4, isIPv6 } from "node:net"

export type ParsedNodePublicAddress =
  | { ok: true; value: string | null }
  | { ok: false; message: string }

export function parseOptionalNodeIpv4(
  input: string | null | undefined
): ParsedNodePublicAddress {
  const value = input?.trim() ?? ""
  if (!value) return { ok: true, value: null }
  if (!isIPv4(value)) return { ok: false, message: "IPv4 地址不合法" }
  return { ok: true, value }
}

export function parseOptionalNodeIpv6(
  input: string | null | undefined
): ParsedNodePublicAddress {
  const value = input?.trim() ?? ""
  if (!value) return { ok: true, value: null }
  if (!isIPv6(value)) return { ok: false, message: "IPv6 地址不合法" }
  return { ok: true, value }
}
