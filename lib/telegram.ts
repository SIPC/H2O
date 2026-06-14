const TELEGRAM_SEND_TIMEOUT_MS = 8000

export type TelegramSendConfig = {
  botToken: string
  chatId: string
  messageThreadId?: string | null
}

export type TelegramSendResult =
  | { ok: true; messageId?: number }
  | { ok: false; code: string; message: string }

export function normalizeTelegramBotToken(value: unknown) {
  if (typeof value !== "string") return ""
  return value.trim()
}

export function normalizeTelegramChatId(value: unknown) {
  if (typeof value !== "string") return ""
  return value.trim()
}

export function normalizeTelegramMessageThreadId(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value)
  }
  if (typeof value !== "string") return ""
  return value.trim()
}

export function validateTelegramBotToken(value: string) {
  if (!value) return true
  if (value.length > 160 || /[\r\n\s]/.test(value)) return false
  return /^\d{6,20}:[A-Za-z0-9_-]{20,128}$/.test(value)
}

export function validateTelegramChatId(value: string) {
  if (!value) return true
  if (value.length > 128 || /[\r\n\s]/.test(value)) return false
  return /^-?\d{1,32}$/.test(value) || /^@[A-Za-z0-9_]{5,32}$/.test(value)
}

export function validateTelegramMessageThreadId(value: string) {
  if (!value) return true
  if (!/^\d{1,16}$/.test(value)) return false
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0
}

export function maskTelegramTarget(
  chatId: string,
  messageThreadId?: string | null
) {
  const id = chatId.trim()
  const thread = messageThreadId?.trim()
  let masked = id
  if (id.startsWith("@")) {
    masked =
      id.length <= 6
        ? `${id.slice(0, 2)}***`
        : `${id.slice(0, 3)}***${id.slice(-2)}`
  } else if (id.length > 8) {
    masked = `${id.slice(0, 4)}***${id.slice(-4)}`
  } else if (id.length > 2) {
    masked = `${id.slice(0, 1)}***${id.slice(-1)}`
  }
  return thread ? `${masked} / topic ${thread}` : masked
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export function buildTelegramHtmlMessage(title: string, message: string) {
  const safeTitle = escapeHtml(title.trim()).slice(0, 512)
  const safeMessage = escapeHtml(message.trim()).slice(0, 3500)
  return `<b>${safeTitle}</b>\n\n${safeMessage}`
}

export async function sendTelegramMessage(
  config: TelegramSendConfig,
  params: { title: string; message: string }
): Promise<TelegramSendResult> {
  const botToken = normalizeTelegramBotToken(config.botToken)
  const chatId = normalizeTelegramChatId(config.chatId)
  const messageThreadId = normalizeTelegramMessageThreadId(
    config.messageThreadId ?? ""
  )

  if (!validateTelegramBotToken(botToken) || !validateTelegramChatId(chatId)) {
    return { ok: false, code: "INVALID_CONFIG", message: "Telegram 配置不合法" }
  }
  if (messageThreadId && !validateTelegramMessageThreadId(messageThreadId)) {
    return {
      ok: false,
      code: "INVALID_CONFIG",
      message: "Telegram Topic ID 不合法",
    }
  }
  if (!botToken || !chatId) {
    return { ok: false, code: "CONFIG_MISSING", message: "Telegram 配置缺失" }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TELEGRAM_SEND_TIMEOUT_MS)
  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: buildTelegramHtmlMessage(params.title, params.message),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }
    if (messageThreadId) payload.message_thread_id = Number(messageThreadId)

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }
    )
    const json = (await response.json().catch(() => null)) as {
      ok?: boolean
      description?: string
      result?: { message_id?: number }
    } | null

    if (!response.ok || !json?.ok) {
      return {
        ok: false,
        code: "TELEGRAM_API_ERROR",
        message: json?.description || `Telegram API 返回 ${response.status}`,
      }
    }

    return { ok: true, messageId: json.result?.message_id }
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError"
    return {
      ok: false,
      code: aborted ? "TELEGRAM_TIMEOUT" : "TELEGRAM_NETWORK_ERROR",
      message: aborted ? "Telegram 请求超时" : "Telegram 请求失败",
    }
  } finally {
    clearTimeout(timer)
  }
}
