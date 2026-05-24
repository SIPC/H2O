# h2o-agent

部署在 Hysteria2 节点侧的上报守护进程。每隔若干秒从本机 Hy2 Traffic Stats API 拉取 `/traffic` 与 `/online`，把完整快照 POST 到 h2o 面板，由面板用差值法把每个用户的增量累加到订阅。

## 为什么要它

Hy2 HTTP auth 回调只在客户端握手时触发一次，其 `tx` 字段并不反映真实用户流量。真正的权威数据在 Hy2 内置 Traffic Stats API。agent 就是把这份数据搬到 h2o。

## 打包 & 部署（推荐）

开发机（有 Go，Windows 可用 Git Bash / WSL；Linux/Mac 原生即可）：

```bash
cd agent
bash build.sh
# 产物：dist/h2o-agent-bundle.tar.gz（含 amd64、arm64 两种二进制 + install.sh + 示例配置）
```

`build.sh` 会自动读取仓库根目录 `package.json` 的 `version`，通过 Go `ldflags` 注入 agent 二进制；agent 每次上报流量快照时会携带该版本号，面板节点页可看到最近一次上报的 agent 版本。

节点侧 root 执行：

```bash
scp dist/h2o-agent-bundle.tar.gz root@<node-ip>:/tmp/
ssh root@<node-ip>
cd /tmp && mkdir -p h2o-agent && tar xzf h2o-agent-bundle.tar.gz -C h2o-agent
cd h2o-agent && bash install.sh
```

`install.sh` 会：
- 按 `uname -m` 自动选 amd64/arm64 二进制
- 创建系统用户 `h2o-agent`
- 安装到 `/usr/local/bin/h2o-agent`
- 首次：生成 `/etc/h2o-agent/config.json`（从示例模板），要求你手动编辑后再启动
- 升级：保留已有配置并自动 `systemctl restart h2o-agent`
- 写 systemd unit 并 `daemon-reload`
- 写入 `h2o-agent-update.timer`，每天从 GitHub Release 检查并自动更新 agent，更新成功后重启 `h2o-agent`

首次部署流程：
1. 跑 `bash install.sh`（会提示下一步）
2. 编辑 `/etc/h2o-agent/config.json`
3. `systemctl enable --now h2o-agent`
4. `journalctl -u h2o-agent -f` 确认每分钟有 `上报成功` 日志

## 手工编译（可选）

如果不想用 `build.sh`，也可以手动：

```bash
cd agent
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.Version=dev" -o h2o-agent-linux-amd64 .
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.Version=dev" -o h2o-agent-linux-arm64 .
```

## 节点侧 Hy2 配置

在 Hysteria2 server 的 config（通常是 `/etc/hysteria/config.yaml`）里启用 traffic stats：

```yaml
trafficStats:
  listen: 127.0.0.1:25300
  secret: 设置一个任意字符串
```

确保 `listen` 只绑 loopback，不要暴露到公网。

## agent 配置

`install.sh` 首次运行会生成 `/etc/h2o-agent/config.json`（从 `config.example.json`），请编辑以下字段：

```json
{
  "h2o_url": "https://panel.example.com",
  "auth_path": "<在 h2o 后台-节点页点击 Agent 配置按钮复制>",
  "hysteria_stats_url": "http://127.0.0.1:25300",
  "hysteria_stats_secret": "<与 Hy2 config 里的 trafficStats.secret 完全一致>",
  "interval_seconds": 120,
  "auto_update_enabled": true,
  "hy2_auto_update_enabled": true
}
```

`auto_update_enabled` 由节点编辑页「Agent 配置 → Agent 每日自动更新」控制，一键部署时会写入节点配置。关闭后，即使系统的每日任务仍存在，agent 也会读取配置并跳过更新 Agent。

`hy2_auto_update_enabled` 由节点编辑页「Agent 配置 → Hysteria2 每日自动更新」控制。启用后，agent 每 24 小时检查一次 `apernet/hysteria` 最新 Release，下载当前架构的 `hysteria-linux-amd64` / `hysteria-linux-arm64`，校验 SHA256 后替换二进制并重启 `hysteria-server`。

`auth_path` 既是节点身份标识，也是 agent 与 h2o 之间的共享秘密——不要外泄。

## 自动更新

agent 支持更新 Agent 命令：

```bash
/usr/local/bin/h2o-agent -self-update
```

它会访问 `https://github.com/SIPC/H2O/releases/latest`，按当前架构下载对应资产：

- `amd64` → `h2o-agent-linux-amd64`
- `arm64` → `h2o-agent-linux-arm64`

下载后会校验同名 `.sha256` 文件，校验通过才替换当前 `/usr/local/bin/h2o-agent`。如果发生更新，命令会以退出码 `2` 结束，安装脚本生成的 systemd timer / Alpine daily 脚本会据此自动重启 agent。

`install.sh` 会安装并启用 `h2o-agent-update.timer`，默认每天凌晨检查一次 Agent 更新；是否真正执行更新由 `/etc/h2o-agent/config.json` 中的 `auto_update_enabled` 控制。

Hy2 更新由常驻 Agent 在同步/上报循环中执行，不依赖额外 systemd timer。后台也可以通过「Hy2 操作 → 更新 Hysteria2」手动创建 `HY2_SELF_UPDATE` 任务。

## 运行（手动启动 / 不走 systemd）

```bash
/usr/local/bin/h2o-agent -c /etc/h2o-agent/config.json
```

## 仅生成 systemd unit（跳过 install.sh，手工维护）

`/etc/systemd/system/h2o-agent.service`：

```ini
[Unit]
Description=H2O Agent (Hysteria2 traffic reporter)
After=network-online.target hysteria-server.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/h2o-agent -c /etc/h2o-agent/config.json
Restart=always
RestartSec=10
User=h2o-agent
Group=h2o-agent
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

```bash
useradd --system --no-create-home --shell /usr/sbin/nologin h2o-agent
systemctl daemon-reload
systemctl enable --now h2o-agent
journalctl -u h2o-agent -f
```

## 排障

- **「拉 /traffic 失败: HTTP 401」** → `hysteria_stats_secret` 与 Hy2 config 不一致
- **「上报 h2o 失败: HTTP 404 NO_NODE」** → `auth_path` 配错或节点在 h2o 被禁用
- **面板心跳不更新** → 先 `curl -H "Authorization: <secret>" http://127.0.0.1:25300/traffic` 确认 Hy2 API 可达
