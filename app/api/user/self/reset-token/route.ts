import { NextResponse } from "next/server"

import { requireUser } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { createUserAuthToken } from "@/lib/tokens"

// 用户自助轮换节点登录 Key（同时等于重置订阅链接）
export async function POST(request: Request) {
  const auth = requireUser(request)
  if (!auth.ok) return auth.response

  const db = getDb()
  const newToken = createUserAuthToken()

  db.prepare(`UPDATE users SET auth_token = ?, updated_at = datetime('now') WHERE id = ?`).run(
    newToken,
    auth.user.id,
  )

  return NextResponse.json({ ok: true })
}
