import { NextResponse } from "next/server"

import {
  clearSessionCookie,
  getSessionUser,
  revokeSessionByRequest,
} from "@/lib/auth"
import { writeEventLog } from "@/lib/logs-db"
import { getClientIp } from "@/lib/turnstile"

export async function POST(request: Request) {
  // 在撤销前先拿到当前会话用户，方便日志记录；未登录时也允许幂等调用
  const user = getSessionUser(request)
  revokeSessionByRequest(request)

  if (user) {
    writeEventLog({
      event: "LOGOUT",
      user_id: user.id,
      username: user.username,
      ip: getClientIp(request),
      success: true,
      reason: "OK",
    })
  }

  const response = NextResponse.json({ ok: true, data: { loggedOut: true } })
  clearSessionCookie(response)
  return response
}
