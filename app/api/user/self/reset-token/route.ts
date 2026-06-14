import { localizedJson } from "@/lib/i18n/api-response"

import { requireUser } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { writeEventLog } from "@/lib/logs-db"
import { createUserAuthToken } from "@/lib/tokens"
import { getClientIp } from "@/lib/turnstile"

// 用户自助轮换节点登录 Key（同时等于重置订阅链接）
export async function POST(request: Request) {
  const auth = requireUser(request)
  if (!auth.ok) return auth.response

  const db = getDb()
  const newToken = createUserAuthToken()

  db.prepare(
    `UPDATE users SET auth_token = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(newToken, auth.user.id)

  writeEventLog({
    event: "RESET_TOKEN_SELF",
    user_id: auth.user.id,
    username: auth.user.username,
    ip: getClientIp(request),
    success: true,
    reason: "OK",
  })

  return localizedJson(request, { ok: true })
}
