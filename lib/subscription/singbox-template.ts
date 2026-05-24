// sing-box 1.x 订阅模板 —— 标准档分流
// 规则集来源：SagerNet 官方 sing-geosite / sing-geoip binary (.srs)

import type { SingboxHysteria2Outbound } from "./node-proxy"
import {
  buildSingboxPolicyGroup,
  compileSingboxPolicyGroups,
  compileSingboxSubscriptionRules,
  getBuiltinRuleTarget,
  isBuiltinRuleEnabled,
  singboxTarget,
  type SubscriptionRuleConfig,
} from "./rule-config"

type SubscriptionNodeRef = { id?: number | null; name: string }

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

function applyCustomRules(
  config: SingboxConfig,
  ruleConfig: SubscriptionRuleConfig | undefined,
  protectedRuleCount: number,
  nodeRefs: SubscriptionNodeRef[]
) {
  if (!ruleConfig?.enabled) return

  config.outbounds.push(...compileSingboxPolicyGroups(ruleConfig, nodeRefs))

  const compiled = compileSingboxSubscriptionRules(ruleConfig)
  const route = config.route
  const rules = Array.isArray(route.rules) ? route.rules : []
  const ruleSets = Array.isArray(route.rule_set) ? route.rule_set : []
  route.rule_set = [...ruleSets, ...compiled.ruleSets]
  route.final = singboxTarget(ruleConfig.finalTarget, ruleConfig)

  const protectedRules = rules.slice(0, protectedRuleCount)
  const builtinRules = rules.slice(protectedRuleCount)

  if (ruleConfig.mode === "replace") {
    route.rules = [...protectedRules, ...compiled.rules]
    return
  }

  if (ruleConfig.mode === "append") {
    route.rules = [...protectedRules, ...builtinRules, ...compiled.rules]
    return
  }

  route.rules = [...protectedRules, ...compiled.rules, ...builtinRules]
}

export function buildSingboxBase(
  nodeTags: string[],
  options: {
    ruleConfig?: SubscriptionRuleConfig
    nodeRefs?: SubscriptionNodeRef[]
  } = {}
): SingboxConfig {
  // urltest 至少需要一个成员，空节点会在调用处被提前 404 拦截
  const ruleConfig = options.ruleConfig
  const aiTarget = singboxTarget(
    getBuiltinRuleTarget(ruleConfig, "ai"),
    ruleConfig
  )
  const mediaTarget = singboxTarget(
    getBuiltinRuleTarget(ruleConfig, "media"),
    ruleConfig
  )
  const telegramTarget = singboxTarget(
    getBuiltinRuleTarget(ruleConfig, "telegram"),
    ruleConfig
  )
  const appleTarget = singboxTarget(
    getBuiltinRuleTarget(ruleConfig, "apple"),
    ruleConfig
  )
  const microsoftTarget = singboxTarget(
    getBuiltinRuleTarget(ruleConfig, "microsoft"),
    ruleConfig
  )
  const rejectTarget = singboxTarget(
    getBuiltinRuleTarget(ruleConfig, "reject"),
    ruleConfig
  )

  const directTarget = singboxTarget(
    getBuiltinRuleTarget(ruleConfig, "direct"),
    ruleConfig
  )
  const autoPool = nodeTags.length > 0 ? nodeTags : ["direct"]
  const selectPool = ["auto", "direct", ...nodeTags]
  const proxyPool = ["proxy"]
  const directFirst = ["proxy"]

  const protectedRouteRuleCount = 5
  const config: SingboxConfig = {
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
      {
        type: "selector",
        tag: "fallback",
        outbounds: ["proxy"],
      },
      { type: "direct", tag: "direct", domain_resolver: "local" },
      { type: "block", tag: "reject" },
    ],
    http_clients: [{ tag: "direct-http", detour: "direct" }],
    route: {
      rules: [
        { inbound: "mixed-in", action: "sniff", timeout: "1s" },
        { inbound: "tun-in", action: "sniff", timeout: "1s" },
        { protocol: "dns", action: "hijack-dns" },
        { clash_mode: "direct", outbound: "direct" },
        { clash_mode: "global", outbound: "proxy" },
        ...(isBuiltinRuleEnabled(ruleConfig, "reject")
          ? [{ rule_set: "geosite-category-ads-all", outbound: rejectTarget }]
          : []),
        ...(isBuiltinRuleEnabled(ruleConfig, "ai")
          ? [{ rule_set: "geosite-openai", outbound: aiTarget }]
          : []),
        ...(isBuiltinRuleEnabled(ruleConfig, "media")
          ? [
              {
                rule_set: [
                  "geosite-youtube",
                  "geosite-netflix",
                  "geosite-disney",
                  "geosite-spotify",
                ],
                outbound: mediaTarget,
              },
            ]
          : []),
        ...(isBuiltinRuleEnabled(ruleConfig, "telegram")
          ? [{ rule_set: ["geosite-telegram"], outbound: telegramTarget }]
          : []),
        ...(isBuiltinRuleEnabled(ruleConfig, "apple")
          ? [
              {
                rule_set: ["geosite-apple", "geosite-icloud"],
                outbound: appleTarget,
              },
            ]
          : []),
        ...(isBuiltinRuleEnabled(ruleConfig, "microsoft")
          ? [{ rule_set: "geosite-microsoft", outbound: microsoftTarget }]
          : []),
        ...(isBuiltinRuleEnabled(ruleConfig, "direct")
          ? [
              { rule_set: ["geosite-cn", "geoip-cn"], outbound: directTarget },
              { ip_is_private: true, outbound: directTarget },
            ]
          : []),
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
      final: "fallback",
      auto_detect_interface: true,
    },
    experimental: {
      cache_file: { enabled: true, path: "cache.db" },
    },
  }

  const nodeRefs = options.nodeRefs ?? nodeTags.map((name) => ({ name }))
  if (options.ruleConfig?.enabled) {
    for (const [target, group] of Object.entries(
      options.ruleConfig.builtinPolicyOverrides
    )) {
      if (!group?.enabled) continue
      const nextOutbound = buildSingboxPolicyGroup(group, nodeRefs, target)
      const index = config.outbounds.findIndex(
        (item) => "tag" in item && item.tag === target
      )
      if (index >= 0) config.outbounds[index] = nextOutbound
      else config.outbounds.push(nextOutbound)
    }
  }

  applyCustomRules(
    config,
    options.ruleConfig,
    protectedRouteRuleCount,
    nodeRefs
  )
  return config
}
