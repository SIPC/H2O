// 根据 ?format= 查询参数或 User-Agent 自动识别订阅格式
// 兼容旧链接：未命中时回落到 base64（现有 Hysteria 客户端预期）

export type SubFormat = "clash" | "singbox" | "base64" | "plain"

const CLASH_UA = /clash|mihomo|stash|verge/i
const SINGBOX_UA = /sing-?box|\bSFA\b|\bSFI\b|\bSFM\b|\bSFT\b|hiddify|karing/i
const V2RAYN_UA = /v2rayn/i

export function detectFormat(url: URL, userAgent: string | null): SubFormat {
  const explicit = url.searchParams.get("format")
  if (
    explicit === "clash" ||
    explicit === "singbox" ||
    explicit === "plain" ||
    explicit === "base64"
  ) {
    return explicit
  }

  const ua = userAgent ?? ""
  if (CLASH_UA.test(ua)) return "clash"
  if (SINGBOX_UA.test(ua)) return "singbox"
  if (V2RAYN_UA.test(ua)) return "base64"
  return "base64"
}
