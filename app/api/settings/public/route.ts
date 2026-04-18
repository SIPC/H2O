import { NextResponse } from "next/server"

import { getPublicSettings } from "@/lib/settings"

// 公开只读端点：供首页/登录/注册页根据开关隐藏入口
export async function GET() {
  return NextResponse.json({ ok: true, data: getPublicSettings() })
}
