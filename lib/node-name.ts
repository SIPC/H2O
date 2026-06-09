// 这些名称是 sing-box 订阅模板里的固定 outbound tag，节点直出同名会冲突
const RESERVED_SINGBOX_NODE_TAGS = new Set([
  "proxy",
  "auto",
  "ai",
  "media",
  "telegram",
  "apple",
  "microsoft",
  "fallback",
  "direct",
  "reject",
])

export function normalizeNodeName(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function validateNodeName(name: string): string | null {
  if (!name) return "节点名称不能为空"
  if (RESERVED_SINGBOX_NODE_TAGS.has(name.toLowerCase())) {
    return `节点名称不能使用 sing-box 内置出站名称：${name}`
  }
  return null
}
