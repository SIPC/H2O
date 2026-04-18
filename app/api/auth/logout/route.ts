import { NextResponse } from "next/server"

import { clearSessionCookie, revokeSessionByRequest } from "@/lib/auth"

export async function POST(request: Request) {
  revokeSessionByRequest(request)
  const response = NextResponse.json({ ok: true, data: { loggedOut: true } })
  clearSessionCookie(response)
  return response
}
