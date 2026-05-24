# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

H2O 是企业内网使用的 Hysteria2 订阅与节点认证管理面板：后端提供用户/套餐/订阅/节点 CRUD、Hysteria2 HTTP 认证回调、Agent 拉取式配置下发与 Hy2 管理、Agent 流量上报统计、Hysteria/Clash/sing-box 订阅分发；前端提供管理员后台与普通用户自助面板。

技术栈：Next.js 16 App Router + React 19 + TypeScript + Tailwind v4 + shadcn/ui，SQLite 使用 Node 内建 `node:sqlite`，节点侧 Agent 是 Go 1.22 stdlib-only 程序。

## 常用命令

使用 **pnpm**（仓库有 `pnpm-lock.yaml`，`packageManager` 当前为 `pnpm@10.33.0`）。

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
   - 管理员修改 Turnstile key 时，`POST /api/admin/settings` 会先在线测试并生成 proof，`PATCH /api/admin/settings` 保存时校验该 proof
2. 启动后访问 `/init` 引导创建第一个管理员（`POST /api/auth/bootstrap-admin`）。已存在 admin 时该接口返回 `ADMIN_EXISTS`。
3. 数据库首次调用 `getDb()` / `getLogsDb()` 时自动建表，无外部迁移工具；业务库还会通过 `ensureForwardCompatibleColumns()` 对若干历史字段做安全补列。

## 架构要点

### 双 SQLite 文件（Node 内建驱动）

使用 Node.js 内建 `node:sqlite` 的 `DatabaseSync`，**没有** `better-sqlite3`/`sqlite3` 依赖。需要 Node 版本支持 `node:sqlite`（Node 22+ 实验性 / Node 23+ 稳定；Docker 运行镜像使用 Node 24）。

- `lib/db.ts` → 业务库 `data/h2o.sqlite`（可用 `H2O_DB_PATH` 覆盖）：`users`, `nodes`, `plans`, `plan_nodes`, `subscriptions`, `sessions`, `settings`, `node_stats`, `node_user_traffic`, `traffic_hourly_stats`, `node_hourly_traffic`, `subscription_hourly_traffic`, `node_agent_state`, `node_agent_tasks`, `agent_request_nonces`
- `lib/logs-db.ts` → 日志库 `data/h2o-logs.sqlite`（可用 `H2O_LOGS_DB_PATH` 覆盖）：`auth_logs`（节点认证日志）、`event_logs`（业务事件日志）、`agent_traffic_reports` / `agent_traffic_user_logs`（Agent 上报日志）

两库分离的设计目的是让日志可单独归档/清理，不影响业务库。两者都采用单例 + 懒加载，首次取用时 `migrate()` 建表并打开 `PRAGMA foreign_keys = ON`。

**迁移注意**：本项目没有完整版本化迁移系统。`lib/db.ts` 的 `migrate()` 维护当前 schema，并调用 `ensureForwardCompatibleColumns()` 对老库执行一组 `ALTER TABLE ADD COLUMN` 安全补列；`getDb()` 在已有单例时也会再次执行补列。新增补列必须用 try-catch 包裹。

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
| `remark` | `TEXT` | nullable（管理员备注） |
| `ip` | `TEXT` | `NOT NULL`（订阅输出的地址/域名；DNS 管理时也作为域名） |
| `port` | `INTEGER` | `NOT NULL`（订阅输出主端口） |
| `port_hopping` | `TEXT` | nullable（逗号分隔端口范围，如 `443,5000-6000`） |
| `auth_path` | `TEXT` | `NOT NULL UNIQUE`（节点认证路径；Agent 流量上报也用它标识节点） |
| `status` | `TEXT` | `NOT NULL DEFAULT 'enabled'`, `CHECK(status IN ('enabled','disabled'))` |
| `sni` | `TEXT` | nullable |
| `obfs` | `TEXT` | nullable（当前一键部署支持空、`salamander` 或 `gecko`） |
| `obfs_password` | `TEXT` | nullable |
| `obfs_min_packet_size` | `INTEGER` | nullable（Gecko 握手分片最小包大小，空则默认 512） |
| `obfs_max_packet_size` | `INTEGER` | nullable（Gecko 握手分片最大包大小，空则默认 1200，最大 2048） |
| `insecure` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK(insecure IN (0,1))` |
| `pin_sha256` | `TEXT` | nullable |
| `node_ip` | `TEXT` | nullable（实际部署节点 IP；DNS 管理写入 A/AAAA 的目标） |
| `node_port` | `INTEGER` | nullable（实际部署端口；为空则回退 `port`） |
| `node_port_hopping` | `TEXT` | nullable（实际部署端口跳跃；仅 `node_port` 已设置时使用） |
| `cert_mode` | `TEXT` | `NOT NULL DEFAULT 'self-signed'`（应用层支持 `self-signed` / `acme-http` / `acme-dns` / `custom`；旧 `acme` 归一为 `acme-dns`） |
| `cert_path` | `TEXT` | nullable |
| `key_path` | `TEXT` | nullable |
| `acme_domains` | `TEXT` | nullable（JSON 字符串数组） |
| `acme_email` | `TEXT` | nullable |
| `acme_dns_provider` | `TEXT` | nullable |
| `acme_dns_config` | `TEXT` | nullable（JSON 字符串，Cloudflare token 可节点级覆盖） |
| `masquerade_type` | `TEXT` | nullable |
| `masquerade_config` | `TEXT` | nullable（JSON 字符串） |
| `agent_interval` | `INTEGER` | nullable（Agent 上报/同步间隔秒数，默认 120） |
| `agent_auto_update_enabled` | `INTEGER` | `NOT NULL DEFAULT 1`, `CHECK(agent_auto_update_enabled IN (0,1))` |
| `hy2_auto_update_enabled` | `INTEGER` | `NOT NULL DEFAULT 1`, `CHECK(hy2_auto_update_enabled IN (0,1))`（Agent 侧每日检查并更新 Hy2） |
| `hy2_stats_secret` | `TEXT` | nullable（Hy2 `trafficStats.secret`，首次部署/取配置时持久化） |
| `agent_secret` | `TEXT` | nullable（Agent 控制面 HMAC 共享密钥，32 字节随机 hex） |
| `agent_control_enabled` | `INTEGER` | `NOT NULL DEFAULT 1`, `CHECK(agent_control_enabled IN (0,1))` |
| `agent_config_revision` | `INTEGER` | `NOT NULL DEFAULT 1`（期望 Hy2 配置版本） |
| `agent_desired_config_hash` | `TEXT` | nullable（面板生成的期望 Hy2 配置 SHA-256） |
| `agent_last_config_built_at` | `TEXT` | nullable |
| `host_traffic_limit_bytes` | `INTEGER` | nullable（宿主机/节点总流量上限；NULL/0 表示关闭） |
| `host_traffic_used_bytes` | `INTEGER` | `NOT NULL DEFAULT 0`（当前宿主机流量周期已用） |
| `host_traffic_billing_mode` | `TEXT` | `NOT NULL DEFAULT 'tx_rx'`, `CHECK(host_traffic_billing_mode IN ('tx_rx','tx','rx'))` |
| `host_traffic_reset_cycle` | `TEXT` | `NOT NULL DEFAULT 'monthly'`, `CHECK(host_traffic_reset_cycle IN ('none','daily','weekly','monthly','custom_days'))` |
| `host_traffic_reset_interval_days` | `INTEGER` | nullable（`custom_days` 时使用，1~366） |
| `host_traffic_reset_anchor` | `TEXT` | nullable（当前宿主机流量周期锚点） |
| `host_traffic_last_reset_at` | `TEXT` | nullable |
| `sort_order` | `INTEGER` | `NOT NULL DEFAULT 0`（节点后台展示与订阅输出排序） |
| `created_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |

`plans`

| 列 | 类型 | 约束 |
|----|------|------|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` |
| `name` | `TEXT` | `NOT NULL UNIQUE` |
| `traffic_limit_bytes` | `INTEGER` | `NOT NULL` |
| `traffic_billing_mode` | `TEXT` | `NOT NULL DEFAULT 'tx_rx'`, `CHECK(traffic_billing_mode IN ('tx_rx','tx','rx'))` |
| `duration_days` | `INTEGER` | `NOT NULL`（`0` 表示永久套餐） |
| `up_mbps` | `INTEGER` | `NOT NULL DEFAULT 0`（0 = 不限速） |
| `down_mbps` | `INTEGER` | `NOT NULL DEFAULT 0`（0 = 不限速） |
| `auto_renew` | `INTEGER` | `NOT NULL DEFAULT 0`, `CHECK(auto_renew IN (0,1))` |
| `renewal_period_days` | `INTEGER` | nullable |

`traffic_billing_mode` 取值：`tx_rx` = 上行+下行计入套餐用量；`tx` = 仅上行；`rx` = 仅下行。小时统计表仍保存真实 tx/rx 增量，不受套餐计费口径影响。

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
| `used_traffic_bytes` | `INTEGER` | `NOT NULL DEFAULT 0`（按套餐 `traffic_billing_mode` 计费后的用量） |
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

`node_stats`（节点心跳与在线/流量快照，由 Agent 流量上报更新）

| 列 | 类型 | 约束 |
|----|------|------|
| `node_id` | `INTEGER` | `PRIMARY KEY`, `FK → nodes(id) ON DELETE CASCADE` |
| `last_report_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |
| `online_count` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `online_snapshot` | `TEXT` | nullable（JSON，每个用户名 → 在线数） |
| `traffic_snapshot` | `TEXT` | nullable（JSON，每个用户名 → {tx, rx}） |
| `agent_version` | `TEXT` | nullable（历史字段；当前 Agent 版本主要来自 `node_agent_state.agent_version`） |

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

`subscription_hourly_traffic`（订阅维度小时流量，记录真实 tx/rx 增量）

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

当前允许任务类型：`HY2_STATUS` / `HY2_START` / `HY2_STOP` / `HY2_RESTART` / `HY2_LOGS` / `HY2_SELF_UPDATE` / `AGENT_LOGS` / `AGENT_RESTART` / `APPLY_CONFIG` / `AGENT_SELF_UPDATE`。

`agent_request_nonces`（Agent HMAC 请求 nonce 防重放）

| 列 | 类型 | 约束 |
|----|------|------|
| `node_id` | `INTEGER` | `NOT NULL`, `FK → nodes(id) ON DELETE CASCADE` |
| `nonce` | `TEXT` | `NOT NULL` |
| `expires_at` | `TEXT` | `NOT NULL` |
| | | `PRIMARY KEY (node_id, nonce)` |

**业务库索引**：`idx_nodes_sort_order`, `idx_node_hourly_traffic_bucket`, `idx_subscription_hourly_traffic_bucket`, `idx_sub_user_status_expire`, `idx_sessions_user_id`, `idx_sessions_expires_at`, `idx_node_stats_last_report`, `idx_node_agent_state_last_seen`, `idx_node_agent_tasks_node_status`, `idx_node_agent_tasks_lease`, `idx_agent_request_nonces_expires`

**向前兼容补列**：当前 `ensureForwardCompatibleColumns()` 会安全补 `nodes.remark`, `nodes.port_hopping`, `plans.up_mbps`, `plans.down_mbps`, `plans.traffic_billing_mode`, 节点部署/证书/ACME/masquerade/agent 字段，`plans.auto_renew`, `plans.renewal_period_days`, `subscriptions.renewal_anchor`, `node_stats.agent_version`, `nodes.host_traffic_*`, `nodes.sort_order`，并创建 `idx_nodes_sort_order`。

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
| `reason` | `TEXT` | nullable |

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

`agent_traffic_reports`

| 列 | 类型 | 约束 |
|----|------|------|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` |
| `created_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |
| `node_id` | `INTEGER` | nullable |
| `node_name` | `TEXT` | nullable |
| `auth_path` | `TEXT` | `NOT NULL`（写入前脱敏） |
| `ip` | `TEXT` | nullable |
| `success` | `INTEGER` | `NOT NULL`, `CHECK(success IN (0,1))` |
| `reason` | `TEXT` | `NOT NULL` |
| `reported_users` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `online_count` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `total_tx_bytes` | `INTEGER` | `NOT NULL DEFAULT 0`（本次快照累计 tx 汇总） |
| `total_rx_bytes` | `INTEGER` | `NOT NULL DEFAULT 0`（本次快照累计 rx 汇总） |
| `delta_tx_bytes` | `INTEGER` | `NOT NULL DEFAULT 0`（本次处理增量 tx 汇总） |
| `delta_rx_bytes` | `INTEGER` | `NOT NULL DEFAULT 0`（本次处理增量 rx 汇总） |
| `agent_version` | `TEXT` | nullable（当前流量上报 payload 未携带，通常为空） |
| `detail` | `TEXT` | nullable |

`agent_traffic_user_logs`

| 列 | 类型 | 约束 |
|----|------|------|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` |
| `report_id` | `INTEGER` | `NOT NULL`, `FK → agent_traffic_reports(id) ON DELETE CASCADE` |
| `created_at` | `TEXT` | `NOT NULL DEFAULT (datetime('now'))` |
| `node_id` | `INTEGER` | nullable |
| `node_name` | `TEXT` | nullable |
| `user_id` | `INTEGER` | nullable |
| `username` | `TEXT` | `NOT NULL` |
| `reported_tx_bytes` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `reported_rx_bytes` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `last_tx_bytes` | `INTEGER` | nullable |
| `last_rx_bytes` | `INTEGER` | nullable |
| `delta_tx_bytes` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `delta_rx_bytes` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `online_count` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `subscription_id` | `INTEGER` | nullable |
| `success` | `INTEGER` | `NOT NULL`, `CHECK(success IN (0,1))` |
| `reason` | `TEXT` | `NOT NULL` |
| `detail` | `TEXT` | nullable |

`EventName` 类型（23 种事件）：`LOGIN` | `REGISTER` | `LOGOUT` | `RESET_TOKEN_SELF` | `RESET_TOKEN_ADMIN` | `BOOTSTRAP_ADMIN` | `USER_CREATE` | `USER_UPDATE` | `USER_DELETE` | `NODE_CREATE` | `NODE_UPDATE` | `NODE_DELETE` | `AGENT_TASK_CREATE` | `AGENT_SECRET_ROTATE` | `AGENT_CONFIG_VIEW` | `PLAN_CREATE` | `PLAN_UPDATE` | `PLAN_DELETE` | `SUBSCRIPTION_CREATE` | `SUBSCRIPTION_UPDATE` | `SUBSCRIPTION_DELETE` | `SUBSCRIPTION_FETCH` | `SETTINGS_UPDATE`

**日志索引**：`idx_auth_logs_created`, `idx_event_logs_created`, `idx_event_logs_event`, `idx_agent_traffic_reports_created`, `idx_agent_traffic_reports_node_created`, `idx_agent_traffic_reports_reason_created`, `idx_agent_traffic_user_logs_report`, `idx_agent_traffic_user_logs_created`, `idx_agent_traffic_user_logs_username_created`, `idx_agent_traffic_user_logs_node_created`

**保留策略**：`settings.stats_retention_days`（默认 30，合法 1~365）同时控制业务库小时统计和日志库保留。

- 业务库清理表：`traffic_hourly_stats`, `node_hourly_traffic`, `subscription_hourly_traffic`，由 Agent `/traffic` 上报事务内触发。
- 日志库清理表：`agent_traffic_user_logs`, `agent_traffic_reports`, `auth_logs`, `event_logs`。普通写日志触发有 1 小时节流；查询日志和更新设置会 force 清理。
- `agent_traffic_reports.auth_path` 写入前会 `maskAuthPath()` 脱敏；`migrate()` 也会修正历史未脱敏记录。

### 认证模型

这是理解本仓库最关键的一点，容易混淆：

1. **Web session**：cookie `h2o_session`（`lib/auth.ts`）
   - 32 字节随机 token，数据库里存 SHA-256，14 天 TTL
   - `createSession` / `getSessionUser` / `requireUser` / `requireAdmin` / `revokeSessionByRequest`
   - `proxy.ts` 只做**浅检查**（cookie 是否存在）用于页面路径重定向；真正权限校验在各 route 里用 `requireUser`/`requireAdmin` 完成
   - `requireUser()` 失败返回 `UNAUTHORIZED`，`requireAdmin()` 对非管理员返回 `FORBIDDEN`
2. **长静态 auth_token**：`users.auth_token`（24 字节随机 hex，`lib/tokens.ts::createUserAuthToken`）
   - Hysteria2 节点 HTTP 认证：`POST /api/node/auth/[authPath]`，body 里的 `auth` 字段即此 token
   - 用户订阅链接：主路径 `GET /api/sub?token=...`，兼容旧路径 `GET /api/sub/[token]`
   - 管理员可在 `PATCH /api/admin/users/[id]` 时 `resetAuthToken: true`，或用户自助 `POST /api/user/self/reset-token` 轮换（会同时使旧订阅链接失效）
3. **节点 auth_path**：`nodes.auth_path`
   - Hysteria2 HTTP auth 回调路径
   - Agent 批量流量上报路径，用于识别节点；不要随意暴露
4. **Agent 控制面 agent_secret**：`nodes.agent_secret`
   - 仅用于 `/api/node/agent/[authPath]/sync` HMAC 签名认证，携带 timestamp + nonce 防重放

**重要**：Hysteria2 节点认证默认使用用户长静态 `auth_token` + 节点 `auth_path`，不要给 `POST /api/node/auth/[authPath]` 额外加 nonce/短签名等机制；控制面签名只用于 Agent sync。

### Hysteria2 节点认证协议

`app/api/node/auth/[authPath]/route.ts` 实现 Hysteria2 的 HTTP auth 回调：

- 入参：`{ addr, auth, tx }`；当前实现只使用 `addr` 和 `auth`，`tx` 不参与计费
- 流程：校验 `authPath` → 节点启用 → 用户 `auth_token` 匹配 → 用户 active → 存在覆盖该节点的 active 且未过期订阅
- 返回体：`{ ok, id }`（`id` 是用户名，符合 Hysteria2 期望）
- 所有分支都会 `writeAuthLog` 写入日志库，HTTP auth 典型 reason：`BAD_PAYLOAD` / `NO_NODE` / `NO_USER` / `USER_DISABLED` / `NO_SUB` / `OK`

**注意**：单用户认证回调**只认证、不计费、不做超额封禁**。实际流量由 Agent 批量上报 `/api/node/auth/[authPath]/traffic` 后，根据 `node_user_traffic` 差值法、`plans.traffic_billing_mode` 和订阅状态进行结算。

### Agent 批量流量上报

`app/api/node/auth/[authPath]/traffic` 接收 Agent 定时上报的全量流量快照：

- 入参：`{ traffic: { "<username>": { tx, rx }, ... }, online: { "<username>": count, ... } }`
- 只要 `authPath` 匹配节点就允许上报，节点禁用也可继续上报状态；未知节点返回 `NO_NODE`
- 差值法：与 `node_user_traffic` 表中上次记录比较，计算增量；若 Hy2 重启导致计数器归零，则本轮增量按当前累计值处理
- 续订检查：流量累加前，对开启 `plans.auto_renew` 的 active/blocked 且未过期订阅按 `renewal_period_days` 清零用量并恢复 active
- 套餐计费：`subscriptions.used_traffic_bytes` 增加的是 `getBillableTrafficBytes(traffic_billing_mode, deltaTx, deltaRx)`
- 超额处理：`nextUsage > traffic_limit_bytes` 时把订阅状态改为 `blocked`，但本次真实 tx/rx 增量仍写入小时统计
- 统计写入：全局 `traffic_hourly_stats`、节点 `node_hourly_traffic`、订阅 `subscription_hourly_traffic` 都记录真实 tx/rx 增量
- 宿主机流量：按节点 `host_traffic_billing_mode` 累加 `nodes.host_traffic_used_bytes`；若没有增量也会检查是否需要周期重置
- 更新 `node_stats` 在线和流量快照
- 按 `settings.stats_retention_days` 清理旧小时统计
- 业务库全部在显式事务中执行；Agent 上报日志在事务外写入，日志库异常不影响业务流量结算
- 请求级/用户级日志写入 `agent_traffic_reports` / `agent_traffic_user_logs`，reason 包括 `OK` / `NO_USER` / `USER_DISABLED` / `NO_SUB` / `TRAFFIC_EXCEEDED` / `BAD_PAYLOAD` / `NO_NODE` / `INTERNAL`

### 套餐流量计费口径

`lib/plan-traffic.ts` 定义套餐流量计费方式：

| 模式 | 含义 |
|------|------|
| `tx_rx` | `delta_tx + delta_rx` 计入套餐用量 |
| `tx` | 仅 `delta_tx` 计入套餐用量 |
| `rx` | 仅 `delta_rx` 计入套餐用量 |

影响范围：

- `POST/PATCH /api/admin/plans` 的 `trafficBillingMode`
- `GET /api/admin/plans`、订阅管理、用户仪表盘的展示
- Agent 批量流量上报对 `subscriptions.used_traffic_bytes` 的累加

小时趋势表仍保存真实 tx/rx，不会因为套餐计费方式丢失方向数据。

### 宿主机/节点总流量配额

`lib/node-traffic-quota.ts` 管理节点宿主机流量额度，字段在 `nodes.host_traffic_*`：

- `host_traffic_limit_bytes`：总额度，NULL/0 表示不启用
- `host_traffic_used_bytes`：当前周期已用
- `host_traffic_billing_mode`：`tx_rx` / `tx` / `rx`
- `host_traffic_reset_cycle`：`none` / `daily` / `weekly` / `monthly` / `custom_days`
- `host_traffic_reset_interval_days`：自定义周期天数，1~366
- `host_traffic_reset_anchor` / `host_traffic_last_reset_at`

`GET /api/admin/nodes` 会对所有节点执行周期检查并返回摘要字段：`host_traffic_remaining_bytes`、`host_traffic_usage_ratio`、`host_traffic_next_reset_at`、`host_traffic_over_limit` 等。Agent `/traffic` 上报也会检查当前节点周期并累计用量。当前宿主机超额只作为统计/展示/告警口径，不阻断认证或上报。

### H2O Agent（Go 独立进程）

`agent/` 目录是独立 Go 程序，部署在每个 Hysteria2 节点上，负责采集 Hy2 Traffic Stats API、上报面板，并执行拉取式控制面任务。

**架构**：五个包——`main`（CLI、配置、信号处理、ticker 循环）、`stats`（并发获取 `/traffic` + `/online`）、`report`（POST 流量快照到面板）、`control`（拉取式控制面同步、Hy2 服务管理、配置应用、日志读取）、`selfupdate`（GitHub Release 更新 Agent）。

**通信**：
- 流量上报：`POST {h2o_url}/api/node/auth/{authPath}/traffic`，复用 `auth_path` 标识节点。Hy2 本地 API 通过 `Authorization: <secret>` 头认证（对应 Hy2 配置的 `trafficStats.secret`）。当前 `report.Send()` payload 只包含 `traffic` / `online`，不携带 `agent_version`。
- 控制面同步：`POST {h2o_url}/api/node/agent/{authPath}/sync`，使用 `agent_secret` 做 HMAC-SHA256 签名，携带 timestamp + nonce 防重放。Agent 不监听任何入站端口。面板节点页展示的 Agent 版本主要来自 control sync 的 `node_agent_state.agent_version`。

**配置**（`agent/config.json` / `/etc/h2o-agent/config.json`）：

| 字段 | 说明 |
|------|------|
| `h2o_url` | 面板地址 |
| `auth_path` | 从面板节点页面复制 |
| `agent_secret` | Agent 控制面 HMAC 密钥，从面板节点「Agent 配置」复制 |
| `control_enabled` | 是否启用控制面同步，默认按是否存在 `agent_secret` 自动开启 |
| `hysteria_stats_url` | 本地 Hy2 Stats API，默认 `http://127.0.0.1:9999` |
| `hysteria_stats_secret` | Hy2 配置的 `trafficStats.secret`，由面板持久化生成 |
| `interval_seconds` | 上报/同步间隔，默认 120 |
| `auto_update_enabled` | 是否允许更新 Agent，默认 true |
| `hy2_auto_update_enabled` | 是否允许 Agent 每日检查并更新 Hysteria2，默认 true |
| `hysteria_config_path` | Hy2 配置路径，默认 `/etc/hysteria/config.yaml` |
| `hysteria_service_name` | Hy2 服务名，默认 `hysteria-server` |
| `agent_config_path` | Agent 自身配置路径，默认当前 `-c` 参数 |

**运行流程**：
- 支持 CLI 参数：`-c`、`-self-update`、`-version`
- 首次启动延迟 10 秒再同步/上报，给 Hy2 初始化和证书申请预留时间
- 每轮先执行 `control.Sync()`（若启用），再抓取 Hy2 `/traffic` + `/online` 并上报面板
- 抓取 Hy2 stats 和上报面板都做 3 次尝试，重试间隔 2s/4s

**构建**：`agent/build.sh` 交叉编译 `linux/amd64` + `linux/arm64`（CGO_ENABLED=0，静态，strip），从根目录 `package.json` 注入版本，打包为 `dist/h2o-agent-bundle.tar.gz` 并生成 `.sha256`。

**安装**：`agent/install.sh` 是 bundle 内的 systemd 安装脚本：自动检测架构、创建系统用户 `h2o-agent`、安装二进制与 systemd service/timer。service 未设置 `User=`，实际以 root 运行，便于控制 Hy2 服务和写入 `/etc/hysteria/config.yaml`。一键部署脚本（`/api/deploy/node-install` 输出）额外支持 systemd 与 OpenRC/Alpine，OpenRC 下会创建 init 脚本与 daily 更新 Agent 任务。

**更新 Agent**：`selfupdate` 访问 GitHub API `https://api.github.com/repos/SIPC/H2O/releases/latest`，按架构下载 `h2o-agent-linux-amd64` / `h2o-agent-linux-arm64` 及 `.sha256`，校验通过后原子替换当前二进制；更新成功以 exit code `2` 表示需要重启。`Version=dev` 时跳过更新。

**Go 依赖**：零外部依赖，仅 stdlib，`go 1.22`。

### 订阅链接

订阅分发核心在 `lib/subscription/serve-subscription.ts`：

- 主路径：`GET /api/sub?token=...`；兼容旧路径：`GET /api/sub/[token]`
- token 即用户的 `users.auth_token`
- 用户必须存在且 `status = active`，否则返回普通 `404 Not Found` 文本（不走统一 JSON 错误体）
- 聚合用户所有 active 且未过期订阅对应的 enabled 节点，按节点去重
- 节点排序：`ORDER BY n.sort_order ASC, n.id ASC`
- 同一节点被多个套餐覆盖时，限速取“最宽松”：任一套餐 `up_mbps/down_mbps = 0` → 最终不限速 `0`；否则取 `MAX`
- 每个节点走 `lib/hysteria-uri.ts::buildHysteriaUri` 生成 `hysteria2://` URI
- 根据 User-Agent **自动检测**输出格式（`lib/subscription/client-type.ts::detectFormat`）：
  - Clash 客户端 → YAML 配置（`lib/subscription/build-clash.ts`）
  - sing-box 客户端 → JSON 配置（`lib/subscription/build-singbox.ts`）
  - 其他 → 默认 base64 编码 URI 列表，`?format=plain` 返回明文
- 响应头带 `Cache-Control: no-store`、`Subscription-Userinfo: upload=0; download=<used>; total=<total>; expire=<ts>` 与 `Profile-Update-Interval: 24`
- `app/api/user/dashboard/route.ts` 返回 `subscriptionPath: /api/sub?token=...`，前端拼接完整 URL
- 每次拉取写 `SUBSCRIPTION_FETCH` 事件日志，URL/token 会脱敏，reason 可能为 `INVALID_TOKEN` / `NO_USER` / `USER_DISABLED` / `NO_NODES` / `OK`

#### 客户端检测逻辑

`lib/subscription/client-type.ts::detectFormat`：`?format=` 查询参数优先，支持 `clash` / `singbox` / `plain` / `base64`；否则 User-Agent 正则匹配：
- `/clash|mihomo|stash|verge/i` → `clash`
- `/sing-?box|\bSFA\b|\bSFI\b|\bSFM\b|\bSFT\b|hiddify|karing/i` → `singbox`
- `/v2rayn/i` → `base64`
- 默认 → `base64`

#### Clash 模板

`lib/subscription/clash-template.ts` 生成完整 Clash Meta (mihomo) 配置：
- 混合端口 7890，fake-ip DNS，DoT 国内（阿里/114）+ DoH 国外走代理
- 代理组：🚀 节点选择(select)、♻️ 自动选择(url-test)、🤖 AI、📺 国际媒体、📲 Telegram、🍎 苹果服务、Ⓜ️ 微软服务、🛑 广告拦截、🐟 漏网之鱼
- 12 个 ACL4SSR 规则集，内联 AI 规则（OpenAI/Anthropic/Gemini 等）
- mihomo 对 `pin_sha256` 支持有限，相关节点会退化为跳过证书校验策略

#### sing-box 模板

`lib/subscription/singbox-template.ts` 生成 sing-box 1.x 配置：
- DNS：`tls://1.1.1.1` 走代理、`tls://223.5.5.5` 直连
- 入站：mixed (127.0.0.1:7890)、tun（IPv4 `172.19.0.1/30` + IPv6 `fdfe:dcba:9876::1/126`，`auto_route`, `strict_route`, `stack: "mixed"`, `sniff`）
- 出站：`proxy`(selector)、`auto`(urltest)、`ai`、`media`、`telegram`、`apple`、`microsoft`、`direct`
- 12 个远程规则集（SagerNet GitHub `.srs` 文件），广告规则走 reject，国内规则直连，final 走 `proxy`

### Agent 配置下发与 Hy2 管理

控制面采用 **Agent 拉取式**：面板只保存期望状态和任务队列，Agent 周期性向面板发起 sync；面板不主动连接节点，Agent 不开放任何入站管理端口。

- Sync 入口：`POST /api/node/agent/[authPath]/sync`
- 认证：请求头 `X-H2O-Agent-Timestamp`、`X-H2O-Agent-Nonce`、`X-H2O-Agent-Signature`，签名消息为 `timestamp\nnonce\nMETHOD\npathname\nsha256(body)`，密钥是 `nodes.agent_secret`
- 防重放：`agent_request_nonces` 记录 nonce，有效期 10 分钟；timestamp 允许约 5 分钟时钟偏差
- 状态：Agent 上报 `agent_version`、主机信息、service manager、Hy2 状态/版本、本地配置 path/hash/revision、last error、capabilities，写入 `node_agent_state`
- 任务结果：Agent 在下一次 sync 的 `task_results` 回传，面板更新 `node_agent_tasks.status/result/error/finished_at`
- 配置：面板用 `lib/hysteria-server-config.ts` 生成规范 Hy2 YAML，并用 `agent_config_revision` + `agent_desired_config_hash` 管理期望版本；当 Agent 本地 hash/revision 与期望不一致时，sync 会返回一个虚拟 `APPLY_CONFIG` 任务（`id: 0`）
- 任务领取：sync 会领取最多 5 个 queued 或 lease 过期的 claimed 任务并设置 lease
- 返回字段包括 `server_time`、`control_enabled`、`desired_config`、`agent_config`、`tasks`
- 任务队列：`node_agent_tasks`，允许任务类型为 `HY2_STATUS` / `HY2_START` / `HY2_STOP` / `HY2_RESTART` / `HY2_LOGS` / `HY2_SELF_UPDATE` / `AGENT_LOGS` / `AGENT_RESTART` / `APPLY_CONFIG` / `AGENT_SELF_UPDATE`
- 任务安全：禁止 `RUN_COMMAND` / `EXEC` 等任意命令；Agent 只执行固定白名单操作
- 常见错误码：`BAD_PAYLOAD` / `NO_NODE` / `AGENT_CONTROL_DISABLED` / `AGENT_SECRET_MISSING` / `UNAUTHORIZED` / `REPLAY_DETECTED` / `INTERNAL`
- 管理 API：`GET /api/admin/nodes/[id]/agent`、`GET|POST /api/admin/nodes/[id]/tasks`、`GET /api/admin/nodes/[id]/agent-config`、`POST /api/admin/nodes/[id]/agent-secret`、`GET /api/admin/agent-tasks`

Agent 执行任务要点：
- `HY2_START` / `HY2_RESTART` 前会清理 `HYSTERIA-*` iptables/ip6tables nat 链
- `HY2_LOGS` / `AGENT_LOGS` 在 systemd 下读 `journalctl`，OpenRC 下读对应 `/var/log/*.log`
- `APPLY_CONFIG` 会校验 YAML hash、备份旧配置、写入 revision/applied-at 元信息、重启 Hy2；失败尝试回滚
- `AGENT_RESTART` 先回传任务结果，再重启 Agent 服务
- `HY2_SELF_UPDATE` 从 `apernet/hysteria` 最新 Release 下载当前架构二进制，校验 SHA256 后替换并重启 Hy2；失败会尽量回滚旧二进制
- `AGENT_SELF_UPDATE` 调用自身 `-self-update`，exit code 2 表示已更新并需要重启

### 一键部署

`GET /api/admin/nodes/[id]/deploy-command` 生成 `curl | bash` 部署命令，将所有节点配置（证书、ACME、obfs、masquerade、agent）编码为 base64url payload。`GET /api/deploy/node-install` 负责解析 payload 并输出自包含的 bash 安装脚本。

- `deploy-command` 支持 query：`panel_url`、`agent_bundle_url`
- `agent_bundle_url` 优先级：全局设置 `agent_bundle_url` → query `agent_bundle_url` → 默认 `https://github.com/SIPC/H2O/releases/latest/download/h2o-agent-bundle.tar.gz`
- 调用 `ensureNodeAgentSecrets()`，必要时持久化 `hy2_stats_secret` / `agent_secret`
- 部署端口：`node_port` 不为空时使用节点部署端口和 `node_port_hopping`；否则回退订阅端口 `port` / `port_hopping`
- 生成的 Hy2 配置将 `trafficStats.listen` 绑定到 `127.0.0.1:9999`
- `node-install` 支持 `payload=base64url(query)` 或直接 query 参数，返回 `text/x-shellscript`
- 输出脚本支持 systemd 与 OpenRC/Alpine，安装/更新 Hy2、写入 Hy2 config、安装 Agent、写入 Agent config、更新 Agent 任务，并提供 uninstall 模式

### Cloudflare DNS 管理

`POST /api/admin/nodes/[id]/dns` 通过 Cloudflare API 为节点域名创建/更新 A/AAAA 记录：

- 使用 `nodes.ip` 作为要解析的域名，要求不是纯 IP
- 使用 `nodes.node_ip` 作为记录目标；IPv6 自动用 `AAAA`，否则 `A`
- Cloudflare token 优先级：节点 `acme_dns_config.cloudflare_api_token` → 全局设置 `cloudflare_api_token`
- 记录存在时，如 IP 或 TTL 不同则更新，保留原 `proxied`；不存在则创建 `proxied: false`

`GET /api/admin/nodes/dns-status` 检查所有节点的 DNS 解析状态，状态包含 `match` / `partial` / `mismatch` / `unresolved` / `skip`，会查询系统 DNS、Cloudflare、Google、AliDNS、DNSPod 多个来源。

### API 返回体约定

多数 JSON API 返回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`，错误码是大写下划线常量。例外：

- Hysteria2 HTTP auth 回调：为符合协议，返回 `{ ok, id }`
- 订阅分发 `/api/sub*`：成功返回订阅内容，失败通常返回普通 `404 Not Found` 文本，同时写事件日志
- 一键部署脚本 `/api/deploy/node-install`：成功返回 `text/x-shellscript`，参数错误返回统一 JSON 错误体

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

- `PATCH /api/admin/settings` 只接受白名单 key，并按默认值类型校验；`stats_retention_days` 范围是 1~365。
- 敏感 key（`turnstile_secret_key`, `cloudflare_api_token`）在事件日志中只记录 `[SET]` / `[CLEARED]`。
- `POST /api/admin/settings` 是 Turnstile 新 key 保存前的在线测试接口，入参为 `turnstileVerifySiteKey` / `turnstileVerifySecretKey` / `turnstileVerifyToken`，成功返回 `{ proof }`；`PATCH` 修改 Turnstile key 时需要带 `turnstileVerifyProof`。

### 路由结构

- `app/(dashboard)/` — 路由组，`layout.tsx` 套 `DashboardShell`（客户端组件，挂载时调 `/api/auth/session` 做二次权限校验并重定向）
  - `dashboard/` — 普通用户自助面板
  - `admin/` — 管理员区：管理概览、users、nodes、plans、subscriptions、traffic-analysis、settings、auth-logs、event-logs、report-logs、agent-tasks
- `app/api/auth/*` — 登录/注册/登出/session 查询/bootstrap-admin
- `app/api/admin/*` — 所有走 `requireAdmin`
- `app/api/user/*` — 走 `requireUser`（self/reset-token/dashboard）
- `app/api/node/auth/[authPath]` — Hysteria2 单用户认证回调，**不用** Web 会话校验
- `app/api/node/auth/[authPath]/traffic` — Agent 批量流量上报，**不用** Web 会话校验
- `app/api/node/agent/[authPath]/sync` — Agent 控制面 sync，**不用** Web 会话校验，但必须 HMAC 签名
- `app/api/sub` / `app/api/sub/[token]` — 订阅分发，用 `auth_token` 匹配，**不用** Web 会话校验
- `app/api/settings/public` — 公开只读设置，**不用** Web 会话校验
- `app/api/deploy/node-install` — 一键部署脚本生成，**不用** Web 会话校验

### 前端架构

**关键模式**：
- 页面基本都是客户端组件（`"use client"`），layout 主要是服务端组件（仅设 metadata + 透传 children）
- 数据获取用 `useEffect` + `fetch`，无 React Server Components 数据获取、无 SWR/react-query
- 状态管理主要用局部 `useState`，无 Redux/Zustand/Jotai；Context 用于 `ConfirmProvider` 和 `ThemeProvider`
- 确认/提示使用 `useConfirm()` hook 提供的 promise-based `confirm()` / `alert()` 替代原生浏览器对话框
- Toast 使用 `sonner`
- 数据可视化使用 recharts（LineChart、BarChart、AreaChart 等）
- 搜索选择框用 `Command` + `Popover` 组合模式
- 表格抽象在 `components/data-table/*`，基于 `@tanstack/react-table`，支持排序、faceted filter、列显示、客户端/服务端分页、loading skeleton、可选行选择
- 节点管理页使用 `@dnd-kit/core` / `@dnd-kit/sortable` 实现卡片拖拽排序，保存到 `PUT /api/admin/nodes/order`

**DashboardShell**（`components/dashboard-shell.tsx`）：侧边栏布局，校验 session 并重定向，admin 用户有完整菜单，检查版本更新并提示。

当前管理员菜单：用户管理、节点管理、套餐管理、订阅管理、流量分析、日志（事件日志、认证日志、上报日志、Agent 队列）、站点设置。

**页面能力摘要**：
- `/dashboard`：用户订阅链接、流量卡片、今日趋势、订阅列表、重置 token
- `/admin`：概览卡片、今日流量趋势和同比
- `/admin/users`：用户 CRUD、角色/状态、改密码、重置 Key
- `/admin/nodes`：节点卡片墙、DNS 状态、Agent/Hy2 操作、一键部署、拖拽排序、宿主机流量额度、30 秒轮询
- `/admin/plans`：套餐 CRUD、节点绑定、流量计费口径、限速、永久套餐、自动续订
- `/admin/subscriptions`：订阅 CRUD、状态/到期/用量管理、小时趋势
- `/admin/traffic-analysis`：日期范围流量分析、节点/用户排行、节点分日趋势
- `/admin/auth-logs` / `/admin/event-logs` / `/admin/report-logs`：服务端分页筛选，详情 Sheet
- `/admin/agent-tasks`：全局 Agent 任务队列，任务参数/执行输出/结构化日志详情
- `/admin/settings`：基础开关、Turnstile、Agent 安装包地址、Cloudflare Token、ACME 邮箱、统计/日志保留天数

**shadcn/ui 组件列表**：Badge, Breadcrumb, Button, Card, Chart, Checkbox, Collapsible, Command, Dialog, DropdownMenu, Input, InputGroup, Label, Popover, Select, Separator, Sheet, Sidebar, Skeleton, Sonner, Switch, Table, Textarea, Tooltip

### lib 内部依赖图

```
db.ts ← auth.ts, settings.ts, agent-control.ts
settings.ts → db.ts
logs-db.ts → settings.ts → db.ts
password.ts（独立）
tokens.ts（独立）
turnstile.ts → settings.ts
cloudflare.ts（独立）
port-hopping.ts（独立）
hysteria-uri.ts（独立）
hysteria-server-config.ts（独立）
plan-traffic.ts（独立）
node-traffic-quota.ts（依赖 node:sqlite 类型）
agent-control.ts → db.ts, settings.ts, hysteria-server-config.ts
agent-task-output.ts（独立）
utils.ts（独立）

subscription/client-type.ts（独立）
subscription/node-proxy.ts → hysteria-uri.ts, port-hopping.ts
subscription/clash-template.ts → node-proxy.ts（仅类型）
subscription/singbox-template.ts → node-proxy.ts（仅类型）
subscription/build-clash.ts → hysteria-uri.ts, clash-template.ts, node-proxy.ts + yaml
subscription/build-singbox.ts → hysteria-uri.ts, singbox-template.ts, node-proxy.ts
subscription/serve-subscription.ts → db.ts, hysteria-uri.ts, logs-db.ts, turnstile.ts, build-clash.ts, build-singbox.ts, client-type.ts
```

### 组件与样式

- 路径别名：`@/*` → 仓库根（tsconfig `baseUrl: "."`）
- shadcn 别名：components=`@/components`、ui=`@/components/ui`、lib=`@/lib`、hooks=`@/hooks`、utils=`@/lib/utils`
- 主题走 `next-themes` + `components/theme-provider.tsx`，当前通过界面按钮切换暗/亮主题
- Turnstile widget 在 `components/turnstile-widget.tsx`，未配置 site key 直接返回 null，theme 跟随 `useTheme().resolvedTheme`

### 部署

**Docker**：三阶段构建（deps → builder → runner），`node:24-alpine` + `tini` + `tzdata`，Next standalone 输出，非 root 用户 `nextjs:nodejs`（uid/gid 1001），数据卷 `/app/data`。runner 环境变量固定：`H2O_DB_PATH=/app/data/h2o.sqlite`、`H2O_LOGS_DB_PATH=/app/data/h2o-logs.sqlite`。

**docker-compose.yml**：

```yaml
services:
  h2o:
    container_name: h2o
    image: sipcink/h2o:latest
    environment:
      TZ: Asia/Shanghai
      # H2O_SECURE_COOKIE: "false"  # 纯 HTTP 部署取消注释
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

**CI/CD**（`.github/workflows/auto-release.yml`）：推送到 `master` 且 `package.json` version 变更时自动触发，`workflow_dispatch` 可手动补发/覆盖版本号；使用 Node 22 读取版本，使用 `agent/go.mod` 指定 Go 版本，运行 `agent/build.sh` 构建 Agent 双架构二进制 + bundle + sha256，发布 GitHub Release，推送 Docker 镜像到 Docker Hub（`sipcink/h2o:latest` + `sipcink/h2o:v{version}`），Telegram secrets 存在时发送发布通知。

### 完整 API 清单（43 路由文件，54 个 handler）

当前统计：GET 28 / POST 16 / PATCH 5 / DELETE 4 / PUT 1。

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
| GET | `/api/admin/overview` | `requireAdmin` | 管理概览：当前用户、版本、用户/节点/套餐/订阅数量 |
| GET | `/api/admin/users` | `requireAdmin` | 用户列表 |
| POST | `/api/admin/users` | `requireAdmin` | 创建用户 |
| PATCH | `/api/admin/users/[id]` | `requireAdmin` | 更新用户 |
| DELETE | `/api/admin/users/[id]` | `requireAdmin` | 删除用户 |
| GET | `/api/admin/nodes` | `requireAdmin` | 节点列表 + 最新统计 + Agent 状态 + 宿主机流量摘要 |
| POST | `/api/admin/nodes` | `requireAdmin` | 创建节点 |
| PATCH | `/api/admin/nodes/[id]` | `requireAdmin` | 更新节点 |
| DELETE | `/api/admin/nodes/[id]` | `requireAdmin` | 删除节点 |
| PUT | `/api/admin/nodes/order` | `requireAdmin` | 保存节点拖拽排序，body `{ ids: number[] }` |
| GET | `/api/admin/nodes/history` | `requireAdmin` | 24 小时节点流量历史，query `ids=1,2` |
| GET | `/api/admin/nodes/dns-status` | `requireAdmin` | 全部节点 DNS 状态 |
| POST | `/api/admin/nodes/[id]/dns` | `requireAdmin` | 创建/更新 Cloudflare DNS |
| GET | `/api/admin/nodes/[id]/deploy-command` | `requireAdmin` | 生成一键部署命令 |
| GET | `/api/admin/nodes/[id]/agent` | `requireAdmin` | Agent 状态页数据 |
| GET | `/api/admin/nodes/[id]/agent-config` | `requireAdmin` | 返回 Agent config、config_json、desired Hy2 config |
| POST | `/api/admin/nodes/[id]/agent-secret` | `requireAdmin` | 轮换 Agent secret |
| GET | `/api/admin/nodes/[id]/tasks` | `requireAdmin` | 最近 50 条节点任务 |
| POST | `/api/admin/nodes/[id]/tasks` | `requireAdmin` | 创建 Agent 任务 |
| GET | `/api/admin/agent-tasks` | `requireAdmin` | 全局 Agent 任务队列，支持状态/类型/节点筛选和分页 |
| GET | `/api/admin/plans` | `requireAdmin` | 套餐列表 |
| POST | `/api/admin/plans` | `requireAdmin` | 创建套餐（事务） |
| PATCH | `/api/admin/plans/[id]` | `requireAdmin` | 更新套餐（事务） |
| DELETE | `/api/admin/plans/[id]` | `requireAdmin` | 删除套餐（有订阅引用时拒绝） |
| GET | `/api/admin/subscriptions` | `requireAdmin` | 订阅列表 |
| POST | `/api/admin/subscriptions` | `requireAdmin` | 创建订阅 |
| PATCH | `/api/admin/subscriptions/[id]` | `requireAdmin` | 更新订阅 |
| DELETE | `/api/admin/subscriptions/[id]` | `requireAdmin` | 删除订阅 |
| GET | `/api/admin/subscriptions/history` | `requireAdmin` | 24 小时订阅流量历史，query `ids=1,2` |
| GET | `/api/admin/auth-logs` | `requireAdmin` | 认证日志（分页+筛选） |
| GET | `/api/admin/event-logs` | `requireAdmin` | 事件日志（分页+筛选） |
| GET | `/api/admin/report-logs` | `requireAdmin` | Agent 流量上报日志列表（分页+筛选） |
| GET | `/api/admin/report-logs/[id]` | `requireAdmin` | 单次 Agent 上报日志详情 + 用户明细 |
| GET | `/api/admin/settings` | `requireAdmin` | 全部站点设置 |
| POST | `/api/admin/settings` | `requireAdmin` | Turnstile 新 key 在线测试，返回 proof |
| PATCH | `/api/admin/settings` | `requireAdmin` | 更新白名单设置键 |
| GET | `/api/admin/traffic/overview` | `requireAdmin` | 全局滚动 24 小时流量概览 + 今日/昨日累计 |
| GET | `/api/admin/traffic/analysis` | `requireAdmin` | 日期范围流量分析 |
| GET | `/api/admin/version-check` | `requireAdmin` | 检查 GitHub 新版本 |

**用户 `/api/user/*`**

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/user/self` | `requireUser` | 当前用户信息 |
| GET | `/api/user/dashboard` | `requireUser` | 用户仪表盘聚合数据，返回 `/api/sub?token=...` |
| POST | `/api/user/self/reset-token` | `requireUser` | 轮换 auth_token |

**节点与 Agent**

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/node/auth/[authPath]` | 无 Web session；`authPath` + 用户 `auth_token` | Hysteria2 单用户 HTTP auth 回调，返回 `{ ok, id }` |
| POST | `/api/node/auth/[authPath]/traffic` | 无 Web session；校验 `authPath` | Agent 批量流量上报 |
| POST | `/api/node/agent/[authPath]/sync` | Agent HMAC | Agent 控制面同步、状态刷新、任务领取/回传 |

**订阅 `/api/sub*`**（无 Web 会话校验）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/sub?token=...` | 新订阅入口，自动检测客户端格式 |
| GET | `/api/sub/[token]` | 兼容旧订阅路径，内部同样调用 `serveSubscription()` |

**公开**（无 Web 会话校验）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/settings/public` | 公开只读设置 |
| GET | `/api/deploy/node-install` | 一键部署 bash 脚本 |

### 错误码与日志 reason

统一 JSON 错误码（含 `lib/auth.ts`）：

| 错误码 | 使用场景 |
|--------|----------|
| `UNAUTHORIZED` | `requireUser()` 未登录、Agent sync 签名失败 |
| `FORBIDDEN` | `requireAdmin()` 非管理员 |
| `INVALID_PAYLOAD` | bootstrap/login/register、节点/套餐/订阅/settings、节点排序、Turnstile proof、流量上报等参数不合法 |
| `INVALID_ID` | users/nodes/plans/subscriptions/report-logs 等 `[id]` 非法 |
| `NOT_FOUND` | 用户/节点/套餐/订阅/上报日志/部署对象不存在 |
| `CREATE_FAILED` | bootstrap-admin、users/nodes/plans/subscriptions 创建失败 |
| `DELETE_FAILED` | users/nodes/plans 删除失败 |
| `UPDATE_FAILED` | plans PATCH、nodes order 等更新失败 |
| `ADMIN_EXISTS` | bootstrap-admin 已存在管理员 |
| `USER_EXISTS` | register 用户名已存在 |
| `INVALID_CREDENTIALS` | login 凭据错误 |
| `LOGIN_DISABLED` | login 被站点设置关闭 |
| `REGISTRATION_DISABLED` | register 被站点设置关闭 |
| `TURNSTILE_MISCONFIGURED` | login/register/settings 中 Turnstile 配置缺失一半 |
| `TURNSTILE_FAILED` | login/register/settings 中 Turnstile 校验失败 |
| `INVALID_PASSWORD` | admin user PATCH 修改密码不合法 |
| `SELF_DEMOTE_FORBIDDEN` | 管理员禁止自我降级 |
| `SELF_DISABLE_FORBIDDEN` | 管理员禁止自我禁用 |
| `CANNOT_DELETE_SELF` | 管理员禁止自我删除 |
| `INVALID_PORT` | nodes POST/PATCH、deploy 脚本端口非法 |
| `INVALID_NODE_PORT` | nodes POST/PATCH 部署端口非法 |
| `INVALID_PORT_HOPPING` | deploy 脚本端口跳跃非法 |
| `INVALID_TRAFFIC` | plans/subscriptions/nodes 宿主机流量相关参数非法 |
| `INVALID_DURATION` | plans PATCH 套餐时长非法 |
| `INVALID_SPEED` | plans PATCH 限速非法 |
| `INVALID_STATUS` | subscriptions PATCH 状态非法 |
| `INVALID_EXPIRE` | subscriptions PATCH 到期时间非法 |
| `PLAN_NOT_FOUND` | subscriptions POST 套餐不存在 |
| `PLAN_IN_USE` | plans DELETE 已被订阅引用 |
| `UNKNOWN_KEY` | settings PATCH 未知设置键 |
| `NOT_A_DOMAIN` | DNS：节点 `ip` 不是域名 |
| `NO_NODE_IP` | DNS：缺少 `node_ip` |
| `NO_CF_TOKEN` | DNS：缺少 Cloudflare token |
| `CF_ZONE_NOT_FOUND` | DNS：Cloudflare zone 未找到 |
| `CF_API_ERROR` | DNS：Cloudflare API 错误 |
| `UNSUPPORTED_OBFS` | deploy-command/deploy：不支持的 obfs |
| `INVALID_NODE_CONFIG` | deploy-command：节点配置不完整 |
| `INVALID_PANEL_URL` | deploy-command/deploy：panel_url 非法 |
| `INVALID_AGENT_BUNDLE_URL` | deploy-command/deploy：Agent bundle URL 非法 |
| `INVALID_AUTH_PATH` | deploy：auth_path 非法 |
| `INVALID_TLS_PATH` | deploy：证书/私钥路径非法 |
| `INVALID_STATS_SECRET` | deploy：Hy2 stats secret 非法 |
| `INVALID_AGENT_SECRET` | deploy：Agent secret 非法 |
| `INVALID_OBFS_PASSWORD` | deploy：obfs password 非法 |
| `INVALID_INTERVAL` | deploy：interval_seconds 非法 |
| `INVALID_CURRENT_VERSION` | version-check 当前版本非法 |
| `BAD_PAYLOAD` | node auth、node traffic、Agent sync 请求体不合法 |
| `NO_NODE` | node auth/node traffic/Agent sync 未知节点 |
| `AGENT_CONTROL_DISABLED` | Agent sync 节点控制面关闭 |
| `AGENT_SECRET_MISSING` | Agent sync 节点缺少 agent_secret |
| `REPLAY_DETECTED` | Agent sync nonce 重放 |
| `INTERNAL` | node traffic / Agent sync 内部处理失败 |

协议/日志 reason（不一定是统一 JSON `error.code`）：

- Hysteria2 HTTP auth 日志：`BAD_PAYLOAD` / `NO_NODE` / `NO_USER` / `USER_DISABLED` / `NO_SUB` / `OK`
- Agent 流量上报用户明细：`NO_USER` / `USER_DISABLED` / `NO_SUB` / `TRAFFIC_EXCEEDED` / `OK`
- 订阅拉取事件：`INVALID_TOKEN` / `NO_USER` / `USER_DISABLED` / `NO_NODES` / `OK`
- 节点排序事件使用 `NODE_UPDATE`，成功 reason 为 `ORDER_UPDATE`

## 写代码约定

- 需要注释时用**简洁中文**注释（现有代码风格）。
- 用户面字符串全部中文。
- 密码用 `lib/password.ts` 的 scrypt（格式 `scrypt$salt$hash`），不要引入 bcrypt 等。
- 涉及多表 / 多行写入要用 `db.exec("BEGIN")` / `COMMIT` / `ROLLBACK` 显式事务（参考 `admin/plans` 的创建与更新）。
- Next.js 16 的动态路由 `params` 是 **Promise**，必须 `await`（代码里一律这么写）。
- API 路由统一返回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`；节点认证、订阅分发、一键部署脚本是明确例外。
- 站点设置的敏感 key（`turnstileSecretKey`, `cloudflareApiToken`）在事件日志中脱敏记录。
- 管理员不能自我降级、自我禁用、自我删除。
- `ALTER TABLE ADD COLUMN` 用 try-catch 包裹以支持安全重入（已存在的列会抛错被 catch）。
- 新增 Agent 任务必须加入 `lib/agent-control.ts` 白名单，并在 Go `agent/control` 中实现固定安全操作；禁止任意命令执行型任务。
- 修改订阅输出时同时考虑 `/api/sub?token=...` 主入口和 `/api/sub/[token]` 兼容入口。
- 修改流量结算时要区分：真实 tx/rx 小时统计、套餐 `traffic_billing_mode` 计费用量、节点宿主机 `host_traffic_billing_mode` 用量。
