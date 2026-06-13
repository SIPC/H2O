import { isIP } from "node:net"

import type { DatabaseSync } from "node:sqlite"

const GEO_CACHE_TTL_DAYS = 14
const GEO_FETCH_TIMEOUT_MS = 4000

export type IpGeoCacheRow = {
  ip: string
  country_code: string | null
  country_name: string | null
  region: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
  timezone: string | null
  asn: string | null
  org: string | null
  provider: string | null
  updated_at: string
  expires_at: string | null
}

type IpGeoResult = {
  ip: string
  country_code: string | null
  country_name: string | null
  region: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
  timezone: string | null
  asn: string | null
  org: string | null
  provider: string
}

type IpWhoisAppResponse = {
  countryCode?: string
  countryName?: string
  regionName?: string
  cityName?: string
  latitude?: number
  longitude?: number
  timeZone?: string
  asn?: string
  isp?: string
  organization?: string
}

type FreeIpApiResponse = {
  countryCode?: string
  countryName?: string
  regionName?: string
  cityName?: string
  latitude?: number
  longitude?: number
  timeZone?: string
}

type IpLocationNetResponse = {
  response_code?: string
  response_message?: string
  country_code2?: string
  country_name?: string
  isp?: string
}

function normalizeWhitespace(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null
  const normalized = value.trim().replace(/\s+/g, " ")
  if (!normalized) return null
  return normalized.slice(0, maxLength)
}

function isPrivateIpv4(parts: number[]) {
  const [a, b] = parts
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && parts[2] === 100))) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224 ||
    a === 0
  )
}

function isPrivateIpv6(value: string) {
  const lower = value.toLowerCase()
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff") ||
    lower.startsWith("2001:db8")
  )
}

export function normalizePublicIp(input: unknown) {
  if (input === undefined || input === null || input === "") return null
  if (typeof input !== "string") return false

  const value = input.trim()
  const version = isIP(value)
  if (!version) return false

  if (version === 4) {
    const parts = value.split(".").map((part) => Number(part))
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return false
    }
    return isPrivateIpv4(parts) ? false : value
  }

  return isPrivateIpv6(value) ? false : value.toLowerCase()
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function parseIpWhoisAppResponse(
  ip: string,
  data: IpWhoisAppResponse
): IpGeoResult | null {
  if (!data || typeof data !== "object") return null

  return {
    ip,
    country_code: normalizeWhitespace(data.countryCode, 8),
    country_name: normalizeWhitespace(data.countryName, 64),
    region: normalizeWhitespace(data.regionName, 64),
    city: normalizeWhitespace(data.cityName, 64),
    latitude: numberOrNull(data.latitude),
    longitude: numberOrNull(data.longitude),
    timezone: normalizeWhitespace(data.timeZone, 64),
    asn: normalizeWhitespace(data.asn, 32),
    org:
      normalizeWhitespace(data.organization, 128) ??
      normalizeWhitespace(data.isp, 128),
    provider: "ipwhois.app",
  }
}

function parseFreeIpApiResponse(
  ip: string,
  data: FreeIpApiResponse
): IpGeoResult | null {
  if (!data || typeof data !== "object") return null

  return {
    ip,
    country_code: normalizeWhitespace(data.countryCode, 8),
    country_name: normalizeWhitespace(data.countryName, 64),
    region: normalizeWhitespace(data.regionName, 64),
    city: normalizeWhitespace(data.cityName, 64),
    latitude: numberOrNull(data.latitude),
    longitude: numberOrNull(data.longitude),
    timezone: normalizeWhitespace(data.timeZone, 64),
    asn: null,
    org: null,
    provider: "freeipapi.com",
  }
}

function parseIpLocationNetResponse(
  ip: string,
  data: IpLocationNetResponse
): IpGeoResult | null {
  if (!data || data.response_code !== "200") return null

  return {
    ip,
    country_code: normalizeWhitespace(data.country_code2, 8),
    country_name: normalizeWhitespace(data.country_name, 64),
    region: null,
    city: null,
    latitude: null,
    longitude: null,
    timezone: null,
    asn: null,
    org: normalizeWhitespace(data.isp, 128),
    provider: "api.iplocation.net",
  }
}

export function getCachedIpGeo(database: DatabaseSync, ip: string) {
  const normalizedIp = normalizePublicIp(ip)
  if (!normalizedIp) return null

  return database
    .prepare(
      `SELECT ip, country_code, country_name, region, city,
              latitude, longitude, timezone, asn, org, provider,
              updated_at, expires_at
       FROM ip_geo_cache
       WHERE ip = ?
       LIMIT 1`
    )
    .get(normalizedIp) as IpGeoCacheRow | undefined
}

function getFreshCachedIpGeo(database: DatabaseSync, ip: string) {
  const normalizedIp = normalizePublicIp(ip)
  if (!normalizedIp) return null

  return database
    .prepare(
      `SELECT ip, country_code, country_name, region, city,
              latitude, longitude, timezone, asn, org, provider,
              updated_at, expires_at
       FROM ip_geo_cache
       WHERE ip = ?
         AND (country_code IS NOT NULL OR country_name IS NOT NULL)
         AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
       LIMIT 1`
    )
    .get(normalizedIp) as IpGeoCacheRow | undefined
}

async function fetchJsonWithTimeout(url: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GEO_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
    if (!response.ok) return null
    return (await response.json()) as unknown
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchIpGeo(ip: string) {
  const encodedIp = encodeURIComponent(ip)
  const providers = [
    {
      url: `https://ipwhois.app/json/${encodedIp}`,
      parse: (data: unknown) =>
        parseIpWhoisAppResponse(ip, data as IpWhoisAppResponse),
    },
    {
      url: `https://freeipapi.com/api/json/${encodedIp}`,
      parse: (data: unknown) =>
        parseFreeIpApiResponse(ip, data as FreeIpApiResponse),
    },
    {
      url: `https://api.iplocation.net/?ip=${encodedIp}`,
      parse: (data: unknown) =>
        parseIpLocationNetResponse(ip, data as IpLocationNetResponse),
    },
  ]

  for (const provider of providers) {
    const data = await fetchJsonWithTimeout(provider.url)
    if (!data) continue
    const geo = provider.parse(data)
    if (geo?.country_code || geo?.country_name) return geo
  }

  return null
}

export async function ensureIpGeoCached(database: DatabaseSync, ip: string) {
  const normalizedIp = normalizePublicIp(ip)
  if (!normalizedIp) return null

  const cached = getFreshCachedIpGeo(database, normalizedIp)
  if (cached) return cached

  const geo = await fetchIpGeo(normalizedIp)
  if (!geo) return getCachedIpGeo(database, normalizedIp) ?? null

  database
    .prepare(
      `INSERT INTO ip_geo_cache(
         ip, country_code, country_name, region, city,
         latitude, longitude, timezone, asn, org, provider,
         updated_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', ?))
       ON CONFLICT(ip) DO UPDATE SET
         country_code = excluded.country_code,
         country_name = excluded.country_name,
         region = excluded.region,
         city = excluded.city,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         timezone = excluded.timezone,
         asn = excluded.asn,
         org = excluded.org,
         provider = excluded.provider,
         updated_at = datetime('now'),
         expires_at = excluded.expires_at`
    )
    .run(
      geo.ip,
      geo.country_code,
      geo.country_name,
      geo.region,
      geo.city,
      geo.latitude,
      geo.longitude,
      geo.timezone,
      geo.asn,
      geo.org,
      geo.provider,
      `+${GEO_CACHE_TTL_DAYS} days`
    )

  return getCachedIpGeo(database, normalizedIp) ?? null
}
