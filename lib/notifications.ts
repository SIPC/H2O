import type { DatabaseSync } from "node:sqlite"

import { getDb } from "@/lib/db"
import {
  writeNotificationLogSafely,
  type NotificationLogFields,
} from "@/lib/logs-db"
import { SETTING_KEYS, type SettingKey } from "@/lib/settings"
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

export const NOTIFICATION_EVENTS = [
  "NODE_STATUS",
  "HY2_STATUS",
  "SUBSCRIPTION_TRAFFIC_EXCEEDED",
  "HOST_TRAFFIC_EXCEEDED",
  "AGENT_TASK_FAILED",
  "TEST",
] as const

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number]
export type NotificationLevel = "info" | "success" | "warning" | "error"

type NotificationPayload = {
  event: NotificationEvent
  level: NotificationLevel
  title: string
  message: string
  subjectType?: string | null
  subjectId?: string | number | null
  reason?: string | null
  detail?: Record<string, unknown> | null
}

type NotificationStateChangePayload = NotificationPayload & {
  subjectType: string
  subjectId: string | number
  state: string
  notifyOnInitial?: boolean
}

type NotificationOutboxRow = {
  id: number
  event: NotificationEvent
  level: NotificationLevel
  title: string
  message: string
  target: string | null
  subject_type: string | null
  subject_id: string | null
  attempts: number
  detail: string | null
}

type NodeAvailabilityRow = {
  id: number
  name: string
  last_report_at: string | null
  agent_last_seen_at: string | null
}

const MAX_NOTIFICATION_ATTEMPTS = 5
const OUTBOX_BATCH_SIZE = 10
const DEFAULT_NODE_OFFLINE_THRESHOLD_MINUTES = 5
const MIN_NODE_OFFLINE_THRESHOLD_MINUTES = 1
const MAX_NODE_OFFLINE_THRESHOLD_MINUTES = 1440

function stringifyDetail(detail: Record<string, unknown> | null | undefined) {
  if (!detail) return null
  return JSON.stringify(detail)
}

function readSetting<T>(
  database: DatabaseSync,
  key: SettingKey,
  fallback: T
): T {
  const row = database
    .prepare(`SELECT value FROM settings WHERE key = ? LIMIT 1`)
    .get(key) as { value: string } | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

function parseStoredDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const raw = value.trim()
  if (!raw) return null
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T")
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
    ? normalized
    : `${normalized}Z`
  const date = new Date(withZone)
  return Number.isFinite(date.getTime()) ? date : null
}

function formatDate(value: string | null | undefined) {
  const date = parseStoredDate(value)
  return date ? date.toLocaleString("zh-CN") : "无"
}

function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes))
    return "-"
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  let value = Math.max(0, bytes)
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`
}

export function getTelegramNotificationConfig(
  database: DatabaseSync = getDb()
) {
  const botToken = normalizeTelegramBotToken(
    readSetting<string>(database, SETTING_KEYS.telegramBotToken, "")
  )
  const chatId = normalizeTelegramChatId(
    readSetting<string>(database, SETTING_KEYS.telegramChatId, "")
  )
  const messageThreadId = normalizeTelegramMessageThreadId(
    readSetting<string>(database, SETTING_KEYS.telegramMessageThreadId, "")
  )
  const enabled = readSetting<boolean>(
    database,
    SETTING_KEYS.telegramNotificationsEnabled,
    false
  )
  const rawThreshold = readSetting<number>(
    database,
    SETTING_KEYS.telegramNodeOfflineThresholdMinutes,
    DEFAULT_NODE_OFFLINE_THRESHOLD_MINUTES
  )
  const nodeOfflineThresholdMinutes =
    Number.isInteger(rawThreshold) &&
    rawThreshold >= MIN_NODE_OFFLINE_THRESHOLD_MINUTES &&
    rawThreshold <= MAX_NODE_OFFLINE_THRESHOLD_MINUTES
      ? rawThreshold
      : DEFAULT_NODE_OFFLINE_THRESHOLD_MINUTES

  return {
    enabled,
    botToken,
    chatId,
    messageThreadId,
    target: chatId ? maskTelegramTarget(chatId, messageThreadId) : null,
    valid:
      validateTelegramBotToken(botToken) &&
      validateTelegramChatId(chatId) &&
      validateTelegramMessageThreadId(messageThreadId) &&
      Boolean(botToken && chatId),
    nodeOfflineThresholdMinutes,
  }
}

function isTelegramEventEnabled(
  database: DatabaseSync,
  event: NotificationEvent
) {
  if (event === "TEST") return true
  if (event === "NODE_STATUS") {
    return readSetting<boolean>(
      database,
      SETTING_KEYS.telegramNotifyNodeStatus,
      true
    )
  }
  if (event === "HY2_STATUS") {
    return readSetting<boolean>(
      database,
      SETTING_KEYS.telegramNotifyHy2Status,
      true
    )
  }
  if (event === "SUBSCRIPTION_TRAFFIC_EXCEEDED") {
    return readSetting<boolean>(
      database,
      SETTING_KEYS.telegramNotifySubscriptionTrafficExceeded,
      true
    )
  }
  if (event === "HOST_TRAFFIC_EXCEEDED") {
    return readSetting<boolean>(
      database,
      SETTING_KEYS.telegramNotifyHostTrafficExceeded,
      true
    )
  }
  if (event === "AGENT_TASK_FAILED") {
    return readSetting<boolean>(
      database,
      SETTING_KEYS.telegramNotifyAgentTaskFailed,
      true
    )
  }
  return false
}

export function enqueueTelegramNotification(
  database: DatabaseSync,
  payload: NotificationPayload
) {
  const config = getTelegramNotificationConfig(database)
  if (
    !config.enabled ||
    !config.valid ||
    !isTelegramEventEnabled(database, payload.event)
  ) {
    return false
  }

  database
    .prepare(
      `INSERT INTO notification_outbox(
        channel, event, level, title, message, target,
        subject_type, subject_id, detail
      ) VALUES ('telegram', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      payload.event,
      payload.level,
      payload.title,
      payload.message,
      config.target,
      payload.subjectType ?? null,
      payload.subjectId === undefined || payload.subjectId === null
        ? null
        : String(payload.subjectId),
      stringifyDetail({
        ...(payload.detail ?? {}),
        reason: payload.reason ?? null,
      })
    )

  return true
}

function notificationStateKey(
  event: NotificationEvent,
  subjectType: string,
  subjectId: string | number
) {
  return `${event}:${subjectType}:${subjectId}`
}

export function markNotificationState(
  database: DatabaseSync,
  params: {
    event: NotificationEvent
    subjectType: string
    subjectId: string | number
    state: string
    detail?: Record<string, unknown> | null
  }
) {
  const key = notificationStateKey(
    params.event,
    params.subjectType,
    params.subjectId
  )
  database
    .prepare(
      `INSERT INTO notification_states(key, event, subject_type, subject_id, state, last_detail, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET
         state = excluded.state,
         last_detail = excluded.last_detail,
         updated_at = datetime('now')`
    )
    .run(
      key,
      params.event,
      params.subjectType,
      String(params.subjectId),
      params.state,
      stringifyDetail(params.detail)
    )
}

export function enqueueStateChangeTelegramNotification(
  database: DatabaseSync,
  payload: NotificationStateChangePayload
) {
  const key = notificationStateKey(
    payload.event,
    payload.subjectType,
    payload.subjectId
  )
  const current = database
    .prepare(`SELECT state FROM notification_states WHERE key = ? LIMIT 1`)
    .get(key) as { state: string } | undefined

  if (!current) {
    database
      .prepare(
        `INSERT INTO notification_states(
          key, event, subject_type, subject_id, state, last_detail, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(
        key,
        payload.event,
        payload.subjectType,
        String(payload.subjectId),
        payload.state,
        stringifyDetail(payload.detail)
      )
    if (!payload.notifyOnInitial) return false
  } else if (current.state === payload.state) {
    database
      .prepare(
        `UPDATE notification_states
         SET last_detail = ?, updated_at = datetime('now')
         WHERE key = ?`
      )
      .run(stringifyDetail(payload.detail), key)
    return false
  } else {
    database
      .prepare(
        `UPDATE notification_states
         SET state = ?, last_detail = ?, updated_at = datetime('now')
         WHERE key = ?`
      )
      .run(payload.state, stringifyDetail(payload.detail), key)
  }

  const enqueued = enqueueTelegramNotification(database, payload)
  if (enqueued) {
    database
      .prepare(
        `UPDATE notification_states
         SET last_notified_at = datetime('now')
         WHERE key = ?`
      )
      .run(key)
  }
  return enqueued
}

export function enqueueSubscriptionTrafficExceededNotification(
  database: DatabaseSync,
  params: {
    nodeId: number
    nodeName: string
    userId: number
    username: string
    subscriptionId: number
    usedBytes: number
    nextUsageBytes: number
    limitBytes: number
    billableDeltaBytes: number
    billingMode: string | null
  }
) {
  return enqueueStateChangeTelegramNotification(database, {
    event: "SUBSCRIPTION_TRAFFIC_EXCEEDED",
    level: "error",
    state: "exceeded",
    subjectType: "subscription",
    subjectId: params.subscriptionId,
    notifyOnInitial: true,
    title: `订阅流量已超限：${params.username}`,
    message: [
      `节点：${params.nodeName}`,
      `用户：${params.username}`,
      `订阅 ID：${params.subscriptionId}`,
      `原已用：${formatBytes(params.usedBytes)}`,
      `新用量：${formatBytes(params.nextUsageBytes)}`,
      `上限：${formatBytes(params.limitBytes)}`,
      `本次计费增量：${formatBytes(params.billableDeltaBytes)}`,
      `计费口径：${params.billingMode ?? "tx_rx"}`,
    ].join("\n"),
    reason: "TRAFFIC_EXCEEDED",
    detail: {
      node_id: params.nodeId,
      node_name: params.nodeName,
      user_id: params.userId,
      username: params.username,
      subscription_id: params.subscriptionId,
      used_traffic_bytes: params.usedBytes,
      next_usage_bytes: params.nextUsageBytes,
      traffic_limit_bytes: params.limitBytes,
      billable_delta_bytes: params.billableDeltaBytes,
      traffic_billing_mode: params.billingMode ?? "tx_rx",
    },
  })
}

export function enqueueHostTrafficExceededNotification(
  database: DatabaseSync,
  params: {
    nodeId: number
    nodeName: string
    usedBytes: number
    nextUsageBytes: number
    limitBytes: number
    deltaBytes: number
    billingMode: string
  }
) {
  return enqueueStateChangeTelegramNotification(database, {
    event: "HOST_TRAFFIC_EXCEEDED",
    level: "warning",
    state: "exceeded",
    subjectType: "node_host_traffic",
    subjectId: params.nodeId,
    notifyOnInitial: true,
    title: `节点宿主机流量已超限：${params.nodeName}`,
    message: [
      `节点：${params.nodeName}`,
      `原已用：${formatBytes(params.usedBytes)}`,
      `新用量：${formatBytes(params.nextUsageBytes)}`,
      `上限：${formatBytes(params.limitBytes)}`,
      `本次计费增量：${formatBytes(params.deltaBytes)}`,
      `计费口径：${params.billingMode}`,
    ].join("\n"),
    reason: "TRAFFIC_EXCEEDED",
    detail: {
      node_id: params.nodeId,
      node_name: params.nodeName,
      host_traffic_used_bytes: params.usedBytes,
      next_usage_bytes: params.nextUsageBytes,
      host_traffic_limit_bytes: params.limitBytes,
      billable_delta_bytes: params.deltaBytes,
      host_traffic_billing_mode: params.billingMode,
    },
  })
}

export function enqueueHy2StatusNotification(
  database: DatabaseSync,
  params: {
    nodeId: number
    nodeName: string
    oldStatus: string | null
    newStatus: string | null
    hostname: string | null
    hy2Version: string | null
    lastError: string | null
    notifyOnInitial?: boolean
  }
) {
  const status = params.newStatus || "unknown"
  const abnormal = status !== "running"
  return enqueueStateChangeTelegramNotification(database, {
    event: "HY2_STATUS",
    level: abnormal ? "error" : "success",
    state: status,
    subjectType: "node_hy2",
    subjectId: params.nodeId,
    notifyOnInitial: params.notifyOnInitial,
    title: abnormal
      ? `Hysteria2 状态异常：${params.nodeName}`
      : `Hysteria2 已恢复：${params.nodeName}`,
    message: [
      `节点：${params.nodeName}`,
      `状态：${status}`,
      `上次状态：${params.oldStatus ?? "未知"}`,
      `主机：${params.hostname ?? "未知"}`,
      `版本：${params.hy2Version ?? "未知"}`,
      params.lastError ? `错误：${params.lastError.slice(0, 500)}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    reason: abnormal ? "HY2_FAILED" : "HY2_RECOVERED",
    detail: {
      node_id: params.nodeId,
      node_name: params.nodeName,
      old_status: params.oldStatus,
      new_status: status,
      hostname: params.hostname,
      hy2_version: params.hy2Version,
      error: params.lastError,
    },
  })
}

export function enqueueAgentTaskFailedNotification(
  database: DatabaseSync,
  params: {
    nodeId: number
    nodeName: string
    taskId: number
    taskType: string | null
    error: string | null
  }
) {
  return enqueueTelegramNotification(database, {
    event: "AGENT_TASK_FAILED",
    level: "error",
    subjectType: "agent_task",
    subjectId: params.taskId,
    title: `Agent 任务执行失败：${params.nodeName}`,
    message: [
      `节点：${params.nodeName}`,
      `任务 ID：${params.taskId}`,
      `任务类型：${params.taskType ?? "未知"}`,
      params.error ? `错误：${params.error.slice(0, 800)}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    reason: "AGENT_TASK_FAILED",
    detail: {
      node_id: params.nodeId,
      node_name: params.nodeName,
      task_id: params.taskId,
      task_type: params.taskType,
      error: params.error,
    },
  })
}

function isFreshAt(value: string | null, thresholdMs: number, nowMs: number) {
  const date = parseStoredDate(value)
  if (!date) return false
  return nowMs - date.getTime() <= thresholdMs
}

export function checkNodeAvailabilityNotifications(
  database: DatabaseSync = getDb()
) {
  const config = getTelegramNotificationConfig(database)
  if (
    !config.enabled ||
    !config.valid ||
    !isTelegramEventEnabled(database, "NODE_STATUS")
  ) {
    return 0
  }

  const thresholdMs = config.nodeOfflineThresholdMinutes * 60 * 1000
  const nowMs = Date.now()
  const rows = database
    .prepare(
      `SELECT n.id, n.name,
              ns.last_report_at,
              nas.last_seen_at AS agent_last_seen_at
       FROM nodes n
       LEFT JOIN node_stats ns ON ns.node_id = n.id
       LEFT JOIN node_agent_state nas ON nas.node_id = n.id
       WHERE n.status = 'enabled'`
    )
    .all() as NodeAvailabilityRow[]

  let enqueued = 0
  database.exec("BEGIN")
  try {
    for (const row of rows) {
      const online =
        isFreshAt(row.last_report_at, thresholdMs, nowMs) ||
        isFreshAt(row.agent_last_seen_at, thresholdMs, nowMs)
      const state = online ? "online" : "offline"
      const didEnqueue = enqueueStateChangeTelegramNotification(database, {
        event: "NODE_STATUS",
        level: online ? "success" : "error",
        state,
        subjectType: "node",
        subjectId: row.id,
        title: online ? `节点恢复在线：${row.name}` : `节点离线：${row.name}`,
        message: [
          `节点：${row.name}`,
          `状态：${online ? "在线" : "离线"}`,
          `流量上报：${formatDate(row.last_report_at)}`,
          `控制面同步：${formatDate(row.agent_last_seen_at)}`,
          `离线阈值：${config.nodeOfflineThresholdMinutes} 分钟`,
        ].join("\n"),
        reason: online ? "NODE_ONLINE" : "NODE_OFFLINE",
        detail: {
          node_id: row.id,
          node_name: row.name,
          state,
          last_report_at: row.last_report_at,
          agent_last_seen_at: row.agent_last_seen_at,
          offline_threshold_minutes: config.nodeOfflineThresholdMinutes,
        },
      })
      if (didEnqueue) enqueued++
    }
    database.exec("COMMIT")
  } catch {
    database.exec("ROLLBACK")
    throw new Error("检查节点通知失败")
  }

  return enqueued
}

function buildNotificationLog(
  row: NotificationOutboxRow,
  success: boolean,
  reason: string
) {
  return {
    channel: "telegram",
    event: row.event,
    level: row.level,
    title: row.title,
    message: row.message,
    target: row.target,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    success,
    reason,
    detail: row.detail,
  } satisfies NotificationLogFields
}

export async function processNotificationOutbox(
  database: DatabaseSync = getDb()
) {
  const config = getTelegramNotificationConfig(database)
  if (!config.enabled || !config.valid)
    return { processed: 0, sent: 0, failed: 0 }

  database
    .prepare(
      `UPDATE notification_outbox
       SET status = 'failed',
           last_error = '发送中断，等待重试',
           next_attempt_at = datetime('now'),
           updated_at = datetime('now')
       WHERE status = 'sending'
         AND updated_at <= datetime('now', '-10 minutes')`
    )
    .run()

  const rows = database
    .prepare(
      `SELECT id, event, level, title, message, target,
              subject_type, subject_id, attempts, detail
       FROM notification_outbox
       WHERE status IN ('queued','failed')
         AND attempts < ?
         AND next_attempt_at <= datetime('now')
       ORDER BY id ASC
       LIMIT ?`
    )
    .all(
      MAX_NOTIFICATION_ATTEMPTS,
      OUTBOX_BATCH_SIZE
    ) as NotificationOutboxRow[]

  let sent = 0
  let failed = 0

  for (const row of rows) {
    const nextAttempts = row.attempts + 1
    const claim = database
      .prepare(
        `UPDATE notification_outbox
         SET status = 'sending', attempts = ?, updated_at = datetime('now')
         WHERE id = ?
           AND status IN ('queued','failed')
           AND attempts = ?
           AND attempts < ?
           AND next_attempt_at <= datetime('now')`
      )
      .run(nextAttempts, row.id, row.attempts, MAX_NOTIFICATION_ATTEMPTS)
    if (claim.changes <= 0) continue

    const result = await sendTelegramMessage(
      {
        botToken: config.botToken,
        chatId: config.chatId,
        messageThreadId: config.messageThreadId,
      },
      { title: row.title, message: row.message }
    )

    if (result.ok) {
      sent++
      database
        .prepare(
          `UPDATE notification_outbox
           SET status = 'sent', sent_at = datetime('now'), last_error = NULL, updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(row.id)
      writeNotificationLogSafely(buildNotificationLog(row, true, "OK"))
      continue
    }

    failed++
    const finalFailed = nextAttempts >= MAX_NOTIFICATION_ATTEMPTS
    const retrySeconds = Math.min(300, 30 * nextAttempts)
    database
      .prepare(
        `UPDATE notification_outbox
         SET status = 'failed',
             last_error = ?,
             next_attempt_at = datetime('now', ?),
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        result.message,
        finalFailed ? "+365 day" : `+${retrySeconds} seconds`,
        row.id
      )
    writeNotificationLogSafely(
      buildNotificationLog(row, false, result.code || "TELEGRAM_API_ERROR")
    )
  }

  return { processed: rows.length, sent, failed }
}

export async function processNotificationOutboxSafely(
  database: DatabaseSync = getDb()
) {
  try {
    return await processNotificationOutbox(database)
  } catch (error) {
    console.error("process notification outbox failed", error)
    return { processed: 0, sent: 0, failed: 0 }
  }
}

export async function runNotificationChecks(database: DatabaseSync = getDb()) {
  try {
    checkNodeAvailabilityNotifications(database)
  } catch (error) {
    console.error("check node availability notifications failed", error)
  }
  return processNotificationOutboxSafely(database)
}
