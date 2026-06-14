import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { writeNotificationLogSafely } from "@/lib/logs-db"
import { getSetting, SETTING_KEYS } from "@/lib/settings"
import {
  maskTelegramTarget,
  normalizeTelegramBotToken,
  normalizeTelegramChatId,
  normalizeTelegramMessageThreadId,
  sendTelegramMessage,
  validateTelegramBotToken,
  validateTelegramChatId,
  validateTelegramMessageThreadId,
} from "@/lib/telegram"
import { getClientIp } from "@/lib/turnstile"

type TelegramTestBody = {
  botToken?: unknown
  chatId?: unknown
  messageThreadId?: unknown
}

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export async function POST(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const ip = getClientIp(request)
  const body = (await request.json().catch(() => ({}))) as TelegramTestBody
  const botToken = normalizeTelegramBotToken(
    body.botToken ?? getSetting<string>(SETTING_KEYS.telegramBotToken, "")
  )
  const chatId = normalizeTelegramChatId(
    body.chatId ?? getSetting<string>(SETTING_KEYS.telegramChatId, "")
  )
  const messageThreadId = normalizeTelegramMessageThreadId(
    body.messageThreadId ??
      getSetting<string>(SETTING_KEYS.telegramMessageThreadId, "")
  )
  const target = chatId ? maskTelegramTarget(chatId, messageThreadId) : null

  if (
    !botToken ||
    !chatId ||
    !validateTelegramBotToken(botToken) ||
    !validateTelegramChatId(chatId) ||
    !validateTelegramMessageThreadId(messageThreadId)
  ) {
    writeNotificationLogSafely({
      channel: "telegram",
      event: "TEST",
      level: "error",
      title: "Telegram 测试通知失败",
      message: "Telegram 配置不合法或不完整",
      target,
      success: false,
      reason: "INVALID_CONFIG",
      detail: { actor: auth.user.username, ip },
    })
    return jsonError(
      "INVALID_PAYLOAD",
      "Telegram 配置不合法或不完整，请检查 Bot Token、Chat ID 和 Topic ID",
      400
    )
  }

  const title = "H2O Telegram 测试通知"
  const message = [
    "这是一条来自 H2O 面板的测试通知。",
    `操作人：${auth.user.username}`,
    `时间：${new Date().toLocaleString("zh-CN")}`,
  ].join("\n")

  const result = await sendTelegramMessage(
    { botToken, chatId, messageThreadId },
    { title, message }
  )

  writeNotificationLogSafely({
    channel: "telegram",
    event: "TEST",
    level: result.ok ? "success" : "error",
    title,
    message,
    target,
    success: result.ok,
    reason: result.ok ? "OK" : result.code,
    detail: {
      actor: auth.user.username,
      ip,
      message_id: result.ok ? result.messageId : null,
      error: result.ok ? null : result.message,
    },
  })

  if (!result.ok) {
    return jsonError(result.code, result.message, 400)
  }

  return NextResponse.json({
    ok: true,
    data: { messageId: result.messageId ?? null },
  })
}
