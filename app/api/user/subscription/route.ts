import { NextResponse } from "next/server"

import { requireUser } from "@/lib/auth"
import { getDb } from "@/lib/db"

// 返回当前登录用户的订阅 URL（不暴露 token 本身）
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
      { status: 404 },
    )
  }

  // const origin = new URL(request.url).origin
  const base = `https://byte.lyrify.cloud/api/sub/${row.auth_token}`

  return NextResponse.json({
    ok: true,
    data: {
      url: base,
      urlPlain: `${base}?format=plain`,
    },
  })
}
