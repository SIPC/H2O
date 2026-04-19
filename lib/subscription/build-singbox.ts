// sing-box 配置生成：把节点 outbound 合并到模板后序列化 JSON
import type { NodeForUri } from "@/lib/hysteria-uri"
import { nodeToSingboxOutbound } from "./node-proxy"
import { buildSingboxBase } from "./singbox-template"

export function buildSingboxConfig(
  token: string,
  nodes: NodeForUri[]
): string {
  const tags = nodes.map((n) => n.name)
  const config = buildSingboxBase(tags)
  config.outbounds.push(...nodes.map((n) => nodeToSingboxOutbound(token, n)))

  return JSON.stringify(config, null, 2)
}
