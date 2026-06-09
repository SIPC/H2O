import { createHash } from "node:crypto"

import { resolveGeckoPacketSizes } from "@/lib/hysteria-obfs"

export type HysteriaCertMode =
  | "self-signed"
  | "acme-http"
  | "acme-dns"
  | "acme"
  | "custom"

export type HysteriaServerConfigInput = {
  panelUrl: string
  authPath: string
  port: number
  portHopping: string | null
  certPath: string
  keyPath: string
  statsSecret: string
  obfs: string | null
  obfsPassword: string | null
  obfsMinPacketSize?: number | null
  obfsMaxPacketSize?: number | null
  certMode: HysteriaCertMode | string
  acmeDomains: string[]
  acmeEmail: string
  acmeDnsProvider: string | null
  acmeDnsConfig: Record<string, string>
  masqueradeType: string | null
  masqueradeConfig: Record<string, unknown>
  serverBandwidthUpMbps?: number | null
  serverBandwidthDownMbps?: number | null
  ignoreClientBandwidth?: boolean
  quicInitStreamReceiveWindow?: number | null
  quicMaxStreamReceiveWindow?: number | null
  quicInitConnReceiveWindow?: number | null
  quicMaxConnReceiveWindow?: number | null
  quicMaxIdleTimeoutSeconds?: number | null
  quicMaxIncomingStreams?: number | null
  quicDisablePathMtuDiscovery?: boolean
  congestionType?: string | null
  congestionBbrProfile?: string | null
  outboundsBlock?: string | null
  aclBlock?: string | null
}

export function yamlString(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

export function normalizeCertMode(input: string | null | undefined) {
  if (input === "acme") return "acme-dns"
  if (
    input === "self-signed" ||
    input === "acme-http" ||
    input === "acme-dns" ||
    input === "custom"
  ) {
    return input
  }
  return "self-signed"
}

export function buildHy2ListenValue(params: {
  port: number
  portHopping: string | null
}) {
  if (!params.portHopping) return `:${params.port}`
  if (/^\d+-\d+$/.test(params.portHopping)) return `:${params.portHopping}`
  return `:${params.port}`
}

export function getPortHoppingFallbackWarning(params: {
  port: number
  portHopping: string | null
}) {
  if (!params.portHopping || /^\d+-\d+$/.test(params.portHopping)) return null
  return `检测到端口跳跃为 "${params.portHopping}"。当前脚本仅自动支持连续端口范围（如 20000-50000）；已回退为单端口 ${params.port}。`
}

// 根据 certMode 构建 Hy2 config 中的 TLS/ACME 段
export function buildTlsOrAcmeBlock(params: HysteriaServerConfigInput): string {
  const certMode = normalizeCertMode(params.certMode)
  const domainsYaml = params.acmeDomains
    .map((d) => `    - ${yamlString(d)}`)
    .join("\n")

  if (certMode === "acme-http") {
    return [
      "acme:",
      "  domains:",
      domainsYaml ||
        `    - ${yamlString(params.acmeDomains[0] || "example.com")}`,
      params.acmeEmail ? `  email: ${yamlString(params.acmeEmail)}` : null,
      "  type: http",
    ]
      .filter(Boolean)
      .join("\n")
  }

  if (certMode === "acme-dns") {
    let dnsBlock = ""
    if (
      params.acmeDnsProvider === "cloudflare" &&
      params.acmeDnsConfig.cloudflare_api_token
    ) {
      dnsBlock = [
        "  dns:",
        "    name: cloudflare",
        "    config:",
        `      cloudflare_api_token: ${yamlString(params.acmeDnsConfig.cloudflare_api_token)}`,
      ].join("\n")
    }

    return [
      "acme:",
      "  domains:",
      domainsYaml ||
        `    - ${yamlString(`*.${params.acmeDomains[0] || "example.com"}`)}`,
      params.acmeEmail ? `  email: ${yamlString(params.acmeEmail)}` : null,
      "  type: dns",
      dnsBlock || null,
    ]
      .filter(Boolean)
      .join("\n")
  }

  // self-signed 或 custom：使用 TLS 证书路径
  return [
    "tls:",
    `  cert: ${yamlString(params.certPath)}`,
    `  key: ${yamlString(params.keyPath)}`,
  ].join("\n")
}

// 根据 masqueradeType 和 masqueradeConfig 构建伪装配置段
export function buildMasqueradeBlock(
  params: HysteriaServerConfigInput
): string | null {
  // none: 不生成 masquerade 段
  if (params.masqueradeType === "none") return null

  const cfg = params.masqueradeConfig
  const mType = params.masqueradeType || "string"

  // string 模式（默认）
  if (mType === "string") {
    const content = typeof cfg.content === "string" ? cfg.content : "ok"
    const statusCode = typeof cfg.statusCode === "number" ? cfg.statusCode : 200
    const headers =
      cfg.headers && typeof cfg.headers === "object"
        ? (cfg.headers as Record<string, string>)
        : { "content-type": "text/plain; charset=utf-8" }

    const headerLines = Object.entries(headers)
      .map(([k, v]) => `      ${yamlString(k)}: ${yamlString(v)}`)
      .join("\n")

    const lines = [
      "masquerade:",
      "  type: string",
      "  string:",
      `    content: ${yamlString(content)}`,
      headerLines ? `    headers:\n${headerLines}` : null,
      `    statusCode: ${statusCode}`,
    ]
    return lines.filter(Boolean).join("\n")
  }

  // proxy 模式
  if (mType === "proxy") {
    const url = typeof cfg.url === "string" ? cfg.url : ""
    if (!url) return null
    const lines = [
      "masquerade:",
      "  type: proxy",
      "  proxy:",
      `    url: ${yamlString(url)}`,
      cfg.rewriteHost ? "    rewriteHost: true" : null,
      cfg.insecure ? "    insecure: true" : null,
      cfg.xForwarded ? "    xForwarded: true" : null,
    ]
    return lines.filter(Boolean).join("\n")
  }

  // file 模式
  if (mType === "file") {
    const dir = typeof cfg.dir === "string" ? cfg.dir : "/www/masq"
    const lines = [
      "masquerade:",
      "  type: file",
      "  file:",
      `    dir: ${yamlString(dir)}`,
    ]
    return lines.filter(Boolean).join("\n")
  }

  // 未知类型，回退到默认 string
  return buildMasqueradeBlock({
    ...params,
    masqueradeType: "string",
    masqueradeConfig: {},
  })
}

function positiveInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null
}

function buildQuicBlock(params: HysteriaServerConfigInput) {
  const lines: string[] = []
  const addInt = (key: string, value: number | null | undefined) => {
    const n = positiveInteger(value)
    if (n != null) lines.push(`  ${key}: ${n}`)
  }

  addInt("initStreamReceiveWindow", params.quicInitStreamReceiveWindow)
  addInt("maxStreamReceiveWindow", params.quicMaxStreamReceiveWindow)
  addInt("initConnReceiveWindow", params.quicInitConnReceiveWindow)
  addInt("maxConnReceiveWindow", params.quicMaxConnReceiveWindow)

  const maxIdleTimeout = positiveInteger(params.quicMaxIdleTimeoutSeconds)
  if (maxIdleTimeout != null) {
    lines.push(`  maxIdleTimeout: ${maxIdleTimeout}s`)
  }

  addInt("maxIncomingStreams", params.quicMaxIncomingStreams)

  if (params.quicDisablePathMtuDiscovery) {
    lines.push("  disablePathMTUDiscovery: true")
  }

  if (lines.length === 0) return null
  return ["quic:", ...lines].join("\n")
}

function buildBandwidthBlock(params: HysteriaServerConfigInput) {
  const up = positiveInteger(params.serverBandwidthUpMbps) ?? 0
  const down = positiveInteger(params.serverBandwidthDownMbps) ?? 0
  if (up <= 0 && down <= 0) return null

  return ["bandwidth:", `  up: ${up} mbps`, `  down: ${down} mbps`].join("\n")
}

function buildCongestionBlock(params: HysteriaServerConfigInput) {
  const type = params.congestionType
  if (type !== "bbr" && type !== "reno") return null

  const lines = ["congestion:", `  type: ${type}`]
  if (
    type === "bbr" &&
    (params.congestionBbrProfile === "standard" ||
      params.congestionBbrProfile === "conservative" ||
      params.congestionBbrProfile === "aggressive")
  ) {
    lines.push(`  bbrProfile: ${params.congestionBbrProfile}`)
  }

  return lines.join("\n")
}

function buildObfsBlock(params: HysteriaServerConfigInput) {
  if (!params.obfsPassword) return ""

  if (params.obfs === "salamander") {
    return [
      "",
      "obfs:",
      "  type: salamander",
      "  salamander:",
      `    password: ${yamlString(params.obfsPassword)}`,
    ].join("\n")
  }

  if (params.obfs === "gecko") {
    const packetSizes = resolveGeckoPacketSizes({
      minPacketSize: params.obfsMinPacketSize,
      maxPacketSize: params.obfsMaxPacketSize,
    })
    return [
      "",
      "obfs:",
      "  type: gecko",
      "  gecko:",
      `    password: ${yamlString(params.obfsPassword)}`,
      `    minPacketSize: ${packetSizes.minPacketSize}`,
      `    maxPacketSize: ${packetSizes.maxPacketSize}`,
    ].join("\n")
  }

  return ""
}

export function buildHysteriaServerConfig(params: HysteriaServerConfigInput) {
  const authUrl = `${params.panelUrl}/api/node/auth/${encodeURIComponent(params.authPath)}`
  const tlsOrAcme = buildTlsOrAcmeBlock(params)
  const listenValue = buildHy2ListenValue({
    port: params.port,
    portHopping: params.portHopping,
  })

  return [
    `listen: ${yamlString(listenValue)}`,
    "",
    tlsOrAcme,
    "",
    buildQuicBlock(params),
    buildBandwidthBlock(params),
    params.ignoreClientBandwidth ? "ignoreClientBandwidth: true" : null,
    buildCongestionBlock(params),
    "",
    "auth:",
    "  type: http",
    "  http:",
    `    url: ${yamlString(authUrl)}`,
    "    insecure: false",
    "",
    "trafficStats:",
    "  listen: 127.0.0.1:9999",
    `  secret: ${yamlString(params.statsSecret)}`,
    params.outboundsBlock,
    params.aclBlock,
    buildMasqueradeBlock(params),
    buildObfsBlock(params),
  ]
    .filter(Boolean)
    .join("\n")
}

export function hashHysteriaServerConfig(config: string) {
  return createHash("sha256").update(config, "utf8").digest("hex")
}
