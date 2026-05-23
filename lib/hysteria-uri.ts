// 构建 Hysteria2 订阅 URI
// 参考格式：https://v2.hysteria.network/docs/developers/URI-Scheme/
// hysteria2://{auth}@{host}:{port}/?sni=...&obfs=...&obfs-password=...&insecure=1&pinSHA256=...#{label}
// 限速字段 upmbps/downmbps 非官方 URI 规范但 NekoBox/v2rayN 等主流客户端均识别

export type NodeForUri = {
  name: string
  ip: string
  port: number
  port_hopping?: string | null
  sni?: string | null
  obfs?: string | null
  obfs_password?: string | null
  obfs_min_packet_size?: number | null
  obfs_max_packet_size?: number | null
  insecure?: 0 | 1 | null
  pin_sha256?: string | null
  // 以下两个由订阅聚合阶段注入（从用户的套餐里按节点取最宽松值）
  up_mbps?: number | null
  down_mbps?: number | null
}

// IPv6 地址在 URI 中必须用方括号包裹（RFC 3986）
function wrapHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host
}

export function buildHysteriaUri(token: string, node: NodeForUri): string {
  const auth = encodeURIComponent(token)
  const host = wrapHost(node.ip)
  // 地址部分始终使用单个整数端口，确保 .NET Uri / 标准 URL 解析器可识别
  // 端口跳跃范围通过 mport query 参数传递，兼容 v2rayN
  const base = `hysteria2://${auth}@${host}:${node.port}/`

  const params = new URLSearchParams()
  if (node.sni) params.set("sni", node.sni)
  if (node.obfs) params.set("obfs", node.obfs)
  if (node.obfs_password) params.set("obfs-password", node.obfs_password)
  if (node.obfs === "gecko") {
    params.set("obfs-min-packet-size", String(node.obfs_min_packet_size ?? 512))
    params.set(
      "obfs-max-packet-size",
      String(node.obfs_max_packet_size ?? 1200)
    )
  }
  if (node.insecure === 1) params.set("insecure", "1")
  if (node.pin_sha256) params.set("pinSHA256", node.pin_sha256)
  // v2rayN 通过 mport 参数识别端口跳跃
  const portHopping = node.port_hopping?.trim()
  if (portHopping) {
    params.set("mport", portHopping.replace(/:/g, "-"))
  }
  if (typeof node.up_mbps === "number" && node.up_mbps > 0) {
    params.set("upmbps", String(node.up_mbps))
  }
  if (typeof node.down_mbps === "number" && node.down_mbps > 0) {
    params.set("downmbps", String(node.down_mbps))
  }

  const query = params.toString()
  const fragment = encodeURIComponent(node.name)
  return `${base}${query ? `?${query}` : ""}#${fragment}`
}
