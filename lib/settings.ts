import { getDb } from "@/lib/db"

// 站点级设置，key-value 单表，值用 JSON.stringify/parse 存取
export const SETTING_KEYS = {
  registrationEnabled: "registration_enabled",
  loginEnabled: "login_enabled",
  newUserDefaultActive: "new_user_default_active",
  turnstileSiteKey: "turnstile_site_key",
  turnstileSecretKey: "turnstile_secret_key",
  agentBundleUrl: "agent_bundle_url",
  statsRetentionDays: "stats_retention_days",
} as const

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]

// 默认值，未写入 DB 时使用；同时也是白名单（只允许这些 key 被读写）
// 校验请求体时按每个 key 的默认值类型（boolean / string / number）决定允许的类型
export const SETTING_DEFAULTS: Record<SettingKey, unknown> = {
  [SETTING_KEYS.registrationEnabled]: true,
  [SETTING_KEYS.loginEnabled]: true,
  [SETTING_KEYS.newUserDefaultActive]: true,
  [SETTING_KEYS.turnstileSiteKey]: "",
  [SETTING_KEYS.turnstileSecretKey]: "",
  [SETTING_KEYS.agentBundleUrl]: "",
  [SETTING_KEYS.statsRetentionDays]: 30,
}

// 暴露给未登录前端的 key（用于首页/登录/注册页隐藏入口，不泄露内部策略）
// site key 天生会出现在浏览器里，可以公开；secret key 绝不能放入
export const PUBLIC_SETTING_KEYS: SettingKey[] = [
  SETTING_KEYS.registrationEnabled,
  SETTING_KEYS.loginEnabled,
  SETTING_KEYS.turnstileSiteKey,
]

function parseValue<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// 单键读取，未写入时返回默认值
export function getSetting<T>(key: SettingKey, fallback: T): T {
  const db = getDb()
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = ? LIMIT 1`)
    .get(key) as { value: string } | undefined
  if (!row) return fallback
  return parseValue<T>(row.value, fallback)
}

// upsert 一个设置项
export function setSetting(key: SettingKey, value: unknown): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO settings(key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, JSON.stringify(value))
}

// 读所有设置，DB 里没写入的 key 用默认值补齐
export function getAllSettings(): Record<SettingKey, unknown> {
  const db = getDb()
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as Array<{
    key: string
    value: string
  }>
  const merged: Record<string, unknown> = { ...SETTING_DEFAULTS }
  for (const row of rows) {
    // 只接受白名单内的 key，避免历史脏数据污染响应
    if (row.key in SETTING_DEFAULTS) {
      merged[row.key] = parseValue(
        row.value,
        SETTING_DEFAULTS[row.key as SettingKey]
      )
    }
  }
  return merged as Record<SettingKey, unknown>
}

// 只返回公开白名单里的设置，供未登录前端使用
export function getPublicSettings(): Record<string, unknown> {
  const all = getAllSettings()
  const out: Record<string, unknown> = {}
  for (const key of PUBLIC_SETTING_KEYS) {
    out[key] = all[key]
  }
  return out
}
