# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

H2O 是企业内网使用的 Hysteria2 订阅与节点认证管理面板：后端提供用户/套餐/订阅/节点 CRUD、Hysteria2 节点 HTTP 认证回调、Agent 拉取式配置下发与 Hy2 管理、Hysteria 订阅链接生成；前端提供管理员后台与普通用户自助面板。Next.js 16 App Router + React 19 + TypeScript + Tailwind v4 + shadcn/ui。

## 常用命令

使用 **pnpm**（仓库有 `pnpm-lock.yaml`）。

- `pnpm dev` — 启动 Turbopack 开发服务器（`next dev --turbopack`）
- `pnpm build` / `pnpm start` — 生产构建与启动
- `pnpm lint` — ESLint（基于 `eslint-config-next`，包含 core-web-vitals + typescript）
- `pnpm typecheck` — `tsc --noEmit`，增量编译结果在 `tsconfig.tsbuildinfo`
- `pnpm format` — Prettier + tailwind 插件（`no-semi`、双引号、2 空格、LF、`tailwindFunctions: ["cn","cva"]`）
- 新增 shadcn 组件：`npx shadcn@latest add <name>`（`components.json` 里 style 是 `radix-nova`，基色 `neutral`，图标库 `lucide`）

目前前端/后端没有测试脚手架。Agent 可用 `go -C agent test ./...` 做 Go 包编译校验。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `H2O_DB_PATH` | `./data/h2o.sqlite` | 业务数据库路径 |
| `H2O_LOGS_DB_PATH` | `./data/h2o-logs.sqlite` | 日志数据库路径 |
| `H2O_SECURE_COOKIE` | `"true"`（生产） | 设为 `"false"` 可在纯 HTTP 部署下关闭 cookie Secure 标志 |

## 首次启动流程

1. Turnstile 人机验证通过后台「站点设置」配置（可选）：
   - 两个 key 都缺失 → 人机验证视为 **disabled**，前端不渲染 widget
   - 两个 key 都有 → **enabled**
   - 只配一个 → **misconfigured**，登录/注册会直接报错（见 `lib/turnstile.ts`）
2. 启动后访问 `/init` 引导创建第一个管理员（`POST /api/auth/bootstrap-admin`）。已存在 admin 时该接口返回 `ADMIN_EXISTS`。
3. 数据库首次调用 `getDb()` / `getLogsDb()` 时自动建表，无外部迁移工具。

## 架构要点

### 双 SQLite 文件（Node 内建驱动）

使用 Node.js 内建 `node:sqlite` 的 `DatabaseSync`，**没有** `better-sqlite3`/`sqlite3` 依赖。需要 Node 版本支持 `node:sqlite`（Node 22+ 实验性 / Node 23+ 稳定）。

- `lib/db.ts` → 业务库 `data/h2o.sqlite`（可用 `H2O_DB_PATH` 覆盖）：`users`, `nodes`, `plans`, `plan_nodes`, `subscriptions`, `sessions`, `settings`, `node_stats`, `node_user_traffic`, `traffic_hourly_stats`, `node_hourly_traffic`, `subscription_hourly_traffic`, `node_agent_state`, `node_agent_tasks`, `agent_request_nonces`
- `lib/logs-db.ts` → 日志库 `data/h2o-logs.sqlite`（可用 `H2O_LOGS_DB_PATH` 覆盖）：`auth_logs`（节点认证日志）、`event_logs`（业务事件日志）、`agent_traffic_reports` / `agent_traffic_user_logs`（Agent 上报日志）

两库分离的设计目的是让日志可单独归档/清理，不影响业务库。两者都采用单例 + 懒加载，首次取用时 `migrate()` 建表并打开 `PRAGMA foreign_keys = ON`。`migrate()` 只维护当前 schema，**不做旧版本迁移兼容**。

#### 完整数据库 Schema

**业务库 `h2o.sqlite`**

`users`

| 列 | 类型 | 约束 |
|----|------|------|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` |
| `username` | `TEXT` | `NOT NULL UNIQUE` |
| `password_hash` | `TEXT` | `NOT NULL`（格式 `scrypt$salt$hash`） |
| `auth_token` | `TEXT` | `NOT NULL UNIQUE`（24 字节随机 hex，48 字符） |
| `role` | `TEXT` | `NOT NULL DEFAULT 'user'`, `CHECK(role IN ('user','admin'))` |
| `status` | `TEXT` | `NOT NULL DEFAULT 'active'`, `CHECK(status IN ('active','disabled'))` |
| `created_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |
| `updated_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |
| `last_login_at` | `TEXT` | nullable |

`nodes`

| 列 | 类型 | 约束 |
|----|------|------|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` |
| `name` | `TEXT` | `NOT NULL UNIQUE` |
| `ip` | `TEXT` | `NOT NULL` |
| `port` | `INTEGER` | `NOT NULL` |
| `port_hopping` | `TEXT` | nullable（逗号分隔端口范围，如 `443,5000-6000`） |
| `auth_path` | `TEXT` | `NOT NULL UNIQUE`（节点认证路径，也用作 agent 密钥） |
| `status` | `TEXT` | `NOT NULL DEFAULT 'enabled'`, `CHECK(status IN ('enabled','disabled'))` |
| `sni` | `TEXT` | nullable |
| `obfs` | `TEXT` | nullable |
| `obfs_password` | `TEXT` | nullable |
| `insecure` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK(insecure IN (0,1))` |
| `pin_sha256` | `TEXT` | nullable |
| `node_ip` | `TEXT` | nullable（agent 上报的实际 IP） |
| `node_port` | `INTEGER` | nullable（agent 上报的实际端口） |
| `node_port_hopping` | `TEXT` | nullable |
| `cert_mode` | `TEXT` | `NOT NULL DEFAULT 'self-signed'`（`self-signed` / `file` / `acme`） |
| `cert_path` | `TEXT` | nullable |
| `key_path` | `TEXT` | nullable |
| `acme_domains` | `TEXT` | nullable |
| `acme_email` | `TEXT` | nullable |
| `acme_dns_provider` | `TEXT` | nullable |
| `acme_dns_config` | `TEXT` | nullable |
| `masquerade_type` | `TEXT` | nullable |
| `masquerade_config` | `TEXT` | nullable |
| `agent_interval` | `INTEGER` | nullable（agent 上报/同步间隔秒数） |
| `agent_auto_update_enabled` | `INTEGER` | `NOT NULL DEFAULT 1`, `CHECK(agent_auto_update_enabled IN (0,1))` |
| `hy2_stats_secret` | `TEXT` | nullable（Hy2 `trafficStats.secret`，首次部署/取配置时持久化） |
| `agent_secret` | `TEXT` | nullable（Agent 控制面 HMAC 共享密钥，32 字节随机 hex） |
| `agent_control_enabled` | `INTEGER` | `NOT NULL DEFAULT 1`, `CHECK(agent_control_enabled IN (0,1))` |
| `agent_config_revision` | `INTEGER` | `NOT NULL DEFAULT 1`（期望 Hy2 配置版本） |
| `agent_desired_config_hash` | `TEXT` | nullable（面板生成的期望 Hy2 配置 SHA-256） |
| `agent_last_config_built_at` | `TEXT` | nullable |
| `created_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |

`plans`

| 列 | 类型 | 约束 |
|----|------|------|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` |
| `name` | `TEXT` | `NOT NULL UNIQUE` |
| `traffic_limit_bytes` | `INTEGER` | `NOT NULL` |
| `duration_days` | `INTEGER` | `NOT NULL` |
| `up_mbps` | `INTEGER` | `NOT NULL DEFAULT 0`（0 = 不限速） |
| `down_mbps` | `INTEGER` | `NOT NULL DEFAULT 0`（0 = 不限速） |
| `auto_renew` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK(auto_renew IN (0,1))` |
| `renewal_period_days` | `INTEGER` | nullable |

`plan_nodes`（多对多关联表）

| 列 | 类型 | 约束 |
|----|------|------|
| `plan_id` | `INTEGER` | `NOT NULL`, `FK → plans(id) ON DELETE CASCADE` |
| `node_id` | `INTEGER` | `NOT NULL`, `FK → nodes(id) ON DELETE CASCADE` |
| | | `PRIMARY KEY (plan_id, node_id)` |

`subscriptions`

| 列 | 类型 | 约束 |
|----|------|------|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` |
| `user_id` | `INTEGER` | `NOT NULL`, `FK → users(id) ON DELETE CASCADE` |
| `plan_id` | `INTEGER` | `NOT NULL`, `FK → plans(id)` |
| `start_time` | `TEXT` | `NOT NULL` |
| `expire_time` | `TEXT` | `NOT NULL` |
| `used_traffic_bytes` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `status` | `TEXT` | `NOT NULL DEFAULT 'active'`, `CHECK(status IN ('active','expired','blocked'))` |
| `renewal_anchor` | `TEXT` | nullable（自动续订周期锚点） |

`sessions`

| 列 | 类型 | 约束 |
|----|------|------|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` |
| `user_id` | `INTEGER` | `NOT NULL`, `FK → users(id) ON DELETE CASCADE` |
| `session_token_hash` | `TEXT` | `NOT NULL UNIQUE`（随机 token 的 SHA-256） |
| `expires_at` | `TEXT` | `NOT NULL` |
| `created_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |
| `revoked_at` | `TEXT` | nullable（登出时设置） |
| `last_seen_at` | `TEXT` | nullable（每次校验时更新） |

`settings`

| 列 | 类型 | 约束 |
|----|------|------|
| `key` | `TEXT` | `PRIMARY KEY` |
| `value` | `TEXT` | `NOT NULL`（JSON 序列化） |
| `updated_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |

`node_stats`（节点心跳与在线/流量快照，由 agent 定时上报）

| 列 | 类型 | 约束 |
|----|------|------|
| `node_id` | `INTEGER` | `PRIMARY KEY`, `FK → nodes(id) ON DELETE CASCADE` |
| `last_report_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |
| `online_count` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `online_snapshot` | `TEXT` | nullable（JSON，每个用户名 → 在线数） |
| `traffic_snapshot` | `TEXT` | nullable（JSON，每个用户名 → {tx, rx}） |
| `agent_version` | `TEXT` | nullable |

`node_user_traffic`（差值法基准：每节点每用户上次上报的累计 tx/rx）

| 列 | 类型 | 约束 |
|----|------|------|
| `node_id` | `INTEGER` | `NOT NULL`, `FK → nodes(id) ON DELETE CASCADE` |
| `user_id` | `INTEGER` | `NOT NULL`, `FK → users(id) ON DELETE CASCADE` |
| `last_tx_bytes` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `last_rx_bytes` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `last_updated_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |
| | | `PRIMARY KEY (node_id, user_id)` |

`traffic_hourly_stats`（全局小时级流量聚合）

| 列 | 类型 | 约束 |
|----|------|------|
| `bucket_date` | `TEXT` | `NOT NULL` |
| `bucket_hour` | `INTEGER` | `NOT NULL`, `CHECK(bucket_hour BETWEEN 0 AND 23)` |
| `tx_bytes` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `rx_bytes` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `updated_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |
| | | `PRIMARY KEY (bucket_date, bucket_hour)` |

`node_hourly_traffic`（节点维度小时流量）

| 列 | 类型 | 约束 |
|----|------|------|
| `node_id` | `INTEGER` | `NOT NULL`, `FK → nodes(id) ON DELETE CASCADE` |
| `bucket_date` | `TEXT` | `NOT NULL` |
| `bucket_hour` | `INTEGER` | `NOT NULL`, `CHECK(bucket_hour BETWEEN 0 AND 23)` |
| `tx_bytes` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `rx_bytes` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `updated_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |
| | | `PRIMARY KEY (node_id, bucket_date, bucket_hour)` |

`subscription_hourly_traffic`（订阅维度小时流量）

| 列 | 类型 | 约束 |
|----|------|------|
| `subscription_id` | `INTEGER` | `NOT NULL`, `FK → subscriptions(id) ON DELETE CASCADE` |
| `bucket_date` | `TEXT` | `NOT NULL` |
| `bucket_hour` | `INTEGER` | `NOT NULL`, `CHECK(bucket_hour BETWEEN 0 AND 23)` |
| `tx_bytes` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `rx_bytes` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `updated_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |
| | | `PRIMARY KEY (subscription_id, bucket_date, bucket_hour)` |

`node_agent_state`（Agent 控制面状态，由 sync 定时刷新）

| 列 | 类型 | 约束 |
|----|------|------|
| `node_id` | `INTEGER` | `PRIMARY KEY`, `FK → nodes(id) ON DELETE CASCADE` |
| `last_seen_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |
| `agent_version` | `TEXT` | nullable |
| `hostname` | `TEXT` | nullable |
| `os` | `TEXT` | nullable |
| `arch` | `TEXT` | nullable |
| `service_manager` | `TEXT` | nullable |
| `hy2_status` | `TEXT` | nullable（`running` / `stopped` / `failed` / `unknown` 等） |
| `hy2_version` | `TEXT` | nullable |
| `hysteria_config_path` | `TEXT` | nullable |
| `hysteria_config_hash` | `TEXT` | nullable（Agent 本地配置 SHA-256） |
| `applied_config_revision` | `INTEGER` | nullable |
| `last_config_apply_at` | `TEXT` | nullable |
| `last_error` | `TEXT` | nullable |
| `capabilities` | `TEXT` | nullable（JSON 数组） |
| `updated_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |

`node_agent_tasks`（Agent 任务队列）

| 列 | 类型 | 约束 |
|----|------|------|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` |
| `node_id` | `INTEGER` | `NOT NULL`, `FK → nodes(id) ON DELETE CASCADE` |
| `type` | `TEXT` | `NOT NULL`（白名单任务类型） |
| `payload` | `TEXT` | nullable（JSON 字符串） |
| `status` | `TEXT` | `NOT NULL DEFAULT 'queued'`, `CHECK(status IN ('queued','claimed','succeeded','failed','cancelled'))` |
| `result` | `TEXT` | nullable（JSON 字符串或文本） |
| `error` | `TEXT` | nullable |
| `created_by` | `INTEGER` | nullable, `FK → users(id) ON DELETE SET NULL` |
| `created_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |
| `claimed_at` | `TEXT` | nullable |
| `lease_expires_at` | `TEXT` | nullable |
| `finished_at` | `TEXT` | nullable |
| `updated_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |

`agent_request_nonces`（Agent HMAC 请求 nonce 防重放）

| 列 | 类型 | 约束 |
|----|------|------|
| `node_id` | `INTEGER` | `NOT NULL`, `FK → nodes(id) ON DELETE CASCADE` |
| `nonce` | `TEXT` | `NOT NULL` |
| `expires_at` | `TEXT` | `NOT NULL` |
| | | `PRIMARY KEY (node_id, nonce)` |

**索引**：`idx_node_hourly_traffic_bucket`, `idx_subscription_hourly_traffic_bucket`, `idx_sub_user_status_expire`, `idx_sessions_user_id`, `idx_sessions_expires_at`, `idx_node_stats_last_report`, `idx_node_agent_state_last_seen`, `idx_node_agent_tasks_node_status`, `idx_node_agent_tasks_lease`, `idx_agent_request_nonces_expires`

**日志库 `h2o-logs.sqlite`**

`auth_logs`

| 列 | 类型 | 约束 |
|----|------|------|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` |
| `created_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |
| `node_id` | `INTEGER` | nullable |
| `node_name` | `TEXT` | nullable |
| `user_id` | `INTEGER` | nullable |
| `username` | `TEXT` | nullable |
| `ip` | `TEXT` | nullable |
| `success` | `INTEGER` | `NOT NULL`, `CHECK(success IN (0,1))` |
| `reason` | `TEXT` | nullable（枚举：`BAD_PAYLOAD` / `NO_NODE` / `NO_USER` / `USER_DISABLED` / `NO_SUB` / `TRAFFIC_EXCEEDED` / `OK`） |

`event_logs`

| 列 | 类型 | 约束 |
|----|------|------|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` |
| `created_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |
| `event` | `TEXT` | `NOT NULL` |
| `user_id` | `INTEGER` | nullable |
| `username` | `TEXT` | nullable |
| `ip` | `TEXT` | nullable |
| `success` | `INTEGER` | `NOT NULL`, `CHECK(success IN (0,1))` |
| `reason` | `TEXT` | nullable |
| `detail` | `TEXT` | nullable（JSON 字符串） |

`agent_traffic_reports` / `agent_traffic_user_logs`：Agent 批量流量上报的请求级汇总与用户级明细，记录上报用户数、在线数、原始累计 tx/rx、差值 delta、处理结果、Agent 版本与错误原因。`auth_path` 落库前会用 `maskAuthPath()` 脱敏。

`EventName` 类型（23 种事件）：`LOGIN` | `REGISTER` | `LOGOUT` | `RESET_TOKEN_SELF` | `RESET_TOKEN_ADMIN` | `BOOTSTRAP_ADMIN` | `USER_CREATE` | `USER_UPDATE` | `USER_DELETE` | `NODE_CREATE` | `NODE_UPDATE` | `NODE_DELETE` | `AGENT_TASK_CREATE` | `AGENT_SECRET_ROTATE` | `AGENT_CONFIG_VIEW` | `PLAN_CREATE` | `PLAN_UPDATE` | `PLAN_DELETE` | `SUBSCRIPTION_CREATE` | `SUBSCRIPTION_UPDATE` | `SUBSCRIPTION_DELETE` | `SUBSCRIPTION_FETCH` | `SETTINGS_UPDATE`

**日志索引**：`idx_auth_logs_created`, `idx_event_logs_created`, `idx_event_logs_event`, `idx_agent_traffic_reports_created`, `idx_agent_traffic_reports_node_created`, `idx_agent_traffic_reports_reason_created`, `idx_agent_traffic_user_logs_report`, `idx_agent_traffic_user_logs_created`, `idx_agent_traffic_user_logs_username_created`, `idx_agent_traffic_user_logs_node_created`

### 双 token 认证模型

这是理解本仓库最关键的一点，容易混淆：

1. **Web session**：cookie `h2o_session`（`lib/auth.ts`）
   - 32 字节随机 token，数据库里存 SHA-256，14 天 TTL
   - `createSession` / `getSessionUser` / `requireUser` / `requireAdmin` / `revokeSessionByRequest`
   - `middleware.ts` 只做**浅检查**（cookie 是否存在）用于路径重定向；真正的权限校验在各 route 里用 `requireUser`/`requireAdmin` 完成
2. **长静态 auth_token**：`users.auth_token`（24 字节随机 hex，`lib/tokens.ts::createUserAuthToken`）
   - Hysteria2 节点 HTTP 认证：`POST /api/node/auth/[authPath]`，body 里的 `auth` 字段即此 token
   - 用户订阅链接：`GET /api/sub/[token]`
   - 管理员可在 `PATCH /api/admin/users/[id]` 时 `resetAuthToken: true`，或用户自助 `POST /api/user/self/reset-token` 轮换（会同时使旧订阅链接失效）

**重要**：节点认证默认用创建节点时生成的长静态凭证，不要额外加 nonce/短签名等机制。

### Hysteria2 节点认证协议

`app/api/node/auth/[authPath]/route.ts` 实现 Hysteria2 的 HTTP auth 回调：

- 入参：`{ addr, auth, tx }`（tx 是本次上报的流量字节数）
- 流程：校验 `authPath` → 节点启用 → 用户 `auth_token` 匹配 → 用户 active → 存在覆盖该节点的 active 订阅且未过期 → 按 `tx` 累加 `used_traffic_bytes`
- 超额处理：`nextUsage > traffic_limit_bytes` 时把订阅状态改 `blocked` 并返回失败
- 返回体：`{ ok, id }`（`id` 是用户名，符合 Hysteria2 期望）
- 所有分支都会 `writeAuthLog` 写入日志库，reason 用固定枚举（`BAD_PAYLOAD`/`NO_NODE`/`NO_USER`/`USER_DISABLED`/`NO_SUB`/`TRAFFIC_EXCEEDED`/`OK`）

**注意**：单用户认证回调**不计流量**（`tx` 字段仅用于日志），实际流量由 agent 批量上报。

### Agent 批量流量上报

`app/api/node/auth/[authPath]/traffic` 接收 agent 定时上报的全量流量快照：

- 入参：`{ traffic: { "<username>": { tx, rx }, ... }, online: { "<username>": count, ... } }`
- 差值法：与 `node_user_traffic` 表中上次记录比较，计算增量（处理 Hy2 重启计数器归零的情况）
- 按增量累加 `subscriptions.used_traffic_bytes`，超额自动 block
- 写入三维度小时流量统计（全局 `traffic_hourly_stats`、节点 `node_hourly_traffic`、订阅 `subscription_hourly_traffic`）
- 更新 `node_stats` 在线快照
- 按 `settings.stats_retention_days` 清理旧统计数据
- 全部在显式事务中执行

### H2O Agent（Go 独立进程）

`agent/` 目录是独立 Go 程序，部署在每个 Hysteria2 节点上，负责采集 Hy2 Traffic Stats API 并上报给面板。

**架构**：四个包——`main`（CLI、配置、信号处理、ticker 循环）、`stats`（并发获取 `/traffic` + `/online`）、`report`（POST 流量快照到面板）、`control`（拉取式控制面同步、Hy2 服务管理、配置应用、日志读取）。

**通信**：
- 流量上报：`POST {h2o_url}/api/node/auth/{authPath}/traffic`，复用 `auth_path` 标识节点。Hy2 本地 API 通过 `Authorization: <secret>` 头认证（对应 Hy2 配置的 `trafficStats.secret`）。
- 控制面同步：`POST {h2o_url}/api/node/agent/{authPath}/sync`，使用 `agent_secret` 做 HMAC-SHA256 签名，携带 timestamp + nonce 防重放。Agent 不监听任何入站端口。

**配置**（`agent/config.json`）：

| 字段 | 说明 |
|------|------|
| `h2o_url` | 面板地址 |
| `auth_path` | 从面板节点页面复制 |
| `agent_secret` | Agent 控制面 HMAC 密钥，从面板节点「Agent 配置」复制 |
| `control_enabled` | 是否启用控制面同步，默认按是否存在 `agent_secret` 自动开启 |
| `hysteria_stats_url` | 本地 Hy2 Stats API，默认 `http://127.0.0.1:9999` |
| `hysteria_stats_secret` | Hy2 配置的 `trafficStats.secret`，由面板持久化生成 |
| `interval_seconds` | 上报/同步间隔，默认 120 |
| `auto_update_enabled` | 是否允许 Agent 自更新 |
| `hysteria_config_path` | Hy2 配置路径，默认 `/etc/hysteria/config.yaml` |
| `hysteria_service_name` | Hy2 服务名，默认 `hysteria-server` |
| `agent_config_path` | Agent 自身配置路径，默认当前 `-c` 参数 |

**构建**：`build.sh` 交叉编译 `linux/amd64` + `linux/arm64`（CGO_ENABLED=0，静态，strip），打包为 `dist/h2o-agent-bundle.tar.gz`

**安装**：`install.sh` 自动检测架构、创建系统用户 `h2o-agent`、安装 systemd 服务。控制面需要管理 Hy2 服务和写入 `/etc/hysteria/config.yaml`，当前 systemd/OpenRC 安装会让 agent 以 root 运行；Agent 不开放入站端口，且只执行白名单任务。首次安装生成配置模板要求手动编辑，升级保留现有配置并自动重启。

**Go 依赖**：零外部依赖，仅 stdlib，`go 1.22`

### 订阅链接

`app/api/sub/[token]/route.ts`：

- 路径参数 `token` 即用户的 `auth_token`
- 聚合用户所有 active 订阅对应的启用节点（去重），每个节点走 `lib/hysteria-uri.ts::buildHysteriaUri` 生成 `hysteria2://` URI
- 根据 User-Agent **自动检测**输出格式（`lib/subscription/client-type.ts::detectFormat`）：
  - Clash 客户端 → YAML 配置（`lib/subscription/build-clash.ts`）
  - sing-box 客户端 → JSON 配置（`lib/subscription/build-singbox.ts`）
  - 其他 → 默认 base64 编码 URI 列表，`?format=plain` 返回明文
- 响应头带 `Subscription-Userinfo: upload=0; download=<used>; total=<total>; expire=<ts>` 与 `Profile-Update-Interval: 24`，兼容订阅客户端
- `app/api/user/dashboard/route.ts` 合并返回订阅路径、订阅列表与流量概览，订阅路径不含 host，由前端拼接完整 URL

#### 客户端检测逻辑

`lib/subscription/client-type.ts::detectFormat`：`?format=` 查询参数优先；否则 User-Agent 正则匹配：
- `/clash|mihomo|stash|verge/i` → `clash`
- `/sing-?box|\bSFA\b|\bSFI\b|\bSFM\b|\bSFT\b|hiddify|karing/i` → `singbox`
- 默认 → `base64`

#### Clash 模板

`lib/subscription/clash-template.ts` 生成完整 Clash Meta (mihomo) 配置：
- 混合端口 7890，fake-ip DNS，DoT 国内（阿里/114）+ DoH 国外走代理
- 代理组：🚀 节点选择(select)、♻️ 自动选择(url-test)、🤖 AI、📺 国际媒体、📲 Telegram、🍎 苹果服务、Ⓜ️ 微软服务、🛑 广告拦截、🐟 漏网之鱼
- 12 个 ACL4SSR 规则集，内联 AI 规则（OpenAI/Anthropic/Gemini 等）

#### sing-box 模板

`lib/subscription/singbox-template.ts` 生成 sing-box 1.x 配置：
- DNS：`tls://1.1.1.1` 走代理、`tls://223.5.5.5` 直连
- 入站：mixed (7890)、tun (172.19.0.1/30, auto_route, strict_route, sniff)
- 出站：proxy(selector)、auto(url-test)、ai、media、telegram、apple、microsoft、direct、block、dns-out
- 13 个远程规则集（SagerNet GitHub .srs 文件）

### Agent 配置下发与 Hy2 管理

控制面采用 **Agent 拉取式**：面板只保存期望状态和任务队列，Agent 周期性向面板发起 sync；面板不主动连接节点，Agent 不开放任何入站管理端口。

- Sync 入口：`POST /api/node/agent/[authPath]/sync`
- 认证：请求头 `X-H2O-Agent-Timestamp`、`X-H2O-Agent-Nonce`、`X-H2O-Agent-Signature`，签名消息为 `timestamp\nnonce\nMETHOD\npathname\nsha256(body)`，密钥是 `nodes.agent_secret`
- 防重放：`agent_request_nonces` 记录 nonce，有效期 10 分钟；timestamp 允许约 5 分钟时钟偏差
- 状态：Agent 上报 `agent_version`、主机信息、service manager、Hy2 状态/版本、本地配置 path/hash/revision、last error、capabilities，写入 `node_agent_state`
- 配置：面板用 `lib/hysteria-server-config.ts` 生成规范 Hy2 YAML，并用 `agent_config_revision` + `agent_desired_config_hash` 管理期望版本；需要下发时 sync 返回 `APPLY_CONFIG` 任务 payload
- 任务队列：`node_agent_tasks`，允许任务类型为 `HY2_STATUS` / `HY2_START` / `HY2_STOP` / `HY2_RESTART` / `HY2_LOGS` / `AGENT_LOGS` / `APPLY_CONFIG` / `AGENT_SELF_UPDATE`
- 任务安全：禁止 `RUN_COMMAND` / `EXEC` 等任意命令；Agent 只执行固定白名单操作
- 管理 API：`GET /api/admin/nodes/[id]/agent`、`GET|POST /api/admin/nodes/[id]/tasks`、`GET /api/admin/nodes/[id]/agent-config`、`POST /api/admin/nodes/[id]/agent-secret`、`GET /api/admin/agent-tasks`

### 一键部署

`GET /api/admin/nodes/[id]/deploy-command` 生成 `curl | bash` 部署命令，将所有节点配置（证书、ACME、obfs、masquerade、agent）编码为 base64url payload。`GET /api/deploy/node-install` 负责解析 payload 并输出自包含的 bash 安装脚本。部署命令会复用并持久化 `hy2_stats_secret` 与 `agent_secret`，生成的 Hy2 配置将 `trafficStats.listen` 绑定到 `127.0.0.1:9999`。

### Cloudflare DNS 管理

`POST /api/admin/nodes/[id]/dns` 通过 Cloudflare API 为节点域名创建/更新 A/AAAA 记录。`GET /api/admin/nodes/dns-status` 检查所有节点的 DNS 解析状态（match/mismatch/unresolved/skip）。API token 通过站点设置 `cloudflare_api_token` 配置。

### API 返回体约定

所有 `/api/*` 路由统一返回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`，错误码是大写下划线常量。节点认证回调是唯一例外：为符合 Hysteria2 协议，统一返回 `{ ok, id }`。

### 站点设置

`lib/settings.ts` 管理 key-value 站点配置，存入 `settings` 表：

| 设置键（DB key） | 常量名 | 类型 | 默认值 | 敏感 | 公开 |
|------------------|--------|------|--------|------|------|
| `registration_enabled` | `registrationEnabled` | boolean | `true` | | ✓ |
| `login_enabled` | `loginEnabled` | boolean | `true` | | ✓ |
| `new_user_default_active` | `newUserDefaultActive` | boolean | `true` | | |
| `turnstile_site_key` | `turnstileSiteKey` | string | `""` | | ✓ |
| `turnstile_secret_key` | `turnstileSecretKey` | string | `""` | ✓ | |
| `agent_bundle_url` | `agentBundleUrl` | string | `""` | | |
| `stats_retention_days` | `statsRetentionDays` | number | `30` | | |
| `cloudflare_api_token` | `cloudflareApiToken` | string | `""` | ✓ | |
| `acme_email` | `acmeEmail` | string | `""` | | |

### 路由结构

- `app/(dashboard)/` — 路由组，`layout.tsx` 套 `DashboardShell`（客户端组件，挂载时调 `/api/auth/session` 做二次权限校验并重定向）
  - `dashboard/` — 普通用户自助
  - `admin/` — 管理员区（users/nodes/plans/subscriptions/auth-logs/event-logs/traffic-analysis/settings），`DashboardShell` 会过滤非 admin
- `app/api/auth/*` — 登录/注册/登出/session 查询/bootstrap-admin
- `app/api/admin/*` — 所有走 `requireAdmin`
- `app/api/user/*` — 走 `requireUser`（self/reset-token/dashboard）
- `app/api/node/auth/[authPath]` — Hysteria2 单用户认证回调，**不用**会话校验
- `app/api/node/auth/[authPath]/traffic` — Agent 批量流量上报，**不用**会话校验
- `app/api/sub/[token]` — 订阅分发，用 `auth_token` 匹配，**不用**会话校验
- `app/api/settings/public` — 公开只读设置，**不用**会话校验
- `app/api/deploy/node-install` — 一键部署脚本生成，**不用**会话校验

### 前端架构

**关键模式**：
- 所有页面都是客户端组件（`"use client"`），所有 layout 都是服务端组件（仅设 metadata + 透传 children）
- 数据获取用 `useEffect` + `fetch`，无 React Server Components 数据获取、无 SWR/react-query
- 状态管理全部用局部 `useState`，无全局状态（无 Redux/Zustand/Jotai），Context 仅用于 `ConfirmProvider` 和 `ThemeProvider`
- 确认/提示使用 `useConfirm()` hook 提供的 promise-based `confirm()` / `alert()` 替代原生浏览器对话框
- 数据可视化全部用 recharts（LineChart、BarChart、AreaChart）
- 搜索选择框用 `Command` + `Popover` 组合模式

**DashboardShell**（`components/dashboard-shell.tsx`）：侧边栏布局，校验 session 并重定向，admin 用户有完整菜单（管理概览、用户/节点/套餐/订阅管理、日志子菜单、流量分析、站点设置），检查版本更新并提示。

**shadcn/ui 组件列表**：Badge, Breadcrumb, Button, Card, Chart, Checkbox, Collapsible, Command, Dialog, DropdownMenu, Input, InputGroup, Label, Popover, Select, Separator, Sheet, Sidebar, Skeleton, Sonner, Table, Textarea, Tooltip

### lib 内部依赖图

```
db.ts ← auth.ts, settings.ts
logs-db.ts（独立）
password.ts（独立）
tokens.ts（独立）
settings.ts → db.ts
auth.ts → db.ts
turnstile.ts → settings.ts
cloudflare.ts（独立）
port-hopping.ts（独立）
hysteria-uri.ts（独立）
utils.ts（独立）

subscription/client-type.ts（独立）
subscription/node-proxy.ts → hysteria-uri.ts, port-hopping.ts
subscription/clash-template.ts → node-proxy.ts（仅类型）
subscription/singbox-template.ts → node-proxy.ts（仅类型）
subscription/build-clash.ts → hysteria-uri.ts, clash-template.ts, node-proxy.ts + yaml
subscription/build-singbox.ts → hysteria-uri.ts, singbox-template.ts, node-proxy.ts
```

### 组件与样式

- 路径别名：`@/*` → 仓库根（tsconfig `baseUrl: "."`）
- shadcn 别名：components=`@/components`、ui=`@/components/ui`、lib=`@/lib`、hooks=`@/hooks`、utils=`@/lib/utils`
- 主题走 `next-themes` + `components/theme-provider.tsx`（按 `D` 键切换暗/亮主题）；Turnstile widget 在 `components/turnstile-widget.tsx`，未配置 site key 直接返回 null，theme 跟随 `useTheme().resolvedTheme`

### 部署

**Docker**：三阶段构建（deps → builder → runner），`node:24-alpine` + `tini`，standalone 输出，非 root 用户 `nextjs:nodejs`（uid/gid 1001），数据卷 `/app/data`。

**docker-compose.yml**：

```yaml
services:
  h2o:
    image: sipcink/h2o:latest
    ports: ["3000:3000"]
    volumes: ["./data:/app/data"]
    environment:
      TZ: Asia/Shanghai
      # H2O_SECURE_COOKIE: "false"  # 纯 HTTP 部署取消注释
    restart: unless-stopped
```

**CI/CD**（`.github/workflows/auto-release.yml`）：推送到 `master` 且 `package.json` version 变更时自动触发，构建 Go agent 双架构二进制 + 发布 GitHub Release + 推送 Docker 镜像到 Docker Hub（`sipcink/h2o:latest` + `sipcink/h2o:v{version}`）。支持 `workflow_dispatch` 手动触发并可覆盖版本号。

### 完整 API 清单（32 路由文件，38 个 handler）

**认证 `/api/auth/*`**

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/auth/bootstrap-admin` | 无 | 创建首个管理员 |
| POST | `/api/auth/login` | 无 | 用户名密码登录 + Turnstile |
| POST | `/api/auth/logout` | 无 | 登出（幂等） |
| POST | `/api/auth/register` | 无 | 用户注册 + Turnstile |
| GET | `/api/auth/session` | `requireUser` | 返回当前 session 用户 |

**管理员 `/api/admin/*`**

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/admin/users` | `requireAdmin` | 用户列表 |
| POST | `/api/admin/users` | `requireAdmin` | 创建用户 |
| PATCH | `/api/admin/users/[id]` | `requireAdmin` | 更新用户 |
| DELETE | `/api/admin/users/[id]` | `requireAdmin` | 删除用户 |
| GET | `/api/admin/nodes` | `requireAdmin` | 节点列表 + 最新统计 |
| POST | `/api/admin/nodes` | `requireAdmin` | 创建节点 |
| PATCH | `/api/admin/nodes/[id]` | `requireAdmin` | 更新节点 |
| DELETE | `/api/admin/nodes/[id]` | `requireAdmin` | 删除节点 |
| GET | `/api/admin/nodes/[id]/deploy-command` | `requireAdmin` | 生成一键部署命令 |
| POST | `/api/admin/nodes/[id]/dns` | `requireAdmin` | 创建/更新 Cloudflare DNS |
| GET | `/api/admin/nodes/dns-status` | `requireAdmin` | 全部节点 DNS 状态 |
| GET | `/api/admin/nodes/history` | `requireAdmin` | 24 小时节点流量历史 |
| GET | `/api/admin/plans` | `requireAdmin` | 套餐列表 |
| POST | `/api/admin/plans` | `requireAdmin` | 创建套餐（事务） |
| PATCH | `/api/admin/plans/[id]` | `requireAdmin` | 更新套餐（事务） |
| DELETE | `/api/admin/plans/[id]` | `requireAdmin` | 删除套餐（有订阅引用时拒绝） |
| GET | `/api/admin/subscriptions` | `requireAdmin` | 订阅列表 |
| POST | `/api/admin/subscriptions` | `requireAdmin` | 创建订阅 |
| PATCH | `/api/admin/subscriptions/[id]` | `requireAdmin` | 更新订阅 |
| DELETE | `/api/admin/subscriptions/[id]` | `requireAdmin` | 删除订阅 |
| GET | `/api/admin/subscriptions/history` | `requireAdmin` | 24 小时订阅流量历史 |
| GET | `/api/admin/auth-logs` | `requireAdmin` | 认证日志（分页+筛选） |
| GET | `/api/admin/event-logs` | `requireAdmin` | 事件日志（分页+筛选） |
| GET | `/api/admin/settings` | `requireAdmin` | 全部站点设置 |
| PATCH | `/api/admin/settings` | `requireAdmin` | 更新白名单设置键 |
| GET | `/api/admin/traffic/overview` | `requireAdmin` | 全局 24 小时流量概览 |
| GET | `/api/admin/traffic/analysis` | `requireAdmin` | 日期范围流量分析 |
| GET | `/api/admin/version-check` | `requireAdmin` | 检查 GitHub 新版本 |

**用户 `/api/user/*`**

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/user/self` | `requireUser` | 当前用户信息 |
| GET | `/api/user/dashboard` | `requireUser` | 用户仪表盘聚合数据 |
| POST | `/api/user/self/reset-token` | `requireUser` | 轮换 auth_token |

**节点认证 `/api/node/auth/*`**（无会话校验）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/node/auth/[authPath]` | Hysteria2 单用户 HTTP auth 回调 |
| POST | `/api/node/auth/[authPath]/traffic` | Agent 批量流量上报 |

**订阅 `/api/sub/*`**（无会话校验）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/sub/[token]` | 订阅分发（自动检测客户端格式） |

**公开**（无会话校验）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/settings/public` | 公开只读设置 |
| GET | `/api/deploy/node-install` | 一键部署 bash 脚本 |

### 完整错误码表

| 错误码 | 使用路由 |
|--------|----------|
| `INVALID_PAYLOAD` | bootstrap-admin, login, register, nodes POST, plans POST/PATCH, subscriptions POST/PATCH, settings PATCH, user PATCH, node traffic |
| `INVALID_ID` | users/nodes/plans/subscriptions PATCH/DELETE, deploy-command, DNS |
| `NOT_FOUND` | users/nodes/plans/subscriptions PATCH/DELETE, user dashboard, deploy-command, DNS |
| `CREATE_FAILED` | bootstrap-admin, users POST, nodes POST, plans POST, subscriptions POST |
| `DELETE_FAILED` | users DELETE, nodes DELETE, plans DELETE |
| `UPDATE_FAILED` | plans PATCH |
| `ADMIN_EXISTS` | bootstrap-admin |
| `USER_EXISTS` | register |
| `INVALID_CREDENTIALS` | login |
| `LOGIN_DISABLED` | login |
| `REGISTRATION_DISABLED` | register |
| `TURNSTILE_MISCONFIGURED` | login, register |
| `TURNSTILE_FAILED` | login, register |
| `INVALID_PASSWORD` | user PATCH |
| `SELF_DEMOTE_FORBIDDEN` | user PATCH |
| `SELF_DISABLE_FORBIDDEN` | user PATCH |
| `CANNOT_DELETE_SELF` | user DELETE |
| `INVALID_PORT` | nodes POST/PATCH |
| `INVALID_NODE_PORT` | nodes POST/PATCH |
| `INVALID_TRAFFIC` | plans PATCH, subscriptions PATCH |
| `INVALID_DURATION` | plans PATCH |
| `INVALID_SPEED` | plans PATCH |
| `INVALID_STATUS` | subscriptions PATCH |
| `INVALID_EXPIRE` | subscriptions PATCH |
| `PLAN_NOT_FOUND` | subscriptions POST |
| `PLAN_IN_USE` | plans DELETE |
| `UNKNOWN_KEY` | settings PATCH |
| `NOT_A_DOMAIN` | DNS |
| `NO_NODE_IP` | DNS |
| `NO_CF_TOKEN` | DNS |
| `CF_ZONE_NOT_FOUND` | DNS |
| `CF_API_ERROR` | DNS |
| `UNSUPPORTED_OBFS` | deploy-command |
| `INVALID_NODE_CONFIG` | deploy-command |
| `INVALID_PANEL_URL` | deploy-command, deploy |
| `INVALID_AGENT_BUNDLE_URL` | deploy-command |
| `INVALID_STATS_SECRET` | deploy |
| `INVALID_INTERVAL` | deploy |
| `INVALID_CURRENT_VERSION` | version-check |
| `BAD_PAYLOAD` | node auth, node traffic |
| `NO_NODE` | node auth, node traffic |
| `NO_USER` | node auth, node traffic |
| `USER_DISABLED` | node auth |
| `NO_SUB` | node auth, node traffic |
| `TRAFFIC_EXCEEDED` | node traffic |
| `INTERNAL` | node traffic |
| `FORBIDDEN` | 保留，当前未直接使用 |

## 写代码约定

- 需要注释时用**简洁中文**注释（现有代码风格）。
- 用户面字符串全部中文。
- 密码用 `lib/password.ts` 的 scrypt（格式 `scrypt$salt$hash`），不要引入 bcrypt 等。
- 涉及多表 / 多行写入要用 `db.exec("BEGIN")` / `COMMIT` / `ROLLBACK` 显式事务（参考 `admin/plans` 的创建与更新）。
- Next.js 16 的动态路由 `params` 是 **Promise**，必须 `await`（代码里一律这么写）。
- API 路由统一返回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`。
- 站点设置的敏感 key（`turnstileSecretKey`, `cloudflareApiToken`）在事件日志中脱敏记录。
- 管理员不能自我降级、自我禁用、自我删除。
- `ALTER TABLE ADD COLUMN` 用 try-catch 包裹以支持安全重入（已存在的列会抛错被 catch）。
