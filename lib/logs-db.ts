import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

// 日志库单独一个 SQLite 文件，便于归档/清理，避免影响业务库
const LOGS_DB_PATH = process.env.H2O_LOGS_DB_PATH ?? "./data/h2o-logs.sqlite"

let db: DatabaseSync | null = null

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
  `)
}

export function getLogsDb() {
  if (db) return db
  ensureDbDirectory(LOGS_DB_PATH)
  db = new DatabaseSync(LOGS_DB_PATH)
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
  | "PLAN_CREATE"
  | "PLAN_UPDATE"
  | "PLAN_DELETE"
  | "SUBSCRIPTION_CREATE"
  | "SUBSCRIPTION_UPDATE"
  | "SUBSCRIPTION_DELETE"
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
