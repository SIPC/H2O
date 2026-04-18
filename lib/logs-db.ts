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

// 统一写入入口，避免调用方直接碰 db 句柄
export function writeAuthLog(fields: AuthLogFields): void {
  const database = getLogsDb()
  database
    .prepare(
      `INSERT INTO auth_logs(node_id, node_name, user_id, username, ip, success, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.node_id,
      fields.node_name,
      fields.user_id,
      fields.username,
      fields.ip,
      fields.success ? 1 : 0,
      fields.reason,
    )
}
