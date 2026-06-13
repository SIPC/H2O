import { getCountryCentroid } from "@/lib/country-centroids"
import { COUNTRY_OPTIONS } from "@/lib/country-options"
import { parseStoredNodeGeoOverride } from "@/lib/node-geo-override"

export type NodeMapGeoSource = "manual" | "geoip"
export type NodeMapCoordinateSource = "exact" | "country_centroid"

export type ResolvedNodeMapGeo = {
  countryCode: string | null
  countryName: string | null
  latitude: number
  longitude: number
  source: NodeMapGeoSource
  coordinateSource: NodeMapCoordinateSource
}

type NodeMapGeoRow = {
  geo_override?: unknown
  geo_country_code?: unknown
  geo_country_name?: unknown
  geo_latitude?: unknown
  geo_longitude?: unknown
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null
  const normalized = value.trim().replace(/\s+/g, " ")
  return normalized ? normalized.slice(0, maxLength) : null
}

function normalizeCountryCode(value: unknown) {
  const normalized = normalizeText(value, 8)?.toUpperCase() ?? null
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : null
}

function normalizeCoordinate(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return value >= min && value <= max ? value : null
}

function getCountryName(countryCode: string | null, fallback: string | null) {
  if (fallback) return fallback
  if (!countryCode) return null
  return COUNTRY_OPTIONS.find((item) => item.code === countryCode)?.name ?? null
}

function buildResolvedGeo({
  countryCode,
  countryName,
  latitude,
  longitude,
  source,
}: {
  countryCode: string | null
  countryName: string | null
  latitude: number | null
  longitude: number | null
  source: NodeMapGeoSource
}): ResolvedNodeMapGeo | null {
  if (latitude !== null && longitude !== null) {
    return {
      countryCode,
      countryName: getCountryName(countryCode, countryName),
      latitude,
      longitude,
      source,
      coordinateSource: "exact",
    }
  }

  const centroid = getCountryCentroid(countryCode)
  if (!centroid) return null

  return {
    countryCode,
    countryName: getCountryName(countryCode, countryName),
    latitude: centroid.latitude,
    longitude: centroid.longitude,
    source,
    coordinateSource: "country_centroid",
  }
}

export function resolveNodeMapGeo(
  row: NodeMapGeoRow,
  options: { geoipEnabled: boolean }
): ResolvedNodeMapGeo | null {
  const override = parseStoredNodeGeoOverride(row.geo_override)
  if (override) {
    return buildResolvedGeo({
      countryCode: override.countryCode,
      countryName: override.countryName,
      latitude: override.latitude,
      longitude: override.longitude,
      source: "manual",
    })
  }

  if (!options.geoipEnabled) return null

  return buildResolvedGeo({
    countryCode: normalizeCountryCode(row.geo_country_code),
    countryName: normalizeText(row.geo_country_name, 64),
    latitude: normalizeCoordinate(row.geo_latitude, -90, 90),
    longitude: normalizeCoordinate(row.geo_longitude, -180, 180),
    source: "geoip",
  })
}
