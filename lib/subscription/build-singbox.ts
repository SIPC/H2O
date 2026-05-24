// sing-box 配置生成：把节点 outbound 合并到模板后序列化 JSON
import type { NodeForUri } from "@/lib/hysteria-uri"
import { nodeToSingboxOutbound } from "./node-proxy"
import {
  getSubscriptionRuleConfig,
  type SubscriptionRuleConfig,
} from "./rule-config"
import { buildSingboxBase } from "./singbox-template"

export function buildSingboxConfig(
  token: string,
  nodes: NodeForUri[],
  ruleConfig: SubscriptionRuleConfig = getSubscriptionRuleConfig()
): string {
  const tags = nodes.map((n) => n.name)
  const nodeRefs = nodes.map((node) => ({
    id: "id" in node && typeof node.id === "number" ? node.id : null,
    name: node.name,
  }))
  const config = buildSingboxBase(tags, { ruleConfig, nodeRefs })
  config.outbounds.push(...nodes.map((n) => nodeToSingboxOutbound(token, n)))

  return JSON.stringify(config, null, 2)
}
