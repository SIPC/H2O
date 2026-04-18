// 构建 Hysteria2 订阅 URI
// 参考格式：https://v2.hysteria.network/docs/developers/URI-Scheme/
// hysteria2://{auth}@{host}:{port}/?sni=...&obfs=...&obfs-password=...&insecure=1&pinSHA256=...#{label}

export type NodeForUri = {
  name: string
  ip: string
  port: number
  sni?: string | null
  obfs?: string | null
  obfs_password?: string | null
  insecure?: 0 | 1 | null
  pin_sha256?: string | null
}

export function buildHysteriaUri(token: string, node: NodeForUri): string {
  const auth = encodeURIComponent(token)
  const host = node.ip
  const base = `hysteria2://${auth}@${host}:${node.port}/`

  const params = new URLSearchParams()
  if (node.sni) params.set("sni", node.sni)
  if (node.obfs) params.set("obfs", node.obfs)
  if (node.obfs_password) params.set("obfs-password", node.obfs_password)
  if (node.insecure === 1) params.set("insecure", "1")
  if (node.pin_sha256) params.set("pinSHA256", node.pin_sha256)

  const query = params.toString()
  const fragment = encodeURIComponent(node.name)
  return `${base}${query ? `?${query}` : ""}#${fragment}`
}
