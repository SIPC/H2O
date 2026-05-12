import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { getSetting, SETTING_KEYS } from "@/lib/settings"

// 日志库单独一个 SQLite 文件，便于归档/清理，避免影响业务库
const LOGS_DB_PATH = process.env.H2O_LOGS_DB_PATH ?? "./data/h2o-logs.sqlite"
const LOG_RETENTION_DAYS_DEFAULT = 30
const LOG_RETENTION_DAYS_MIN = 1
const LOG_RETENTION_DAYS_MAX = 365
const LOG_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

let db: DatabaseSync | null = null
let lastLogCleanupAt = 0

function ensureDbDirectory(filePath: string) {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true })
}

function migrate(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS auth_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      node_id INTEGER,
      node_name TEXT,
      user_id INTEGER,
      username TEXT,
      ip TEXT,
      success INTEGER NOT NULL CHECK(success IN (0,1)),
      reason TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_auth_logs_created ON auth_logs(created_at);

    CREATE TABLE IF NOT EXISTS event_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      event TEXT NOT NULL,
      user_id INTEGER,
      username TEXT,
      ip TEXT,
      success INTEGER NOT NULL CHECK(success IN (0,1)),
      reason TEXT,
      detail TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_event_logs_created ON event_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_event_logs_event ON event_logs(event);

    CREATE TABLE IF NOT EXISTS agent_traffic_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      node_id INTEGER,
      node_name TEXT,
      auth_path TEXT NOT NULL,
      ip TEXT,
      success INTEGER NOT NULL CHECK(success IN (0,1)),
      reason TEXT NOT NULL,
      reported_users INTEGER NOT NULL DEFAULT 0,
      online_count INTEGER NOT NULL DEFAULT 0,
      total_tx_bytes INTEGER NOT NULL DEFAULT 0,
      total_rx_bytes INTEGER NOT NULL DEFAULT 0,
      delta_tx_bytes INTEGER NOT NULL DEFAULT 0,
      delta_rx_bytes INTEGER NOT NULL DEFAULT 0,
      agent_version TEXT,
      detail TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_traffic_reports_created ON agent_traffic_reports(created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_traffic_reports_node_created ON agent_traffic_reports(node_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_traffic_reports_reason_created ON agent_traffic_reports(reason, created_at);

    CREATE TABLE IF NOT EXISTS agent_traffic_user_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES agent_traffic_reports(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      node_id INTEGER,
      node_name TEXT,
      user_id INTEGER,
      username TEXT NOT NULL,
      reported_tx_bytes INTEGER NOT NULL DEFAULT 0,
      reported_rx_bytes INTEGER NOT NULL DEFAULT 0,
      last_tx_bytes INTEGER,
      last_rx_bytes INTEGER,
      delta_tx_bytes INTEGER NOT NULL DEFAULT 0,
      delta_rx_bytes INTEGER NOT NULL DEFAULT 0,
      online_count INTEGER NOT NULL DEFAULT 0,
      subscription_id INTEGER,
      success INTEGER NOT NULL CHECK(success IN (0,1)),
      reason TEXT NOT NULL,
      detail TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_traffic_user_logs_report ON agent_traffic_user_logs(report_id);
    CREATE INDEX IF NOT EXISTS idx_agent_traffic_user_logs_created ON agent_traffic_user_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_traffic_user_logs_username_created ON agent_traffic_user_logs(username, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_traffic_user_logs_node_created ON agent_traffic_user_logs(node_id, created_at);
  `)
  maskExistingAgentAuthPaths(database)
}

function maskExistingAgentAuthPaths(database: DatabaseSync) {
  const rows = database
    .prepare(
      `SELECT id, auth_path FROM agent_traffic_reports
       WHERE auth_path NOT LIKE '%...%'`
    )
    .all() as Array<{ id: number; auth_path: string }>
  if (rows.length === 0) return

  const update = database.prepare(
    `UPDATE agent_traffic_reports SET auth_path = ? WHERE id = ?`
  )
  for (const row of rows) {
    update.run(maskAuthPath(row.auth_path), row.id)
  }
}

export function getLogsDb() {
  if (db) return db
  ensureDbDirectory(LOGS_DB_PATH)
  db = new DatabaseSync(LOGS_DB_PATH)
  db.exec("PRAGMA foreign_keys = ON")
  migrate(db)
  return db
}

export type AuthLogFields = {
  node_id: number | null
  node_name: string | null
  user_id: number | null
  username: string | null
  ip: string | null
  success: boolean
  reason: string
}

// auth_path 同时是 agent 共享密钥，落日志时只保留开头和结尾便于排查
export function maskAuthPath(authPath: string): string {
  const value = authPath.trim()
  if (!value || value.includes("...")) return value
  if (value.length <= 4) return `${value[0]}...${value[value.length - 1]}`
  if (value.length <= 12) return `${value.slice(0, 2)}...${value.slice(-2)}`
  return `${value.slice(0, 6)}...${value.slice(-6)}`
}

export type AgentTrafficReportLogFields = {
  node_id: number | null
  node_name: string | null
  auth_path: string
  ip: string | null
  success: boolean
  reason: string
  reported_users: number
  online_count: number
  total_tx_bytes: number
  total_rx_bytes: number
  delta_tx_bytes: number
  delta_rx_bytes: number
  agent_version?: string | null
  detail?: string | null
}

export type AgentTrafficUserLogFields = {
  node_id: number | null
  node_name: string | null
  user_id: number | null
  username: string
  reported_tx_bytes: number
  reported_rx_bytes: number
  last_tx_bytes: number | null
  last_rx_bytes: number | null
  delta_tx_bytes: number
  delta_rx_bytes: number
  online_count: number
  subscription_id: number | null
  success: boolean
  reason: string
  detail?: string | null
}

// 节点认证日志入口（由 Hysteria2 /api/node/auth 调用）
export function writeAuthLog(fields: AuthLogFields): void {
  const database = getLogsDb()
  database
    .prepare(
      `INSERT INTO auth_logs(node_id, node_name, user_id, username, ip, success, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fields.node_id,
      fields.node_name,
      fields.user_id,
      fields.username,
      fields.ip,
      fields.success ? 1 : 0,
      fields.reason
    )
  cleanupExpiredLogsBySetting()
}

// Agent 批量流量上报日志入口：请求级汇总 + 用户级明细写入同一个日志事务
export function writeAgentTrafficLogs(
  report: AgentTrafficReportLogFields,
  userLogs: AgentTrafficUserLogFields[]
): void {
  const database = getLogsDb()
  database.exec("BEGIN")
  try {
    const reportResult = database
      .prepare(
        `INSERT INTO agent_traffic_reports(
          node_id,
          node_name,
          auth_path,
          ip,
          success,
          reason,
          reported_users,
          online_count,
          total_tx_bytes,
          total_rx_bytes,
          delta_tx_bytes,
          delta_rx_bytes,
          agent_version,
          detail
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        report.node_id,
        report.node_name,
        maskAuthPath(report.auth_path),
        report.ip,
        report.success ? 1 : 0,
        report.reason,
        report.reported_users,
        report.online_count,
        report.total_tx_bytes,
        report.total_rx_bytes,
        report.delta_tx_bytes,
        report.delta_rx_bytes,
        report.agent_version ?? null,
        report.detail ?? null
      )

    const reportId = Number(reportResult.lastInsertRowid)
    const insertUserLog = database.prepare(
      `INSERT INTO agent_traffic_user_logs(
        report_id,
        node_id,
        node_name,
        user_id,
        username,
        reported_tx_bytes,
        reported_rx_bytes,
        last_tx_bytes,
        last_rx_bytes,
        delta_tx_bytes,
        delta_rx_bytes,
        online_count,
        subscription_id,
        success,
        reason,
        detail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    for (const userLog of userLogs) {
      insertUserLog.run(
        reportId,
        userLog.node_id,
        userLog.node_name,
        userLog.user_id,
        userLog.username,
        userLog.reported_tx_bytes,
        userLog.reported_rx_bytes,
        userLog.last_tx_bytes,
        userLog.last_rx_bytes,
        userLog.delta_tx_bytes,
        userLog.delta_rx_bytes,
        userLog.online_count,
        userLog.subscription_id,
        userLog.success ? 1 : 0,
        userLog.reason,
        userLog.detail ?? null
      )
    }

    database.exec("COMMIT")
  } catch {
    database.exec("ROLLBACK")
    throw new Error("写入 Agent 流量日志失败")
  }
  cleanupExpiredLogsBySetting()
}

function normalizeRetentionDays(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= LOG_RETENTION_DAYS_MIN &&
    value <= LOG_RETENTION_DAYS_MAX
    ? value
    : LOG_RETENTION_DAYS_DEFAULT
}

// 事件日志、认证日志、上报日志统一跟随 stats_retention_days 清理
export function cleanupExpiredLogs(retentionDays: number): void {
  const modifier = `-${normalizeRetentionDays(retentionDays)} day`
  const database = getLogsDb()
  database.exec("BEGIN")
  try {
    database
      .prepare(
        `DELETE FROM agent_traffic_user_logs
         WHERE report_id IN (
           SELECT id FROM agent_traffic_reports
           WHERE created_at < datetime('now', ?)
         )`
      )
      .run(modifier)
    database
      .prepare(
        `DELETE FROM agent_traffic_reports
         WHERE created_at < datetime('now', ?)`
      )
      .run(modifier)
    database
      .prepare(
        `DELETE FROM agent_traffic_user_logs
         WHERE created_at < datetime('now', ?)`
      )
      .run(modifier)
    database
      .prepare(
        `DELETE FROM auth_logs
         WHERE created_at < datetime('now', ?)`
      )
      .run(modifier)
    database
      .prepare(
        `DELETE FROM event_logs
         WHERE created_at < datetime('now', ?)`
      )
      .run(modifier)
    database.exec("COMMIT")
  } catch {
    database.exec("ROLLBACK")
    throw new Error("清理日志失败")
  }
}

export function cleanupExpiredLogsBySetting(force = false): void {
  const now = Date.now()
  if (!force && now - lastLogCleanupAt < LOG_CLEANUP_INTERVAL_MS) return

  try {
    const retentionDays = getSetting<number>(
      SETTING_KEYS.statsRetentionDays,
      LOG_RETENTION_DAYS_DEFAULT
    )
    cleanupExpiredLogs(retentionDays)
    lastLogCleanupAt = now
  } catch {
    // 清理失败不影响日志写入和后台查询
  }
}

// 兼容旧调用名：现在会清理全部日志表，而不是只清理 Agent 上报日志
export function cleanupAgentTrafficLogs(retentionDays: number): void {
  cleanupExpiredLogs(retentionDays)
}

// 业务事件类型：登录/注册/登出/轮换 Key 等；与节点认证日志分开存储
export type EventName =
  | "LOGIN"
  | "REGISTER"
  | "LOGOUT"
  | "RESET_TOKEN_SELF"
  | "RESET_TOKEN_ADMIN"
  | "BOOTSTRAP_ADMIN"
  | "USER_CREATE"
  | "USER_UPDATE"
  | "USER_DELETE"
  | "NODE_CREATE"
  | "NODE_UPDATE"
  | "NODE_DELETE"
  | "AGENT_TASK_CREATE"
  | "AGENT_SECRET_ROTATE"
  | "AGENT_CONFIG_VIEW"
  | "PLAN_CREATE"
  | "PLAN_UPDATE"
  | "PLAN_DELETE"
  | "SUBSCRIPTION_CREATE"
  | "SUBSCRIPTION_UPDATE"
  | "SUBSCRIPTION_DELETE"
  | "SUBSCRIPTION_FETCH"
  | "SETTINGS_UPDATE"

export type EventLogFields = {
  event: EventName
  user_id: number | null
  username: string | null
  ip: string | null
  success: boolean
  reason: string
  // 可选补充信息（如 admin 操作的目标用户），以 JSON 字符串存
  detail?: string | null
}

// 业务事件日志入口
export function writeEventLog(fields: EventLogFields): void {
  const database = getLogsDb()
  database
    .prepare(
      `INSERT INTO event_logs(event, user_id, username, ip, success, reason, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fields.event,
      fields.user_id,
      fields.username,
      fields.ip,
      fields.success ? 1 : 0,
      fields.reason,
      fields.detail ?? null
    )
  cleanupExpiredLogsBySetting()
}

// admin 操作日志的简化入口：actor 填当前登录的管理员，detail 为 JSON 友好对象
export function writeAdminEvent(params: {
  event: EventName
  actor: { id: number; username: string }
  ip: string | null
  success: boolean
  reason: string
  detail?: Record<string, unknown>
}): void {
  writeEventLog({
    event: params.event,
    user_id: params.actor.id,
    username: params.actor.username,
    ip: params.ip,
    success: params.success,
    reason: params.reason,
    detail: params.detail ? JSON.stringify(params.detail) : null,
  })
}
