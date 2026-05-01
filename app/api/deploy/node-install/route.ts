import { randomBytes } from "node:crypto"

import { NextResponse } from "next/server"

type InstallParams = {
  panelUrl: string
  authPath: string
  port: number
  portHopping: string | null
  certPath: string
  keyPath: string
  statsSecret: string
  obfs: "" | "salamander"
  obfsPassword: string | null
  intervalSeconds: number
  agentBundleUrl: string
  certMode: "self-signed" | "acme-http" | "acme-dns" | "acme" | "custom"
  acmeDomains: string[]
  acmeEmail: string
  acmeDnsProvider: string
  acmeDnsConfig: Record<string, string>
  masqueradeType: string
  masqueradeConfig: Record<string, unknown>
}

function errorJson(code: string, message: string, status = 400) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

function yamlString(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function parseBaseUrl(input: string): string | null {
  try {
    const url = new URL(input)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

function parsePositiveInt(
  input: string,
  min: number,
  max: number
): number | null {
  if (!/^\d+$/.test(input)) return null
  const n = Number(input)
  if (!Number.isInteger(n) || n < min || n > max) return null
  return n
}

function parsePayloadQuery(payload: string): URLSearchParams | null {
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8")
    if (!decoded || /[\r\n]/.test(decoded)) return null
    return new URLSearchParams(decoded)
  } catch {
    return null
  }
}

// 根据 certMode 构建 Hy2 config 中的 TLS/ACME 段
function buildTlsOrAcmeBlock(params: InstallParams): string {
  const domainsYaml = params.acmeDomains
    .map((d) => `    - ${yamlString(d)}`)
    .join("\n")

  if (params.certMode === "acme-http") {
    return [
      "acme:",
      `  domains:`,
      domainsYaml ||
        `    - ${yamlString(params.acmeDomains[0] || "example.com")}`,
      params.acmeEmail ? `  email: ${yamlString(params.acmeEmail)}` : null,
      "  type: http",
    ]
      .filter(Boolean)
      .join("\n")
  }

  if (params.certMode === "acme-dns") {
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
      `  domains:`,
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
function buildMasqueradeBlock(params: InstallParams): string | null {
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

function buildScript(params: InstallParams) {
  const authUrl = `${params.panelUrl}/api/node/auth/${encodeURIComponent(params.authPath)}`
  const listenValue = (() => {
    if (!params.portHopping) return `:${params.port}`
    if (/^\d+-\d+$/.test(params.portHopping)) return `:${params.portHopping}`
    return `:${params.port}`
  })()

  const portHoppingWarn =
    params.portHopping && !/^\d+-\d+$/.test(params.portHopping)
      ? `检测到端口跳跃为 "${params.portHopping}"。当前脚本仅自动支持连续端口范围（如 20000-50000）；已回退为单端口 ${params.port}。`
      : null

  const tlsOrAcme = buildTlsOrAcmeBlock(params)

  const hy2Yaml = [
    "listen: __H2O_LISTEN__",
    "",
    tlsOrAcme,
    "",
    "auth:",
    "  type: http",
    "  http:",
    `    url: ${yamlString(authUrl)}`,
    "    insecure: false",
    "",
    "trafficStats:",
    "  listen: :9999",
    `  secret: ${yamlString(params.statsSecret)}`,
    buildMasqueradeBlock(params),
    params.obfs === "salamander" && params.obfsPassword
      ? [
          "",
          "obfs:",
          "  type: salamander",
          "  salamander:",
          `    password: ${yamlString(params.obfsPassword)}`,
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n")

  const agentConfig = JSON.stringify(
    {
      h2o_url: params.panelUrl,
      auth_path: params.authPath,
      hysteria_stats_url: "http://127.0.0.1:9999",
      hysteria_stats_secret: params.statsSecret,
      interval_seconds: params.intervalSeconds,
    },
    null,
    2
  )

  // self-signed 模式需要 openssl 生成证书；acme/custom 模式不需要
  const needsSelfSignedCert = params.certMode === "self-signed"

  const lines: string[] = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    `PANEL_URL=${shellSingleQuote(params.panelUrl)}`,
    `AUTH_PATH=${shellSingleQuote(params.authPath)}`,
    `CERT_PATH=${shellSingleQuote(params.certPath)}`,
    `KEY_PATH=${shellSingleQuote(params.keyPath)}`,
    `AGENT_BUNDLE_URL=${shellSingleQuote(params.agentBundleUrl)}`,
    `HY2_LISTEN=${shellSingleQuote(listenValue)}`,
    `HY2_FALLBACK_LISTEN=${shellSingleQuote(`:${params.port}`)}`,
    "",
    'echo "[h2o] 开始一键部署 hy2 + agent"',
    "",
    'if [[ "${EUID}" -ne 0 ]]; then',
    '  echo "请使用 root 执行" >&2',
    "  exit 1",
    "fi",
    "",
    "for cmd in curl tar systemctl; do",
    '  if ! command -v "$cmd" >/dev/null 2>&1; then',
    '    echo "缺少依赖: $cmd" >&2',
    "    exit 1",
    "  fi",
    "done",
    "",
    'if [[ "$HY2_LISTEN" == *"-"* ]]; then',
    "  if ! command -v nft >/dev/null 2>&1 && ! command -v iptables >/dev/null 2>&1; then",
    '    echo "[h2o] 检测到系统缺少 nft/iptables，端口跳跃不可用，自动回退到单端口监听: $HY2_FALLBACK_LISTEN"',
    '    HY2_LISTEN="$HY2_FALLBACK_LISTEN"',
    "  fi",
    "fi",
    "",
  ]

  if (needsSelfSignedCert) {
    lines.push(
      "HY2_USER=$(awk -F= '/^User=/{print $2; exit}' /etc/systemd/system/hysteria-server.service 2>/dev/null || true)",
      'if [[ -z "$HY2_USER" ]]; then HY2_USER="hysteria"; fi',
      'if [[ ! -f "$CERT_PATH" || ! -f "$KEY_PATH" ]]; then',
      "  if ! command -v openssl >/dev/null 2>&1; then",
      '    echo "缺少依赖: openssl（证书缺失时用于自动生成）" >&2',
      "    exit 1",
      "  fi",
      '  echo "[h2o] 证书或私钥不存在，自动生成自签证书"',
      '  mkdir -p "$(dirname "$CERT_PATH")" "$(dirname "$KEY_PATH")"',
      '  openssl req -x509 -nodes -newkey rsa:2048 -keyout "$KEY_PATH" -out "$CERT_PATH" -days 3650 -subj "/CN=h2o-hy2"',
      "fi",
      'if id "$HY2_USER" >/dev/null 2>&1; then',
      '  chown root:"$HY2_USER" "$KEY_PATH" "$CERT_PATH" 2>/dev/null || true',
      '  chmod 0640 "$KEY_PATH" || true',
      "else",
      '  chmod 0644 "$KEY_PATH" || true',
      "fi",
      'chmod 0644 "$CERT_PATH" || true',
      ""
    )
  } else if (params.certMode === "custom") {
    lines.push(
      'if [[ ! -f "$CERT_PATH" ]]; then',
      '  echo "[h2o] 警告：证书文件不存在: $CERT_PATH" >&2',
      "fi",
      'if [[ ! -f "$KEY_PATH" ]]; then',
      '  echo "[h2o] 警告：私钥文件不存在: $KEY_PATH" >&2',
      "fi",
      ""
    )
  }
  // acme 模式：不需要处理证书文件，Hy2 会自动申请

  lines.push(
    'echo "[h2o] 安装/更新 hysteria"',
    "curl -fsSL https://get.hy2.sh/ | bash",
    "",
    'echo "[h2o] 写入 /etc/hysteria/config.yaml"',
    "mkdir -p /etc/hysteria",
    "cat > /etc/hysteria/config.yaml <<'H2O_HY2_CONFIG'",
    hy2Yaml,
    "H2O_HY2_CONFIG",
    'sed -i "s|__H2O_LISTEN__|$HY2_LISTEN|g" /etc/hysteria/config.yaml',
    "",
    'echo "[h2o] 重启 hysteria-server"',
    "systemctl enable hysteria-server >/dev/null 2>&1 || true",
    "systemctl restart hysteria-server",
    "systemctl --no-pager --full status hysteria-server | sed -n '1,12p' || true",
    "",
    'echo "[h2o] 下载并安装 h2o-agent"',
    "WORKDIR=$(mktemp -d /tmp/h2o-node-install.XXXXXX)",
    "trap 'rm -rf \"$WORKDIR\"' EXIT",
    'curl -fsSL "$AGENT_BUNDLE_URL" -o "$WORKDIR/h2o-agent-bundle.tar.gz"',
    'tar xzf "$WORKDIR/h2o-agent-bundle.tar.gz" -C "$WORKDIR"',
    'bash "$WORKDIR/install.sh"',
    "",
    'echo "[h2o] 写入 /etc/h2o-agent/config.json"',
    "mkdir -p /etc/h2o-agent",
    "cat > /etc/h2o-agent/config.json <<'H2O_AGENT_CONFIG'",
    agentConfig,
    "H2O_AGENT_CONFIG",
    "if id h2o-agent >/dev/null 2>&1; then",
    "  chown root:h2o-agent /etc/h2o-agent/config.json || true",
    "  chmod 0640 /etc/h2o-agent/config.json || true",
    "fi",
    "",
    'echo "[h2o] 重启 h2o-agent"',
    "systemctl enable h2o-agent >/dev/null 2>&1 || true",
    "systemctl restart h2o-agent",
    "systemctl --no-pager --full status h2o-agent | sed -n '1,12p' || true",
    "",
    `echo "面板地址: ${params.panelUrl}"`,
    `echo "节点认证路径: /api/node/auth/${params.authPath}"`,
    'echo "查看 agent 日志: journalctl -u h2o-agent -f"'
  )

  if (portHoppingWarn) {
    lines.splice(
      lines.length - 3,
      0,
      `echo ${shellSingleQuote(`[h2o] 警告：${portHoppingWarn}`)}`
    )
  }

  lines.push("", 'echo "[h2o] 部署完成"')

  return `${lines.join("\n")}\n`
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const inputQuery = url.searchParams

  const payload = inputQuery.get("payload")?.trim() ?? ""
  const query = payload ? parsePayloadQuery(payload) : inputQuery
  if (!query) {
    return errorJson(
      "INVALID_PAYLOAD",
      "payload 不合法（必须为 base64url 编码的查询字符串）"
    )
  }

  const requestBase = `${url.protocol}//${url.host}`
  const panelUrlRaw = query.get("panel_url")?.trim() || requestBase
  const panelUrl = parseBaseUrl(panelUrlRaw)
  if (!panelUrl) {
    return errorJson("INVALID_PANEL_URL", "panel_url 不合法")
  }

  const authPath = query.get("auth_path")?.trim() ?? ""
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(authPath)) {
    return errorJson(
      "INVALID_AUTH_PATH",
      "auth_path 不合法（仅允许字母数字下划线短横线，长度 8~128）"
    )
  }

  const portRaw = query.get("port")?.trim() ?? ""
  const port = parsePositiveInt(portRaw, 1, 65535)
  if (port == null) {
    return errorJson("INVALID_PORT", "port 不合法")
  }

  const portHoppingRaw = query.get("port_hopping")?.trim() ?? ""
  const portHopping = portHoppingRaw.length > 0 ? portHoppingRaw : null
  if (portHopping && !/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(portHopping)) {
    return errorJson("INVALID_PORT_HOPPING", "port_hopping 格式不合法")
  }

  const certPath = query.get("cert_path")?.trim() || "/etc/hysteria/server.crt"
  const keyPath = query.get("key_path")?.trim() || "/etc/hysteria/server.key"
  if (!certPath.startsWith("/") || !keyPath.startsWith("/")) {
    return errorJson("INVALID_TLS_PATH", "cert_path 与 key_path 必须是绝对路径")
  }

  const statsSecret =
    query.get("stats_secret")?.trim() || randomBytes(24).toString("hex")
  if (
    statsSecret.length < 8 ||
    statsSecret.length > 256 ||
    /[\r\n]/.test(statsSecret)
  ) {
    return errorJson(
      "INVALID_STATS_SECRET",
      "stats_secret 不合法（长度 8~256，且不能包含换行）"
    )
  }

  const obfsRaw = query.get("obfs")?.trim() ?? ""
  if (obfsRaw !== "" && obfsRaw !== "salamander") {
    return errorJson("UNSUPPORTED_OBFS", "当前仅支持 obfs=salamander")
  }
  const obfs = obfsRaw as "" | "salamander"

  const obfsPasswordRaw = query.get("obfs_password")?.trim() ?? ""
  const obfsPassword = obfsPasswordRaw.length > 0 ? obfsPasswordRaw : null
  if (obfs === "salamander" && !obfsPassword) {
    return errorJson(
      "INVALID_OBFS_PASSWORD",
      "obfs=salamander 时必须提供 obfs_password"
    )
  }

  const intervalSeconds = 120

  const agentBundleUrlRaw = query.get("agent_bundle_url")?.trim() ?? ""
  const agentBundleUrl = parseBaseUrl(agentBundleUrlRaw)
    ? agentBundleUrlRaw
    : null
  if (!agentBundleUrl) {
    return errorJson("INVALID_AGENT_BUNDLE_URL", "agent_bundle_url 不合法")
  }

  // 证书模式解析（兼容旧值 acme → acme-dns）
  const certModeRaw = query.get("cert_mode")?.trim() ?? "self-signed"
  const certMode = (
    ["self-signed", "acme-http", "acme-dns", "acme", "custom"].includes(
      certModeRaw
    )
      ? certModeRaw === "acme"
        ? "acme-dns"
        : certModeRaw
      : "self-signed"
  ) as "self-signed" | "acme-http" | "acme-dns" | "custom"

  // ACME 配置解析
  let acmeDomains: string[] = []
  const acmeDomainsRaw = query.get("acme_domains")?.trim() ?? ""
  if (acmeDomainsRaw) {
    try {
      const parsed = JSON.parse(acmeDomainsRaw)
      if (Array.isArray(parsed))
        acmeDomains = parsed.filter((d) => typeof d === "string")
    } catch {
      // 忽略
    }
  }

  const acmeEmail = query.get("acme_email")?.trim() ?? ""
  const acmeDnsProvider = query.get("acme_dns_provider")?.trim() ?? ""

  let acmeDnsConfig: Record<string, string> = {}
  const acmeDnsConfigRaw = query.get("acme_dns_config")?.trim() ?? ""
  if (acmeDnsConfigRaw) {
    try {
      const parsed = JSON.parse(acmeDnsConfigRaw)
      if (parsed && typeof parsed === "object") acmeDnsConfig = parsed
    } catch {
      // 忽略
    }
  }

  const masqueradeType = query.get("masquerade_type")?.trim() || "string"

  let masqueradeConfig: Record<string, unknown> = {}
  const masqueradeConfigRaw = query.get("masquerade_config")?.trim() ?? ""
  if (masqueradeConfigRaw) {
    try {
      const parsed = JSON.parse(masqueradeConfigRaw)
      if (parsed && typeof parsed === "object") masqueradeConfig = parsed
    } catch {
      // 忽略
    }
  }

  const script = buildScript({
    panelUrl,
    authPath,
    port,
    portHopping,
    certPath,
    keyPath,
    statsSecret,
    obfs,
    obfsPassword,
    intervalSeconds,
    agentBundleUrl,
    certMode,
    acmeDomains,
    acmeEmail,
    acmeDnsProvider,
    acmeDnsConfig,
    masqueradeType,
    masqueradeConfig,
  })

  return new NextResponse(script, {
    status: 200,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
