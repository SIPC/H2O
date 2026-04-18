import { NextResponse } from "next/server"

import { requireUser } from "@/lib/auth"

export async function GET(request: Request) {
  const auth = requireUser(request)
  if (!auth.ok) return auth.response

  return NextResponse.json({
    ok: true,
    data: {
      id: auth.user.id,
      username: auth.user.username,
      role: auth.user.role,
      status: auth.user.status,
    },
  })
}
