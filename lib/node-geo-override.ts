export type NodeGeoOverride = {
  countryCode: string | null
  countryName: string | null
  region: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
}

type ParseResult =
  | { ok: true; value: NodeGeoOverride | null }
  | { ok: false; message: string }

function normalizeText(input: unknown, maxLength: number) {
  if (input === undefined || input === null || input === "") return null
  if (typeof input !== "string") return false
  const value = input.trim().replace(/\s+/g, " ")
  if (!value) return null
  return value.length <= maxLength ? value : false
}

function normalizeCountryCode(input: unknown) {
  const value = normalizeText(input, 8)
  if (value === null || value === false) return value
  const upper = value.toUpperCase()
  return /^[A-Z]{2}$/.test(upper) ? upper : false
}

function normalizeCoordinate(input: unknown, min: number, max: number) {
  if (input === undefined || input === null || input === "") return null
  const value = typeof input === "string" ? Number(input.trim()) : input
  if (typeof value !== "number" || !Number.isFinite(value)) return false
  if (value < min || value > max) return false
  return value
}

export function normalizeNodeGeoOverride(input: unknown): ParseResult {
  if (input === undefined || input === null) return { ok: true, value: null }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "位置覆盖参数不合法" }
  }

  const payload = input as Record<string, unknown>
  const countryCode = normalizeCountryCode(payload.countryCode)
  const countryName = normalizeText(payload.countryName, 64)
  const region = normalizeText(payload.region, 64)
  const city = normalizeText(payload.city, 64)
  const latitude = normalizeCoordinate(payload.latitude, -90, 90)
  const longitude = normalizeCoordinate(payload.longitude, -180, 180)

  if (countryCode === false) {
    return { ok: false, message: "国家代码必须是 2 位大写字母，如 US、HK、JP" }
  }
  if (countryName === false) {
    return { ok: false, message: "国家名称不能超过 64 个字符" }
  }
  if (region === false) {
    return { ok: false, message: "地区名称不能超过 64 个字符" }
  }
  if (city === false) {
    return { ok: false, message: "城市名称不能超过 64 个字符" }
  }
  if (latitude === false) {
    return { ok: false, message: "纬度必须在 -90 到 90 之间" }
  }
  if (longitude === false) {
    return { ok: false, message: "经度必须在 -180 到 180 之间" }
  }

  if (!countryCode && !countryName && !region && !city && latitude === null && longitude === null) {
    return { ok: true, value: null }
  }

  return {
    ok: true,
    value: {
      countryCode,
      countryName,
      region,
      city,
      latitude,
      longitude,
    },
  }
}

export function stringifyNodeGeoOverride(value: NodeGeoOverride | null) {
  return value ? JSON.stringify(value) : null
}

export function parseStoredNodeGeoOverride(input: unknown): NodeGeoOverride | null {
  if (typeof input !== "string" || !input.trim()) return null
  try {
    const parsed = JSON.parse(input) as unknown
    const normalized = normalizeNodeGeoOverride(parsed)
    return normalized.ok ? normalized.value : null
  } catch {
    return null
  }
}
