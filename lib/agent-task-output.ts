export type AgentTaskOutputType = "text" | "json" | "logs"

export type AgentLogEntry = {
  raw: string
  prefix?: string
  time?: string
  level?: string
  message: string
  detail?: Record<string, unknown>
  service?: string
}

export type AgentTaskOutput = {
  type: AgentTaskOutputType
  value: string
  lines?: number
  logEntries?: AgentLogEntry[]
}

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function unwrapJsonString(input: unknown): unknown {
  if (typeof input !== "string") return input
  const parsed = parseJson(input)
  return parsed ?? input
}

function readPartialJsonString(raw: string, quoteIndex: number): string {
  let out = ""

  for (let i = quoteIndex + 1; i < raw.length; i += 1) {
    const char = raw[i]
    if (char === '"') break
    if (char !== "\\") {
      out += char
      continue
    }

    const escaped = raw[i + 1]
    if (!escaped) break
    i += 1

    if (escaped === '"' || escaped === "\\" || escaped === "/") {
      out += escaped
    } else if (escaped === "n") {
      out += "\n"
    } else if (escaped === "r") {
      out += "\r"
    } else if (escaped === "t") {
      out += "\t"
    } else if (escaped === "b") {
      out += "\b"
    } else if (escaped === "f") {
      out += "\f"
    } else if (escaped === "u") {
      const hex = raw.slice(i + 1, i + 5)
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16))
        i += 4
      }
    } else {
      out += escaped
    }
  }

  return out
}

function extractPartialLogsPayload(
  raw: string
): { logs: string; lines?: number } | null {
  const logsKeyIndex = raw.indexOf('"logs"')
  if (logsKeyIndex < 0) return null

  const colonIndex = raw.indexOf(":", logsKeyIndex)
  if (colonIndex < 0) return null

  const quoteIndex = raw.indexOf('"', colonIndex + 1)
  if (quoteIndex < 0) return null

  const logs = readPartialJsonString(raw, quoteIndex)
  if (!logs) return null

  const linesMatch = raw.match(/"lines"\s*:\s*(\d+)/)
  const lines = linesMatch ? Number(linesMatch[1]) : undefined

  return {
    logs,
    lines: Number.isFinite(lines) ? lines : undefined,
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input && typeof input === "object" && !Array.isArray(input))
}

const taskJsonKeyLabel: Record<string, string> = {
  current_version: "当前版本",
  latest_version: "最新版本",
  updated: "是否已更新",
  restart_required: "需要重启",
  skipped_reason: "跳过原因",
  output: "输出",
  revision: "配置版本",
  hash: "配置哈希",
  path: "路径",
  status: "状态",
  lines: "日志行数",
}

const taskJsonValueLabel: Record<string, string> = {
  running: "运行中",
  stopped: "已停止",
  failed: "异常",
  unknown: "未知",
}

function localizeTaskJson(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(localizeTaskJson)
  if (isRecord(input)) {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        taskJsonKeyLabel[key] ?? key,
        localizeTaskJson(value),
      ])
    )
  }
  if (typeof input === "string") return taskJsonValueLabel[input] ?? input
  return input
}

function parseJournalPrefix(
  line: string
): { prefix: string; content: string; service?: string } | null {
  const match = line.match(
    /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+(\S+)\[\d+\]:)\s+(.*)$/
  )
  if (!match) return null

  return {
    prefix: match[1].trim(),
    service: match[2].trim(),
    content: match[3].trim(),
  }
}

function parseHy2LogContent(
  raw: string,
  content: string,
  prefix?: string,
  service?: string
): AgentLogEntry | null {
  const match = content.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\s+([A-Z]+)\s+(.*)$/
  )
  if (!match) return null

  const time = match[1].trim()
  const level = match[2].trim()
  const messageRaw = match[3].trim()
  const jsonStart = messageRaw.indexOf("{")
  const message =
    jsonStart >= 0 ? messageRaw.slice(0, jsonStart).trim() : messageRaw
  const jsonRaw = jsonStart >= 0 ? messageRaw.slice(jsonStart).trim() : ""
  const parsed = jsonRaw ? parseJson(jsonRaw) : null

  return {
    raw,
    prefix,
    service,
    time,
    level,
    message,
    detail: isRecord(parsed) ? parsed : undefined,
  }
}

function parseGoLogContent(
  raw: string,
  content: string,
  prefix?: string,
  service?: string
): AgentLogEntry | null {
  const match = content.match(
    /^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+(.*)$/
  )
  if (!match) return null

  const message = match[2].trim()
  const level = /失败|错误|fatal|panic/i.test(message)
    ? "ERROR"
    : /重试|跳过|关闭|warning|warn/i.test(message)
      ? "WARN"
      : "INFO"

  return {
    raw,
    prefix,
    service,
    time: match[1].trim(),
    level,
    message,
  }
}

function parsePlainLogContent(
  raw: string,
  content: string,
  prefix?: string,
  service?: string
): AgentLogEntry {
  const level = /失败|错误|fatal|panic|error/i.test(content)
    ? "ERROR"
    : /重试|跳过|关闭|warning|warn/i.test(content)
      ? "WARN"
      : undefined

  return {
    raw,
    prefix,
    service,
    level,
    message: content,
  }
}

export function parseServiceLogEntries(logs: string): AgentLogEntry[] {
  return logs
    .split("\n")
    .map((line): AgentLogEntry | null => {
      const trimmed = line.trimEnd()
      if (!trimmed) return null

      const journal = parseJournalPrefix(trimmed)
      const content = journal?.content ?? trimmed
      const prefix = journal?.prefix
      const service = journal?.service

      return (
        parseHy2LogContent(trimmed, content, prefix, service) ??
        parseGoLogContent(trimmed, content, prefix, service) ??
        parsePlainLogContent(trimmed, content, prefix, service)
      )
    })
    .filter((item): item is AgentLogEntry => item !== null)
}

function formatLogEntry(entry: AgentLogEntry): string {
  if (!entry.time || !entry.level) return entry.raw

  const parts = [
    `${entry.time}  ${entry.level.padEnd(5)}  ${entry.message}`,
    entry.prefix ? `  ${entry.prefix}` : "",
  ].filter(Boolean)

  if (entry.detail) {
    parts.push(
      JSON.stringify(entry.detail, null, 2)
        .split("\n")
        .map((item) => `  ${item}`)
        .join("\n")
    )
  }

  return parts.join("\n")
}

export function formatServiceLogs(logs: string): string {
  return parseServiceLogEntries(logs).map(formatLogEntry).join("\n\n").trim()
}

export function parseAgentTaskOutput(
  result: string | null,
  error?: string | null
): AgentTaskOutput | null {
  const raw = result || error
  if (!raw) return null

  const firstParsed = unwrapJsonString(raw)
  const parsed = unwrapJsonString(firstParsed)

  if (parsed && typeof parsed === "object" && "logs" in parsed) {
    const payload = parsed as { logs?: unknown; lines?: unknown }
    if (typeof payload.logs === "string") {
      const logEntries = parseServiceLogEntries(payload.logs)
      return {
        type: "logs",
        value: logEntries.map(formatLogEntry).join("\n\n").trim(),
        lines:
          typeof payload.lines === "number" && Number.isFinite(payload.lines)
            ? Math.floor(payload.lines)
            : undefined,
        logEntries,
      }
    }
  }

  if (typeof parsed === "string") {
    const partialLogs = extractPartialLogsPayload(parsed)
    if (partialLogs) {
      const logEntries = parseServiceLogEntries(partialLogs.logs)
      return {
        type: "logs",
        value: logEntries.map(formatLogEntry).join("\n\n").trim(),
        lines: partialLogs.lines,
        logEntries,
      }
    }
    return { type: "text", value: parsed }
  }

  return {
    type: "json",
    value: JSON.stringify(localizeTaskJson(parsed), null, 2),
  }
}

export function renderAgentTaskOutput(
  result: string | null,
  error?: string | null
): string {
  return parseAgentTaskOutput(result, error)?.value ?? ""
}
