import { randomBytes } from "node:crypto"

import { NextResponse } from "next/server"

import {
  buildHysteriaServerConfig,
  buildHy2ListenValue,
  getPortHoppingFallbackWarning,
  normalizeCertMode,
  yamlString,
} from "@/lib/hysteria-server-config"

type InstallParams = {
  panelUrl: string
  authPath: string
  port: number
  portHopping: string | null
  certPath: string
  keyPath: string
  statsSecret: string
  agentSecret: string
  obfs: "" | "salamander"
  obfsPassword: string | null
  intervalSeconds: number
  agentAutoUpdateEnabled: boolean
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

function buildScript(params: InstallParams) {
  const listenValue = buildHy2ListenValue({
    port: params.port,
    portHopping: params.portHopping,
  })
  const portHoppingWarn = getPortHoppingFallbackWarning({
    port: params.port,
    portHopping: params.portHopping,
  })

  const hy2Yaml = buildHysteriaServerConfig(params).replace(
    `listen: ${yamlString(listenValue)}`,
    "listen: __H2O_LISTEN__"
  )

  const agentConfig = JSON.stringify(
    {
      h2o_url: params.panelUrl,
      auth_path: params.authPath,
      agent_secret: params.agentSecret,
      control_enabled: true,
      hysteria_stats_url: "http://127.0.0.1:9999",
      hysteria_stats_secret: params.statsSecret,
      interval_seconds: params.intervalSeconds,
      auto_update_enabled: params.agentAutoUpdateEnabled,
      hysteria_config_path: "/etc/hysteria/config.yaml",
      hysteria_service_name: "hysteria-server",
      agent_config_path: "/etc/h2o-agent/config.json",
    },
    null,
    2
  )

  // self-signed 模式需要 openssl 生成证书；acme/custom 模式不需要
  const needsSelfSignedCert = params.certMode === "self-signed"

  const systemdAgentService = [
    "[Unit]",
    "Description=H2O Agent (Hysteria2 traffic reporter)",
    "After=network-online.target hysteria-server.service",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    "ExecStart=/usr/local/bin/h2o-agent -c /etc/h2o-agent/config.json",
    "Restart=always",
    "RestartSec=10",
    "NoNewPrivileges=yes",
    "ProtectHome=yes",
    "PrivateTmp=yes",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
  ].join("\n")

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
    `AGENT_AUTO_UPDATE_ENABLED=${shellSingleQuote(params.agentAutoUpdateEnabled ? "true" : "false")}`,
    "",
    "if [[ -t 1 ]] && command -v tput >/dev/null 2>&1; then",
    "  C_RESET=$(tput sgr0 || true)",
    "  C_BLUE=$(tput setaf 4 || true)",
    "  C_GREEN=$(tput setaf 2 || true)",
    "  C_YELLOW=$(tput setaf 3 || true)",
    "  C_RED=$(tput setaf 1 || true)",
    "  C_BOLD=$(tput bold || true)",
    "else",
    "  C_RESET=; C_BLUE=; C_GREEN=; C_YELLOW=; C_RED=; C_BOLD=",
    "fi",
    "",
    "log_time() { date '+%H:%M:%S'; }",
    'log_info() { printf \'%s %bINFO%b %s\\n\' "[$(log_time)]" "$C_BLUE" "$C_RESET" "$*"; }',
    'log_step() { printf \'\\n%s %b==>%b %b%s%b\\n\' "[$(log_time)]" "$C_BLUE" "$C_RESET" "$C_BOLD" "$*" "$C_RESET"; }',
    'log_ok() { printf \'%s %bOK%b %s\\n\' "[$(log_time)]" "$C_GREEN" "$C_RESET" "$*"; }',
    'log_warn() { printf \'%s %bWARN%b %s\\n\' "[$(log_time)]" "$C_YELLOW" "$C_RESET" "$*"; }',
    'log_error() { printf \'%s %bERR%b %s\\n\' "[$(log_time)]" "$C_RED" "$C_RESET" "$*" >&2; }',
    "",
    "print_header() {",
    '  echo "========================================"',
    '  echo " H2O 节点管理脚本"',
    '  echo "========================================"',
    `  echo "面板地址: ${params.panelUrl}"`,
    `  echo "节点认证路径: /api/node/auth/${params.authPath}"`,
    '  echo ""',
    "}",
    "",
    "require_root() {",
    '  if [[ "${EUID}" -ne 0 ]]; then',
    '    log_error "请使用 root 执行"',
    "    exit 1",
    "  fi",
    "}",
    "",
    "has_systemd() { command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; }",
    "",
    "has_openrc() { command -v rc-service >/dev/null 2>&1 && command -v rc-update >/dev/null 2>&1; }",
    "",
    "is_alpine() { [[ -f /etc/alpine-release ]]; }",
    "",
    "check_service_manager() {",
    "  if has_systemd || has_openrc; then",
    "    return 0",
    "  fi",
    '  log_error "缺少支持的服务管理器：需要 systemd 或 OpenRC"',
    "  exit 1",
    "}",
    "",
    "ensure_command() {",
    '  local cmd="$1"',
    '  if command -v "$cmd" >/dev/null 2>&1; then',
    "    return 0",
    "  fi",
    "  if is_alpine && command -v apk >/dev/null 2>&1; then",
    '    log_info "安装缺失依赖: $cmd"',
    '    apk add --no-cache "$cmd"',
    "    return 0",
    "  fi",
    '  log_error "缺少依赖: $cmd"',
    "  exit 1",
    "}",
    "",
    "check_install_dependencies() {",
    "  check_service_manager",
    "  ensure_command curl",
    "  ensure_command tar",
    "}",
    "",
    "ensure_system_user() {",
    '  local name="$1"',
    '  if id "$name" >/dev/null 2>&1; then',
    "    return 0",
    "  fi",
    "  if command -v useradd >/dev/null 2>&1; then",
    '    useradd --system --no-create-home --shell /usr/sbin/nologin "$name"',
    "  elif command -v adduser >/dev/null 2>&1; then",
    '    adduser -S -H -s /sbin/nologin "$name"',
    "  else",
    '    log_error "缺少创建系统用户命令: useradd/adduser"',
    "    exit 1",
    "  fi",
    "}",
    "",
    "create_openrc_hysteria_service() {",
    "  cat > /etc/init.d/hysteria-server <<'H2O_OPENRC_HYSTERIA'",
    "#!/sbin/openrc-run",
    'name="hysteria-server"',
    'description="Hysteria Server Service"',
    'command="/usr/local/bin/hysteria"',
    'command_args="server --config /etc/hysteria/config.yaml"',
    'command_background="yes"',
    'pidfile="/run/hysteria-server.pid"',
    'output_log="/var/log/hysteria-server.log"',
    'error_log="/var/log/hysteria-server.log"',
    "depend() {",
    "  need net",
    "  after firewall",
    "}",
    "H2O_OPENRC_HYSTERIA",
    "  chmod +x /etc/init.d/hysteria-server",
    "}",
    "",
    "create_openrc_agent_service() {",
    "  cat > /etc/init.d/h2o-agent <<'H2O_OPENRC_AGENT'",
    "#!/sbin/openrc-run",
    'name="h2o-agent"',
    'description="H2O Agent (Hysteria2 traffic reporter)"',
    'command="/usr/local/bin/h2o-agent"',
    'command_args="-c /etc/h2o-agent/config.json"',
    'command_background="yes"',
    'pidfile="/run/h2o-agent.pid"',
    'output_log="/var/log/h2o-agent.log"',
    'error_log="/var/log/h2o-agent.log"',
    "start_pre() {",
    "  checkpath -f -m 0640 -o root:root /var/log/h2o-agent.log",
    "}",
    "depend() {",
    "  need net",
    "  after hysteria-server",
    "}",
    "H2O_OPENRC_AGENT",
    "  chmod +x /etc/init.d/h2o-agent",
    "}",
    "",
    "create_openrc_agent_update_job() {",
    '  if [[ "$AGENT_AUTO_UPDATE_ENABLED" != "true" ]]; then',
    "    rm -f /etc/periodic/daily/h2o-agent-self-update",
    '    log_info "Agent 每日自动更新已关闭"',
    "    return 0",
    "  fi",
    "  mkdir -p /etc/periodic/daily",
    "  cat > /etc/periodic/daily/h2o-agent-self-update <<'H2O_OPENRC_AGENT_UPDATE'",
    "#!/bin/sh",
    "set +e",
    "/usr/local/bin/h2o-agent -c /etc/h2o-agent/config.json -self-update",
    "code=$?",
    'if [ "$code" -eq 2 ]; then',
    "  rc-service h2o-agent restart >/dev/null 2>&1 || true",
    "  exit 0",
    "fi",
    "exit $code",
    "H2O_OPENRC_AGENT_UPDATE",
    "  chmod +x /etc/periodic/daily/h2o-agent-self-update",
    "  if command -v rc-update >/dev/null 2>&1; then",
    "    rc-update add crond default >/dev/null 2>&1 || true",
    "  fi",
    "  if command -v rc-service >/dev/null 2>&1; then",
    "    rc-service crond start >/dev/null 2>&1 || true",
    "  fi",
    '  log_ok "已写入每日自更新任务: /etc/periodic/daily/h2o-agent-self-update"',
    "}",
    "",
    "cleanup_hysteria_firewall_chains() {",
    "  local bin rule delete_rule chain",
    "  for bin in iptables ip6tables; do",
    '    if ! command -v "$bin" >/dev/null 2>&1; then',
    "      continue",
    "    fi",
    "    while IFS= read -r rule; do",
    '      delete_rule="${rule/-A /-D }"',
    "      $bin -w -t nat $delete_rule >/dev/null 2>&1 || true",
    '    done < <($bin -w -t nat -S 2>/dev/null | grep "^-A .*HYSTERIA-" || true)',
    "    while IFS= read -r chain; do",
    '      $bin -w -t nat -F "$chain" >/dev/null 2>&1 || true',
    '      $bin -w -t nat -X "$chain" >/dev/null 2>&1 || true',
    "    done < <($bin -w -t nat -S 2>/dev/null | awk '/^-N HYSTERIA-/ {print $2}' || true)",
    "  done",
    "}",
    "",
    "enable_and_restart_service() {",
    '  local service="$1"',
    '  log_info "启用并重启服务: $service"',
    '  if [[ "$service" == hysteria* ]]; then',
    "    cleanup_hysteria_firewall_chains",
    "  fi",
    "  if has_systemd; then",
    '    systemctl enable "$service" >/dev/null 2>&1 || true',
    '    if systemctl restart "$service"; then',
    '      log_ok "服务运行正常: $service"',
    "    else",
    '      log_error "服务启动失败: $service"',
    "      systemctl --no-pager --full status \"$service\" | sed -n '1,20p' || true",
    "      return 1",
    "    fi",
    "  else",
    '    rc-update add "$service" default >/dev/null 2>&1 || true',
    '    if rc-service "$service" restart; then',
    '      log_ok "服务运行正常: $service"',
    "    else",
    '      log_error "服务启动失败: $service"',
    '      rc-service "$service" status || true',
    "      return 1",
    "    fi",
    "  fi",
    "}",
    "",
    "uninstall_h2o_node() {",
    "  require_root",
    '  log_warn "将停止并移除 h2o-agent 与 hysteria-server 服务、H2O 生成的配置文件和相关二进制。"',
    '  read -r -p "确认卸载？请输入 y 继续: " confirm </dev/tty',
    '  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then',
    '    log_info "已取消卸载"',
    "    return 0",
    "  fi",
    "",
    '  log_step "停止服务"',
    "  if has_systemd; then",
    "    systemctl disable --now h2o-agent-update.timer >/dev/null 2>&1 || true",
    "    systemctl disable --now h2o-agent >/dev/null 2>&1 || true",
    "    systemctl disable --now hysteria-server >/dev/null 2>&1 || true",
    "  elif has_openrc; then",
    "    rc-service h2o-agent stop >/dev/null 2>&1 || true",
    "    rc-service hysteria-server stop >/dev/null 2>&1 || true",
    "    rc-update del h2o-agent default >/dev/null 2>&1 || true",
    "    rc-update del hysteria-server default >/dev/null 2>&1 || true",
    "  fi",
    "",
    '  log_step "移除 h2o-agent"',
    "  rm -f /etc/systemd/system/h2o-agent.service /etc/systemd/system/h2o-agent-update.service /etc/systemd/system/h2o-agent-update.timer",
    "  rm -f /etc/init.d/h2o-agent /etc/periodic/daily/h2o-agent-self-update /usr/local/libexec/h2o-agent-self-update",
    "  rm -f /usr/local/bin/h2o-agent",
    "  rm -rf /etc/h2o-agent",
    "  if id h2o-agent >/dev/null 2>&1; then",
    "    if command -v userdel >/dev/null 2>&1; then",
    "      userdel h2o-agent >/dev/null 2>&1 || true",
    "    elif command -v deluser >/dev/null 2>&1; then",
    "      deluser h2o-agent >/dev/null 2>&1 || true",
    "    fi",
    "  fi",
    "",
    '  log_step "移除 hysteria-server"',
    "  rm -f /etc/systemd/system/hysteria-server.service /etc/init.d/hysteria-server",
    "  rm -f /usr/local/bin/hysteria",
    "  rm -rf /etc/hysteria",
    "",
    "  if has_systemd; then",
    "    systemctl daemon-reload >/dev/null 2>&1 || true",
    "    systemctl reset-failed h2o-agent hysteria-server >/dev/null 2>&1 || true",
    "  fi",
    '  log_ok "卸载完成"',
    "}",
    "",
    "install_h2o_node() {",
    "  require_root",
    "  check_install_dependencies",
    "  if has_openrc; then",
    "    ensure_system_user hysteria",
    "  fi",
    '  log_step "开始部署 hy2 + agent"',
    "",
    '  if [[ "$HY2_LISTEN" == *"-"* ]]; then',
    "    if ! command -v nft >/dev/null 2>&1 && ! command -v iptables >/dev/null 2>&1; then",
    '      log_warn "检测到系统缺少 nft/iptables，端口跳跃不可用，自动回退到单端口监听: $HY2_FALLBACK_LISTEN"',
    '      HY2_LISTEN="$HY2_FALLBACK_LISTEN"',
    "    fi",
    "  fi",
    "",
  ]

  if (needsSelfSignedCert) {
    lines.push(
      "HY2_USER=$(awk -F= '/^User=/{print $2; exit}' /etc/systemd/system/hysteria-server.service 2>/dev/null || true)",
      'if [[ -z "$HY2_USER" ]]; then HY2_USER="hysteria"; fi',
      'if [[ ! -f "$CERT_PATH" || ! -f "$KEY_PATH" ]]; then',
      "  ensure_command openssl",
      '  log_info "证书或私钥不存在，自动生成自签证书"',
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
      '  log_warn "证书文件不存在: $CERT_PATH"',
      "fi",
      'if [[ ! -f "$KEY_PATH" ]]; then',
      '  log_warn "私钥文件不存在: $KEY_PATH"',
      "fi",
      ""
    )
  }
  // acme 模式：不需要处理证书文件，Hy2 会自动申请

  lines.push(
    'log_step "安装/更新 hysteria"',
    "if has_systemd; then",
    '  curl -A "H2O-Agent" -fsSL https://get.hy2.sh/ | bash',
    "else",
    "  if is_alpine && command -v apk >/dev/null 2>&1; then",
    "    apk add --no-cache shadow ca-certificates >/dev/null",
    "    update-ca-certificates >/dev/null 2>&1 || true",
    "  fi",
    '  case "$(uname -m)" in',
    "    x86_64|amd64) HY2_ARCH=amd64 ;;",
    "    aarch64|arm64) HY2_ARCH=arm64 ;;",
    '    *) log_error "不支持的架构: $(uname -m)"; exit 1 ;;',
    "  esac",
    "  HY2_TMP=$(mktemp /tmp/hysteria.XXXXXX)",
    '  curl -A "H2O-Agent" -fsSL "https://github.com/apernet/hysteria/releases/latest/download/hysteria-linux-$HY2_ARCH" -o "$HY2_TMP"',
    '  chmod 0755 "$HY2_TMP"',
    '  mv "$HY2_TMP" /usr/local/bin/hysteria',
    "  ensure_system_user hysteria",
    "  create_openrc_hysteria_service",
    "fi",
    "",
    'log_step "写入 /etc/hysteria/config.yaml"',
    "mkdir -p /etc/hysteria",
    "cat > /etc/hysteria/config.yaml <<'H2O_HY2_CONFIG'",
    hy2Yaml,
    "H2O_HY2_CONFIG",
    'sed -i "s|__H2O_LISTEN__|$HY2_LISTEN|g" /etc/hysteria/config.yaml',
    "chown root:root /etc/hysteria /etc/hysteria/config.yaml || true",
    "chmod 0755 /etc/hysteria || true",
    "chmod 0644 /etc/hysteria/config.yaml || true",
    "",
    'log_step "重启 hysteria-server"',
    "enable_and_restart_service hysteria-server",
    "",
    'log_step "下载并安装 h2o-agent"',
    "WORKDIR=$(mktemp -d /tmp/h2o-node-install.XXXXXX)",
    "trap 'rm -rf \"$WORKDIR\"' EXIT",
    'curl -A "H2O-Agent" -fsSL "$AGENT_BUNDLE_URL" -o "$WORKDIR/h2o-agent-bundle.tar.gz"',
    'tar xzf "$WORKDIR/h2o-agent-bundle.tar.gz" -C "$WORKDIR"',
    "if has_systemd; then",
    '  bash "$WORKDIR/install.sh"',
    "else",
    '  case "$(uname -m)" in',
    "    x86_64|amd64) AGENT_BIN=h2o-agent-linux-amd64 ;;",
    "    aarch64|arm64) AGENT_BIN=h2o-agent-linux-arm64 ;;",
    '    *) log_error "不支持的架构: $(uname -m)"; exit 1 ;;',
    "  esac",
    "  ensure_system_user h2o-agent",
    '  install -m 0755 "$WORKDIR/$AGENT_BIN" /usr/local/bin/h2o-agent',
    "  create_openrc_agent_service",
    "  create_openrc_agent_update_job",
    "fi",
    "",
    'log_step "写入 /etc/h2o-agent/config.json"',
    "mkdir -p /etc/h2o-agent",
    "cat > /etc/h2o-agent/config.json <<'H2O_AGENT_CONFIG'",
    agentConfig,
    "H2O_AGENT_CONFIG",
    "if has_systemd; then",
    "  cat > /etc/systemd/system/h2o-agent.service <<'H2O_SYSTEMD_AGENT'",
    systemdAgentService,
    "H2O_SYSTEMD_AGENT",
    "  systemctl daemon-reload",
    "fi",
    "if id h2o-agent >/dev/null 2>&1; then",
    "  chown root:h2o-agent /etc/h2o-agent/config.json || true",
    "else",
    "  chown root:root /etc/h2o-agent/config.json || true",
    "fi",
    "chmod 0600 /etc/h2o-agent/config.json || true",
    "",
    'log_step "重启 h2o-agent"',
    "enable_and_restart_service h2o-agent",
    "",
    `log_info "面板地址: ${params.panelUrl}"`,
    `log_info "节点认证路径: /api/node/auth/${params.authPath}"`,
    "if has_systemd; then",
    '  log_info "查看 agent 日志: journalctl -u h2o-agent -f"',
    "else",
    '  log_info "查看 agent 日志: tail -f /var/log/h2o-agent.log"',
    "fi"
  )

  if (portHoppingWarn) {
    lines.splice(
      lines.length - 3,
      0,
      `log_warn ${shellSingleQuote(portHoppingWarn)}`
    )
  }

  lines.push(
    "",
    '  log_ok "部署完成"',
    "}",
    "",
    "show_menu() {",
    "  print_header",
    '  echo "请选择要执行的操作："',
    '  echo "  1. 安装/更新"',
    '  echo "  2. 卸载"',
    '  echo "  0. 退出"',
    '  echo ""',
    "}",
    "",
    "main() {",
    "  while true; do",
    "    show_menu",
    '    read -r -p "请输入选项 [1/2/0]: " choice </dev/tty',
    '    case "$choice" in',
    "      1)",
    "        install_h2o_node",
    "        break",
    "        ;;",
    "      2)",
    "        uninstall_h2o_node",
    "        break",
    "        ;;",
    "      0|q|Q)",
    '        echo "[h2o] 已退出"',
    "        break",
    "        ;;",
    "      *)",
    '        echo "无效选项，请重新输入"',
    '        echo ""',
    "        ;;",
    "    esac",
    "  done",
    "}",
    "",
    'main "$@"'
  )

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

  const agentSecret =
    query.get("agent_secret")?.trim() || randomBytes(32).toString("hex")
  if (
    agentSecret.length < 32 ||
    agentSecret.length > 256 ||
    /[\r\n]/.test(agentSecret)
  ) {
    return errorJson(
      "INVALID_AGENT_SECRET",
      "agent_secret 不合法（长度 32~256，且不能包含换行）"
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

  const intervalSeconds = parsePositiveInt(
    query.get("interval_seconds")?.trim() ?? "120",
    10,
    86400
  )
  if (intervalSeconds == null) {
    return errorJson("INVALID_INTERVAL", "interval_seconds 不合法")
  }

  const agentAutoUpdateRaw =
    query.get("agent_auto_update_enabled")?.trim().toLowerCase() ?? "true"
  if (agentAutoUpdateRaw !== "true" && agentAutoUpdateRaw !== "false") {
    return errorJson(
      "INVALID_PAYLOAD",
      "agent_auto_update_enabled 必须是 true 或 false"
    )
  }
  const agentAutoUpdateEnabled = agentAutoUpdateRaw === "true"

  const agentBundleUrlRaw = query.get("agent_bundle_url")?.trim() ?? ""
  const agentBundleUrl = parseBaseUrl(agentBundleUrlRaw)
    ? agentBundleUrlRaw
    : null
  if (!agentBundleUrl) {
    return errorJson("INVALID_AGENT_BUNDLE_URL", "agent_bundle_url 不合法")
  }

  // 证书模式解析（兼容旧值 acme → acme-dns）
  const certModeRaw = query.get("cert_mode")?.trim() ?? "self-signed"
  const certMode = normalizeCertMode(certModeRaw) as
    | "self-signed"
    | "acme-http"
    | "acme-dns"
    | "custom"

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
    agentSecret,
    obfs,
    obfsPassword,
    intervalSeconds,
    agentAutoUpdateEnabled,
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
