# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

H2O 是企业内网使用的 Hysteria2 订阅与节点认证管理面板：后端提供用户/套餐/订阅/节点 CRUD、Hysteria2 节点 HTTP 认证回调、Hysteria 订阅链接生成；前端提供管理员后台与普通用户自助面板。Next.js 16 App Router + React 19 + TypeScript + Tailwind v4 + shadcn/ui。

## 常用命令

使用 **pnpm**（仓库有 `pnpm-lock.yaml`）。

- `pnpm dev` — 启动 Turbopack 开发服务器（`next dev --turbopack`）
- `pnpm build` / `pnpm start` — 生产构建与启动
- `pnpm lint` — ESLint（基于 `eslint-config-next`，包含 core-web-vitals + typescript）
- `pnpm typecheck` — `tsc --noEmit`，增量编译结果在 `tsconfig.tsbuildinfo`
- `pnpm format` — Prettier + tailwind 插件（`no-semi`、双引号、2 空格、LF、`tailwindFunctions: ["cn","cva"]`）
- 新增 shadcn 组件：`npx shadcn@latest add <name>`（`components.json` 里 style 是 `radix-nova`，基色 `neutral`，图标库 `lucide`）

目前仓库没有测试脚手架。

## 首次启动流程

1. 配置 `.env.local`（可选 Turnstile 人机验证）：
   - 两个 key 都缺失 → 人机验证视为 **disabled**，前端不渲染 widget
   - 两个 key 都有 → **enabled**
   - 只配一个 → **misconfigured**，登录/注册会直接报错（见 `lib/turnstile.ts`）
2. 启动后访问 `/init` 引导创建第一个管理员（`POST /api/auth/bootstrap-admin`）。已存在 admin 时该接口返回 `ADMIN_EXISTS`。
3. 数据库首次调用 `getDb()` / `getLogsDb()` 时自动建表，无外部迁移工具。

## 架构要点

### 双 SQLite 文件（Node 内建驱动）

使用 Node.js 内建 `node:sqlite` 的 `DatabaseSync`，**没有** `better-sqlite3`/`sqlite3` 依赖。需要 Node 版本支持 `node:sqlite`（Node 22+ 实验性 / Node 23+ 稳定）。

- `lib/db.ts` → 业务库 `data/h2o.sqlite`（可用 `H2O_DB_PATH` 覆盖）：`users`, `nodes`, `plans`, `plan_nodes`, `subscriptions`, `sessions`
- `lib/logs-db.ts` → 日志库 `data/h2o-logs.sqlite`（可用 `H2O_LOGS_DB_PATH` 覆盖）：只有 `auth_logs`

两库分离的设计目的是让日志可单独归档/清理，不影响业务库。两者都采用单例 + 懒加载，首次取用时 `migrate()` 建表并打开 `PRAGMA foreign_keys = ON`。`migrate()` 只维护当前 schema，**不做旧版本迁移兼容**。

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

### 订阅链接

`app/api/sub/[token]/route.ts`：

- 路径参数 `token` 即用户的 `auth_token`
- 聚合用户所有 active 订阅对应的启用节点（去重），每个节点走 `lib/hysteria-uri.ts::buildHysteriaUri` 生成 `hysteria2://` URI
- 默认返回 base64 编码，`?format=plain` 返回明文
- 响应头带 `Subscription-Userinfo: upload=0; download=<used>; total=<total>; expire=<ts>` 与 `Profile-Update-Interval: 24`，兼容订阅客户端
- ⚠️ `app/api/user/subscription/route.ts` 里的订阅 URL 目前**硬编码** `https://byte.lyrify.cloud/api/sub/...`，如果部署到其他域名要改这里（而不是用 `request.url` 的 origin）

### API 返回体约定

所有 `/api/*` 路由统一返回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`，错误码是大写下划线常量（如 `INVALID_PAYLOAD`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `PLAN_IN_USE`）。节点认证回调是唯一例外：为符合 Hysteria2 协议，统一返回 `{ ok, id }`。

### 路由结构

- `app/(dashboard)/` — 路由组，`layout.tsx` 套 `DashboardShell`（客户端组件，挂载时调 `/api/auth/session` 做二次权限校验并重定向）
  - `dashboard/` — 普通用户自助
  - `admin/` — 管理员区（users/nodes/plans/subscriptions/logs），`DashboardShell` 会过滤非 admin
- `app/api/auth/*` — 登录/注册/登出/session 查询/bootstrap-admin
- `app/api/admin/*` — 所有走 `requireAdmin`
- `app/api/user/*` — 走 `requireUser`
- `app/api/node/auth/[authPath]` — Hysteria2 节点回调，**不用**会话校验
- `app/api/sub/[token]` — 订阅分发，用 `auth_token` 匹配，**不用**会话校验

### 组件与样式

- 路径别名：`@/*` → 仓库根（tsconfig `baseUrl: "."`）
- shadcn 别名：components=`@/components`、ui=`@/components/ui`、lib=`@/lib`、hooks=`@/hooks`、utils=`@/lib/utils`
- 主题走 `next-themes` + `components/theme-provider.tsx`；Turnstile widget 在 `components/turnstile-widget.tsx`，未配置 site key 直接返回 null，theme 跟随 `useTheme().resolvedTheme`

## 写代码约定

- 需要注释时用**简洁中文**注释（现有代码风格）。
- 用户面字符串全部中文。
- 密码用 `lib/password.ts` 的 scrypt（格式 `scrypt$salt$hash`），不要引入 bcrypt 等。
- 涉及多表 / 多行写入要用 `db.exec("BEGIN")` / `COMMIT` / `ROLLBACK` 显式事务（参考 `admin/plans` 的创建与更新）。
- Next.js 16 的动态路由 `params` 是 **Promise**，必须 `await`（代码里一律这么写）。
