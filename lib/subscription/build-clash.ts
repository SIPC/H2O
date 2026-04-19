// Clash Meta (mihomo) 配置生成：合成模板 + 节点后 YAML 序列化
import YAML from "yaml"

import type { NodeForUri } from "@/lib/hysteria-uri"
import { buildClashBase } from "./clash-template"
import { nodeToClashProxy } from "./node-proxy"

export function buildClashConfig(
  token: string,
  nodes: NodeForUri[]
): string {
  const names = nodes.map((n) => n.name)
  const config = buildClashBase(names)
  config.proxies = nodes.map((n) => nodeToClashProxy(token, n))

  return YAML.stringify(config, { lineWidth: 0 })
}
