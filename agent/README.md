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

首次部署流程：
1. 跑 `bash install.sh`（会提示下一步）
2. 编辑 `/etc/h2o-agent/config.json`
3. `systemctl enable --now h2o-agent`
4. `journalctl -u h2o-agent -f` 确认每分钟有 `上报成功` 日志

## 手工编译（可选）

如果不想用 `build.sh`，也可以手动：

```bash
cd agent
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o h2o-agent-linux-amd64 .
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o h2o-agent-linux-arm64 .
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
  "interval_seconds": 120
}
```

`auth_path` 既是节点身份标识，也是 agent 与 h2o 之间的共享秘密——不要外泄。

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
