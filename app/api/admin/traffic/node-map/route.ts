import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"
import {
  resolveNodeMapGeo,
  type NodeMapCoordinateSource,
  type NodeMapGeoSource,
} from "@/lib/node-map-geo"
import { getSetting, SETTING_KEYS } from "@/lib/settings"

type MapWindow = "rolling24h" | "today" | "7d"

type NodeTrafficMapRow = {
  id: number
  name: string
  status: "enabled" | "disabled"
  sort_order: number
  geo_override: string | null
  geo_country_code: string | null
  geo_country_name: string | null
  geo_latitude: number | null
  geo_longitude: number | null
  tx_bytes: number | null
  rx_bytes: number | null
}

type NodeMapItem = {
  nodeId: number
  nodeName: string
  status: "enabled" | "disabled"
  txBytes: number
  rxBytes: number
  totalBytes: number
  geoSource?: NodeMapGeoSource
  coordinateSource?: NodeMapCoordinateSource
}

type CountryAccumulator = {
  key: string
  countryCode: string | null
  countryName: string
  latitudeWeight: number
  longitudeWeight: number
  weight: number
  nodeCount: number
  manualNodeCount: number
  centroidNodeCount: number
  txBytes: number
  rxBytes: number
  nodes: NodeMapItem[]
}

const TOP_NODE_LIMIT = 5
const UNKNOWN_NODE_LIMIT = 8

function normalizeWindow(value: string | null): MapWindow {
  if (value === "today" || value === "7d" || value === "rolling24h")
    return value
  return "rolling24h"
}

function getWindowMeta(window: MapWindow) {
  if (window === "today") {
    return {
      label: "今日",
      windowHours: null,
      whereSql: "nht.bucket_date = date('now', 'localtime')",
    }
  }

  if (window === "7d") {
    return {
      label: "近 7 天",
      windowHours: 24 * 7,
      whereSql:
        "nht.bucket_date BETWEEN date('now', 'localtime', '-6 days') AND date('now', 'localtime')",
    }
  }

  return {
    label: "滚动 24 小时",
    windowHours: 24,
    whereSql: `EXISTS (
      SELECT 1
      FROM window_hours wh
      WHERE wh.bucket_date = nht.bucket_date
        AND wh.bucket_hour = nht.bucket_hour
    )`,
  }
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0
}

function getNodeStatus(value: unknown): "enabled" | "disabled" {
  return value === "disabled" ? "disabled" : "enabled"
}

function buildTrafficQuery(window: MapWindow) {
  const meta = getWindowMeta(window)
  const withRollingWindow =
    window === "rolling24h"
      ? `WITH RECURSIVE window_hours(i, bucket_date, bucket_hour) AS (
           SELECT
             0,
             date('now', 'localtime', '-23 hours'),
             CAST(strftime('%H', 'now', 'localtime', '-23 hours') AS INTEGER)
           UNION ALL
           SELECT
             i + 1,
             date('now', 'localtime', printf('-%d hours', 22 - i)),
             CAST(strftime('%H', 'now', 'localtime', printf('-%d hours', 22 - i)) AS INTEGER)
           FROM window_hours
           WHERE i < 23
         ),`
      : "WITH"

  return `${withRollingWindow}
         traffic AS (
           SELECT
             nht.node_id,
             COALESCE(SUM(nht.tx_bytes), 0) AS tx_bytes,
             COALESCE(SUM(nht.rx_bytes), 0) AS rx_bytes
           FROM node_hourly_traffic nht
           WHERE ${meta.whereSql}
           GROUP BY nht.node_id
         )
         SELECT
           n.id,
           n.name,
           n.status,
           n.sort_order,
           n.geo_override,
           CASE WHEN ? THEN igc.country_code ELSE NULL END AS geo_country_code,
           CASE WHEN ? THEN igc.country_name ELSE NULL END AS geo_country_name,
           CASE WHEN ? THEN igc.latitude ELSE NULL END AS geo_latitude,
           CASE WHEN ? THEN igc.longitude ELSE NULL END AS geo_longitude,
           COALESCE(t.tx_bytes, 0) AS tx_bytes,
           COALESCE(t.rx_bytes, 0) AS rx_bytes
         FROM nodes n
         LEFT JOIN traffic t ON t.node_id = n.id
         LEFT JOIN node_agent_state nas ON nas.node_id = n.id
         LEFT JOIN ip_geo_cache igc ON igc.ip = nas.public_ip
         ORDER BY (COALESCE(t.tx_bytes, 0) + COALESCE(t.rx_bytes, 0)) DESC,
                  n.sort_order ASC,
                  n.id ASC`
}

function makeLocationKey(
  countryCode: string | null,
  latitude: number,
  longitude: number
) {
  return countryCode ?? `coord:${latitude.toFixed(3)}:${longitude.toFixed(3)}`
}

function sortNodeItems(a: NodeMapItem, b: NodeMapItem) {
  if (b.totalBytes !== a.totalBytes) return b.totalBytes - a.totalBytes
  return a.nodeId - b.nodeId
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const window = normalizeWindow(url.searchParams.get("window"))
  const meta = getWindowMeta(window)
  const db = getDb()
  const geoipEnabled = getSetting(SETTING_KEYS.geoipEnabled, true)
  const geoipFlag = geoipEnabled ? 1 : 0

  const rows = db
    .prepare(buildTrafficQuery(window))
    .all(geoipFlag, geoipFlag, geoipFlag, geoipFlag) as NodeTrafficMapRow[]

  const countries = new Map<string, CountryAccumulator>()
  const unknownNodes: NodeMapItem[] = []
  let totalTxBytes = 0
  let totalRxBytes = 0
  let locatedTxBytes = 0
  let locatedRxBytes = 0
  let locatedNodeCount = 0

  for (const row of rows) {
    const txBytes = numberOrZero(row.tx_bytes)
    const rxBytes = numberOrZero(row.rx_bytes)
    const totalBytes = txBytes + rxBytes
    totalTxBytes += txBytes
    totalRxBytes += rxBytes

    const geo = resolveNodeMapGeo(row, { geoipEnabled })
    const nodeItem: NodeMapItem = {
      nodeId: row.id,
      nodeName: row.name,
      status: getNodeStatus(row.status),
      txBytes,
      rxBytes,
      totalBytes,
      geoSource: geo?.source,
      coordinateSource: geo?.coordinateSource,
    }

    if (!geo) {
      unknownNodes.push(nodeItem)
      continue
    }

    locatedNodeCount += 1
    locatedTxBytes += txBytes
    locatedRxBytes += rxBytes

    const key = makeLocationKey(geo.countryCode, geo.latitude, geo.longitude)
    const countryName = geo.countryName ?? geo.countryCode ?? "未知地区"
    const weight = Math.max(totalBytes, 1)
    const existing = countries.get(key)

    if (!existing) {
      countries.set(key, {
        key,
        countryCode: geo.countryCode,
        countryName,
        latitudeWeight: geo.latitude * weight,
        longitudeWeight: geo.longitude * weight,
        weight,
        nodeCount: 1,
        manualNodeCount: geo.source === "manual" ? 1 : 0,
        centroidNodeCount: geo.coordinateSource === "country_centroid" ? 1 : 0,
        txBytes,
        rxBytes,
        nodes: [nodeItem],
      })
      continue
    }

    existing.latitudeWeight += geo.latitude * weight
    existing.longitudeWeight += geo.longitude * weight
    existing.weight += weight
    existing.nodeCount += 1
    existing.manualNodeCount += geo.source === "manual" ? 1 : 0
    existing.centroidNodeCount +=
      geo.coordinateSource === "country_centroid" ? 1 : 0
    existing.txBytes += txBytes
    existing.rxBytes += rxBytes
    existing.nodes.push(nodeItem)
  }

  const countryItems = Array.from(countries.values())
    .map((item) => {
      const txBytes = numberOrZero(item.txBytes)
      const rxBytes = numberOrZero(item.rxBytes)
      const nodes = item.nodes.sort(sortNodeItems)
      const topNodes = nodes.slice(0, TOP_NODE_LIMIT)

      return {
        key: item.key,
        countryCode: item.countryCode,
        countryName: item.countryName,
        latitude: item.latitudeWeight / item.weight,
        longitude: item.longitudeWeight / item.weight,
        nodeCount: item.nodeCount,
        manualNodeCount: item.manualNodeCount,
        centroidNodeCount: item.centroidNodeCount,
        txBytes,
        rxBytes,
        totalBytes: txBytes + rxBytes,
        topNodes,
        nodes,
      }
    })
    .sort((a, b) => {
      if (b.totalBytes !== a.totalBytes) return b.totalBytes - a.totalBytes
      return a.countryName.localeCompare(b.countryName, "zh-CN")
    })

  unknownNodes.sort(sortNodeItems)
  const totalBytes = totalTxBytes + totalRxBytes
  const locatedBytes = locatedTxBytes + locatedRxBytes

  return NextResponse.json({
    ok: true,
    data: {
      window,
      windowLabel: meta.label,
      windowHours: meta.windowHours,
      geoipEnabled,
      totalTxBytes,
      totalRxBytes,
      totalBytes,
      locatedTxBytes,
      locatedRxBytes,
      locatedBytes,
      unknownTxBytes: totalTxBytes - locatedTxBytes,
      unknownRxBytes: totalRxBytes - locatedRxBytes,
      unknownBytes: totalBytes - locatedBytes,
      nodeCount: rows.length,
      locatedNodeCount,
      unknownNodeCount: rows.length - locatedNodeCount,
      countries: countryItems,
      unknownNodes: unknownNodes.slice(0, UNKNOWN_NODE_LIMIT),
    },
  })
}
