export const ACME_CA_PROVIDERS = ["letsencrypt", "zerossl", "custom"] as const
export type AcmeCaProvider = (typeof ACME_CA_PROVIDERS)[number]
export type NodeAcmeCaProvider = AcmeCaProvider | "inherit"

export const DEFAULT_ACME_CA_PROVIDER: AcmeCaProvider = "letsencrypt"

export const ACME_DNS_PROVIDERS = [
  "cloudflare",
  "duckdns",
  "gandi",
  "godaddy",
  "namedotcom",
  "vultr",
] as const
export type AcmeDnsProvider = (typeof ACME_DNS_PROVIDERS)[number]

export type AcmeDnsProviderField = {
  key: string
  label: string
  placeholder?: string
  secret?: boolean
  required?: boolean
}

export type ResolvedAcmeCa = {
  provider: AcmeCaProvider
  url: string | null
  yamlValue: string | null
  source: "node" | "global"
}

export const ACME_CA_PROVIDER_LABELS: Record<AcmeCaProvider, string> = {
  letsencrypt: "Let’s Encrypt",
  zerossl: "ZeroSSL",
  custom: "自定义 Directory URL",
}

export const NODE_ACME_CA_PROVIDER_LABELS: Record<NodeAcmeCaProvider, string> =
  {
    inherit: "继承全局默认",
    ...ACME_CA_PROVIDER_LABELS,
  }

export const ACME_DNS_PROVIDER_LABELS: Record<AcmeDnsProvider, string> = {
  cloudflare: "Cloudflare",
  duckdns: "Duck DNS",
  gandi: "Gandi.net",
  godaddy: "GoDaddy",
  namedotcom: "Name.com",
  vultr: "Vultr",
}

export const ACME_DNS_PROVIDER_FIELDS: Record<
  AcmeDnsProvider,
  AcmeDnsProviderField[]
> = {
  cloudflare: [
    {
      key: "cloudflare_api_token",
      label: "Cloudflare API Token",
      placeholder: "留空则使用全局 Cloudflare Token",
      secret: true,
      required: true,
    },
  ],
  duckdns: [
    {
      key: "duckdns_api_token",
      label: "Duck DNS API Token",
      secret: true,
      required: true,
    },
    {
      key: "duckdns_override_domain",
      label: "Override Domain",
      placeholder: "如 abc.example.com",
      required: false,
    },
  ],
  gandi: [
    {
      key: "gandi_api_token",
      label: "Gandi API Token",
      secret: true,
      required: true,
    },
  ],
  godaddy: [
    {
      key: "godaddy_api_token",
      label: "GoDaddy API Token",
      secret: true,
      required: true,
    },
  ],
  namedotcom: [
    {
      key: "namedotcom_token",
      label: "Name.com Token",
      secret: true,
      required: true,
    },
    {
      key: "namedotcom_user",
      label: "Name.com User",
      required: true,
    },
    {
      key: "namedotcom_server",
      label: "Name.com Server",
      placeholder: "api.name.com",
      required: false,
    },
  ],
  vultr: [
    {
      key: "vultr_api_token",
      label: "Vultr API Token",
      secret: true,
      required: true,
    },
  ],
}

export function isAcmeCaProvider(value: unknown): value is AcmeCaProvider {
  return (
    typeof value === "string" &&
    ACME_CA_PROVIDERS.includes(value as AcmeCaProvider)
  )
}

export function isNodeAcmeCaProvider(
  value: unknown
): value is NodeAcmeCaProvider {
  return value === "inherit" || isAcmeCaProvider(value)
}

export function isAcmeDnsProvider(value: unknown): value is AcmeDnsProvider {
  return (
    typeof value === "string" &&
    ACME_DNS_PROVIDERS.includes(value as AcmeDnsProvider)
  )
}

export function normalizeAcmeCaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  const raw = value.trim()
  if (!raw || raw.length > 2048 || /[\s\u0000-\u001F\u007F]/.test(raw)) {
    return null
  }

  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return url.toString()
  } catch {
    return null
  }
}

export function validateGlobalAcmeCaInput(params: {
  provider: unknown
  url: unknown
}):
  | { ok: true; provider: AcmeCaProvider; url: string }
  | { ok: false; message: string } {
  const provider =
    typeof params.provider === "string" && params.provider.trim()
      ? params.provider.trim()
      : DEFAULT_ACME_CA_PROVIDER

  if (!isAcmeCaProvider(provider)) {
    return {
      ok: false,
      message: "ACME CA 必须是 letsencrypt、zerossl 或 custom",
    }
  }

  const url = typeof params.url === "string" ? params.url.trim() : ""
  if (provider === "custom") {
    const normalizedUrl = normalizeAcmeCaUrl(url)
    if (!normalizedUrl) {
      return { ok: false, message: "自定义 ACME Directory URL 不合法" }
    }
    return { ok: true, provider, url: normalizedUrl }
  }

  return { ok: true, provider, url: "" }
}

export function validateNodeAcmeCaInput(params: {
  provider: unknown
  url: unknown
}):
  | { ok: true; provider: NodeAcmeCaProvider; url: string | null }
  | { ok: false; message: string } {
  const provider =
    typeof params.provider === "string" && params.provider.trim()
      ? params.provider.trim()
      : "inherit"

  if (!isNodeAcmeCaProvider(provider)) {
    return {
      ok: false,
      message: "节点 ACME CA 必须是 inherit、letsencrypt、zerossl 或 custom",
    }
  }

  if (provider === "custom") {
    const normalizedUrl = normalizeAcmeCaUrl(params.url)
    if (!normalizedUrl) {
      return { ok: false, message: "自定义 ACME Directory URL 不合法" }
    }
    return { ok: true, provider, url: normalizedUrl }
  }

  return { ok: true, provider, url: null }
}

export function resolveAcmeCa(params: {
  nodeProvider?: string | null
  nodeUrl?: string | null
  globalProvider?: string | null
  globalUrl?: string | null
}): ResolvedAcmeCa {
  const rawNodeProvider = params.nodeProvider?.trim() || "inherit"
  const nodeProvider = isNodeAcmeCaProvider(rawNodeProvider)
    ? rawNodeProvider
    : "inherit"

  if (nodeProvider !== "inherit") {
    const url =
      nodeProvider === "custom" ? normalizeAcmeCaUrl(params.nodeUrl) : null
    return {
      provider: nodeProvider,
      url,
      yamlValue:
        nodeProvider === "letsencrypt"
          ? null
          : nodeProvider === "custom"
            ? url
            : nodeProvider,
      source: "node",
    }
  }

  const rawGlobalProvider =
    params.globalProvider?.trim() || DEFAULT_ACME_CA_PROVIDER
  const globalProvider = isAcmeCaProvider(rawGlobalProvider)
    ? rawGlobalProvider
    : DEFAULT_ACME_CA_PROVIDER
  const url =
    globalProvider === "custom" ? normalizeAcmeCaUrl(params.globalUrl) : null

  return {
    provider: globalProvider,
    url,
    yamlValue:
      globalProvider === "letsencrypt"
        ? null
        : globalProvider === "custom"
          ? url
          : globalProvider,
    source: "global",
  }
}

export function normalizeAcmeDnsProvider(
  value: unknown
): AcmeDnsProvider | null {
  if (typeof value !== "string") return null
  const raw = value.trim()
  return isAcmeDnsProvider(raw) ? raw : null
}

export function normalizeAcmeDnsConfig(
  provider: AcmeDnsProvider | null,
  config: Record<string, string> | null | undefined
): Record<string, string> {
  if (!provider || !config) return {}

  const allowed = new Set(
    ACME_DNS_PROVIDER_FIELDS[provider].map((field) => field.key)
  )
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(config)) {
    if (!allowed.has(key)) continue
    const normalized = typeof value === "string" ? value.trim() : ""
    if (normalized && !/[\r\n\u0000]/.test(normalized)) out[key] = normalized
  }
  return out
}

export function validateAcmeDnsConfig(params: {
  provider: unknown
  config: unknown
  allowEmptyCloudflareToken?: boolean
}):
  | {
      ok: true
      provider: AcmeDnsProvider | null
      config: Record<string, string> | null
    }
  | { ok: false; message: string } {
  const provider = normalizeAcmeDnsProvider(params.provider)
  if (!provider) {
    const raw =
      typeof params.provider === "string" ? params.provider.trim() : ""
    if (raw) return { ok: false, message: "不支持的 ACME DNS 服务商" }
    return { ok: true, provider: null, config: null }
  }

  const rawConfig =
    params.config &&
    typeof params.config === "object" &&
    !Array.isArray(params.config)
      ? (params.config as Record<string, string>)
      : {}
  const config = normalizeAcmeDnsConfig(provider, rawConfig)

  for (const field of ACME_DNS_PROVIDER_FIELDS[provider]) {
    if (!field.required) continue
    if (
      provider === "cloudflare" &&
      field.key === "cloudflare_api_token" &&
      params.allowEmptyCloudflareToken
    ) {
      continue
    }
    if (!config[field.key]) {
      return { ok: false, message: `${field.label} 不能为空` }
    }
  }

  return {
    ok: true,
    provider,
    config: Object.keys(config).length > 0 ? config : null,
  }
}
