import type { DatabaseSync } from "node:sqlite"

export const HOST_TRAFFIC_RESET_CYCLES = [
  "none",
  "daily",
  "weekly",
  "monthly",
  "custom_days",
] as const

export const HOST_TRAFFIC_BILLING_MODES = ["tx_rx", "tx", "rx"] as const

export type HostTrafficResetCycle = (typeof HOST_TRAFFIC_RESET_CYCLES)[number]
export type HostTrafficBillingMode = (typeof HOST_TRAFFIC_BILLING_MODES)[number]

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string }

type HostTrafficRow = {
  id?: number
  host_traffic_limit_bytes: number | null
  host_traffic_used_bytes: number | null
  host_traffic_billing_mode?: string | null
  host_traffic_reset_cycle: string | null
  host_traffic_reset_interval_days: number | null
  host_traffic_reset_anchor: string | null
  host_traffic_last_reset_at?: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000
const MIN_INTERVAL_DAYS = 1
const MAX_INTERVAL_DAYS = 366

export function isHostTrafficResetCycle(
  value: unknown
): value is HostTrafficResetCycle {
  return (
    typeof value === "string" &&
    HOST_TRAFFIC_RESET_CYCLES.includes(value as HostTrafficResetCycle)
  )
}

export function isHostTrafficBillingMode(
  value: unknown
): value is HostTrafficBillingMode {
  return (
    typeof value === "string" &&
    HOST_TRAFFIC_BILLING_MODES.includes(value as HostTrafficBillingMode)
  )
}

export function parseHostTrafficLimitBytes(
  value: unknown
): ParseResult<number | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null }
  }

  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(n) || n < 0) {
    return { ok: false, message: "宿主机总流量不合法" }
  }

  return { ok: true, value: n > 0 ? n : null }
}

export function parseHostTrafficUsedBytes(value: unknown): ParseResult<number> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: 0 }
  }

  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(n) || n < 0) {
    return { ok: false, message: "宿主机已用流量不合法" }
  }

  return { ok: true, value: n }
}

export function parseHostTrafficResetCycle(
  value: unknown
): ParseResult<HostTrafficResetCycle> {
  if (!isHostTrafficResetCycle(value)) {
    return { ok: false, message: "宿主机流量重置周期不合法" }
  }
  return { ok: true, value }
}

export function parseHostTrafficBillingMode(
  value: unknown
): ParseResult<HostTrafficBillingMode> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: "tx_rx" }
  }

  if (!isHostTrafficBillingMode(value)) {
    return { ok: false, message: "宿主机流量计费口径不合法" }
  }
  return { ok: true, value }
}

export function parseHostTrafficResetIntervalDays(
  value: unknown
): ParseResult<number | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null }
  }

  const n = typeof value === "number" ? value : Number(value)
  if (
    !Number.isSafeInteger(n) ||
    n < MIN_INTERVAL_DAYS ||
    n > MAX_INTERVAL_DAYS
  ) {
    return {
      ok: false,
      message: `宿主机流量自定义重置天数需为 ${MIN_INTERVAL_DAYS}~${MAX_INTERVAL_DAYS}`,
    }
  }

  return { ok: true, value: n }
}

export function parseHostTrafficResetAnchor(
  value: unknown
): ParseResult<string | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null }
  }

  const date = parseStoredDate(String(value))
  if (!date) return { ok: false, message: "宿主机流量周期起始时间不合法" }
  return { ok: true, value: date.toISOString() }
}

export function validateHostTrafficResetConfig(
  cycle: HostTrafficResetCycle,
  intervalDays: number | null
): ParseResult<true> {
  if (cycle === "custom_days" && !intervalDays) {
    return { ok: false, message: "自定义重置周期需要填写天数" }
  }
  return { ok: true, value: true }
}

function normalizeCycle(value: string | null): HostTrafficResetCycle {
  return isHostTrafficResetCycle(value) ? value : "monthly"
}

function normalizeBillingMode(
  value: string | null | undefined
): HostTrafficBillingMode {
  return isHostTrafficBillingMode(value) ? value : "tx_rx"
}

function normalizeNonNegativeInteger(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0
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

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

function addUtcMonths(date: Date, months: number): Date {
  const firstOfTarget = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  )
  const year = firstOfTarget.getUTCFullYear()
  const month = firstOfTarget.getUTCMonth()
  const day = Math.min(date.getUTCDate(), daysInUtcMonth(year, month))

  return new Date(
    Date.UTC(
      year,
      month,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  )
}

function getFixedIntervalDays(
  cycle: HostTrafficResetCycle,
  intervalDays: number | null
): number | null {
  if (cycle === "daily") return 1
  if (cycle === "weekly") return 7
  if (cycle === "custom_days") return intervalDays
  return null
}

function getPeriodInfo(row: HostTrafficRow, now = new Date()) {
  const cycle = normalizeCycle(row.host_traffic_reset_cycle)
  const anchor = parseStoredDate(row.host_traffic_reset_anchor) ?? now

  if (cycle === "none") {
    return {
      cycle,
      anchor,
      shouldReset: false,
      nextResetAt: null as Date | null,
      currentAnchor: anchor,
    }
  }

  if (cycle === "monthly") {
    if (now.getTime() < anchor.getTime()) {
      return {
        cycle,
        anchor,
        shouldReset: false,
        nextResetAt: addUtcMonths(anchor, 1),
        currentAnchor: anchor,
      }
    }

    let months =
      (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      (now.getUTCMonth() - anchor.getUTCMonth())
    let currentAnchor = addUtcMonths(anchor, months)

    if (currentAnchor.getTime() > now.getTime()) {
      months -= 1
      currentAnchor = addUtcMonths(anchor, months)
    }

    return {
      cycle,
      anchor,
      shouldReset: months >= 1,
      nextResetAt: addUtcMonths(currentAnchor, 1),
      currentAnchor,
    }
  }

  const fixedDays = getFixedIntervalDays(
    cycle,
    row.host_traffic_reset_interval_days
  )
  if (!fixedDays) {
    return {
      cycle,
      anchor,
      shouldReset: false,
      nextResetAt: null as Date | null,
      currentAnchor: anchor,
    }
  }

  const intervalMs = fixedDays * DAY_MS
  if (now.getTime() < anchor.getTime()) {
    return {
      cycle,
      anchor,
      shouldReset: false,
      nextResetAt: new Date(anchor.getTime() + intervalMs),
      currentAnchor: anchor,
    }
  }

  const cycles = Math.floor((now.getTime() - anchor.getTime()) / intervalMs)
  const currentAnchor = new Date(anchor.getTime() + cycles * intervalMs)

  return {
    cycle,
    anchor,
    shouldReset: cycles >= 1,
    nextResetAt: new Date(currentAnchor.getTime() + intervalMs),
    currentAnchor,
  }
}

function readNodeHostTrafficRow(
  database: DatabaseSync,
  nodeId: number
): HostTrafficRow | null {
  return (
    (database
      .prepare(
        `SELECT id, host_traffic_limit_bytes, host_traffic_used_bytes,
                host_traffic_billing_mode, host_traffic_reset_cycle,
                host_traffic_reset_interval_days, host_traffic_reset_anchor,
                host_traffic_last_reset_at
         FROM nodes
         WHERE id = ?
         LIMIT 1`
      )
      .get(nodeId) as HostTrafficRow | undefined) ?? null
  )
}

export function ensureNodeHostTrafficPeriod(
  database: DatabaseSync,
  nodeId: number,
  now = new Date()
): HostTrafficRow | null {
  const row = readNodeHostTrafficRow(database, nodeId)
  if (!row) return null

  const limit = normalizeNonNegativeInteger(row.host_traffic_limit_bytes)
  if (limit <= 0) return row

  const period = getPeriodInfo(row, now)
  if (!row.host_traffic_reset_anchor) {
    database
      .prepare(
        `UPDATE nodes
         SET host_traffic_reset_anchor = ?
         WHERE id = ?`
      )
      .run(period.currentAnchor.toISOString(), nodeId)
    row.host_traffic_reset_anchor = period.currentAnchor.toISOString()
  }

  if (!period.shouldReset) return row

  const nextAnchor = period.currentAnchor.toISOString()
  const resetAt = now.toISOString()

  database
    .prepare(
      `UPDATE nodes
       SET host_traffic_used_bytes = 0,
           host_traffic_reset_anchor = ?,
           host_traffic_last_reset_at = ?
       WHERE id = ?`
    )
    .run(nextAnchor, resetAt, nodeId)

  return {
    ...row,
    host_traffic_used_bytes: 0,
    host_traffic_reset_anchor: nextAnchor,
    host_traffic_last_reset_at: resetAt,
  }
}

export function ensureAllNodeHostTrafficPeriods(database: DatabaseSync) {
  const rows = database
    .prepare(
      `SELECT id
       FROM nodes
       WHERE COALESCE(host_traffic_limit_bytes, 0) > 0`
    )
    .all() as Array<{ id: number }>

  const now = new Date()
  for (const row of rows) ensureNodeHostTrafficPeriod(database, row.id, now)
}

function getBilledTrafficDelta(
  mode: HostTrafficBillingMode,
  txBytes: number,
  rxBytes: number
) {
  const tx = Number.isFinite(txBytes) && txBytes > 0 ? Math.floor(txBytes) : 0
  const rx = Number.isFinite(rxBytes) && rxBytes > 0 ? Math.floor(rxBytes) : 0

  if (mode === "tx") return tx
  if (mode === "rx") return rx
  return tx + rx
}

export function addNodeHostTrafficUsage(
  database: DatabaseSync,
  nodeId: number,
  txBytes: number,
  rxBytes: number
) {
  const row = ensureNodeHostTrafficPeriod(database, nodeId)
  if (!row) return

  const deltaBytes = getBilledTrafficDelta(
    normalizeBillingMode(row.host_traffic_billing_mode),
    txBytes,
    rxBytes
  )
  if (deltaBytes <= 0) return

  database
    .prepare(
      `UPDATE nodes
       SET host_traffic_used_bytes = COALESCE(host_traffic_used_bytes, 0) + ?
       WHERE id = ?
         AND COALESCE(host_traffic_limit_bytes, 0) > 0`
    )
    .run(deltaBytes, nodeId)
}

export function buildNodeHostTrafficSummary(row: HostTrafficRow) {
  const limit = normalizeNonNegativeInteger(row.host_traffic_limit_bytes)
  const used = normalizeNonNegativeInteger(row.host_traffic_used_bytes)

  if (limit <= 0) {
    return {
      host_traffic_remaining_bytes: null,
      host_traffic_usage_ratio: null,
      host_traffic_next_reset_at: null,
      host_traffic_over_limit: false,
    }
  }

  const period = getPeriodInfo(row)

  return {
    host_traffic_remaining_bytes: limit - used,
    host_traffic_usage_ratio: used / limit,
    host_traffic_next_reset_at: period.nextResetAt?.toISOString() ?? null,
    host_traffic_over_limit: used > limit,
  }
}
