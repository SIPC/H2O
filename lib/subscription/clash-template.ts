// Clash Meta (mihomo) 订阅模板 —— 标准档分流
// 规则集来源：ACL4SSR (https://github.com/ACL4SSR/ACL4SSR)
// AI 走内联 DOMAIN 规则（OpenAI/Anthropic/Gemini），省一个 rule-provider

import type { ClashHysteria2Proxy } from "./node-proxy"
import {
  buildClashPolicyGroup,
  clashTarget,
  compileClashPolicyGroups,
  compileClashSubscriptionRules,
  getBuiltinRuleTarget,
  isBuiltinRuleEnabled,
  type SubscriptionRuleConfig,
} from "./rule-config"

type SubscriptionNodeRef = { id?: number | null; name: string }

const ACL4SSR_BASE =
  "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Providers/Ruleset"

type RuleBehavior = "domain" | "ipcidr" | "classical"

function httpProvider(filename: string, behavior: RuleBehavior) {
  return {
    type: "http",
    behavior,
    url: `${ACL4SSR_BASE}/${filename}`,
    path: `./ruleset/${filename.replace(/\.yaml$/i, "").toLowerCase()}.yaml`,
    interval: 86400,
  }
}

export type ClashConfig = {
  "mixed-port": number
  "allow-lan": boolean
  "bind-address": string
  mode: "rule"
  "log-level": string
  ipv6: boolean
  dns: Record<string, unknown>
  proxies: ClashHysteria2Proxy[]
  "proxy-groups": Array<Record<string, unknown>>
  "rule-providers": Record<string, Record<string, unknown>>
  rules: string[]
}

function applyCustomRules(
  config: ClashConfig,
  ruleConfig: SubscriptionRuleConfig | undefined,
  nodeRefs: SubscriptionNodeRef[]
) {
  if (!ruleConfig?.enabled) return

  config["proxy-groups"].push(...compileClashPolicyGroups(ruleConfig, nodeRefs))

  const compiled = compileClashSubscriptionRules(ruleConfig)
  config["rule-providers"] = {
    ...config["rule-providers"],
    ...compiled.providers,
  }

  const finalRule = `MATCH,${clashTarget(ruleConfig.finalTarget, ruleConfig)}`
  const matchIndex = config.rules.findIndex((rule) => rule.startsWith("MATCH,"))
  const builtinRules =
    matchIndex >= 0 ? config.rules.slice(0, matchIndex) : config.rules

  if (ruleConfig.mode === "replace") {
    config.rules = [...compiled.rules, finalRule]
    return
  }

  if (ruleConfig.mode === "append") {
    config.rules = [...builtinRules, ...compiled.rules, finalRule]
    return
  }

  config.rules = [...compiled.rules, ...builtinRules, finalRule]
}

export function buildClashBase(
  nodeNames: string[],
  options: {
    ruleConfig?: SubscriptionRuleConfig
    nodeRefs?: SubscriptionNodeRef[]
  } = {}
): ClashConfig {
  // url-test 必须至少有一个成员，空节点列表时会在调用处被提前 404 拦截
  const ruleConfig = options.ruleConfig
  const groupSelect = clashTarget("proxy", ruleConfig)
  const groupAuto = clashTarget("auto", ruleConfig)
  const groupAi = clashTarget("ai", ruleConfig)
  const groupMedia = clashTarget("media", ruleConfig)
  const groupTelegram = clashTarget("telegram", ruleConfig)
  const groupApple = clashTarget("apple", ruleConfig)
  const groupMicrosoft = clashTarget("microsoft", ruleConfig)
  const groupAds = clashTarget("reject", ruleConfig)
  const groupFallback = clashTarget("fallback", ruleConfig)
  const ruleSelect = clashTarget(
    getBuiltinRuleTarget(ruleConfig, "proxy"),
    ruleConfig
  )
  const ruleAi = clashTarget(getBuiltinRuleTarget(ruleConfig, "ai"), ruleConfig)
  const ruleMedia = clashTarget(
    getBuiltinRuleTarget(ruleConfig, "media"),
    ruleConfig
  )
  const ruleTelegram = clashTarget(
    getBuiltinRuleTarget(ruleConfig, "telegram"),
    ruleConfig
  )
  const ruleApple = clashTarget(
    getBuiltinRuleTarget(ruleConfig, "apple"),
    ruleConfig
  )
  const ruleMicrosoft = clashTarget(
    getBuiltinRuleTarget(ruleConfig, "microsoft"),
    ruleConfig
  )
  const ruleAds = clashTarget(
    getBuiltinRuleTarget(ruleConfig, "reject"),
    ruleConfig
  )
  const ruleDirect = clashTarget(
    getBuiltinRuleTarget(ruleConfig, "direct"),
    ruleConfig
  )

  const autoPool = nodeNames.length > 0 ? nodeNames : ["DIRECT"]
  const selectPool = [groupAuto, ...nodeNames, "DIRECT"]
  const proxyPool = [groupSelect]
  const directFirst = [groupSelect]

  const config: ClashConfig = {
    "mixed-port": 7890,
    "allow-lan": false,
    "bind-address": "*",
    mode: "rule",
    "log-level": "info",
    ipv6: false,
    dns: {
      enable: true,
      ipv6: false,
      "enhanced-mode": "fake-ip",
      "fake-ip-range": "198.18.0.1/16",
      "use-hosts": true,
      "respect-rules": true,
      // bootstrap 解析器：用来解析下面 DoT 域名的 IP，必须纯 IP
      "default-nameserver": ["223.5.5.5", "119.29.29.29", "114.114.114.114"],
      // 代理服务器地址专用解析器，不绕回代理自己；走国内 DoT 加密，ISP 看不到代理服务器域名
      "proxy-server-nameserver": ["tls://dns.alidns.com", "tls://dot.pub"],
      // 国内域名走 DoT 直连加密
      nameserver: ["tls://dns.alidns.com", "tls://dot.pub"],
      // 境外域名走 DoH 并**通过代理**出去，避免明文 UDP 53 泄漏查询内容
      fallback: [
        `https://1.1.1.1/dns-query#${groupSelect}`,
        `https://dns.google/dns-query#${groupSelect}`,
      ],
      "fallback-filter": {
        geoip: true,
        "geoip-code": "CN",
      },
    },
    proxies: [],
    "proxy-groups": [
      { name: groupSelect, type: "select", proxies: selectPool },
      {
        name: groupAuto,
        type: "url-test",
        proxies: autoPool,
        url: "http://www.gstatic.com/generate_204",
        interval: 300,
        tolerance: 50,
      },
      { name: groupAi, type: "select", proxies: proxyPool },
      { name: groupMedia, type: "select", proxies: proxyPool },
      { name: groupTelegram, type: "select", proxies: proxyPool },
      { name: groupApple, type: "select", proxies: directFirst },
      { name: groupMicrosoft, type: "select", proxies: directFirst },
      {
        name: groupAds,
        type: "select",
        proxies: ["REJECT"],
      },
      {
        name: groupFallback,
        type: "select",
        proxies: [groupSelect],
      },
    ],
    "rule-providers": {
      reject: httpProvider("Reject.yaml", "domain"),
      icloud: httpProvider("iCloud.yaml", "domain"),
      apple: httpProvider("Apple.yaml", "domain"),
      microsoft: httpProvider("Microsoft.yaml", "classical"),
      proxymedia: httpProvider("ProxyMedia.yaml", "classical"),
      telegram: httpProvider("Telegram.yaml", "domain"),
      telegramcidr: httpProvider("Telegramcidr.yaml", "ipcidr"),
      proxy: httpProvider("ProxyLite.yaml", "classical"),
      chinadomain: httpProvider("ChinaDomain.yaml", "domain"),
      chinacompanyip: httpProvider("ChinaCompanyIp.yaml", "ipcidr"),
      chinaip: httpProvider("ChinaIp.yaml", "ipcidr"),
      lan: httpProvider("LocalAreaNetwork.yaml", "classical"),
    },
    rules: [
      // AI 内联规则（不依赖外部 rule-provider）
      ...(isBuiltinRuleEnabled(ruleConfig, "ai")
        ? [
            `DOMAIN-KEYWORD,openai,${ruleAi}`,
            `DOMAIN-SUFFIX,chatgpt.com,${ruleAi}`,
            `DOMAIN-SUFFIX,oaistatic.com,${ruleAi}`,
            `DOMAIN-SUFFIX,anthropic.com,${ruleAi}`,
            `DOMAIN-SUFFIX,claude.ai,${ruleAi}`,
            `DOMAIN-SUFFIX,gemini.google.com,${ruleAi}`,
          ]
        : []),
      // 规则集分流
      ...(isBuiltinRuleEnabled(ruleConfig, "reject")
        ? [`RULE-SET,reject,${ruleAds}`]
        : []),
      ...(isBuiltinRuleEnabled(ruleConfig, "apple")
        ? [`RULE-SET,icloud,${ruleApple}`, `RULE-SET,apple,${ruleApple}`]
        : []),
      ...(isBuiltinRuleEnabled(ruleConfig, "microsoft")
        ? [`RULE-SET,microsoft,${ruleMicrosoft}`]
        : []),
      ...(isBuiltinRuleEnabled(ruleConfig, "media")
        ? [`RULE-SET,proxymedia,${ruleMedia}`]
        : []),
      ...(isBuiltinRuleEnabled(ruleConfig, "telegram")
        ? [
            `RULE-SET,telegram,${ruleTelegram}`,
            `RULE-SET,telegramcidr,${ruleTelegram},no-resolve`,
          ]
        : []),
      ...(isBuiltinRuleEnabled(ruleConfig, "proxy")
        ? [`RULE-SET,proxy,${ruleSelect}`]
        : []),
      ...(isBuiltinRuleEnabled(ruleConfig, "direct")
        ? [
            `RULE-SET,lan,${ruleDirect}`,
            `RULE-SET,chinadomain,${ruleDirect}`,
            `RULE-SET,chinacompanyip,${ruleDirect},no-resolve`,
            `RULE-SET,chinaip,${ruleDirect},no-resolve`,
            `GEOIP,LAN,${ruleDirect},no-resolve`,
            `GEOIP,CN,${ruleDirect},no-resolve`,
          ]
        : []),
      `MATCH,${groupFallback}`,
    ],
  }

  const nodeRefs = options.nodeRefs ?? nodeNames.map((name) => ({ name }))
  if (options.ruleConfig?.enabled) {
    for (const [target, group] of Object.entries(
      options.ruleConfig.builtinPolicyOverrides
    )) {
      if (!group?.enabled) continue
      const name = clashTarget(target, options.ruleConfig)
      const nextGroup = buildClashPolicyGroup(
        group,
        nodeRefs,
        name,
        options.ruleConfig
      )
      const index = config["proxy-groups"].findIndex(
        (item) => item.name === name
      )
      if (index >= 0) config["proxy-groups"][index] = nextGroup
      else config["proxy-groups"].push(nextGroup)
    }
  }

  applyCustomRules(config, options.ruleConfig, nodeRefs)
  return config
}
