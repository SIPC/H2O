// sing-box 1.x 订阅模板 —— 标准档分流
// 规则集来源：SagerNet 官方 sing-geosite / sing-geoip binary (.srs)

import type { SingboxHysteria2Outbound } from "./node-proxy"

const GEOSITE_BASE =
  "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set"
const GEOIP_BASE =
  "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set"

function geositeRule(tag: string) {
  return {
    type: "remote" as const,
    tag,
    format: "binary" as const,
    url: `${GEOSITE_BASE}/${tag}.srs`,
  }
}

function geoipRule(tag: string) {
  return {
    type: "remote" as const,
    tag,
    format: "binary" as const,
    url: `${GEOIP_BASE}/${tag}.srs`,
  }
}

export type SingboxConfig = {
  log: Record<string, unknown>
  dns: Record<string, unknown>
  inbounds: Array<Record<string, unknown>>
  outbounds: Array<Record<string, unknown> | SingboxHysteria2Outbound>
  http_clients: Array<Record<string, unknown>>
  route: Record<string, unknown>
  experimental: Record<string, unknown>
}

export function buildSingboxBase(nodeTags: string[]): SingboxConfig {
  // urltest 至少需要一个成员，空节点会在调用处被提前 404 拦截
  const autoPool = nodeTags.length > 0 ? nodeTags : ["direct"]
  const selectPool = ["auto", "direct", ...nodeTags]
  const proxyPool = ["proxy", "auto", ...nodeTags]
  const directFirst = ["direct", "proxy", ...nodeTags]

  return {
    log: { level: "info", timestamp: true },
    dns: {
      servers: [
        // 境外域名：DoT 走代理，避免明文 UDP 53 外泄
        { tag: "cloudflare", type: "tls", server: "1.1.1.1", detour: "proxy" },
        // 国内域名：DoT 直连加密
        { tag: "local", type: "tls", server: "223.5.5.5", detour: "direct" },
      ],
      rules: [
        // DNS 层拦截广告域名
        {
          rule_set: "geosite-category-ads-all",
          action: "predefined",
          rcode: "REFUSED",
        },
        { clash_mode: "global", action: "route", server: "cloudflare" },
        { clash_mode: "direct", action: "route", server: "local" },
        { rule_set: "geosite-cn", action: "route", server: "local" },
        // 兜底：未匹配的域名走 cloudflare
        { action: "route", server: "cloudflare" },
      ],
      strategy: "prefer_ipv4",
    },
    inbounds: [
      {
        type: "mixed",
        tag: "mixed-in",
        listen: "127.0.0.1",
        listen_port: 7890,
      },
      {
        type: "tun",
        tag: "tun-in",
        interface_name: "sing-tun0",
        address: ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
        auto_route: true,
        strict_route: true,
        stack: "mixed",
      },
    ],
    outbounds: [
      {
        type: "selector",
        tag: "proxy",
        outbounds: selectPool,
        default: "auto",
      },
      {
        type: "urltest",
        tag: "auto",
        outbounds: autoPool,
        url: "https://www.gstatic.com/generate_204",
        interval: "3m",
        tolerance: 50,
      },
      { type: "selector", tag: "ai", outbounds: proxyPool },
      { type: "selector", tag: "media", outbounds: proxyPool },
      { type: "selector", tag: "telegram", outbounds: proxyPool },
      { type: "selector", tag: "apple", outbounds: directFirst },
      { type: "selector", tag: "microsoft", outbounds: directFirst },
      { type: "direct", tag: "direct", domain_resolver: "local" },
    ],
    http_clients: [{ tag: "direct-http", detour: "direct" }],
    route: {
      rules: [
        { inbound: "mixed-in", action: "sniff", timeout: "1s" },
        { inbound: "tun-in", action: "sniff", timeout: "1s" },
        { protocol: "dns", action: "hijack-dns" },
        { clash_mode: "direct", outbound: "direct" },
        { clash_mode: "global", outbound: "proxy" },
        { rule_set: "geosite-category-ads-all", action: "reject" },
        { rule_set: "geosite-openai", outbound: "ai" },
        {
          rule_set: [
            "geosite-youtube",
            "geosite-netflix",
            "geosite-disney",
            "geosite-spotify",
          ],
          outbound: "media",
        },
        {
          rule_set: ["geosite-telegram"],
          outbound: "telegram",
        },
        {
          rule_set: ["geosite-apple", "geosite-icloud"],
          outbound: "apple",
        },
        { rule_set: "geosite-microsoft", outbound: "microsoft" },
        { rule_set: ["geosite-cn", "geoip-cn"], outbound: "direct" },
        { ip_is_private: true, outbound: "direct" },
      ],
      rule_set: [
        geositeRule("geosite-category-ads-all"),
        geositeRule("geosite-openai"),
        geositeRule("geosite-youtube"),
        geositeRule("geosite-netflix"),
        geositeRule("geosite-disney"),
        geositeRule("geosite-spotify"),
        geositeRule("geosite-telegram"),
        geositeRule("geosite-apple"),
        geositeRule("geosite-icloud"),
        geositeRule("geosite-microsoft"),
        geositeRule("geosite-cn"),
        geoipRule("geoip-cn"),
      ],
      default_http_client: "direct-http",
      default_domain_resolver: "local",
      final: "proxy",
      auto_detect_interface: true,
    },
    experimental: {
      cache_file: { enabled: true, path: "cache.db" },
    },
  }
}
