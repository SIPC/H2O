export type CongestionType = "bbr" | "reno"
export type CongestionBbrProfile = "standard" | "conservative" | "aggressive"

export type HysteriaNetworkConfig = {
  serverBandwidthUpMbps: number
  serverBandwidthDownMbps: number
  ignoreClientBandwidth: boolean
  quicInitStreamReceiveWindow: number | null
  quicMaxStreamReceiveWindow: number | null
  quicInitConnReceiveWindow: number | null
  quicMaxConnReceiveWindow: number | null
  quicMaxIdleTimeoutSeconds: number | null
  quicMaxIncomingStreams: number | null
  quicDisablePathMtuDiscovery: boolean
  congestionType: CongestionType | null
  congestionBbrProfile: CongestionBbrProfile | null
}

export type HysteriaNetworkConfigInput = Partial<
  Record<keyof HysteriaNetworkConfig, unknown>
>

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; code?: string }

function isEmptyInput(value: unknown) {
  return value === undefined || value === null || String(value).trim() === ""
}

function parseNumberInput(value: unknown) {
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim()) return Number(value.trim())
  return NaN
}

export function parseNonNegativeIntegerInput(
  value: unknown,
  label: string
): ParseResult<number> {
  if (isEmptyInput(value)) return { ok: true, value: 0 }

  const n = parseNumberInput(value)
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, message: `${label}必须是非负整数` }
  }

  return { ok: true, value: Math.floor(n) }
}

export function parseOptionalPositiveIntegerInput(
  value: unknown,
  label: string
): ParseResult<number | null> {
  if (isEmptyInput(value)) return { ok: true, value: null }

  const n = parseNumberInput(value)
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, message: `${label}必须是正整数` }
  }

  return { ok: true, value: Math.floor(n) }
}

export function normalizeCongestionType(
  value: unknown
): ParseResult<CongestionType | null> {
  if (isEmptyInput(value)) return { ok: true, value: null }

  const raw = String(value).trim()
  if (raw === "default" || raw === "none") return { ok: true, value: null }
  if (raw === "bbr" || raw === "reno") return { ok: true, value: raw }

  return { ok: false, message: "拥塞控制类型不合法" }
}

export function normalizeCongestionBbrProfile(
  value: unknown,
  congestionType: CongestionType | null
): ParseResult<CongestionBbrProfile | null> {
  if (congestionType !== "bbr") return { ok: true, value: null }
  if (isEmptyInput(value)) return { ok: true, value: null }

  const raw = String(value).trim()
  if (raw === "standard" || raw === "conservative" || raw === "aggressive") {
    return { ok: true, value: raw }
  }

  return { ok: false, message: "BBR 预设不合法" }
}

export function parseBooleanInput(
  value: unknown,
  label: string,
  fallback = false
): ParseResult<boolean> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: fallback }
  }
  if (typeof value === "boolean") return { ok: true, value }
  if (typeof value === "number") {
    if (value === 1) return { ok: true, value: true }
    if (value === 0) return { ok: true, value: false }
  }

  const raw = String(value).trim().toLowerCase()
  if (raw === "true" || raw === "1") return { ok: true, value: true }
  if (raw === "false" || raw === "0") return { ok: true, value: false }
  return { ok: false, message: `${label}必须是 true 或 false` }
}

export function parseBooleanQueryFlag(
  value: string | null,
  label: string
): ParseResult<boolean> {
  return parseBooleanInput(value, label)
}

function pickInput<K extends keyof HysteriaNetworkConfig>(
  input: HysteriaNetworkConfigInput,
  fallback: HysteriaNetworkConfig | null | undefined,
  key: K,
  defaultValue: HysteriaNetworkConfig[K]
) {
  return input[key] !== undefined
    ? input[key]
    : (fallback?.[key] ?? defaultValue)
}

export function parseHysteriaNetworkConfig(
  input: HysteriaNetworkConfigInput,
  fallback?: HysteriaNetworkConfig | null
): ParseResult<HysteriaNetworkConfig> {
  const serverBandwidthUpMbps = parseNonNegativeIntegerInput(
    pickInput(input, fallback, "serverBandwidthUpMbps", 0),
    "服务端上传限速"
  )
  if (!serverBandwidthUpMbps.ok) {
    return { ...serverBandwidthUpMbps, code: "INVALID_SPEED" }
  }

  const serverBandwidthDownMbps = parseNonNegativeIntegerInput(
    pickInput(input, fallback, "serverBandwidthDownMbps", 0),
    "服务端下载限速"
  )
  if (!serverBandwidthDownMbps.ok) {
    return { ...serverBandwidthDownMbps, code: "INVALID_SPEED" }
  }

  const ignoreClientBandwidth = parseBooleanInput(
    pickInput(input, fallback, "ignoreClientBandwidth", false),
    "忽略客户端带宽配置"
  )
  if (!ignoreClientBandwidth.ok) return ignoreClientBandwidth

  const quicInitStreamReceiveWindow = parseOptionalPositiveIntegerInput(
    pickInput(input, fallback, "quicInitStreamReceiveWindow", null),
    "初始流接收窗口"
  )
  if (!quicInitStreamReceiveWindow.ok) return quicInitStreamReceiveWindow

  const quicMaxStreamReceiveWindow = parseOptionalPositiveIntegerInput(
    pickInput(input, fallback, "quicMaxStreamReceiveWindow", null),
    "最大流接收窗口"
  )
  if (!quicMaxStreamReceiveWindow.ok) return quicMaxStreamReceiveWindow

  const quicInitConnReceiveWindow = parseOptionalPositiveIntegerInput(
    pickInput(input, fallback, "quicInitConnReceiveWindow", null),
    "初始连接接收窗口"
  )
  if (!quicInitConnReceiveWindow.ok) return quicInitConnReceiveWindow

  const quicMaxConnReceiveWindow = parseOptionalPositiveIntegerInput(
    pickInput(input, fallback, "quicMaxConnReceiveWindow", null),
    "最大连接接收窗口"
  )
  if (!quicMaxConnReceiveWindow.ok) return quicMaxConnReceiveWindow

  const quicMaxIdleTimeoutSeconds = parseOptionalPositiveIntegerInput(
    pickInput(input, fallback, "quicMaxIdleTimeoutSeconds", null),
    "最大空闲时间"
  )
  if (!quicMaxIdleTimeoutSeconds.ok) return quicMaxIdleTimeoutSeconds

  const quicMaxIncomingStreams = parseOptionalPositiveIntegerInput(
    pickInput(input, fallback, "quicMaxIncomingStreams", null),
    "最大传入流数量"
  )
  if (!quicMaxIncomingStreams.ok) return quicMaxIncomingStreams

  const quicDisablePathMtuDiscovery = parseBooleanInput(
    pickInput(input, fallback, "quicDisablePathMtuDiscovery", false),
    "禁用 Path MTU Discovery"
  )
  if (!quicDisablePathMtuDiscovery.ok) return quicDisablePathMtuDiscovery

  const congestionType = normalizeCongestionType(
    pickInput(input, fallback, "congestionType", null)
  )
  if (!congestionType.ok) return congestionType

  const congestionBbrProfile = normalizeCongestionBbrProfile(
    pickInput(input, fallback, "congestionBbrProfile", null),
    congestionType.value
  )
  if (!congestionBbrProfile.ok) return congestionBbrProfile

  return {
    ok: true,
    value: {
      serverBandwidthUpMbps: serverBandwidthUpMbps.value,
      serverBandwidthDownMbps: serverBandwidthDownMbps.value,
      ignoreClientBandwidth: ignoreClientBandwidth.value,
      quicInitStreamReceiveWindow: quicInitStreamReceiveWindow.value,
      quicMaxStreamReceiveWindow: quicMaxStreamReceiveWindow.value,
      quicInitConnReceiveWindow: quicInitConnReceiveWindow.value,
      quicMaxConnReceiveWindow: quicMaxConnReceiveWindow.value,
      quicMaxIdleTimeoutSeconds: quicMaxIdleTimeoutSeconds.value,
      quicMaxIncomingStreams: quicMaxIncomingStreams.value,
      quicDisablePathMtuDiscovery: quicDisablePathMtuDiscovery.value,
      congestionType: congestionType.value,
      congestionBbrProfile: congestionBbrProfile.value,
    },
  }
}
