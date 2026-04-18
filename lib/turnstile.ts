// Cloudflare Turnstile 服务端校验
const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify"

export type TurnstileStatus = "disabled" | "enabled" | "misconfigured"

// 判断当前 Turnstile 启用状态：两个 key 都缺失视为未启用，单独配置视为错误
export function getTurnstileStatus(): TurnstileStatus {
  const hasSite = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
  const hasSecret = Boolean(process.env.TURNSTILE_SECRET_KEY)
  if (!hasSite && !hasSecret) return "disabled"
  if (hasSite && hasSecret) return "enabled"
  return "misconfigured"
}

export type VerifyResult =
  | { ok: true }
  | {
      ok: false
      code: "TURNSTILE_MISCONFIGURED" | "TURNSTILE_MISSING" | "TURNSTILE_FAILED"
      message: string
    }

// 用前端回传的 token 调 Cloudflare 校验；未启用时直通
export async function verifyTurnstile(
  token: string | undefined,
  remoteIp?: string | null
): Promise<VerifyResult> {
  const status = getTurnstileStatus()
  if (status === "disabled") return { ok: true }
  if (status === "misconfigured") {
    return {
      ok: false,
      code: "TURNSTILE_MISCONFIGURED",
      message: "人机验证未正确配置",
    }
  }
  if (!token) {
    return { ok: false, code: "TURNSTILE_MISSING", message: "请先完成人机验证" }
  }

  const form = new URLSearchParams()
  form.set("secret", process.env.TURNSTILE_SECRET_KEY as string)
  form.set("response", token)
  if (remoteIp) form.set("remoteip", remoteIp)

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      cache: "no-store",
    })
    const data = (await res.json()) as { success?: boolean }
    if (!data.success) {
      return {
        ok: false,
        code: "TURNSTILE_FAILED",
        message: "人机验证未通过，请重试",
      }
    }
    return { ok: true }
  } catch {
    return {
      ok: false,
      code: "TURNSTILE_FAILED",
      message: "人机验证服务不可用，请重试",
    }
  }
}

// 从请求头里尽力提取客户端 IP，用于 siteverify 的 remoteip 字段
export function getClientIp(request: Request): string | null {
  const headers = request.headers
  const forwarded = headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0].trim()
  return headers.get("cf-connecting-ip") ?? headers.get("x-real-ip") ?? null
}
