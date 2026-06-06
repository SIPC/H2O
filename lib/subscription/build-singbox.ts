// sing-box 配置生成：把节点 outbound 合并到模板后序列化 JSON
import type { NodeForUri } from "@/lib/hysteria-uri"
import { nodeToSingboxOutbound } from "./node-proxy"
import {
  getSubscriptionRuleConfig,
  type SubscriptionRuleConfig,
} from "./rule-config"
import { buildSingboxBase } from "./singbox-template"

function buildNodeTag(node: NodeForUri, index: number) {
  const id = "id" in node && typeof node.id === "number" ? node.id : index + 1
  return `node-${id}-${node.name}`
}

export function buildSingboxConfig(
  token: string,
  nodes: NodeForUri[],
  ruleConfig: SubscriptionRuleConfig = getSubscriptionRuleConfig()
): string {
  const tags = nodes.map(buildNodeTag)
  const nodeRefs = nodes.map((node, index) => ({
    id: "id" in node && typeof node.id === "number" ? node.id : null,
    name: tags[index],
  }))
  const config = buildSingboxBase(tags, { ruleConfig, nodeRefs })
  config.outbounds.push(
    ...nodes.map((node, index) =>
      nodeToSingboxOutbound(token, node, tags[index])
    )
  )

  return JSON.stringify(config, null, 2)
}
