import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { runNotificationChecks } from "@/lib/notifications"

export async function POST(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const result = await runNotificationChecks()
  return NextResponse.json({ ok: true, data: result })
}
