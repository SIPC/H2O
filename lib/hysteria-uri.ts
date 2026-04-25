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
  insecure?: 0 | 1 | null
  pin_sha256?: string | null
  // 以下两个由订阅聚合阶段注入（从用户的套餐里按节点取最宽松值）
  up_mbps?: number | null
  down_mbps?: number | null
}

export function buildHysteriaUri(token: string, node: NodeForUri): string {
  const auth = encodeURIComponent(token)
  const host = node.ip
  const portHopping = node.port_hopping?.trim()
  const address = portHopping
    ? `${host}:${portHopping}`
    : `${host}:${node.port}`
  const base = `hysteria2://${auth}@${address}/`

  const params = new URLSearchParams()
  if (node.sni) params.set("sni", node.sni)
  if (node.obfs) params.set("obfs", node.obfs)
  if (node.obfs_password) params.set("obfs-password", node.obfs_password)
  if (node.insecure === 1) params.set("insecure", "1")
  if (node.pin_sha256) params.set("pinSHA256", node.pin_sha256)
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
