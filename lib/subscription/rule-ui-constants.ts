type SubscriptionRuleTarget = string

export const BUILTIN_SUBSCRIPTION_RULE_IDS = [
  "reject",
  "ai",
  "media",
  "telegram",
  "apple",
  "microsoft",
  "proxy",
  "direct",
] as const

export type BuiltinSubscriptionRuleId =
  (typeof BUILTIN_SUBSCRIPTION_RULE_IDS)[number]

export const DEFAULT_BUILTIN_RULE_TARGETS: Record<
  BuiltinSubscriptionRuleId,
  SubscriptionRuleTarget
> = {
  reject: "reject",
  ai: "ai",
  media: "media",
  telegram: "telegram",
  apple: "apple",
  microsoft: "microsoft",
  proxy: "proxy",
  direct: "direct",
}

export const BUILTIN_SUBSCRIPTION_RULE_LABELS: Record<
  BuiltinSubscriptionRuleId,
  { name: string; description: string }
> = {
  reject: { name: "广告拦截", description: "广告、追踪与恶意域名规则" },
  ai: { name: "AI 服务", description: "OpenAI / Claude / Gemini 等服务规则" },
  media: {
    name: "国际媒体",
    description: "YouTube / Netflix / Disney / Spotify 等规则",
  },
  telegram: { name: "Telegram", description: "Telegram 域名与 IP 规则" },
  apple: { name: "苹果服务", description: "Apple / iCloud 规则" },
  microsoft: { name: "微软服务", description: "Microsoft 规则" },
  proxy: { name: "代理规则", description: "默认代理域名规则" },
  direct: { name: "直连规则", description: "局域网、中国域名与中国 IP 规则" },
}

export const BUILTIN_SUBSCRIPTION_RULE_PREVIEW_LINES: Record<
  BuiltinSubscriptionRuleId,
  string[]
> = {
  reject: ["Clash: RULE-SET,reject", "sing-box: geosite-category-ads-all"],
  ai: [
    "DOMAIN-KEYWORD,openai",
    "DOMAIN-SUFFIX,chatgpt.com",
    "DOMAIN-SUFFIX,oaistatic.com",
    "DOMAIN-SUFFIX,anthropic.com",
    "DOMAIN-SUFFIX,claude.ai",
    "DOMAIN-SUFFIX,gemini.google.com",
    "sing-box: geosite-openai",
  ],
  media: [
    "Clash: RULE-SET,proxymedia",
    "sing-box: geosite-youtube",
    "sing-box: geosite-netflix",
    "sing-box: geosite-disney",
    "sing-box: geosite-spotify",
  ],
  telegram: [
    "Clash: RULE-SET,telegram",
    "Clash: RULE-SET,telegramcidr,no-resolve",
    "sing-box: geosite-telegram",
  ],
  apple: [
    "Clash: RULE-SET,icloud",
    "Clash: RULE-SET,apple",
    "sing-box: geosite-icloud",
    "sing-box: geosite-apple",
  ],
  microsoft: ["Clash: RULE-SET,microsoft", "sing-box: geosite-microsoft"],
  proxy: ["Clash: RULE-SET,proxy"],
  direct: [
    "Clash: RULE-SET,lan",
    "Clash: RULE-SET,chinadomain",
    "Clash: RULE-SET,chinacompanyip,no-resolve",
    "Clash: RULE-SET,chinaip,no-resolve",
    "Clash: GEOIP,LAN,no-resolve",
    "Clash: GEOIP,CN,no-resolve",
    "sing-box: geosite-cn",
    "sing-box: geoip-cn",
    "sing-box: ip_is_private",
  ],
}
