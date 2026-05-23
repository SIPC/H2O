export type HysteriaObfs = "salamander" | "gecko"

export const GECKO_DEFAULT_MIN_PACKET_SIZE = 512
export const GECKO_DEFAULT_MAX_PACKET_SIZE = 1200
export const GECKO_MAX_PACKET_SIZE_LIMIT = 2048

export function normalizeHysteriaObfs(
  value: string | null | undefined
): HysteriaObfs | null {
  const normalized = value?.trim() || ""
  if (normalized === "salamander" || normalized === "gecko") {
    return normalized
  }
  return null
}

export function isSupportedHysteriaObfs(
  value: string | null | undefined
): value is HysteriaObfs {
  return normalizeHysteriaObfs(value) !== null
}

export function requiresObfsPassword(value: string | null | undefined) {
  return normalizeHysteriaObfs(value) !== null
}

function parseOptionalInteger(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return undefined
    return value
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (!/^\d+$/.test(trimmed)) return undefined
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed)) return undefined
    return parsed
  }
  return undefined
}

export type GeckoPacketSizeValidation =
  | { ok: true; minPacketSize: number | null; maxPacketSize: number | null }
  | { ok: false; message: string }

export function validateGeckoPacketSizes(params: {
  obfs: string | null | undefined
  minPacketSize: unknown
  maxPacketSize: unknown
}): GeckoPacketSizeValidation {
  const obfs = normalizeHysteriaObfs(params.obfs)
  const rawMin = parseOptionalInteger(params.minPacketSize)
  const rawMax = parseOptionalInteger(params.maxPacketSize)

  if (rawMin === undefined || rawMax === undefined) {
    return { ok: false, message: "Gecko 分片大小必须是整数" }
  }

  if (obfs !== "gecko") {
    return { ok: true, minPacketSize: null, maxPacketSize: null }
  }

  const min = rawMin ?? GECKO_DEFAULT_MIN_PACKET_SIZE
  const max = rawMax ?? GECKO_DEFAULT_MAX_PACKET_SIZE

  if (min < 1 || min > GECKO_MAX_PACKET_SIZE_LIMIT) {
    return {
      ok: false,
      message: `Gecko minPacketSize 必须在 1~${GECKO_MAX_PACKET_SIZE_LIMIT} 之间`,
    }
  }

  if (max < 1 || max > GECKO_MAX_PACKET_SIZE_LIMIT) {
    return {
      ok: false,
      message: `Gecko maxPacketSize 必须在 1~${GECKO_MAX_PACKET_SIZE_LIMIT} 之间`,
    }
  }

  if (max < min) {
    return {
      ok: false,
      message: "Gecko maxPacketSize 必须大于等于 minPacketSize",
    }
  }

  return { ok: true, minPacketSize: rawMin, maxPacketSize: rawMax }
}

export function resolveGeckoPacketSizes(params: {
  minPacketSize: number | null | undefined
  maxPacketSize: number | null | undefined
}) {
  return {
    minPacketSize: params.minPacketSize ?? GECKO_DEFAULT_MIN_PACKET_SIZE,
    maxPacketSize: params.maxPacketSize ?? GECKO_DEFAULT_MAX_PACKET_SIZE,
  }
}
