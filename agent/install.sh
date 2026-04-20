#!/usr/bin/env bash
# h2o-agent 节点侧一键部署脚本：
#   - 按架构选对应二进制拷到 /usr/local/bin/h2o-agent
#   - /etc/h2o-agent/config.json 不存在时从示例生成（首次运行要求手动编辑）
#   - 创建 h2o-agent 系统用户
#   - 写入 systemd unit 并 daemon-reload
#   - 已有配置 → 自动 enable+restart；首次安装 → 提示用户编辑 config 后启动
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

INSTALL_BIN=/usr/local/bin/h2o-agent
CONFIG_DIR=/etc/h2o-agent
CONFIG_FILE=$CONFIG_DIR/config.json
UNIT_FILE=/etc/systemd/system/h2o-agent.service
SERVICE_USER=h2o-agent

if [[ $EUID -ne 0 ]]; then
  echo "需要 root，请用 sudo 或直接以 root 运行" >&2
  exit 1
fi

# 1. 按 arch 选二进制
arch=$(uname -m)
case $arch in
  x86_64|amd64)  bin_name=h2o-agent-linux-amd64 ;;
  aarch64|arm64) bin_name=h2o-agent-linux-arm64 ;;
  *) echo "不支持的架构: $arch" >&2; exit 1 ;;
esac

if [[ ! -f "$SCRIPT_DIR/$bin_name" ]]; then
  echo "未找到二进制 $SCRIPT_DIR/$bin_name" >&2
  echo "请先在开发机 cd agent && bash build.sh 生成 dist/h2o-agent-bundle.tar.gz" >&2
  exit 1
fi

# 2. 创建服务用户
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  echo "已创建系统用户 $SERVICE_USER"
fi

# 3. 拷贝二进制
install -m 0755 "$SCRIPT_DIR/$bin_name" "$INSTALL_BIN"
echo "已安装二进制 $INSTALL_BIN ($arch)"

# 4. 准备配置
mkdir -p "$CONFIG_DIR"
chmod 0750 "$CONFIG_DIR"
chown root:"$SERVICE_USER" "$CONFIG_DIR"

first_install=0
if [[ ! -f "$CONFIG_FILE" ]]; then
  install -m 0640 -o root -g "$SERVICE_USER" \
    "$SCRIPT_DIR/config.example.json" "$CONFIG_FILE"
  first_install=1
  echo "已生成示例配置 $CONFIG_FILE"
else
  chown root:"$SERVICE_USER" "$CONFIG_FILE"
  chmod 0640 "$CONFIG_FILE"
  echo "保留已有配置 $CONFIG_FILE"
fi

# 5. 写 systemd unit
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=H2O Agent (Hysteria2 traffic reporter)
After=network-online.target hysteria-server.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=$INSTALL_BIN -c $CONFIG_FILE
Restart=always
RestartSec=10
User=$SERVICE_USER
Group=$SERVICE_USER
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
echo "已写入 $UNIT_FILE"

# 6. 首次 vs 升级
if [[ $first_install -eq 1 ]]; then
  cat <<EOF

=== 首次安装 ===
接下来需要手动完成：
  1) 编辑 $CONFIG_FILE 填入 h2o_url / auth_path / hysteria_stats_secret
     （auth_path 在 h2o 后台节点行点"Agent 配置"复制）
  2) systemctl enable --now h2o-agent
  3) journalctl -u h2o-agent -f    # 看日志
EOF
else
  systemctl enable h2o-agent >/dev/null 2>&1 || true
  systemctl restart h2o-agent
  echo ""
  echo "=== 已重启 h2o-agent ==="
  echo "查看日志: journalctl -u h2o-agent -f"
fi
