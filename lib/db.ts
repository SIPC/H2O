import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

// SQLite 文件默认落在项目 data 目录，可通过环境变量覆盖
const DB_PATH = process.env.H2O_DB_PATH ?? "./data/h2o.sqlite"

let db: DatabaseSync | null = null

function ensureDbDirectory(filePath: string) {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true })
}

function migrate(database: DatabaseSync) {
  // 仅维护当前版本 schema，不做旧版本兼容迁移
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      auth_token TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      ip TEXT NOT NULL,
      port INTEGER NOT NULL,
      port_hopping TEXT,
      auth_path TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'enabled' CHECK(status IN ('enabled','disabled')),
      sni TEXT,
      obfs TEXT,
      obfs_password TEXT,
      insecure INTEGER NOT NULL DEFAULT 0 CHECK(insecure IN (0,1)),
      pin_sha256 TEXT,
      node_ip TEXT,
      node_port INTEGER,
      node_port_hopping TEXT,
      cert_mode TEXT NOT NULL DEFAULT 'self-signed',
      cert_path TEXT,
      key_path TEXT,
      acme_domains TEXT,
      acme_email TEXT,
      acme_dns_provider TEXT,
      acme_dns_config TEXT,
      masquerade_type TEXT,
      masquerade_config TEXT,
      agent_interval INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      traffic_limit_bytes INTEGER NOT NULL,
      duration_days INTEGER NOT NULL,
      up_mbps INTEGER NOT NULL DEFAULT 0,
      down_mbps INTEGER NOT NULL DEFAULT 0,
      auto_renew INTEGER NOT NULL DEFAULT 0 CHECK(auto_renew IN (0,1)),
      renewal_period_days INTEGER
    );

    CREATE TABLE IF NOT EXISTS plan_nodes (
      plan_id INTEGER NOT NULL,
      node_id INTEGER NOT NULL,
      PRIMARY KEY (plan_id, node_id),
      FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE,
      FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan_id INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      expire_time TEXT NOT NULL,
      used_traffic_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','blocked')),
      renewal_anchor TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(plan_id) REFERENCES plans(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      last_seen_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 节点心跳与在线/流量快照，由 h2o-agent 定时上报
    CREATE TABLE IF NOT EXISTS node_stats (
      node_id INTEGER PRIMARY KEY,
      last_report_at TEXT NOT NULL DEFAULT (datetime('now')),
      online_count INTEGER NOT NULL DEFAULT 0,
      online_snapshot TEXT,
      traffic_snapshot TEXT,
      FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );

    -- 每 (节点, 用户) 维度记录上次上报的累计 tx/rx，用于差值法计算增量
    CREATE TABLE IF NOT EXISTS node_user_traffic (
      node_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      last_tx_bytes INTEGER NOT NULL DEFAULT 0,
      last_rx_bytes INTEGER NOT NULL DEFAULT 0,
      last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (node_id, user_id),
      FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 全局小时流量统计：按天+小时聚合总出/总入流量
    CREATE TABLE IF NOT EXISTS traffic_hourly_stats (
      bucket_date TEXT NOT NULL,
      bucket_hour INTEGER NOT NULL CHECK(bucket_hour BETWEEN 0 AND 23),
      tx_bytes INTEGER NOT NULL DEFAULT 0,
      rx_bytes INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (bucket_date, bucket_hour)
    );

    -- 节点维度小时流量统计：用于节点总用量趋势
    CREATE TABLE IF NOT EXISTS node_hourly_traffic (
      node_id INTEGER NOT NULL,
      bucket_date TEXT NOT NULL,
      bucket_hour INTEGER NOT NULL CHECK(bucket_hour BETWEEN 0 AND 23),
      tx_bytes INTEGER NOT NULL DEFAULT 0,
      rx_bytes INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (node_id, bucket_date, bucket_hour),
      FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_node_hourly_traffic_bucket
      ON node_hourly_traffic(bucket_date, bucket_hour);

    -- 订阅维度小时流量统计：用于单订阅消耗历史趋势
    CREATE TABLE IF NOT EXISTS subscription_hourly_traffic (
      subscription_id INTEGER NOT NULL,
      bucket_date TEXT NOT NULL,
      bucket_hour INTEGER NOT NULL CHECK(bucket_hour BETWEEN 0 AND 23),
      tx_bytes INTEGER NOT NULL DEFAULT 0,
      rx_bytes INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (subscription_id, bucket_date, bucket_hour),
      FOREIGN KEY(subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_subscription_hourly_traffic_bucket
      ON subscription_hourly_traffic(bucket_date, bucket_hour);

    CREATE INDEX IF NOT EXISTS idx_sub_user_status_expire
      ON subscriptions(user_id, status, expire_time);

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

    CREATE INDEX IF NOT EXISTS idx_node_stats_last_report ON node_stats(last_report_at);
  `)

  // 对老库做一次补列：新增字段允许安全重入（已存在会抛错，catch 掉）
  // 不是多版本迁移链，仅是单次向前兼容
  for (const alter of [
    `ALTER TABLE nodes ADD COLUMN port_hopping TEXT`,
    `ALTER TABLE plans ADD COLUMN up_mbps INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE plans ADD COLUMN down_mbps INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE nodes ADD COLUMN node_ip TEXT`,
    `ALTER TABLE nodes ADD COLUMN node_port INTEGER`,
    `ALTER TABLE nodes ADD COLUMN node_port_hopping TEXT`,
    `ALTER TABLE nodes ADD COLUMN cert_mode TEXT NOT NULL DEFAULT 'self-signed'`,
    `ALTER TABLE nodes ADD COLUMN cert_path TEXT`,
    `ALTER TABLE nodes ADD COLUMN key_path TEXT`,
    `ALTER TABLE nodes ADD COLUMN acme_domains TEXT`,
    `ALTER TABLE nodes ADD COLUMN acme_email TEXT`,
    `ALTER TABLE nodes ADD COLUMN acme_dns_provider TEXT`,
    `ALTER TABLE nodes ADD COLUMN acme_dns_config TEXT`,
    `ALTER TABLE nodes ADD COLUMN masquerade_type TEXT`,
    `ALTER TABLE nodes ADD COLUMN masquerade_config TEXT`,
    `ALTER TABLE nodes ADD COLUMN agent_interval INTEGER`,
    `ALTER TABLE plans ADD COLUMN auto_renew INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE plans ADD COLUMN renewal_period_days INTEGER`,
    `ALTER TABLE subscriptions ADD COLUMN renewal_anchor TEXT`,
  ]) {
    try {
      database.exec(alter)
    } catch {
      // 字段已存在
    }
  }
}

export function getDb() {
  if (db) return db
  ensureDbDirectory(DB_PATH)
  db = new DatabaseSync(DB_PATH)
  migrate(db)
  return db
}
