import { NextResponse } from "next/server"

import { requireUser } from "@/lib/auth"
import { getDb } from "@/lib/db"

// 返回当前登录用户的订阅路径（不含 host），由前端拼 origin 组装完整 URL
// 不在后端拼 host 是因为内网部署域名多变，在服务端写死域名会导致部署换域名后订阅链接失效
export async function GET(request: Request) {
  const auth = requireUser(request)
  if (!auth.ok) return auth.response
  const db = getDb()
  const row = db
    .prepare(`SELECT auth_token FROM users WHERE id = ? LIMIT 1`)
    .get(auth.user.id) as { auth_token: string } | undefined

  if (!row) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "用户不存在" } },
      { status: 404 }
    )
  }

  return NextResponse.json({
    ok: true,
    data: { path: `/api/sub/${row.auth_token}` },
  })
}
