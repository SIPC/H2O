// H2O 节点 → Clash / sing-box 代理节点对象
// 说明：mihomo 与 sing-box 的 hysteria2 原生类型都不支持 TLS SHA256 Pin，
// 节点若启用了 pin_sha256，会退化成 skip-cert-verify —— 原生 hysteria 客户端
// 通过 pin 信任证书，mihomo/sing-box 没这个字段，只能绕过系统 CA 校验
// 以保证能连上；需要更严格的校验请继续用 hysteria 原生 URI 订阅。

import type { NodeForUri } from "@/lib/hysteria-uri"
import { toClashPorts, toSingboxServerPorts } from "@/lib/port-hopping"

export type ClashHysteria2Proxy = {
  name: string
  type: "hysteria2"
  server: string
  port: number
  ports?: string
  password: string
  udp?: boolean
  up?: string
  down?: string
  sni?: string
  "skip-cert-verify"?: boolean
  alpn?: string[]
  obfs?: string
  "obfs-password"?: string
}

export type SingboxHysteria2Outbound = {
  type: "hysteria2"
  tag: string
  server: string
  server_port?: number
  server_ports?: string[]
  password: string
  up_mbps?: number
  down_mbps?: number
  obfs?: { type: "salamander"; password: string }
  tls: {
    enabled: true
    server_name?: string
    insecure?: boolean
    alpn?: string[]
  }
}

// insecure=1 或设置了 pin_sha256 时都需要 skip-cert-verify，避免 TLS 握手失败
function shouldSkipCertVerify(node: NodeForUri): boolean {
  return node.insecure === 1 || Boolean(node.pin_sha256)
}

export function nodeToClashProxy(
  token: string,
  node: NodeForUri
): ClashHysteria2Proxy {
  const proxy: ClashHysteria2Proxy = {
    name: node.name,
    type: "hysteria2",
    server: node.ip,
    port: node.port,
    password: token,
    udp: true,
    alpn: ["h3"],
  }
  const clashPorts = toClashPorts(node.port_hopping)
  if (clashPorts) proxy.ports = clashPorts
  if (node.sni) proxy.sni = node.sni
  if (shouldSkipCertVerify(node)) proxy["skip-cert-verify"] = true
  // mihomo 当前仅按 salamander 输出；避免把 gecko 错误下发成 salamander
  if (node.obfs === "salamander" && node.obfs_password) {
    proxy.obfs = "salamander"
    proxy["obfs-password"] = node.obfs_password
  }
  // 限速：0 / 空 → 不下发，走服务端默认
  if (typeof node.up_mbps === "number" && node.up_mbps > 0) {
    proxy.up = `${node.up_mbps} Mbps`
  }
  if (typeof node.down_mbps === "number" && node.down_mbps > 0) {
    proxy.down = `${node.down_mbps} Mbps`
  }
  return proxy
}

export function nodeToSingboxOutbound(
  token: string,
  node: NodeForUri,
  tag = node.name
): SingboxHysteria2Outbound {
  const outbound: SingboxHysteria2Outbound = {
    type: "hysteria2",
    tag,
    server: node.ip,
    password: token,
    tls: {
      enabled: true,
      alpn: ["h3"],
    },
  }
  const serverPorts = toSingboxServerPorts(node.port_hopping)
  if (serverPorts && serverPorts.length > 0) {
    // sing-box 1.11+ 使用 server_ports 表示端口跳跃；避免同时输出 server_port 被客户端误当成单端口。
    outbound.server_ports = serverPorts
  } else {
    outbound.server_port = node.port
  }
  if (node.sni) outbound.tls.server_name = node.sni
  if (shouldSkipCertVerify(node)) outbound.tls.insecure = true
  if (node.obfs === "salamander" && node.obfs_password) {
    outbound.obfs = { type: "salamander", password: node.obfs_password }
  }
  if (typeof node.up_mbps === "number" && node.up_mbps > 0) {
    outbound.up_mbps = node.up_mbps
  }
  if (typeof node.down_mbps === "number" && node.down_mbps > 0) {
    outbound.down_mbps = node.down_mbps
  }
  return outbound
}
