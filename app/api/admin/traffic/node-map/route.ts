import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getCountryCentroid } from "@/lib/country-centroids"
import { COUNTRY_OPTIONS } from "@/lib/country-options"
import { getDb } from "@/lib/db"
import {
  ensureIpGeoCached,
  getCachedIpGeo,
  normalizePublicIp,
  type IpGeoCacheRow,
} from "@/lib/ip-geo"
import { getLogsDb } from "@/lib/logs-db"
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

type NodeFlowTarget = {
  nodeId: number
  nodeName: string
  countryCode: string
  countryName: string
  latitude: number
  longitude: number
  txBytes: number
  rxBytes: number
  totalBytes: number
}

type AuthFlowRow = {
  node_id: number | null
  user_id: number | null
  username: string | null
  ip: string | null
  auth_count: number | null
  first_auth_at: string | null
  last_auth_at: string | null
}

type UserTrafficRow = {
  node_id: number | null
  user_id: number | null
  username: string | null
  tx_bytes: number | null
  rx_bytes: number | null
}

type SourceCountryGeo = {
  countryCode: string
  countryName: string
  latitude: number
  longitude: number
}

type SourceAuthRow = {
  nodeId: number
  userId: number | null
  username: string
  ip: string | null
  authCount: number
  firstAuthAt: string | null
  lastAuthAt: string | null
  source: SourceCountryGeo
}

type FlowNodeAccumulator = {
  nodeId: number
  nodeName: string
  authCount: number
  estimatedTxBytes: number
  estimatedRxBytes: number
  estimatedBytes: number
}

type FlowAccountAccumulator = {
  userId: number | null
  username: string
  authCount: number
  estimatedTxBytes: number
  estimatedRxBytes: number
  estimatedBytes: number
}

type FlowConnectionAccumulator = {
  key: string
  nodeId: number
  nodeName: string
  userId: number | null
  username: string
  authCount: number
  nodeAuthCount: number
  accountNodeAuthCount: number
  sourceIps: Map<string, number>
  firstAuthAt: string | null
  lastAuthAt: string | null
  estimatedTxBytes: number
  estimatedRxBytes: number
  estimatedBytes: number
  accountNodeTxBytes: number | null
  accountNodeRxBytes: number | null
  accountNodeBytes: number | null
  nodeTxBytes: number
  nodeRxBytes: number
  nodeBytes: number
  trafficBasis: "account_traffic" | "node_auth_share"
}

type UserTrafficAccumulator = {
  txBytes: number
  rxBytes: number
}

type FlowAccumulator = {
  key: string
  sourceCountryCode: string
  sourceCountryName: string
  sourceLatitude: number
  sourceLongitude: number
  targetCountryCode: string
  targetCountryName: string
  targetLatitude: number
  targetLongitude: number
  authCount: number
  estimatedTxBytes: number
  estimatedRxBytes: number
  nodes: Map<number, FlowNodeAccumulator>
  accounts: Map<string, FlowAccountAccumulator>
  connections: Map<string, FlowConnectionAccumulator>
}

const TOP_NODE_LIMIT = 5
const UNKNOWN_NODE_LIMIT = 8
const AUTH_FLOW_GROUP_LIMIT = 5000
const FLOW_ONLINE_GEOIP_LIMIT = 24
const FLOW_LIMIT = 80
const FLOW_TOP_NODE_LIMIT = 5
const FLOW_TOP_ACCOUNT_LIMIT = 8
const FLOW_TOP_CONNECTION_LIMIT = 24

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

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null
  const normalized = value.trim().replace(/\s+/g, " ")
  return normalized ? normalized.slice(0, maxLength) : null
}

function normalizeCountryCode(value: unknown) {
  const normalized = normalizeText(value, 8)?.toUpperCase() ?? null
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : null
}

function getCountryName(countryCode: string | null, fallback: string | null) {
  if (fallback) return fallback
  if (!countryCode) return "未知地区"
  return (
    COUNTRY_OPTIONS.find((item) => item.code === countryCode)?.name ??
    countryCode
  )
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

function getAuthWindowWhere(window: MapWindow) {
  if (window === "today") {
    return "date(created_at, 'localtime') = date('now', 'localtime')"
  }
  if (window === "7d") {
    return "date(created_at, 'localtime') BETWEEN date('now', 'localtime', '-6 days') AND date('now', 'localtime')"
  }
  return "datetime(created_at) >= datetime('now', '-24 hours')"
}

function buildAuthFlowQuery(window: MapWindow) {
  return `SELECT node_id, user_id, username, ip,
                 COUNT(*) AS auth_count,
                 MIN(created_at) AS first_auth_at,
                 MAX(created_at) AS last_auth_at
          FROM auth_logs
          WHERE success = 1
            AND reason = 'OK'
            AND node_id IS NOT NULL
            AND username IS NOT NULL
            AND TRIM(username) <> ''
            AND ip IS NOT NULL
            AND TRIM(ip) <> ''
            AND ${getAuthWindowWhere(window)}
          GROUP BY node_id, user_id, username, ip
          ORDER BY auth_count DESC
          LIMIT ?`
}

function buildUserTrafficQuery(window: MapWindow) {
  return `SELECT node_id, user_id, username,
                 COALESCE(SUM(delta_tx_bytes), 0) AS tx_bytes,
                 COALESCE(SUM(delta_rx_bytes), 0) AS rx_bytes
          FROM agent_traffic_user_logs
          WHERE success = 1
            AND reason = 'OK'
            AND node_id IS NOT NULL
            AND username IS NOT NULL
            AND TRIM(username) <> ''
            AND ${getAuthWindowWhere(window)}
          GROUP BY node_id, user_id, username`
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

function makeNodeUserKey(
  nodeId: number,
  userId: number | null,
  username: string
) {
  return `${nodeId}:${userId ?? "name"}:${username}`
}

function makeUserKey(userId: number | null, username: string) {
  return userId !== null ? `id:${userId}` : `name:${username}`
}

function normalizeUsername(value: unknown) {
  return normalizeText(value, 64) ?? "未知账号"
}

function normalizeDateText(value: unknown) {
  return normalizeText(value, 32)
}

function minDateText(current: string | null, next: string | null) {
  if (!next) return current
  if (!current) return next
  return next < current ? next : current
}

function maxDateText(current: string | null, next: string | null) {
  if (!next) return current
  if (!current) return next
  return next > current ? next : current
}

function extractClientIpFromAuthAddr(addr: unknown) {
  const value = normalizeText(addr, 128)
  if (!value) return null

  const direct = normalizePublicIp(value)
  if (typeof direct === "string") return direct

  const bracketed = value.match(/^\[([^\]]+)](?::\d+)?$/)
  if (bracketed) {
    const normalized = normalizePublicIp(bracketed[1])
    return typeof normalized === "string" ? normalized : null
  }

  if (value.includes(".")) {
    const colonIndex = value.lastIndexOf(":")
    if (colonIndex > 0) {
      const normalized = normalizePublicIp(value.slice(0, colonIndex))
      if (typeof normalized === "string") return normalized
    }
  }

  return null
}

function resolveSourceCountryFromGeo(
  geo: IpGeoCacheRow | null | undefined
): SourceCountryGeo | null {
  const countryCode = normalizeCountryCode(geo?.country_code)
  if (!countryCode) return null
  const centroid = getCountryCentroid(countryCode)
  if (!centroid) return null

  return {
    countryCode,
    countryName: getCountryName(
      countryCode,
      normalizeText(geo?.country_name, 64)
    ),
    latitude: centroid.latitude,
    longitude: centroid.longitude,
  }
}

async function resolveSourceCountries(
  db: ReturnType<typeof getDb>,
  ipAuthCounts: Map<string, number>
) {
  const resolved = new Map<string, SourceCountryGeo | null>()
  const unresolvedIps: Array<{ ip: string; authCount: number }> = []

  for (const [ip, authCount] of ipAuthCounts.entries()) {
    const source = resolveSourceCountryFromGeo(getCachedIpGeo(db, ip))
    if (source) {
      resolved.set(ip, source)
    } else {
      unresolvedIps.push({ ip, authCount })
    }
  }

  unresolvedIps.sort((a, b) => b.authCount - a.authCount)
  const onlineTargets = unresolvedIps.slice(0, FLOW_ONLINE_GEOIP_LIMIT)

  await Promise.all(
    onlineTargets.map(async ({ ip }) => {
      const source = resolveSourceCountryFromGeo(
        await ensureIpGeoCached(db, ip)
      )
      resolved.set(ip, source)
    })
  )

  for (const { ip } of unresolvedIps) {
    if (!resolved.has(ip)) resolved.set(ip, null)
  }

  return resolved
}

function buildUserTrafficMap(
  logsDb: ReturnType<typeof getLogsDb>,
  window: MapWindow
) {
  const rows = logsDb
    .prepare(buildUserTrafficQuery(window))
    .all() as UserTrafficRow[]
  const trafficByNodeUser = new Map<string, UserTrafficAccumulator>()

  for (const row of rows) {
    const nodeId = numberOrZero(row.node_id)
    const username = normalizeUsername(row.username)
    if (nodeId <= 0 || !username) continue
    const userId = typeof row.user_id === "number" ? row.user_id : null
    trafficByNodeUser.set(makeNodeUserKey(nodeId, userId, username), {
      txBytes: numberOrZero(row.tx_bytes),
      rxBytes: numberOrZero(row.rx_bytes),
    })
  }

  return trafficByNodeUser
}

async function buildTrafficFlows({
  window,
  geoipEnabled,
  db,
  nodeTargets,
}: {
  window: MapWindow
  geoipEnabled: boolean
  db: ReturnType<typeof getDb>
  nodeTargets: Map<number, NodeFlowTarget>
}) {
  if (!geoipEnabled || nodeTargets.size === 0) {
    return {
      flows: [],
      flowTotalEstimatedBytes: 0,
      flowLocatedAuthCount: 0,
      flowUnknownAuthCount: 0,
    }
  }

  const logsDb = getLogsDb()
  const authRows = logsDb
    .prepare(buildAuthFlowQuery(window))
    .all(AUTH_FLOW_GROUP_LIMIT) as AuthFlowRow[]
  const trafficByNodeUser = buildUserTrafficMap(logsDb, window)

  const nodeAuthTotals = new Map<number, number>()
  const nodeUserAuthTotals = new Map<string, number>()
  const parsedRows: Array<{
    nodeId: number
    userId: number | null
    username: string
    ip: string | null
    authCount: number
    firstAuthAt: string | null
    lastAuthAt: string | null
  }> = []
  const ipAuthCounts = new Map<string, number>()

  for (const row of authRows) {
    const nodeId = numberOrZero(row.node_id)
    const target = nodeTargets.get(nodeId)
    const authCount = numberOrZero(row.auth_count)
    const username = normalizeUsername(row.username)
    if (!target || authCount <= 0 || !username) continue

    nodeAuthTotals.set(nodeId, (nodeAuthTotals.get(nodeId) ?? 0) + authCount)
    const userId = typeof row.user_id === "number" ? row.user_id : null
    const nodeUserKey = makeNodeUserKey(nodeId, userId, username)
    nodeUserAuthTotals.set(
      nodeUserKey,
      (nodeUserAuthTotals.get(nodeUserKey) ?? 0) + authCount
    )
    const ip = extractClientIpFromAuthAddr(row.ip)
    parsedRows.push({
      nodeId,
      userId,
      username,
      ip,
      authCount,
      firstAuthAt: normalizeDateText(row.first_auth_at),
      lastAuthAt: normalizeDateText(row.last_auth_at),
    })
    if (ip) ipAuthCounts.set(ip, (ipAuthCounts.get(ip) ?? 0) + authCount)
  }

  const sourceByIp = await resolveSourceCountries(db, ipAuthCounts)
  const sourceRows: SourceAuthRow[] = []
  let flowLocatedAuthCount = 0
  let flowUnknownAuthCount = 0

  for (const row of parsedRows) {
    const source = row.ip ? sourceByIp.get(row.ip) : null
    if (!source) {
      flowUnknownAuthCount += row.authCount
      continue
    }

    flowLocatedAuthCount += row.authCount
    sourceRows.push({
      nodeId: row.nodeId,
      userId: row.userId,
      username: row.username,
      ip: row.ip,
      authCount: row.authCount,
      firstAuthAt: row.firstAuthAt,
      lastAuthAt: row.lastAuthAt,
      source,
    })
  }

  const flowAccumulators = new Map<string, FlowAccumulator>()

  for (const row of sourceRows) {
    const target = nodeTargets.get(row.nodeId)
    if (!target) continue
    const nodeAuthTotal = nodeAuthTotals.get(row.nodeId) ?? row.authCount
    if (nodeAuthTotal <= 0) continue

    const estimatedTxBytes = Math.floor(
      (target.txBytes * row.authCount) / nodeAuthTotal
    )
    const estimatedRxBytes = Math.floor(
      (target.rxBytes * row.authCount) / nodeAuthTotal
    )
    const estimatedBytes = estimatedTxBytes + estimatedRxBytes
    const key = `${row.source.countryCode}->${target.countryCode}`
    let flow = flowAccumulators.get(key)

    if (!flow) {
      flow = {
        key,
        sourceCountryCode: row.source.countryCode,
        sourceCountryName: row.source.countryName,
        sourceLatitude: row.source.latitude,
        sourceLongitude: row.source.longitude,
        targetCountryCode: target.countryCode,
        targetCountryName: target.countryName,
        targetLatitude: target.latitude,
        targetLongitude: target.longitude,
        authCount: 0,
        estimatedTxBytes: 0,
        estimatedRxBytes: 0,
        nodes: new Map(),
        accounts: new Map(),
        connections: new Map(),
      }
      flowAccumulators.set(key, flow)
    }

    flow.authCount += row.authCount
    flow.estimatedTxBytes += estimatedTxBytes
    flow.estimatedRxBytes += estimatedRxBytes

    const existingNode = flow.nodes.get(target.nodeId)
    if (existingNode) {
      existingNode.authCount += row.authCount
      existingNode.estimatedTxBytes += estimatedTxBytes
      existingNode.estimatedRxBytes += estimatedRxBytes
      existingNode.estimatedBytes += estimatedBytes
    } else {
      flow.nodes.set(target.nodeId, {
        nodeId: target.nodeId,
        nodeName: target.nodeName,
        authCount: row.authCount,
        estimatedTxBytes,
        estimatedRxBytes,
        estimatedBytes,
      })
    }

    const nodeUserKey = makeNodeUserKey(target.nodeId, row.userId, row.username)
    const userTraffic = trafficByNodeUser.get(nodeUserKey)
    const nodeUserAuthTotal =
      nodeUserAuthTotals.get(nodeUserKey) ?? row.authCount
    const accountTxBytes = userTraffic
      ? Math.floor((userTraffic.txBytes * row.authCount) / nodeUserAuthTotal)
      : estimatedTxBytes
    const accountRxBytes = userTraffic
      ? Math.floor((userTraffic.rxBytes * row.authCount) / nodeUserAuthTotal)
      : estimatedRxBytes
    const accountBytes = accountTxBytes + accountRxBytes
    const accountKey = makeUserKey(row.userId, row.username)
    const existingAccount = flow.accounts.get(accountKey)
    if (existingAccount) {
      existingAccount.authCount += row.authCount
      existingAccount.estimatedTxBytes += accountTxBytes
      existingAccount.estimatedRxBytes += accountRxBytes
      existingAccount.estimatedBytes += accountBytes
    } else {
      flow.accounts.set(accountKey, {
        userId: row.userId,
        username: row.username,
        authCount: row.authCount,
        estimatedTxBytes: accountTxBytes,
        estimatedRxBytes: accountRxBytes,
        estimatedBytes: accountBytes,
      })
    }

    const connectionKey = `${target.nodeId}:${accountKey}`
    const accountNodeTxBytes = userTraffic?.txBytes ?? null
    const accountNodeRxBytes = userTraffic?.rxBytes ?? null
    const accountNodeBytes = userTraffic
      ? userTraffic.txBytes + userTraffic.rxBytes
      : null
    const existingConnection = flow.connections.get(connectionKey)
    if (existingConnection) {
      existingConnection.authCount += row.authCount
      existingConnection.estimatedTxBytes += accountTxBytes
      existingConnection.estimatedRxBytes += accountRxBytes
      existingConnection.estimatedBytes += accountBytes
      if (row.ip) {
        existingConnection.sourceIps.set(
          row.ip,
          (existingConnection.sourceIps.get(row.ip) ?? 0) + row.authCount
        )
      }
      existingConnection.firstAuthAt = minDateText(
        existingConnection.firstAuthAt,
        row.firstAuthAt
      )
      existingConnection.lastAuthAt = maxDateText(
        existingConnection.lastAuthAt,
        row.lastAuthAt
      )
      if (
        existingConnection.trafficBasis !== "account_traffic" &&
        userTraffic
      ) {
        existingConnection.trafficBasis = "account_traffic"
        existingConnection.accountNodeTxBytes = accountNodeTxBytes
        existingConnection.accountNodeRxBytes = accountNodeRxBytes
        existingConnection.accountNodeBytes = accountNodeBytes
      }
    } else {
      flow.connections.set(connectionKey, {
        key: connectionKey,
        nodeId: target.nodeId,
        nodeName: target.nodeName,
        userId: row.userId,
        username: row.username,
        authCount: row.authCount,
        nodeAuthCount: nodeAuthTotal,
        accountNodeAuthCount: nodeUserAuthTotal,
        sourceIps: row.ip ? new Map([[row.ip, row.authCount]]) : new Map(),
        firstAuthAt: row.firstAuthAt,
        lastAuthAt: row.lastAuthAt,
        estimatedTxBytes: accountTxBytes,
        estimatedRxBytes: accountRxBytes,
        estimatedBytes: accountBytes,
        accountNodeTxBytes,
        accountNodeRxBytes,
        accountNodeBytes,
        nodeTxBytes: target.txBytes,
        nodeRxBytes: target.rxBytes,
        nodeBytes: target.totalBytes,
        trafficBasis: userTraffic ? "account_traffic" : "node_auth_share",
      })
    }
  }

  const allFlows = Array.from(flowAccumulators.values())
    .map((flow) => {
      const estimatedBytes = flow.estimatedTxBytes + flow.estimatedRxBytes
      const topNodes = Array.from(flow.nodes.values())
        .sort((a, b) => {
          if (b.estimatedBytes !== a.estimatedBytes) {
            return b.estimatedBytes - a.estimatedBytes
          }
          return b.authCount - a.authCount
        })
        .slice(0, FLOW_TOP_NODE_LIMIT)
      const topAccounts = Array.from(flow.accounts.values())
        .sort((a, b) => {
          if (b.estimatedBytes !== a.estimatedBytes) {
            return b.estimatedBytes - a.estimatedBytes
          }
          return b.authCount - a.authCount
        })
        .slice(0, FLOW_TOP_ACCOUNT_LIMIT)
      const topConnections = Array.from(flow.connections.values())
        .sort((a, b) => {
          if (b.estimatedBytes !== a.estimatedBytes) {
            return b.estimatedBytes - a.estimatedBytes
          }
          return b.authCount - a.authCount
        })
        .slice(0, FLOW_TOP_CONNECTION_LIMIT)
        .map((connection) => ({
          key: connection.key,
          sourceCountryCode: flow.sourceCountryCode,
          sourceCountryName: flow.sourceCountryName,
          targetCountryCode: flow.targetCountryCode,
          targetCountryName: flow.targetCountryName,
          nodeId: connection.nodeId,
          nodeName: connection.nodeName,
          userId: connection.userId,
          username: connection.username,
          authCount: connection.authCount,
          nodeAuthCount: connection.nodeAuthCount,
          accountNodeAuthCount: connection.accountNodeAuthCount,
          sourceIpCount: connection.sourceIps.size,
          sourceAddresses: Array.from(connection.sourceIps.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([ip, authCount]) => ({ ip, authCount })),
          firstAuthAt: connection.firstAuthAt,
          lastAuthAt: connection.lastAuthAt,
          estimatedTxBytes: connection.estimatedTxBytes,
          estimatedRxBytes: connection.estimatedRxBytes,
          estimatedBytes: connection.estimatedBytes,
          accountNodeTxBytes: connection.accountNodeTxBytes,
          accountNodeRxBytes: connection.accountNodeRxBytes,
          accountNodeBytes: connection.accountNodeBytes,
          nodeTxBytes: connection.nodeTxBytes,
          nodeRxBytes: connection.nodeRxBytes,
          nodeBytes: connection.nodeBytes,
          trafficBasis: connection.trafficBasis,
        }))

      return {
        key: flow.key,
        sourceCountryCode: flow.sourceCountryCode,
        sourceCountryName: flow.sourceCountryName,
        sourceLatitude: flow.sourceLatitude,
        sourceLongitude: flow.sourceLongitude,
        targetCountryCode: flow.targetCountryCode,
        targetCountryName: flow.targetCountryName,
        targetLatitude: flow.targetLatitude,
        targetLongitude: flow.targetLongitude,
        authCount: flow.authCount,
        estimatedTxBytes: flow.estimatedTxBytes,
        estimatedRxBytes: flow.estimatedRxBytes,
        estimatedBytes,
        nodeCount: flow.nodes.size,
        accountCount: flow.accounts.size,
        topNodes,
        topAccounts,
        topConnections,
      }
    })
    .filter((flow) => flow.authCount > 0 && flow.estimatedBytes > 0)
    .sort((a, b) => {
      if (b.estimatedBytes !== a.estimatedBytes) {
        return b.estimatedBytes - a.estimatedBytes
      }
      return b.authCount - a.authCount
    })
  const flows = allFlows.slice(0, FLOW_LIMIT)

  return {
    flows,
    flowTotalEstimatedBytes: allFlows.reduce(
      (total, flow) => total + flow.estimatedBytes,
      0
    ),
    flowLocatedAuthCount,
    flowUnknownAuthCount,
  }
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
  const nodeTargets = new Map<number, NodeFlowTarget>()
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

    const countryCode = normalizeCountryCode(geo.countryCode)
    if (countryCode) {
      nodeTargets.set(row.id, {
        nodeId: row.id,
        nodeName: row.name,
        countryCode,
        countryName: getCountryName(countryCode, geo.countryName),
        latitude: geo.latitude,
        longitude: geo.longitude,
        txBytes,
        rxBytes,
        totalBytes,
      })
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

  const flowData = await buildTrafficFlows({
    window,
    geoipEnabled,
    db,
    nodeTargets,
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
      ...flowData,
    },
  })
}
