import { localizedJson } from "@/lib/i18n/api-response"

import { getPublicSettings } from "@/lib/settings"

// 公开只读端点：供首页/登录/注册页根据开关隐藏入口
export async function GET(request: Request) {
  return localizedJson(request, { ok: true, data: getPublicSettings() })
}
