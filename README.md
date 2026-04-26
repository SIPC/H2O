# H2O

企业内网场景下的 Hysteria2 订阅与节点认证管理面板。  
提供用户、套餐、订阅、节点管理；实现 Hysteria2 HTTP 认证回调；并支持节点侧流量快照上报与订阅分发。

> 当前文档以中文为主，欢迎补充英文文档（`README.en.md`）。

---

## 目录

- [项目特性](#项目特性)
- [技术栈](#技术栈)
- [系统架构](#系统架构)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [初始化流程](#初始化流程)
- [部署](#部署)
- [节点 Agent（可选）](#节点-agent可选)
- [API 约定](#api-约定)
- [安全建议](#安全建议)
- [常见问题](#常见问题)
- [开发指南](#开发指南)
- [开源计划与贡献](#开源计划与贡献)
- [License](#license)

---

## 项目特性

- **管理员后台**
  - 用户管理（启用/禁用、重置用户订阅 Token）
  - 节点管理（`auth_path`、SNI、混淆参数等）
  - 套餐管理（流量上限、时长、节点绑定、上下行限速）
  - 订阅管理（开通、续期、状态维护）
  - 认证日志与事件日志查询
  - 系统设置（注册/登录开关、Turnstile 配置）

- **用户面板**
  - 查看我的订阅与到期状态
  - 获取个人订阅链接
  - 自助重置订阅 Token

- **协议适配**
  - Hysteria2 节点 HTTP 认证回调
  - 根据 User-Agent 自动分发 Clash / sing-box / URI 列表格式

- **流量统计闭环**
  - 节点 Agent 定时上报 Hy2 Traffic Stats 快照
  - 服务端以差值法累计订阅流量并自动执行超额阻断逻辑

---

## 技术栈

- **Web**: Next.js 16 (App Router), React 19, TypeScript
- **UI**: Tailwind CSS v4, shadcn/ui
- **Database**: Node 内建 `node:sqlite`（双 SQLite 文件）
- **Package Manager**: pnpm
- **Node Agent**: Go（位于 `agent/`）

---

## 系统架构

### 1) 双 SQLite 数据库

- 业务库：`data/h2o.sqlite`
- 日志库：`data/h2o-logs.sqlite`

日志与业务数据拆分，便于日志单独归档与清理，降低对业务库影响。

### 2) 双 Token 认证模型

- **Web Session**
  - Cookie：`h2o_session`
  - 用于后台与用户面板登录态

- **用户静态 `auth_token`**
  - 用于节点认证（`/api/node/auth/[authPath]` 请求体中的 `auth`）
  - 用于订阅分发（`/api/sub/[token]`）

### 3) 节点认证与流量统计

- 节点认证回调用于连接鉴权
- 节点 Agent 上报 `/traffic` 与 `/online` 快照
- 服务端按差值更新每用户流量并处理超额封禁

---

## 快速开始

### 环境要求

- Node.js **23+**（建议）
- pnpm
- Go（仅构建 `agent/` 时需要）

### 1. 安装依赖

~~~bash
pnpm install
~~~

### 2. 准备环境变量（可选）

~~~bash
cp .env.example .env.local
~~~

> Windows PowerShell 可用：`Copy-Item .env.example .env.local`

### 3. 启动开发环境

~~~bash
pnpm dev
~~~

### 4. 初始化管理员

访问：`http://localhost:3000/init`  
创建首个管理员账号后，前往登录页使用该账号登录。

---

## 环境变量

核心参数大多有默认值，不配置也可运行。

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `H2O_DB_PATH` | `./data/h2o.sqlite` | 业务数据库路径 |
| `H2O_LOGS_DB_PATH` | `./data/h2o-logs.sqlite` | 日志数据库路径 |
| `PORT` | `3000` | 服务端口 |
| `HOSTNAME` | `0.0.0.0` | 监听地址 |
| `NEXT_TELEMETRY_DISABLED` | `1` | 关闭 Next.js Telemetry（可选） |

### Turnstile 说明

Cloudflare Turnstile 的 `site key` 与 `secret key` 由后台设置存储在数据库（`settings` 表），不通过 `.env` 维护。  
配置状态规则：

- 两个都未配置：`disabled`
- 两个都配置：`enabled`
- 只配置其中一个：`misconfigured`（登录/注册会报错）

---

## 初始化流程

1. 启动应用
2. 打开 `/init` 初始化管理员
3. 使用管理员登录后台
4. 创建节点 / 套餐 / 订阅并分配用户

---

## 部署

### Docker Compose（示例）

~~~yaml
services:
  h2o:
    container_name: h2o
    image: sipcink/h2o:latest
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
~~~

> 建议将 `./data` 挂载到持久化存储，并纳入备份策略。

---

## 节点 Agent（可选）

`agent/` 提供 Go 守护进程，用于从 Hysteria2 Traffic Stats API 拉取真实流量并上报面板。

- 文档：`agent/README.md`
- 示例配置：`agent/config.example.json`

**重要**：`agent/config.json` 是运行时配置，可能包含敏感信息，禁止提交到仓库。

---

## API 约定

除节点认证回调外，所有 `/api/*` 路由统一返回：

- 成功：`{ ok: true, data }`
- 失败：`{ ok: false, error: { code, message } }`

节点认证回调为协议兼容格式：

- `{ ok, id }`

---

## 安全建议

1. **禁止提交敏感文件**
   - `.env*`
   - `data/` 及 `*.sqlite*`
   - 私钥/证书（`*.pem`、`*.key`、`*.p12`、`*.jks` 等）
   - `agent/config.json`

2. **发生泄露时立即轮换**
   - 所有 Token / Secret / 凭据应视为已泄露并立即更换

3. **最小暴露原则**
   - 建议置于内网或反向代理后
   - 限制管理面访问源

4. **账户与审计**
   - 管理员使用强密码
   - 定期审阅认证日志与事件日志

5. **备份策略**
   - 定期备份 `data/`
   - 对日志库设置归档与清理周期

---

## 常见问题

### Q1: 启动时报 `node:sqlite` 相关错误？
请升级 Node.js，建议 23+。

### Q2: 看不到 Turnstile 组件？
后台未完整配置 site key 与 secret key 时，前端会按状态隐藏或报配置错误。

### Q3: 第一次登录失败？
请先访问 `/init` 创建首个管理员。

### Q4: 节点认证成功但流量不更新？
请检查 `agent` 是否正常运行并能访问 Hy2 Traffic Stats API。

---

## 开发指南

### 常用命令

~~~bash
pnpm dev
pnpm build
pnpm start
pnpm lint
pnpm typecheck
pnpm format
~~~

### 目录结构（精简）

- `app/`：页面与 API 路由
- `components/`：UI 与业务组件
- `lib/`：认证、数据库、订阅构建、工具函数
- `agent/`：节点侧流量上报守护进程
- `data/`：运行时数据库（不入库）

---

## 开源计划与贡献

欢迎提交 Issue / PR。建议贡献方向：

- 文档完善（含英文文档）
- API 文档补全
- 部署模板（systemd / docker / reverse proxy）
- 监控与可观测性增强
- 测试与 CI 完善

提交 PR 前请至少执行：

~~~bash
pnpm lint
pnpm typecheck
~~~

---

## License

本项目采用 MIT License，详见仓库根目录 `LICENSE` 文件。  
Copyright (c) 2026 ink

---