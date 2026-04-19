// Clash Meta (mihomo) 订阅模板 —— 标准档分流
// 规则集来源：ACL4SSR (https://github.com/ACL4SSR/ACL4SSR)
// AI 走内联 DOMAIN 规则（OpenAI/Anthropic/Gemini），省一个 rule-provider

import type { ClashHysteria2Proxy } from "./node-proxy"

const ACL4SSR_BASE =
  "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Providers/Ruleset"

// 代理组名字（带 emoji 便于客户端识别）
const GROUP_SELECT = "🚀 节点选择"
const GROUP_AUTO = "♻️ 自动选择"
const GROUP_AI = "🤖 AI"
const GROUP_MEDIA = "📺 国际媒体"
const GROUP_TELEGRAM = "📲 Telegram"
const GROUP_APPLE = "🍎 苹果服务"
const GROUP_MICROSOFT = "Ⓜ️ 微软服务"
const GROUP_ADS = "🛑 广告拦截"
const GROUP_FALLBACK = "🐟 漏网之鱼"

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

export function buildClashBase(nodeNames: string[]): ClashConfig {
  // url-test 必须至少有一个成员，空节点列表时会在调用处被提前 404 拦截
  const autoPool = nodeNames.length > 0 ? nodeNames : ["DIRECT"]
  const selectPool = [GROUP_AUTO, ...nodeNames, "DIRECT"]
  const proxyPool = [GROUP_SELECT, GROUP_AUTO, ...nodeNames]
  const directFirst = ["DIRECT", GROUP_SELECT, ...nodeNames]

  return {
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
      "proxy-server-nameserver": [
        "tls://dns.alidns.com",
        "tls://dot.pub",
      ],
      // 国内域名走 DoT 直连加密
      nameserver: ["tls://dns.alidns.com", "tls://dot.pub"],
      // 境外域名走 DoH 并**通过代理**出去，避免明文 UDP 53 泄漏查询内容
      fallback: [
        `https://1.1.1.1/dns-query#${GROUP_SELECT}`,
        `https://dns.google/dns-query#${GROUP_SELECT}`,
      ],
      "fallback-filter": {
        geoip: true,
        "geoip-code": "CN",
      },
    },
    proxies: [],
    "proxy-groups": [
      { name: GROUP_SELECT, type: "select", proxies: selectPool },
      {
        name: GROUP_AUTO,
        type: "url-test",
        proxies: autoPool,
        url: "http://www.gstatic.com/generate_204",
        interval: 300,
        tolerance: 50,
      },
      { name: GROUP_AI, type: "select", proxies: proxyPool },
      { name: GROUP_MEDIA, type: "select", proxies: proxyPool },
      { name: GROUP_TELEGRAM, type: "select", proxies: proxyPool },
      { name: GROUP_APPLE, type: "select", proxies: directFirst },
      { name: GROUP_MICROSOFT, type: "select", proxies: directFirst },
      {
        name: GROUP_ADS,
        type: "select",
        proxies: ["REJECT", "DIRECT", GROUP_SELECT],
      },
      {
        name: GROUP_FALLBACK,
        type: "select",
        proxies: [GROUP_SELECT, "DIRECT", ...nodeNames],
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
      `DOMAIN-KEYWORD,openai,${GROUP_AI}`,
      `DOMAIN-SUFFIX,chatgpt.com,${GROUP_AI}`,
      `DOMAIN-SUFFIX,oaistatic.com,${GROUP_AI}`,
      `DOMAIN-SUFFIX,anthropic.com,${GROUP_AI}`,
      `DOMAIN-SUFFIX,claude.ai,${GROUP_AI}`,
      `DOMAIN-SUFFIX,gemini.google.com,${GROUP_AI}`,
      // 规则集分流
      `RULE-SET,reject,${GROUP_ADS}`,
      `RULE-SET,icloud,${GROUP_APPLE}`,
      `RULE-SET,apple,${GROUP_APPLE}`,
      `RULE-SET,microsoft,${GROUP_MICROSOFT}`,
      `RULE-SET,proxymedia,${GROUP_MEDIA}`,
      `RULE-SET,telegram,${GROUP_TELEGRAM}`,
      `RULE-SET,telegramcidr,${GROUP_TELEGRAM},no-resolve`,
      `RULE-SET,proxy,${GROUP_SELECT}`,
      "RULE-SET,lan,DIRECT",
      "RULE-SET,chinadomain,DIRECT",
      "RULE-SET,chinacompanyip,DIRECT,no-resolve",
      "RULE-SET,chinaip,DIRECT,no-resolve",
      "GEOIP,LAN,DIRECT,no-resolve",
      "GEOIP,CN,DIRECT,no-resolve",
      `MATCH,${GROUP_FALLBACK}`,
    ],
  }
}
