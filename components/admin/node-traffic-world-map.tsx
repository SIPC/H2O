"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react"

import { Minus, Plus, RotateCcw } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Card, CardContent } from "@/components/ui/card"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { WORLD_COUNTRY_PATHS } from "@/lib/world-country-paths"
import { cn, formatBytes } from "@/lib/utils"

export type NodeTrafficMapNode = {
  nodeId: number
  nodeName: string
  status: "enabled" | "disabled"
  txBytes: number
  rxBytes: number
  totalBytes: number
  geoSource?: "manual" | "geoip"
  coordinateSource?: "exact" | "country_centroid"
}

export type NodeTrafficMapCountry = {
  key: string
  countryCode: string | null
  countryName: string
  latitude: number
  longitude: number
  nodeCount: number
  manualNodeCount: number
  centroidNodeCount: number
  txBytes: number
  rxBytes: number
  totalBytes: number
  topNodes: NodeTrafficMapNode[]
  nodes: NodeTrafficMapNode[]
}

export type NodeTrafficMapFlowNode = {
  nodeId: number
  nodeName: string
  authCount: number
  estimatedTxBytes: number
  estimatedRxBytes: number
  estimatedBytes: number
}

export type NodeTrafficMapFlowAccount = {
  userId: number | null
  username: string
  authCount: number
  estimatedTxBytes: number
  estimatedRxBytes: number
  estimatedBytes: number
}

export type NodeTrafficMapFlowSourceAddress = {
  ip: string
  authCount: number
}

export type NodeTrafficMapFlowConnection = {
  key: string
  sourceCountryCode: string
  sourceCountryName: string
  targetCountryCode: string
  targetCountryName: string
  nodeId: number
  nodeName: string
  userId: number | null
  username: string
  authCount: number
  nodeAuthCount: number
  accountNodeAuthCount: number
  sourceIpCount: number
  sourceAddresses: NodeTrafficMapFlowSourceAddress[]
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

export type NodeTrafficMapFlow = {
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
  estimatedBytes: number
  nodeCount: number
  accountCount: number
  topNodes: NodeTrafficMapFlowNode[]
  topAccounts: NodeTrafficMapFlowAccount[]
  topConnections: NodeTrafficMapFlowConnection[]
}

export type NodeTrafficMapData = {
  window: "rolling24h" | "today" | "7d"
  windowLabel: string
  windowHours: number | null
  geoipEnabled: boolean
  totalTxBytes: number
  totalRxBytes: number
  totalBytes: number
  locatedTxBytes: number
  locatedRxBytes: number
  locatedBytes: number
  unknownTxBytes: number
  unknownRxBytes: number
  unknownBytes: number
  nodeCount: number
  locatedNodeCount: number
  unknownNodeCount: number
  flowTotalEstimatedBytes: number
  flowLocatedAuthCount: number
  flowUnknownAuthCount: number
  countries: NodeTrafficMapCountry[]
  unknownNodes: NodeTrafficMapNode[]
  flows: NodeTrafficMapFlow[]
}

export const EMPTY_NODE_TRAFFIC_MAP: NodeTrafficMapData = {
  window: "rolling24h",
  windowLabel: "",
  windowHours: 24,
  geoipEnabled: true,
  totalTxBytes: 0,
  totalRxBytes: 0,
  totalBytes: 0,
  locatedTxBytes: 0,
  locatedRxBytes: 0,
  locatedBytes: 0,
  unknownTxBytes: 0,
  unknownRxBytes: 0,
  unknownBytes: 0,
  nodeCount: 0,
  locatedNodeCount: 0,
  unknownNodeCount: 0,
  flowTotalEstimatedBytes: 0,
  flowLocatedAuthCount: 0,
  flowUnknownAuthCount: 0,
  countries: [],
  unknownNodes: [],
  flows: [],
}

const MAP_WIDTH = 1000
const MAP_HEIGHT = 520
const TRAFFIC_COUNTRY_LIMIT = 6
const MICRO_COUNTRY_SIZE = 5

type CanvasViewBox = {
  x: number
  y: number
  width: number
  height: number
}

const DEFAULT_CANVAS_VIEWBOX: CanvasViewBox = {
  x: 0,
  y: 0,
  width: MAP_WIDTH,
  height: MAP_HEIGHT,
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0
}

function normalizeNullableCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null
}

function normalizeMapWindow(value: unknown): NodeTrafficMapData["window"] {
  return value === "today" || value === "7d" || value === "rolling24h"
    ? value
    : "rolling24h"
}

function normalizeMapStatus(value: unknown): "enabled" | "disabled" {
  return value === "disabled" ? "disabled" : "enabled"
}

function normalizeMapGeoSource(value: unknown): "manual" | "geoip" | undefined {
  return value === "manual" || value === "geoip" ? value : undefined
}

function normalizeMapCoordinateSource(
  value: unknown
): "exact" | "country_centroid" | undefined {
  return value === "exact" || value === "country_centroid" ? value : undefined
}

function normalizeNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function normalizeMapNode(input: unknown): NodeTrafficMapNode | null {
  if (!input || typeof input !== "object") return null
  const row = input as Partial<NodeTrafficMapNode>
  const nodeId = normalizeCount(row.nodeId)
  const nodeName = typeof row.nodeName === "string" ? row.nodeName.trim() : ""
  if (nodeId <= 0 || !nodeName) return null

  const txBytes = normalizeCount(row.txBytes)
  const rxBytes = normalizeCount(row.rxBytes)

  return {
    nodeId,
    nodeName,
    status: normalizeMapStatus(row.status),
    txBytes,
    rxBytes,
    totalBytes: normalizeCount(row.totalBytes) || txBytes + rxBytes,
    geoSource: normalizeMapGeoSource(row.geoSource),
    coordinateSource: normalizeMapCoordinateSource(row.coordinateSource),
  }
}

function normalizeMapCountry(input: unknown): NodeTrafficMapCountry | null {
  if (!input || typeof input !== "object") return null
  const row = input as Partial<NodeTrafficMapCountry>
  const key = typeof row.key === "string" && row.key.trim() ? row.key : ""
  const countryName =
    typeof row.countryName === "string" && row.countryName.trim()
      ? row.countryName
      : ""
  const latitude = normalizeNumber(row.latitude)
  const longitude = normalizeNumber(row.longitude)
  if (
    !key ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null
  }

  const txBytes = normalizeCount(row.txBytes)
  const rxBytes = normalizeCount(row.rxBytes)
  const topNodes = Array.isArray(row.topNodes)
    ? row.topNodes.map(normalizeMapNode).filter((item) => item !== null)
    : []
  const nodes = Array.isArray(row.nodes)
    ? row.nodes.map(normalizeMapNode).filter((item) => item !== null)
    : topNodes

  return {
    key,
    countryCode: normalizeNullableString(row.countryCode),
    countryName,
    latitude,
    longitude,
    nodeCount: normalizeCount(row.nodeCount),
    manualNodeCount: normalizeCount(row.manualNodeCount),
    centroidNodeCount: normalizeCount(row.centroidNodeCount),
    txBytes,
    rxBytes,
    totalBytes: normalizeCount(row.totalBytes) || txBytes + rxBytes,
    topNodes,
    nodes,
  }
}

function normalizeMapFlowNode(input: unknown): NodeTrafficMapFlowNode | null {
  if (!input || typeof input !== "object") return null
  const row = input as Partial<NodeTrafficMapFlowNode>
  const nodeId = normalizeCount(row.nodeId)
  const nodeName = typeof row.nodeName === "string" ? row.nodeName.trim() : ""
  if (nodeId <= 0 || !nodeName) return null

  const estimatedTxBytes = normalizeCount(row.estimatedTxBytes)
  const estimatedRxBytes = normalizeCount(row.estimatedRxBytes)

  return {
    nodeId,
    nodeName,
    authCount: normalizeCount(row.authCount),
    estimatedTxBytes,
    estimatedRxBytes,
    estimatedBytes:
      normalizeCount(row.estimatedBytes) || estimatedTxBytes + estimatedRxBytes,
  }
}

function normalizeMapFlowAccount(
  input: unknown
): NodeTrafficMapFlowAccount | null {
  if (!input || typeof input !== "object") return null
  const row = input as Partial<NodeTrafficMapFlowAccount>
  const username = typeof row.username === "string" ? row.username.trim() : ""
  if (!username) return null

  const estimatedTxBytes = normalizeCount(row.estimatedTxBytes)
  const estimatedRxBytes = normalizeCount(row.estimatedRxBytes)

  return {
    userId:
      typeof row.userId === "number" && Number.isFinite(row.userId)
        ? Math.max(0, Math.floor(row.userId))
        : null,
    username,
    authCount: normalizeCount(row.authCount),
    estimatedTxBytes,
    estimatedRxBytes,
    estimatedBytes:
      normalizeCount(row.estimatedBytes) || estimatedTxBytes + estimatedRxBytes,
  }
}

function normalizeMapFlowSourceAddress(
  input: unknown
): NodeTrafficMapFlowSourceAddress | null {
  if (!input || typeof input !== "object") return null
  const row = input as Partial<NodeTrafficMapFlowSourceAddress>
  const ip = typeof row.ip === "string" ? row.ip.trim() : ""
  if (!ip) return null
  return {
    ip,
    authCount: normalizeCount(row.authCount),
  }
}

function normalizeMapFlowConnection(
  input: unknown
): NodeTrafficMapFlowConnection | null {
  if (!input || typeof input !== "object") return null
  const row = input as Partial<NodeTrafficMapFlowConnection>
  const key = typeof row.key === "string" && row.key.trim() ? row.key : ""
  const nodeId = normalizeCount(row.nodeId)
  const nodeName = typeof row.nodeName === "string" ? row.nodeName.trim() : ""
  const username = typeof row.username === "string" ? row.username.trim() : ""
  const sourceCountryCode = safeCountryCode(row.sourceCountryCode ?? null) ?? ""
  const targetCountryCode = safeCountryCode(row.targetCountryCode ?? null) ?? ""
  if (!key || nodeId <= 0 || !nodeName || !username) return null

  const estimatedTxBytes = normalizeCount(row.estimatedTxBytes)
  const estimatedRxBytes = normalizeCount(row.estimatedRxBytes)
  const nodeTxBytes = normalizeCount(row.nodeTxBytes)
  const nodeRxBytes = normalizeCount(row.nodeRxBytes)
  const accountNodeTxBytes = normalizeNullableCount(row.accountNodeTxBytes)
  const accountNodeRxBytes = normalizeNullableCount(row.accountNodeRxBytes)
  const sourceAddresses = Array.isArray(row.sourceAddresses)
    ? row.sourceAddresses
        .map(normalizeMapFlowSourceAddress)
        .filter((item) => item !== null)
    : []

  return {
    key,
    sourceCountryCode,
    sourceCountryName:
      typeof row.sourceCountryName === "string" && row.sourceCountryName.trim()
        ? row.sourceCountryName
        : sourceCountryCode,
    targetCountryCode,
    targetCountryName:
      typeof row.targetCountryName === "string" && row.targetCountryName.trim()
        ? row.targetCountryName
        : targetCountryCode,
    nodeId,
    nodeName,
    userId:
      typeof row.userId === "number" && Number.isFinite(row.userId)
        ? Math.max(0, Math.floor(row.userId))
        : null,
    username,
    authCount: normalizeCount(row.authCount),
    nodeAuthCount: normalizeCount(row.nodeAuthCount),
    accountNodeAuthCount: normalizeCount(row.accountNodeAuthCount),
    sourceIpCount: normalizeCount(row.sourceIpCount),
    sourceAddresses,
    firstAuthAt: normalizeNullableString(row.firstAuthAt),
    lastAuthAt: normalizeNullableString(row.lastAuthAt),
    estimatedTxBytes,
    estimatedRxBytes,
    estimatedBytes:
      normalizeCount(row.estimatedBytes) || estimatedTxBytes + estimatedRxBytes,
    accountNodeTxBytes,
    accountNodeRxBytes,
    accountNodeBytes:
      normalizeNullableCount(row.accountNodeBytes) ??
      (accountNodeTxBytes !== null && accountNodeRxBytes !== null
        ? accountNodeTxBytes + accountNodeRxBytes
        : null),
    nodeTxBytes,
    nodeRxBytes,
    nodeBytes: normalizeCount(row.nodeBytes) || nodeTxBytes + nodeRxBytes,
    trafficBasis:
      row.trafficBasis === "account_traffic"
        ? "account_traffic"
        : "node_auth_share",
  }
}

function normalizeMapFlow(input: unknown): NodeTrafficMapFlow | null {
  if (!input || typeof input !== "object") return null
  const row = input as Partial<NodeTrafficMapFlow>
  const key = typeof row.key === "string" && row.key.trim() ? row.key : ""
  const sourceCountryCode = safeCountryCode(row.sourceCountryCode ?? null) ?? ""
  const targetCountryCode = safeCountryCode(row.targetCountryCode ?? null) ?? ""
  const sourceCountryName =
    typeof row.sourceCountryName === "string" && row.sourceCountryName.trim()
      ? row.sourceCountryName
      : sourceCountryCode
  const targetCountryName =
    typeof row.targetCountryName === "string" && row.targetCountryName.trim()
      ? row.targetCountryName
      : targetCountryCode
  const sourceLatitude = normalizeNumber(row.sourceLatitude)
  const sourceLongitude = normalizeNumber(row.sourceLongitude)
  const targetLatitude = normalizeNumber(row.targetLatitude)
  const targetLongitude = normalizeNumber(row.targetLongitude)
  if (
    !key ||
    !sourceCountryCode ||
    !targetCountryCode ||
    sourceLatitude < -90 ||
    sourceLatitude > 90 ||
    targetLatitude < -90 ||
    targetLatitude > 90 ||
    sourceLongitude < -180 ||
    sourceLongitude > 180 ||
    targetLongitude < -180 ||
    targetLongitude > 180
  ) {
    return null
  }

  const estimatedTxBytes = normalizeCount(row.estimatedTxBytes)
  const estimatedRxBytes = normalizeCount(row.estimatedRxBytes)
  const topNodes = Array.isArray(row.topNodes)
    ? row.topNodes.map(normalizeMapFlowNode).filter((item) => item !== null)
    : []
  const topAccounts = Array.isArray(row.topAccounts)
    ? row.topAccounts
        .map(normalizeMapFlowAccount)
        .filter((item) => item !== null)
    : []
  const topConnections = Array.isArray(row.topConnections)
    ? row.topConnections
        .map(normalizeMapFlowConnection)
        .filter((item) => item !== null)
    : []

  return {
    key,
    sourceCountryCode,
    sourceCountryName,
    sourceLatitude,
    sourceLongitude,
    targetCountryCode,
    targetCountryName,
    targetLatitude,
    targetLongitude,
    authCount: normalizeCount(row.authCount),
    estimatedTxBytes,
    estimatedRxBytes,
    estimatedBytes:
      normalizeCount(row.estimatedBytes) || estimatedTxBytes + estimatedRxBytes,
    nodeCount: normalizeCount(row.nodeCount),
    accountCount: normalizeCount(row.accountCount),
    topNodes,
    topAccounts,
    topConnections,
  }
}

export function normalizeNodeTrafficMapData(
  input: unknown
): NodeTrafficMapData {
  if (!input || typeof input !== "object") return EMPTY_NODE_TRAFFIC_MAP
  const row = input as Partial<NodeTrafficMapData>
  const countries = Array.isArray(row.countries)
    ? row.countries.map(normalizeMapCountry).filter((item) => item !== null)
    : []
  const unknownNodes = Array.isArray(row.unknownNodes)
    ? row.unknownNodes.map(normalizeMapNode).filter((item) => item !== null)
    : []
  const flows = Array.isArray(row.flows)
    ? row.flows.map(normalizeMapFlow).filter((item) => item !== null)
    : []
  const totalTxBytes = normalizeCount(row.totalTxBytes)
  const totalRxBytes = normalizeCount(row.totalRxBytes)
  const locatedTxBytes = normalizeCount(row.locatedTxBytes)
  const locatedRxBytes = normalizeCount(row.locatedRxBytes)
  const totalBytes =
    normalizeCount(row.totalBytes) || totalTxBytes + totalRxBytes
  const locatedBytes =
    normalizeCount(row.locatedBytes) || locatedTxBytes + locatedRxBytes

  return {
    window: normalizeMapWindow(row.window),
    windowLabel:
      typeof row.windowLabel === "string" && row.windowLabel.trim()
        ? row.windowLabel
        : "",
    windowHours:
      typeof row.windowHours === "number" && Number.isFinite(row.windowHours)
        ? Math.max(0, Math.floor(row.windowHours))
        : null,
    geoipEnabled: row.geoipEnabled !== false,
    totalTxBytes,
    totalRxBytes,
    totalBytes,
    locatedTxBytes,
    locatedRxBytes,
    locatedBytes,
    unknownTxBytes: normalizeCount(row.unknownTxBytes),
    unknownRxBytes: normalizeCount(row.unknownRxBytes),
    unknownBytes: normalizeCount(row.unknownBytes),
    nodeCount: normalizeCount(row.nodeCount),
    locatedNodeCount: normalizeCount(row.locatedNodeCount),
    unknownNodeCount: normalizeCount(row.unknownNodeCount),
    flowTotalEstimatedBytes: normalizeCount(row.flowTotalEstimatedBytes),
    flowLocatedAuthCount: normalizeCount(row.flowLocatedAuthCount),
    flowUnknownAuthCount: normalizeCount(row.flowUnknownAuthCount),
    countries,
    unknownNodes,
    flows,
  }
}

function safeCountryCode(code: string | null) {
  const normalized = code?.trim().toUpperCase()
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : null
}

function getCountryFlagUrl(countryCode: string | null) {
  const code = safeCountryCode(countryCode)?.toLowerCase()
  return code ? `https://flagcdn.com/w40/${code}.png` : null
}

function CountryFlagImage({
  countryCode,
  countryName,
}: {
  countryCode: string | null
  countryName?: string | null
}) {
  const flagUrl = getCountryFlagUrl(countryCode)
  if (!flagUrl) {
    return (
      <span className="inline-flex h-3.5 min-w-5 items-center justify-center rounded-xs bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
        --
      </span>
    )
  }

  return (
    <span
      aria-label={countryName ?? countryCode ?? undefined}
      title={countryName ?? countryCode ?? undefined}
      className="inline-block h-3.5 w-5 shrink-0 rounded-xs bg-cover bg-center shadow-sm"
      style={{ backgroundImage: `url(${flagUrl})` }}
    />
  )
}

function CountryFlagBadge({
  countryCode,
  countryName,
}: {
  countryCode: string | null
  countryName?: string | null
}) {
  return (
    <Badge className="gap-1.5 bg-muted text-foreground">
      <CountryFlagImage countryCode={countryCode} countryName={countryName} />
      <span className="font-mono">{safeCountryCode(countryCode) ?? "--"}</span>
    </Badge>
  )
}

function FlowFlagBadge({ flow }: { flow: NodeTrafficMapFlow | null }) {
  const { t } = useI18n()
  return (
    <Badge className="gap-1.5 bg-muted text-foreground">
      <CountryFlagImage
        countryCode={flow?.sourceCountryCode ?? null}
        countryName={getCountryDisplayName(
          flow?.sourceCountryCode,
          flow?.sourceCountryName,
          t
        )}
      />
      <span className="text-muted-foreground">→</span>
      <CountryFlagImage
        countryCode={flow?.targetCountryCode ?? null}
        countryName={getCountryDisplayName(
          flow?.targetCountryCode,
          flow?.targetCountryName,
          t
        )}
      />
    </Badge>
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function projectPoint(longitude: number, latitude: number) {
  return {
    x: clamp(((longitude + 180) / 360) * MAP_WIDTH, 0, MAP_WIDTH),
    y: clamp(((90 - latitude) / 180) * MAP_HEIGHT, 0, MAP_HEIGHT),
  }
}

function getMicroCountryPath(country: NodeTrafficMapCountry) {
  const { x, y } = projectPoint(country.longitude, country.latitude)
  const size = MICRO_COUNTRY_SIZE
  return `M${x} ${y - size} L${x + size} ${y} L${x} ${y + size} L${x - size} ${y} Z`
}

function getPercent(value: number, total: number) {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, (value / total) * 100))
}

function getHeatOpacity(totalBytes: number, maxBytes: number) {
  if (maxBytes <= 0 || totalBytes <= 0) return 0.08
  return 0.18 + Math.pow(totalBytes / maxBytes, 0.62) * 0.62
}

function clampCanvasZoom(value: number) {
  return Math.min(4, Math.max(0.55, Number(value.toFixed(2))))
}

function getCanvasZoom(viewBox: CanvasViewBox) {
  return MAP_WIDTH / viewBox.width
}

function formatCanvasViewBox(viewBox: CanvasViewBox) {
  return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`
}

function getSvgScale(svg: SVGSVGElement, viewBox: CanvasViewBox) {
  const bounds = svg.getBoundingClientRect()
  const scale = Math.min(
    bounds.width / viewBox.width,
    bounds.height / viewBox.height
  )
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

function getSvgPoint(
  svg: SVGSVGElement,
  viewBox: CanvasViewBox,
  clientX: number,
  clientY: number
) {
  const bounds = svg.getBoundingClientRect()
  const scale = getSvgScale(svg, viewBox)
  const renderedWidth = viewBox.width * scale
  const renderedHeight = viewBox.height * scale
  const offsetX = (bounds.width - renderedWidth) / 2
  const offsetY = (bounds.height - renderedHeight) / 2

  return {
    x: viewBox.x + (clientX - bounds.left - offsetX) / scale,
    y: viewBox.y + (clientY - bounds.top - offsetY) / scale,
  }
}

type TFunction = (key: string, params?: Record<string, unknown>) => string

function translateKnownKey(t: TFunction, key: string, fallback: string) {
  const translated = t(key)
  return translated === key ? fallback : translated
}

function getCountryDisplayName(
  countryCode: string | null | undefined,
  fallback: string | null | undefined,
  t: TFunction
) {
  const code = safeCountryCode(countryCode ?? null)
  if (code) {
    return translateKnownKey(
      t,
      `nodes.country.${code}`,
      fallback?.trim() || code
    )
  }

  const raw = fallback?.trim()
  if (!raw || /[\u4e00-\u9fff]/.test(raw)) {
    return t("routing.trafficMap.unknownRegion")
  }
  return raw
}

function getWindowLabel(
  window: NodeTrafficMapData["window"],
  windowLabel: string,
  t: TFunction
) {
  if (window === "today") return t("routing.trafficMap.window.today")
  if (window === "7d") return t("routing.trafficMap.window.7d")
  if (window === "rolling24h") return t("routing.trafficMap.window.rolling24h")
  return windowLabel || t("routing.trafficMap.window.rolling24h")
}

function getNodeSummary(country: NodeTrafficMapCountry, t: TFunction) {
  const nodes = country.topNodes.slice(0, 3)
  if (nodes.length === 0) return t("routing.trafficMap.noNodeDetails")
  return nodes
    .map((node) => `${node.nodeName} ${formatBytes(node.totalBytes)}`)
    .join(" / ")
}

function getNodeGeoLabel(node: NodeTrafficMapNode, t: TFunction) {
  const source =
    node.geoSource === "manual"
      ? t("routing.trafficMap.geoSource.manual")
      : t("routing.trafficMap.geoSource.geoip")
  const coordinate =
    node.coordinateSource === "country_centroid"
      ? t("routing.trafficMap.coordinate.countryCentroid")
      : t("routing.trafficMap.coordinate.exact")
  return `${source} · ${coordinate}`
}

function getTargetCountryCode(target: EventTarget | null) {
  if (!(target instanceof Element)) return null
  const element = target.closest("[data-country-code]")
  return safeCountryCode(element?.getAttribute("data-country-code") ?? null)
}

function ReportMetric({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-lg border bg-background/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

function getFlowTitle(flow: NodeTrafficMapFlow, t: TFunction) {
  return `${getCountryDisplayName(flow.sourceCountryCode, flow.sourceCountryName, t)} → ${getCountryDisplayName(flow.targetCountryCode, flow.targetCountryName, t)}`
}

function formatOptionalBytes(value: number | null, t: TFunction) {
  return value === null
    ? t("routing.trafficMap.notAvailable")
    : formatBytes(value)
}

function formatAuthTime(value: string | null, t: TFunction) {
  if (!value) return t("routing.trafficMap.notAvailable")
  return value.replace("T", " ").slice(0, 19)
}

function getTrafficBasisLabel(
  basis: NodeTrafficMapFlowConnection["trafficBasis"],
  t: TFunction
) {
  return basis === "account_traffic"
    ? t("routing.trafficMap.trafficBasis.account")
    : t("routing.trafficMap.trafficBasis.nodeShare")
}

function SourceAddressBadge({
  connection,
}: {
  connection: NodeTrafficMapFlowConnection
}) {
  const { t } = useI18n()
  const badge = (
    <Badge className="cursor-help bg-muted text-foreground hover:bg-muted">
      {t("routing.trafficMap.sourceAddressCount", {
        count: connection.sourceIpCount,
      })}
    </Badge>
  )

  if (connection.sourceAddresses.length === 0) return badge

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        className="max-h-80 w-fit max-w-72 overflow-auto p-2"
      >
        <div className="grid grid-cols-[minmax(0,max-content)_auto] gap-x-3 gap-y-1.5">
          {connection.sourceAddresses.map((address) => (
            <div key={address.ip} className="contents">
              <span className="min-w-0 font-mono text-xs break-all">
                {address.ip}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t("routing.common.authCount", {
                  count: address.authCount,
                })}
              </span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function FlowConnectionList({ flow }: { flow: NodeTrafficMapFlow }) {
  const { t } = useI18n()

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {t("routing.trafficMap.connectionsTitle")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("routing.trafficMap.connectionsDescription")}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          Top {flow.topConnections.length}
        </span>
      </div>
      <div className="mt-3 divide-y rounded-lg border bg-background/60">
        {flow.topConnections.length > 0 ? (
          flow.topConnections.map((connection) => {
            const accountAuthShare = getPercent(
              connection.authCount,
              connection.accountNodeAuthCount
            )
            const nodeAuthShare = getPercent(
              connection.authCount,
              connection.nodeAuthCount
            )

            return (
              <div key={connection.key} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {connection.username} → {connection.nodeName}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {getCountryDisplayName(
                        connection.sourceCountryCode,
                        connection.sourceCountryName,
                        t
                      )}{" "}
                      · {connection.sourceCountryCode} →{" "}
                      {getCountryDisplayName(
                        connection.targetCountryCode,
                        connection.targetCountryName,
                        t
                      )}{" "}
                      · {connection.targetCountryCode}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums">
                      {formatBytes(connection.estimatedBytes)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("routing.common.estimated")}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                  <SourceAddressBadge connection={connection} />
                  <Badge className="bg-muted text-foreground hover:bg-muted">
                    {t("routing.common.authCount", {
                      count: connection.authCount,
                    })}
                  </Badge>
                  <Badge className="bg-muted text-foreground hover:bg-muted">
                    {t("routing.trafficMap.accountAndNode").split(" + ")[0]} #
                    {connection.userId ?? "-"}
                  </Badge>
                  <Badge className="bg-muted text-foreground hover:bg-muted">
                    {t("routing.trafficAnalysis.node")} #{connection.nodeId}
                  </Badge>
                </div>

                <div className="mt-3 rounded-md bg-muted/30 px-2 py-1.5 text-xs">
                  <span className="text-muted-foreground">
                    {t("routing.trafficMap.authTime")}{" "}
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatAuthTime(connection.firstAuthAt, t)} →{" "}
                    {formatAuthTime(connection.lastAuthAt, t)}
                  </span>
                </div>

                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-md bg-muted/40 px-2 py-1.5">
                    <span className="text-muted-foreground">
                      {t("routing.trafficMap.estimatedTxRx")}{" "}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatBytes(connection.estimatedTxBytes)} /{" "}
                      {formatBytes(connection.estimatedRxBytes)}
                    </span>
                  </div>
                  <div className="rounded-md bg-muted/40 px-2 py-1.5">
                    <span className="text-muted-foreground">
                      {t("routing.trafficMap.accountNodeTraffic")}{" "}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatOptionalBytes(connection.accountNodeBytes, t)}
                    </span>
                  </div>
                  <div className="rounded-md bg-muted/40 px-2 py-1.5">
                    <span className="text-muted-foreground">
                      {t("routing.trafficMap.accountSourceShare")}{" "}
                    </span>
                    <span className="font-medium tabular-nums">
                      {accountAuthShare.toFixed(1)}%
                    </span>
                  </div>
                  <div className="rounded-md bg-muted/40 px-2 py-1.5">
                    <span className="text-muted-foreground">
                      {t("routing.trafficMap.nodeSourceShare")}{" "}
                    </span>
                    <span className="font-medium tabular-nums">
                      {nodeAuthShare.toFixed(1)}%
                    </span>
                  </div>
                  <div className="rounded-md bg-muted/40 px-2 py-1.5 sm:col-span-2">
                    <span className="text-muted-foreground">
                      {t("routing.trafficMap.nodeWindowTraffic")}{" "}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatBytes(connection.nodeBytes)}
                    </span>
                    <span className="ml-2 text-muted-foreground">
                      · {getTrafficBasisLabel(connection.trafficBasis, t)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            {t("routing.trafficMap.noConnectionDetails")}
          </div>
        )}
      </div>
    </div>
  )
}

function FlowMiniList({
  title,
  empty,
  flows,
}: {
  title: string
  empty: string
  flows: NodeTrafficMapFlow[]
}) {
  const { t } = useI18n()

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {t("routing.trafficMap.authSourceEstimate")}
        </span>
      </div>
      <div className="mt-3 divide-y rounded-lg border bg-background/60">
        {flows.length > 0 ? (
          flows.map((flow) => (
            <div key={flow.key} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {getFlowTitle(flow, t)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("routing.common.authCount", {
                      count: flow.authCount,
                    })}{" "}
                    ·{" "}
                    {t("routing.common.nodesCount", {
                      count: flow.nodeCount,
                    })}{" "}
                    ·{" "}
                    {t("routing.common.accountsCount", {
                      count: flow.accountCount,
                    })}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    {formatBytes(flow.estimatedBytes)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("routing.common.estimated")}
                  </p>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="p-4 text-sm text-muted-foreground">{empty}</div>
        )}
      </div>
    </div>
  )
}

function FlowConnectionMiniList({
  title,
  empty,
  connections,
}: {
  title: string
  empty: string
  connections: NodeTrafficMapFlowConnection[]
}) {
  const { t } = useI18n()

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {t("routing.trafficMap.accountAndNode")}
        </span>
      </div>
      <div className="mt-3 divide-y rounded-lg border bg-background/60">
        {connections.length > 0 ? (
          connections.map((connection) => (
            <div
              key={`${connection.sourceCountryCode}-${connection.targetCountryCode}-${connection.key}`}
              className="p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {getCountryDisplayName(
                      connection.sourceCountryCode,
                      connection.sourceCountryName,
                      t
                    )}{" "}
                    → {connection.username} → {connection.nodeName}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>
                      {getCountryDisplayName(
                        connection.targetCountryCode,
                        connection.targetCountryName,
                        t
                      )}{" "}
                      ·{" "}
                      {t("routing.common.authCount", {
                        count: connection.authCount,
                      })}
                    </span>
                    <SourceAddressBadge connection={connection} />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    {formatBytes(connection.estimatedBytes)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("routing.common.estimated")}
                  </p>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="p-4 text-sm text-muted-foreground">{empty}</div>
        )}
      </div>
    </div>
  )
}

function FlowTrafficReportSheet({
  flow,
  open,
  onOpenChange,
}: {
  flow: NodeTrafficMapFlow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(98vw,860px)] gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <SheetHeader className="border-b pr-12">
          <div className="flex items-center gap-2">
            <FlowFlagBadge flow={flow} />
            <SheetTitle>
              {flow
                ? getFlowTitle(flow, t)
                : t("routing.trafficMap.flowReportTitle")}
            </SheetTitle>
          </div>
          <SheetDescription>
            {t("routing.trafficMap.flowReportDescription")}
          </SheetDescription>
        </SheetHeader>

        {flow ? (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <ReportMetric
                label={t("routing.trafficMap.estimatedTraffic")}
                value={formatBytes(flow.estimatedBytes)}
                hint={t("routing.trafficMap.estimatedTrafficHint")}
              />
              <ReportMetric
                label={t("routing.trafficMap.accountCount")}
                value={`${flow.accountCount}`}
                hint={t("routing.trafficMap.successAuthHint", {
                  count: flow.authCount,
                })}
              />
              <ReportMetric
                label={t("routing.trafficMap.estimatedTx")}
                value={formatBytes(flow.estimatedTxBytes)}
                hint={t("routing.trafficMap.nodeTxShareHint")}
              />
              <ReportMetric
                label={t("routing.trafficMap.estimatedRx")}
                value={formatBytes(flow.estimatedRxBytes)}
                hint={t("routing.trafficMap.nodeRxShareHint")}
              />
            </div>

            <div className="mt-4 rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <p>{t("routing.trafficMap.sourceRegion")}</p>
                  <p className="mt-1 font-medium text-foreground">
                    {getCountryDisplayName(
                      flow.sourceCountryCode,
                      flow.sourceCountryName,
                      t
                    )}{" "}
                    · {flow.sourceCountryCode}
                  </p>
                </div>
                <div>
                  <p>{t("routing.trafficMap.targetRegion")}</p>
                  <p className="mt-1 font-medium text-foreground">
                    {getCountryDisplayName(
                      flow.targetCountryCode,
                      flow.targetCountryName,
                      t
                    )}{" "}
                    · {flow.targetCountryCode}
                  </p>
                </div>
              </div>
            </div>

            <FlowConnectionList flow={flow} />

            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">
                  {t("routing.trafficMap.accountSummary")}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {t("routing.trafficMap.sortByEstimatedTraffic")}
                </span>
              </div>
              <div className="mt-3 divide-y rounded-lg border bg-background/60">
                {flow.topAccounts.length > 0 ? (
                  flow.topAccounts.map((account) => (
                    <div
                      key={`${account.userId ?? "name"}-${account.username}`}
                      className="p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {account.username}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {account.userId !== null
                              ? `#${account.userId} · `
                              : ""}
                            {t("routing.common.authCount", {
                              count: account.authCount,
                            })}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold tabular-nums">
                            {formatBytes(account.estimatedBytes)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("routing.common.estimated")}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-md bg-muted/40 px-2 py-1.5">
                          <span className="text-muted-foreground">TX </span>
                          <span className="font-medium tabular-nums">
                            {formatBytes(account.estimatedTxBytes)}
                          </span>
                        </div>
                        <div className="rounded-md bg-muted/40 px-2 py-1.5">
                          <span className="text-muted-foreground">RX </span>
                          <span className="font-medium tabular-nums">
                            {formatBytes(account.estimatedRxBytes)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-sm text-muted-foreground">
                    {t("routing.trafficMap.noAccountDetails")}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">
                  {t("routing.trafficMap.nodeSummary")}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {t("routing.trafficMap.sortByEstimatedTraffic")}
                </span>
              </div>
              <div className="mt-3 divide-y rounded-lg border bg-background/60">
                {flow.topNodes.length > 0 ? (
                  flow.topNodes.map((node) => (
                    <div key={node.nodeId} className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {node.nodeName}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            #{node.nodeId} ·{" "}
                            {t("routing.common.authCount", {
                              count: node.authCount,
                            })}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold tabular-nums">
                            {formatBytes(node.estimatedBytes)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("routing.common.estimated")}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-md bg-muted/40 px-2 py-1.5">
                          <span className="text-muted-foreground">TX </span>
                          <span className="font-medium tabular-nums">
                            {formatBytes(node.estimatedTxBytes)}
                          </span>
                        </div>
                        <div className="rounded-md bg-muted/40 px-2 py-1.5">
                          <span className="text-muted-foreground">RX </span>
                          <span className="font-medium tabular-nums">
                            {formatBytes(node.estimatedRxBytes)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-sm text-muted-foreground">
                    {t("routing.trafficMap.noNodeDetailsSentence")}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function CountryTrafficReportSheet({
  country,
  data,
  open,
  onOpenChange,
}: {
  country: NodeTrafficMapCountry | null
  data: NodeTrafficMapData
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const totalShare = country
    ? getPercent(country.totalBytes, data.totalBytes)
    : 0
  const locatedShare = country
    ? getPercent(country.totalBytes, data.locatedBytes)
    : 0
  const nodes = country?.nodes.length
    ? country.nodes
    : (country?.topNodes ?? [])
  const windowLabel = getWindowLabel(data.window, data.windowLabel, t)
  const countryCode = safeCountryCode(country?.countryCode ?? null)
  const incomingFlows = countryCode
    ? data.flows
        .filter((flow) => flow.targetCountryCode === countryCode)
        .slice(0, 5)
    : []
  const outgoingFlows = countryCode
    ? data.flows
        .filter((flow) => flow.sourceCountryCode === countryCode)
        .slice(0, 5)
    : []
  const incomingConnections = countryCode
    ? data.flows
        .filter((flow) => flow.targetCountryCode === countryCode)
        .flatMap((flow) => flow.topConnections)
        .sort((a, b) => {
          if (b.estimatedBytes !== a.estimatedBytes) {
            return b.estimatedBytes - a.estimatedBytes
          }
          return b.authCount - a.authCount
        })
        .slice(0, 8)
    : []
  const outgoingConnections = countryCode
    ? data.flows
        .filter((flow) => flow.sourceCountryCode === countryCode)
        .flatMap((flow) => flow.topConnections)
        .sort((a, b) => {
          if (b.estimatedBytes !== a.estimatedBytes) {
            return b.estimatedBytes - a.estimatedBytes
          }
          return b.authCount - a.authCount
        })
        .slice(0, 8)
    : []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(98vw,860px)] gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <SheetHeader className="border-b pr-12">
          <div className="flex items-center gap-2">
            <CountryFlagBadge
              countryCode={country?.countryCode ?? null}
              countryName={getCountryDisplayName(
                country?.countryCode,
                country?.countryName,
                t
              )}
            />
            <SheetTitle>
              {country
                ? getCountryDisplayName(
                    country.countryCode,
                    country.countryName,
                    t
                  )
                : t("routing.trafficMap.regionReportTitle")}
            </SheetTitle>
          </div>
          <SheetDescription>
            {t("routing.trafficMap.regionTrafficReport", {
              window: windowLabel,
            })}
          </SheetDescription>
        </SheetHeader>

        {country ? (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <ReportMetric
                label={t("routing.trafficMap.regionTotalTraffic")}
                value={formatBytes(country.totalBytes)}
                hint={t("routing.trafficMap.globalShareHint", {
                  share: `${totalShare.toFixed(1)}%`,
                })}
              />
              <ReportMetric
                label={t("routing.trafficMap.mapShare")}
                value={`${locatedShare.toFixed(1)}%`}
                hint={t("routing.trafficMap.regionNodeCountHint", {
                  count: country.nodeCount,
                })}
              />
              <ReportMetric
                label={t("routing.trafficMap.uploadTx")}
                value={formatBytes(country.txBytes)}
                hint={t("routing.trafficMap.nodeTxHint")}
              />
              <ReportMetric
                label={t("routing.trafficMap.downloadRx")}
                value={formatBytes(country.rxBytes)}
                hint={t("routing.trafficMap.nodeRxHint")}
              />
            </div>

            <div className="mt-4 rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <p>{t("routing.trafficMap.nodeCount")}</p>
                  <p className="mt-1 font-medium text-foreground tabular-nums">
                    {country.nodeCount}
                  </p>
                </div>
                <div>
                  <p>{t("routing.trafficMap.manualOverride")}</p>
                  <p className="mt-1 font-medium text-foreground tabular-nums">
                    {country.manualNodeCount}
                  </p>
                </div>
                <div>
                  <p>{t("routing.trafficMap.centroidLocation")}</p>
                  <p className="mt-1 font-medium text-foreground tabular-nums">
                    {country.centroidNodeCount}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-5">
              <FlowConnectionMiniList
                title={t("routing.trafficMap.incomingConnections")}
                empty={t("routing.trafficMap.noIncomingConnections")}
                connections={incomingConnections}
              />
              <FlowConnectionMiniList
                title={t("routing.trafficMap.asSourceConnections")}
                empty={t("routing.trafficMap.noSourceConnections")}
                connections={outgoingConnections}
              />
              <FlowMiniList
                title={t("routing.trafficMap.incomingSourceSummary")}
                empty={t("routing.trafficMap.noIncomingFlows")}
                flows={incomingFlows}
              />
              <FlowMiniList
                title={t("routing.trafficMap.connectionTargetSummary")}
                empty={t("routing.trafficMap.noTargetFlows")}
                flows={outgoingFlows}
              />
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">
                  {t("routing.trafficMap.nodeDetails")}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {t("routing.trafficMap.sortByTrafficDesc")}
                </span>
              </div>
              <div className="mt-3 divide-y rounded-lg border bg-background/60">
                {nodes.length > 0 ? (
                  nodes.map((node) => {
                    const share = getPercent(
                      node.totalBytes,
                      country.totalBytes
                    )
                    return (
                      <div key={node.nodeId} className="p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {node.nodeName}
                              </span>
                              <Badge
                                className={cn(
                                  "shrink-0 px-1.5 py-0 text-[10px]",
                                  node.status === "enabled"
                                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                    : "bg-muted text-muted-foreground"
                                )}
                              >
                                {node.status === "enabled"
                                  ? t("routing.common.enabled")
                                  : t("routing.common.disabled")}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              #{node.nodeId} · {getNodeGeoLabel(node, t)}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold tabular-nums">
                              {formatBytes(node.totalBytes)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {share.toFixed(1)}%
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-md bg-muted/40 px-2 py-1.5">
                            <span className="text-muted-foreground">TX </span>
                            <span className="font-medium tabular-nums">
                              {formatBytes(node.txBytes)}
                            </span>
                          </div>
                          <div className="rounded-md bg-muted/40 px-2 py-1.5">
                            <span className="text-muted-foreground">RX </span>
                            <span className="font-medium tabular-nums">
                              {formatBytes(node.rxBytes)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className="p-4 text-sm text-muted-foreground">
                    {t("routing.trafficMap.noNodeDetailsSentence")}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function EmptyHint({ geoipEnabled }: { geoipEnabled: boolean }) {
  const { t } = useI18n()

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="max-w-sm rounded-lg border bg-background/90 px-4 py-3 text-center shadow-sm backdrop-blur">
        <p className="text-sm font-medium">
          {t("routing.trafficMap.emptyTitle")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {geoipEnabled
            ? t("routing.trafficMap.emptyGeoipEnabled")
            : t("routing.trafficMap.emptyGeoipDisabled")}
        </p>
      </div>
    </div>
  )
}

function HoverPanel({
  country,
  totalBytes,
  positionClassName = "top-3 left-3",
}: {
  country: NodeTrafficMapCountry | null
  totalBytes: number
  positionClassName?: string
}) {
  const { t } = useI18n()
  if (!country) return null

  const share = getPercent(country.totalBytes, totalBytes)

  return (
    <div
      className={cn(
        "pointer-events-none absolute z-10 w-76 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur",
        positionClassName
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 min-w-8 items-center justify-center rounded bg-muted px-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
              {safeCountryCode(country.countryCode) ?? "--"}
            </span>
            <p className="truncate text-sm font-semibold">
              {getCountryDisplayName(
                country.countryCode,
                country.countryName,
                t
              )}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("routing.trafficMap.countryNodeShare", {
              count: country.nodeCount,
              share: `${share.toFixed(1)}%`,
            })}
          </p>
        </div>
        <Badge className="shrink-0 font-mono">
          {formatBytes(country.totalBytes)}
        </Badge>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md bg-muted/50 p-2">
          <p className="text-muted-foreground">
            {t("routing.trafficMap.totalTxShort")}
          </p>
          <p className="mt-1 font-semibold tabular-nums">
            {formatBytes(country.txBytes)}
          </p>
        </div>
        <div className="rounded-md bg-muted/50 p-2">
          <p className="text-muted-foreground">
            {t("routing.trafficMap.totalRxShort")}
          </p>
          <p className="mt-1 font-semibold tabular-nums">
            {formatBytes(country.rxBytes)}
          </p>
        </div>
      </div>

      <p className="mt-2 truncate text-xs text-muted-foreground">
        {getNodeSummary(country, t)}
      </p>
      <p className="mt-2 text-xs font-medium text-foreground">
        {t("routing.trafficMap.clickCountryHint")}
      </p>
    </div>
  )
}

function FlowHoverPanel({
  flow,
  positionClassName = "bottom-16 left-4 max-w-[calc(100vw-2rem)]",
}: {
  flow: NodeTrafficMapFlow | null
  positionClassName?: string
}) {
  const { t } = useI18n()
  if (!flow) return null

  return (
    <div
      className={cn(
        "pointer-events-none absolute z-10 w-80 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur",
        positionClassName
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 min-w-16 items-center justify-center rounded bg-muted px-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
              {flow.sourceCountryCode} → {flow.targetCountryCode}
            </span>
          </div>
          <p className="mt-2 truncate text-sm font-semibold">
            {getFlowTitle(flow, t)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("routing.common.authCount", {
              count: flow.authCount,
            })}{" "}
            ·{" "}
            {t("routing.common.nodesCount", {
              count: flow.nodeCount,
            })}{" "}
            ·{" "}
            {t("routing.common.accountsCount", {
              count: flow.accountCount,
            })}
          </p>
        </div>
        <Badge className="shrink-0 font-mono">
          {formatBytes(flow.estimatedBytes)}
        </Badge>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md bg-muted/50 p-2">
          <p className="text-muted-foreground">
            {t("routing.trafficMap.estimatedTx")}
          </p>
          <p className="mt-1 font-semibold tabular-nums">
            {formatBytes(flow.estimatedTxBytes)}
          </p>
        </div>
        <div className="rounded-md bg-muted/50 p-2">
          <p className="text-muted-foreground">
            {t("routing.trafficMap.estimatedRx")}
          </p>
          <p className="mt-1 font-semibold tabular-nums">
            {formatBytes(flow.estimatedRxBytes)}
          </p>
        </div>
      </div>

      <p className="mt-2 text-xs font-medium text-foreground">
        {t("routing.trafficMap.clickFlowHint")}
      </p>
    </div>
  )
}

type GlobeFlatPoint = {
  x: number
  y: number
  latitude: number
  longitude: number
}

type GlobeCountryShape = {
  code: string | null
  name: string
  polygons: GlobeFlatPoint[][]
}

type GlobeVector = {
  x: number
  y: number
  z: number
}

type GlobeMeshCountry = {
  code: string | null
  name: string
  triangleStart: number
  triangleCount: number
  lineStart: number
  lineCount: number
  center: GlobeVector | null
}

type GlobeMesh = {
  oceanPositions: Float32Array
  countryPositions: Float32Array
  borderPositions: Float32Array
  countries: GlobeMeshCountry[]
}

type GlobeViewState = {
  longitude: number
  latitude: number
  zoom: number
}

type GlobeScreenMetrics = {
  centerX: number
  centerY: number
  radius: number
}

type RgbaColor = [number, number, number, number]

type GlobeRenderTheme = {
  ocean: RgbaColor
  inactiveLand: RgbaColor
  inactiveBorder: RgbaColor
  activeBorder: RgbaColor
  hoverBorder: RgbaColor
  outline: RgbaColor
}

type GlobeRenderFlow = {
  key: string
  flow: NodeTrafficMapFlow
  positions: Float32Array
  samples: GlobeVector[]
  pointCount: number
}

type GlobeDrawInput = {
  view: GlobeViewState
  countryByCode: Map<string, NodeTrafficMapCountry>
  maxCountryBytes: number
  flows: GlobeRenderFlow[]
  maxFlowBytes: number
  hoveredCode: string | null
  hoveredFlowKey: string | null
  dark: boolean
}

const GLOBE_MIN_ZOOM = 0.78
const GLOBE_MAX_ZOOM = 1.72
const GLOBE_MIN_LATITUDE = -65
const GLOBE_MAX_LATITUDE = 65
const GLOBE_RADIUS_RATIO = 0.39
const GLOBE_CENTER_OFFSET_CLIP_Y = -0.03
const GLOBE_COUNTRY_RADIUS = 1.01
const GLOBE_BORDER_RADIUS = 1.018
const GLOBE_FILL_MAX_POLYGON_POINTS = 360
const GLOBE_BORDER_MAX_POLYGON_POINTS = 900
const GLOBE_HIT_RADIUS = 24
const GLOBE_FLOW_HIT_RADIUS = 12
const GLOBE_FLOW_BASE_RADIUS = 1.045
const GLOBE_FLOW_HALF_WIDTH = 0.0048
const GLOBE_FLOW_CLIP_THRESHOLD = -0.28
const GLOBE_FLOW_SEGMENTS = 48
const GLOBE_OUTLINE_SEGMENTS = 160
const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const PATH_TOKEN_REGEX = /[MLZ]|-?\d+(?:\.\d+)?/g

const GLOBE_VERTEX_SHADER = [
  "attribute vec3 a_position;",
  "uniform float u_sin_yaw;",
  "uniform float u_cos_yaw;",
  "uniform float u_sin_pitch;",
  "uniform float u_cos_pitch;",
  "uniform vec2 u_scale;",
  "uniform vec2 u_offset;",
  "varying float v_front_z;",
  "void main() {",
  "  vec3 p = a_position;",
  "  float x1 = p.x * u_cos_yaw - p.z * u_sin_yaw;",
  "  float z1 = p.x * u_sin_yaw + p.z * u_cos_yaw;",
  "  float y2 = p.y * u_cos_pitch - z1 * u_sin_pitch;",
  "  float z2 = p.y * u_sin_pitch + z1 * u_cos_pitch;",
  "  gl_Position = vec4(x1 * u_scale.x + u_offset.x, y2 * u_scale.y + u_offset.y, -z2 * 0.7, 1.0);",
  "  v_front_z = z2;",
  "}",
].join("\n")

const GLOBE_FRAGMENT_SHADER = [
  "precision mediump float;",
  "uniform vec4 u_color;",
  "uniform float u_clip_front;",
  "uniform float u_clip_threshold;",
  "varying float v_front_z;",
  "void main() {",
  "  if (u_clip_front > 0.5 && v_front_z < u_clip_threshold) discard;",
  "  gl_FragColor = u_color;",
  "}",
].join("\n")

const GLOBE_THEME_LIGHT: GlobeRenderTheme = {
  ocean: [0.94, 0.94, 0.94, 1],
  inactiveLand: [0.76, 0.76, 0.76, 1],
  inactiveBorder: [0.88, 0.88, 0.88, 0.9],
  activeBorder: [0.06, 0.06, 0.06, 0.36],
  hoverBorder: [0.02, 0.02, 0.02, 0.92],
  outline: [0.04, 0.04, 0.04, 0.38],
}

const GLOBE_THEME_DARK: GlobeRenderTheme = {
  ocean: [0.15, 0.15, 0.15, 1],
  inactiveLand: [0.31, 0.31, 0.31, 1],
  inactiveBorder: [0.18, 0.18, 0.18, 0.82],
  activeBorder: [1, 1, 1, 0.38],
  hoverBorder: [1, 1, 1, 0.92],
  outline: [1, 1, 1, 0.42],
}

let parsedWorldCountryShapesCache: GlobeCountryShape[] | null = null
let globeMeshCache: GlobeMesh | null = null

function normalizeLongitude(value: number) {
  if (!Number.isFinite(value)) return 0
  return ((((value + 180) % 360) + 360) % 360) - 180
}

function clampGlobeZoom(value: number) {
  return Math.min(GLOBE_MAX_ZOOM, Math.max(GLOBE_MIN_ZOOM, value))
}

function flatPointToLonLat(x: number, y: number): GlobeFlatPoint {
  return {
    x,
    y,
    latitude: clamp(90 - (y / MAP_HEIGHT) * 180, -90, 90),
    longitude: normalizeLongitude((x / MAP_WIDTH) * 360 - 180),
  }
}

function parseCountryPathPolygons(pathData: string): GlobeFlatPoint[][] {
  const tokens = pathData.match(PATH_TOKEN_REGEX) ?? []
  const polygons: GlobeFlatPoint[][] = []
  let current: GlobeFlatPoint[] = []
  let command: "M" | "L" | null = null

  function flushCurrent() {
    if (current.length >= 2) polygons.push(current)
    current = []
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === "M") {
      flushCurrent()
      command = "M"
      continue
    }
    if (token === "L") {
      command = "L"
      continue
    }
    if (token === "Z") {
      flushCurrent()
      command = null
      continue
    }
    if (!command) continue

    const x = Number(token)
    const y = Number(tokens[index + 1])
    index += 1
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    current.push(flatPointToLonLat(x, y))
    if (command === "M") command = "L"
  }

  flushCurrent()
  return polygons
}

function getParsedWorldCountryShapes() {
  if (!parsedWorldCountryShapesCache) {
    parsedWorldCountryShapesCache = WORLD_COUNTRY_PATHS.map((country) => ({
      code: safeCountryCode(country.code),
      name: country.name,
      polygons: parseCountryPathPolygons(country.d),
    })).filter((country) => country.polygons.length > 0)
  }
  return parsedWorldCountryShapesCache
}

function latLonToGlobeVector(
  latitudeInput: number,
  longitudeInput: number,
  radius = 1
): GlobeVector {
  const latitude = clamp(latitudeInput, -90, 90) * DEG_TO_RAD
  const longitude = normalizeLongitude(longitudeInput) * DEG_TO_RAD
  const cosLatitude = Math.cos(latitude)
  return {
    x: radius * cosLatitude * Math.sin(longitude),
    y: radius * Math.sin(latitude),
    z: radius * cosLatitude * Math.cos(longitude),
  }
}

function pushGlobeVector(target: number[], vector: GlobeVector) {
  target.push(vector.x, vector.y, vector.z)
}

function normalizeVector(vector: GlobeVector): GlobeVector | null {
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (!Number.isFinite(length) || length <= 0) return null
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  }
}

function scaleGlobeVector(vector: GlobeVector, scale: number): GlobeVector {
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  }
}

function subtractGlobeVector(
  from: GlobeVector,
  value: GlobeVector
): GlobeVector {
  return {
    x: from.x - value.x,
    y: from.y - value.y,
    z: from.z - value.z,
  }
}

function crossGlobeVector(a: GlobeVector, b: GlobeVector): GlobeVector {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function slerpGlobeVector(
  from: GlobeVector,
  to: GlobeVector,
  t: number
): GlobeVector {
  const dot = clamp(from.x * to.x + from.y * to.y + from.z * to.z, -1, 1)
  const omega = Math.acos(dot)
  const sinOmega = Math.sin(omega)
  if (sinOmega < 0.000001) {
    return (
      normalizeVector({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: from.z + (to.z - from.z) * t,
      }) ?? from
    )
  }

  const a = Math.sin((1 - t) * omega) / sinOmega
  const b = Math.sin(t * omega) / sinOmega
  return {
    x: from.x * a + to.x * b,
    y: from.y * a + to.y * b,
    z: from.z * a + to.z * b,
  }
}

function buildFlowRenderData(flow: NodeTrafficMapFlow): GlobeRenderFlow | null {
  if (
    flow.estimatedBytes <= 0 ||
    flow.sourceCountryCode === flow.targetCountryCode
  ) {
    return null
  }

  const from = normalizeVector(
    latLonToGlobeVector(flow.sourceLatitude, flow.sourceLongitude)
  )
  const to = normalizeVector(
    latLonToGlobeVector(flow.targetLatitude, flow.targetLongitude)
  )
  if (!from || !to) return null

  const centers: GlobeVector[] = []
  const stripPositions: number[] = []
  const distance = Math.acos(
    clamp(from.x * to.x + from.y * to.y + from.z * to.z, -1, 1)
  )
  const height = clamp(0.045 + distance * 0.075, 0.06, 0.2)

  for (let index = 0; index <= GLOBE_FLOW_SEGMENTS; index += 1) {
    const t = index / GLOBE_FLOW_SEGMENTS
    const base = slerpGlobeVector(from, to, t)
    const altitude = GLOBE_FLOW_BASE_RADIUS + Math.sin(Math.PI * t) * height
    centers.push(scaleGlobeVector(base, altitude))
  }

  for (let index = 0; index < centers.length; index += 1) {
    const center = centers[index]
    const previous = centers[Math.max(0, index - 1)]
    const next = centers[Math.min(centers.length - 1, index + 1)]
    const tangent = normalizeVector(subtractGlobeVector(next, previous))
    const normal = normalizeVector(center)
    const side =
      tangent && normal
        ? normalizeVector(crossGlobeVector(normal, tangent))
        : null
    const offset = side
      ? scaleGlobeVector(side, GLOBE_FLOW_HALF_WIDTH)
      : { x: 0, y: 0, z: 0 }
    pushGlobeVector(stripPositions, {
      x: center.x + offset.x,
      y: center.y + offset.y,
      z: center.z + offset.z,
    })
    pushGlobeVector(stripPositions, {
      x: center.x - offset.x,
      y: center.y - offset.y,
      z: center.z - offset.z,
    })
  }

  return {
    key: flow.key,
    flow,
    positions: new Float32Array(stripPositions),
    samples: centers,
    pointCount: centers.length * 2,
  }
}

function buildSphereDiscPositions(view: GlobeViewState) {
  const positions: number[] = []
  pushGlobeVector(positions, unrotateGlobeVector({ x: 0, y: 0, z: 0 }, view))
  for (let index = 0; index <= GLOBE_OUTLINE_SEGMENTS; index += 1) {
    const angle = (index / GLOBE_OUTLINE_SEGMENTS) * Math.PI * 2
    pushGlobeVector(
      positions,
      unrotateGlobeVector(
        { x: Math.cos(angle), y: Math.sin(angle), z: 0 },
        view
      )
    )
  }
  return new Float32Array(positions)
}

function buildSphereOutlinePositions(view: GlobeViewState) {
  const positions: number[] = []
  for (let index = 0; index < GLOBE_OUTLINE_SEGMENTS; index += 1) {
    const currentAngle = (index / GLOBE_OUTLINE_SEGMENTS) * Math.PI * 2
    const nextAngle = ((index + 1) / GLOBE_OUTLINE_SEGMENTS) * Math.PI * 2
    pushGlobeVector(
      positions,
      unrotateGlobeVector(
        {
          x: Math.cos(currentAngle) * 1.002,
          y: Math.sin(currentAngle) * 1.002,
          z: 0,
        },
        view
      )
    )
    pushGlobeVector(
      positions,
      unrotateGlobeVector(
        {
          x: Math.cos(nextAngle) * 1.002,
          y: Math.sin(nextAngle) * 1.002,
          z: 0,
        },
        view
      )
    )
  }
  return new Float32Array(positions)
}

function buildSphereTrianglePositions(
  longitudeSegments = 72,
  latitudeBands = 36
) {
  const positions: number[] = []
  for (let latIndex = 0; latIndex < latitudeBands; latIndex += 1) {
    const latA = -90 + (latIndex / latitudeBands) * 180
    const latB = -90 + ((latIndex + 1) / latitudeBands) * 180
    for (let lonIndex = 0; lonIndex < longitudeSegments; lonIndex += 1) {
      const lonA = -180 + (lonIndex / longitudeSegments) * 360
      const lonB = -180 + ((lonIndex + 1) / longitudeSegments) * 360
      const a = latLonToGlobeVector(latA, lonA)
      const b = latLonToGlobeVector(latA, lonB)
      const c = latLonToGlobeVector(latB, lonB)
      const d = latLonToGlobeVector(latB, lonA)
      pushGlobeVector(positions, a)
      pushGlobeVector(positions, b)
      pushGlobeVector(positions, c)
      pushGlobeVector(positions, a)
      pushGlobeVector(positions, c)
      pushGlobeVector(positions, d)
    }
  }
  return new Float32Array(positions)
}

function getFlatPolygonSignedArea(points: GlobeFlatPoint[]) {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }
  return area / 2
}

function cleanFlatPolygon(
  points: GlobeFlatPoint[],
  maxPoints = GLOBE_FILL_MAX_POLYGON_POINTS
) {
  const clean: GlobeFlatPoint[] = []
  for (const point of points) {
    const previous = clean[clean.length - 1]
    if (
      previous &&
      Math.abs(previous.x - point.x) < 0.01 &&
      Math.abs(previous.y - point.y) < 0.01
    ) {
      continue
    }
    clean.push(point)
  }

  const first = clean[0]
  const last = clean[clean.length - 1]
  if (
    first &&
    last &&
    clean.length > 1 &&
    Math.abs(first.x - last.x) < 0.01 &&
    Math.abs(first.y - last.y) < 0.01
  ) {
    clean.pop()
  }

  if (clean.length <= maxPoints) return clean
  const step = Math.ceil(clean.length / maxPoints)
  return clean.filter((_, index) => index % step === 0)
}

function getFlatCross(a: GlobeFlatPoint, b: GlobeFlatPoint, c: GlobeFlatPoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function isFlatPointInTriangle(
  point: GlobeFlatPoint,
  a: GlobeFlatPoint,
  b: GlobeFlatPoint,
  c: GlobeFlatPoint
) {
  const areaA = getFlatCross(point, a, b)
  const areaB = getFlatCross(point, b, c)
  const areaC = getFlatCross(point, c, a)
  const hasNegative =
    areaA < -0.000001 || areaB < -0.000001 || areaC < -0.000001
  const hasPositive = areaA > 0.000001 || areaB > 0.000001 || areaC > 0.000001
  return !(hasNegative && hasPositive)
}

function fallbackFanTriangulation(points: GlobeFlatPoint[]) {
  const triangles: GlobeFlatPoint[][] = []
  for (let index = 1; index < points.length - 1; index += 1) {
    triangles.push([points[0], points[index], points[index + 1]])
  }
  return triangles
}

function triangulateFlatPolygon(input: GlobeFlatPoint[]) {
  const points = cleanFlatPolygon(input)
  if (points.length < 3) return []

  const area = getFlatPolygonSignedArea(points)
  const orientation = area >= 0 ? 1 : -1
  const vertices = points.map((_, index) => index)
  const triangles: GlobeFlatPoint[][] = []
  let guard = 0

  while (vertices.length > 3 && guard < points.length * points.length) {
    let earIndex = -1
    guard += 1

    for (let index = 0; index < vertices.length; index += 1) {
      const previous = vertices[(index - 1 + vertices.length) % vertices.length]
      const current = vertices[index]
      const next = vertices[(index + 1) % vertices.length]
      const a = points[previous]
      const b = points[current]
      const c = points[next]
      if (getFlatCross(a, b, c) * orientation <= 0.000001) continue

      let hasPointInside = false
      for (const candidateIndex of vertices) {
        if (
          candidateIndex === previous ||
          candidateIndex === current ||
          candidateIndex === next
        ) {
          continue
        }
        if (isFlatPointInTriangle(points[candidateIndex], a, b, c)) {
          hasPointInside = true
          break
        }
      }
      if (hasPointInside) continue
      earIndex = index
      triangles.push([a, b, c])
      break
    }

    if (earIndex < 0) return fallbackFanTriangulation(points)
    vertices.splice(earIndex, 1)
  }

  if (vertices.length === 3) {
    triangles.push([
      points[vertices[0]],
      points[vertices[1]],
      points[vertices[2]],
    ])
  }
  return triangles
}

function buildGlobeMesh() {
  if (globeMeshCache) return globeMeshCache

  const countryPositions: number[] = []
  const borderPositions: number[] = []
  const countries: GlobeMeshCountry[] = []

  for (const shape of getParsedWorldCountryShapes()) {
    const triangleStart = countryPositions.length / 3
    const lineStart = borderPositions.length / 3
    let centerTotal: GlobeVector = { x: 0, y: 0, z: 0 }
    let centerCount = 0

    for (const polygon of shape.polygons) {
      const fillPoints = cleanFlatPolygon(
        polygon,
        GLOBE_FILL_MAX_POLYGON_POINTS
      )
      const borderPoints = cleanFlatPolygon(
        polygon,
        GLOBE_BORDER_MAX_POLYGON_POINTS
      )

      if (fillPoints.length >= 3) {
        const triangles = triangulateFlatPolygon(fillPoints)
        for (const triangle of triangles) {
          for (const point of triangle) {
            pushGlobeVector(
              countryPositions,
              latLonToGlobeVector(
                point.latitude,
                point.longitude,
                GLOBE_COUNTRY_RADIUS
              )
            )
          }
        }
      }

      for (let index = 0; index < borderPoints.length; index += 1) {
        const current = borderPoints[index]
        const next = borderPoints[(index + 1) % borderPoints.length]
        pushGlobeVector(
          borderPositions,
          latLonToGlobeVector(
            current.latitude,
            current.longitude,
            GLOBE_BORDER_RADIUS
          )
        )
        pushGlobeVector(
          borderPositions,
          latLonToGlobeVector(
            next.latitude,
            next.longitude,
            GLOBE_BORDER_RADIUS
          )
        )
        const centerVector = latLonToGlobeVector(
          current.latitude,
          current.longitude
        )
        centerTotal = {
          x: centerTotal.x + centerVector.x,
          y: centerTotal.y + centerVector.y,
          z: centerTotal.z + centerVector.z,
        }
        centerCount += 1
      }
    }

    countries.push({
      code: shape.code,
      name: shape.name,
      triangleStart,
      triangleCount: countryPositions.length / 3 - triangleStart,
      lineStart,
      lineCount: borderPositions.length / 3 - lineStart,
      center: centerCount > 0 ? normalizeVector(centerTotal) : null,
    })
  }

  globeMeshCache = {
    oceanPositions: buildSphereTrianglePositions(),
    countryPositions: new Float32Array(countryPositions),
    borderPositions: new Float32Array(borderPositions),
    countries,
  }
  return globeMeshCache
}

function createWebGlShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createWebGlProgram(gl: WebGLRenderingContext) {
  const vertexShader = createWebGlShader(
    gl,
    gl.VERTEX_SHADER,
    GLOBE_VERTEX_SHADER
  )
  const fragmentShader = createWebGlShader(
    gl,
    gl.FRAGMENT_SHADER,
    GLOBE_FRAGMENT_SHADER
  )
  if (!vertexShader || !fragmentShader) return null

  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  return program
}

function createWebGlBuffer(gl: WebGLRenderingContext, data: Float32Array) {
  const buffer = gl.createBuffer()
  if (!buffer) return null
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
  return buffer
}

function resizeWebGlCanvas(canvas: HTMLCanvasElement) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width * ratio))
  const height = Math.max(1, Math.round(rect.height * ratio))
  const resized = canvas.width !== width || canvas.height !== height
  if (resized) {
    canvas.width = width
    canvas.height = height
  }
  return resized
}

function mixColor(from: RgbaColor, to: RgbaColor, amount: number): RgbaColor {
  const t = clamp(amount, 0, 1)
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
    from[3] + (to[3] - from[3]) * t,
  ]
}

function getTrafficHeatColor(
  totalBytes: number,
  maxBytes: number,
  dark: boolean
): RgbaColor {
  const ratio = maxBytes > 0 ? Math.pow(totalBytes / maxBytes, 0.58) : 0
  const low: RgbaColor = dark ? [0.14, 0.52, 0.9, 1] : [0.2, 0.5, 0.92, 1]
  const mid: RgbaColor = dark ? [0.12, 0.78, 0.58, 1] : [0.08, 0.66, 0.44, 1]
  const high: RgbaColor = dark ? [0.98, 0.5, 0.2, 1] : [0.92, 0.34, 0.18, 1]
  if (ratio < 0.55) return mixColor(low, mid, ratio / 0.55)
  return mixColor(mid, high, (ratio - 0.55) / 0.45)
}

function getCountryFillColor(
  country: NodeTrafficMapCountry | undefined,
  maxCountryBytes: number,
  dark: boolean,
  hovered: boolean
) {
  const theme = dark ? GLOBE_THEME_DARK : GLOBE_THEME_LIGHT
  if (!country) return theme.inactiveLand
  const color = getTrafficHeatColor(country.totalBytes, maxCountryBytes, dark)
  return hovered
    ? mixColor(color, dark ? [1, 1, 1, 1] : [0, 0, 0, 1], 0.1)
    : color
}

function getCountryBorderColor(
  active: boolean,
  hovered: boolean,
  dark: boolean
) {
  const theme = dark ? GLOBE_THEME_DARK : GLOBE_THEME_LIGHT
  if (hovered) return theme.hoverBorder
  return active ? theme.activeBorder : theme.inactiveBorder
}

function getFlowStrokeColor(
  flow: NodeTrafficMapFlow,
  maxFlowBytes: number,
  dark: boolean,
  hovered: boolean
): RgbaColor {
  const ratio =
    maxFlowBytes > 0 ? Math.pow(flow.estimatedBytes / maxFlowBytes, 0.55) : 0
  const base: RgbaColor = dark ? [0.38, 0.78, 1, 1] : [0.08, 0.42, 0.82, 1]
  const hot: RgbaColor = dark ? [1, 0.72, 0.38, 1] : [0.88, 0.32, 0.14, 1]
  const color = mixColor(base, hot, ratio)
  return [color[0], color[1], color[2], hovered ? 0.96 : 0.44 + ratio * 0.34]
}

class GlobeWebGlRenderer {
  private gl: WebGLRenderingContext
  private mesh: GlobeMesh
  private program: WebGLProgram
  private oceanBuffer: WebGLBuffer
  private globeDiscBuffer: WebGLBuffer
  private countryBuffer: WebGLBuffer
  private borderBuffer: WebGLBuffer
  private outlineBuffer: WebGLBuffer
  private flowBuffer: WebGLBuffer
  private positionLocation: number
  private colorLocation: WebGLUniformLocation
  private clipFrontLocation: WebGLUniformLocation
  private clipThresholdLocation: WebGLUniformLocation
  private sinYawLocation: WebGLUniformLocation
  private cosYawLocation: WebGLUniformLocation
  private sinPitchLocation: WebGLUniformLocation
  private cosPitchLocation: WebGLUniformLocation
  private scaleLocation: WebGLUniformLocation
  private offsetLocation: WebGLUniformLocation

  constructor(
    private canvas: HTMLCanvasElement,
    mesh: GlobeMesh
  ) {
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      depth: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    })
    if (!gl) throw new Error("WebGL unavailable")
    const program = createWebGlProgram(gl)
    if (!program) throw new Error("WebGL program failed")
    const oceanBuffer = createWebGlBuffer(gl, mesh.oceanPositions)
    const globeDiscBuffer = createWebGlBuffer(gl, new Float32Array())
    const countryBuffer = createWebGlBuffer(gl, mesh.countryPositions)
    const borderBuffer = createWebGlBuffer(gl, mesh.borderPositions)
    const outlineBuffer = createWebGlBuffer(gl, new Float32Array())
    const flowBuffer = createWebGlBuffer(gl, new Float32Array())
    if (
      !oceanBuffer ||
      !globeDiscBuffer ||
      !countryBuffer ||
      !borderBuffer ||
      !outlineBuffer ||
      !flowBuffer
    ) {
      throw new Error("WebGL buffer failed")
    }

    const positionLocation = gl.getAttribLocation(program, "a_position")
    const colorLocation = gl.getUniformLocation(program, "u_color")
    const clipFrontLocation = gl.getUniformLocation(program, "u_clip_front")
    const clipThresholdLocation = gl.getUniformLocation(
      program,
      "u_clip_threshold"
    )
    const sinYawLocation = gl.getUniformLocation(program, "u_sin_yaw")
    const cosYawLocation = gl.getUniformLocation(program, "u_cos_yaw")
    const sinPitchLocation = gl.getUniformLocation(program, "u_sin_pitch")
    const cosPitchLocation = gl.getUniformLocation(program, "u_cos_pitch")
    const scaleLocation = gl.getUniformLocation(program, "u_scale")
    const offsetLocation = gl.getUniformLocation(program, "u_offset")
    if (
      positionLocation < 0 ||
      !colorLocation ||
      !clipFrontLocation ||
      !clipThresholdLocation ||
      !sinYawLocation ||
      !cosYawLocation ||
      !sinPitchLocation ||
      !cosPitchLocation ||
      !scaleLocation ||
      !offsetLocation
    ) {
      throw new Error("WebGL locations failed")
    }

    this.gl = gl
    this.mesh = mesh
    this.program = program
    this.oceanBuffer = oceanBuffer
    this.globeDiscBuffer = globeDiscBuffer
    this.countryBuffer = countryBuffer
    this.borderBuffer = borderBuffer
    this.outlineBuffer = outlineBuffer
    this.flowBuffer = flowBuffer
    this.positionLocation = positionLocation
    this.colorLocation = colorLocation
    this.clipFrontLocation = clipFrontLocation
    this.clipThresholdLocation = clipThresholdLocation
    this.sinYawLocation = sinYawLocation
    this.cosYawLocation = cosYawLocation
    this.sinPitchLocation = sinPitchLocation
    this.cosPitchLocation = cosPitchLocation
    this.scaleLocation = scaleLocation
    this.offsetLocation = offsetLocation
  }

  dispose() {
    const gl = this.gl
    gl.deleteBuffer(this.oceanBuffer)
    gl.deleteBuffer(this.globeDiscBuffer)
    gl.deleteBuffer(this.countryBuffer)
    gl.deleteBuffer(this.borderBuffer)
    gl.deleteBuffer(this.outlineBuffer)
    gl.deleteBuffer(this.flowBuffer)
    gl.deleteProgram(this.program)
  }

  private bindPositionBuffer(buffer: WebGLBuffer) {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(this.positionLocation)
    gl.vertexAttribPointer(this.positionLocation, 3, gl.FLOAT, false, 0, 0)
  }

  private setColor(color: RgbaColor) {
    this.gl.uniform4f(
      this.colorLocation,
      color[0],
      color[1],
      color[2],
      color[3]
    )
  }

  private setClipFront(enabled: boolean, threshold = 0) {
    this.gl.uniform1f(this.clipFrontLocation, enabled ? 1 : 0)
    this.gl.uniform1f(this.clipThresholdLocation, threshold)
  }

  draw({
    view,
    countryByCode,
    maxCountryBytes,
    flows,
    maxFlowBytes,
    hoveredCode,
    hoveredFlowKey,
    dark,
  }: GlobeDrawInput) {
    const gl = this.gl
    resizeWebGlCanvas(this.canvas)
    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    const radius = Math.min(width, height) * GLOBE_RADIUS_RATIO * view.zoom
    const yaw = view.longitude * DEG_TO_RAD
    const pitch = view.latitude * DEG_TO_RAD
    const theme = dark ? GLOBE_THEME_DARK : GLOBE_THEME_LIGHT

    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clearDepth(1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.lineWidth(1)

    gl.uniform1f(this.sinYawLocation, Math.sin(yaw))
    gl.uniform1f(this.cosYawLocation, Math.cos(yaw))
    gl.uniform1f(this.sinPitchLocation, Math.sin(pitch))
    gl.uniform1f(this.cosPitchLocation, Math.cos(pitch))
    gl.uniform2f(
      this.scaleLocation,
      (2 * radius) / width,
      (2 * radius) / height
    )
    gl.uniform2f(this.offsetLocation, 0, GLOBE_CENTER_OFFSET_CLIP_Y)

    gl.depthMask(false)
    this.setClipFront(false)
    this.bindPositionBuffer(this.globeDiscBuffer)
    const discPositions = buildSphereDiscPositions(view)
    gl.bufferData(gl.ARRAY_BUFFER, discPositions, gl.DYNAMIC_DRAW)
    this.setColor(theme.ocean)
    gl.drawArrays(gl.TRIANGLE_FAN, 0, discPositions.length / 3)

    this.setClipFront(true)
    this.bindPositionBuffer(this.oceanBuffer)
    this.setColor(theme.ocean)
    gl.drawArrays(gl.TRIANGLES, 0, this.mesh.oceanPositions.length / 3)

    gl.disable(gl.DEPTH_TEST)
    this.bindPositionBuffer(this.outlineBuffer)
    const outlinePositions = buildSphereOutlinePositions(view)
    gl.bufferData(gl.ARRAY_BUFFER, outlinePositions, gl.DYNAMIC_DRAW)
    this.setClipFront(false)
    this.setColor(theme.outline)
    gl.drawArrays(gl.LINES, 0, outlinePositions.length / 3)

    // 国家面片是经纬边界三角化后的球面近似，不能再用海洋球面的深度遮挡，
    // 否则大地块中部会被球面深度吃掉，看起来像缺块。
    this.setClipFront(true)
    this.bindPositionBuffer(this.countryBuffer)
    for (const countryMesh of this.mesh.countries) {
      if (countryMesh.triangleCount <= 0) continue
      const country = countryMesh.code
        ? countryByCode.get(countryMesh.code)
        : undefined
      const hovered = Boolean(
        countryMesh.code && countryMesh.code === hoveredCode
      )
      this.setColor(
        getCountryFillColor(country, maxCountryBytes, dark, hovered)
      )
      gl.drawArrays(
        gl.TRIANGLES,
        countryMesh.triangleStart,
        countryMesh.triangleCount
      )
    }

    this.bindPositionBuffer(this.borderBuffer)
    for (const countryMesh of this.mesh.countries) {
      if (countryMesh.lineCount <= 0) continue
      const active = Boolean(
        countryMesh.code && countryByCode.has(countryMesh.code)
      )
      const hovered = Boolean(
        countryMesh.code && countryMesh.code === hoveredCode
      )
      this.setColor(getCountryBorderColor(active, hovered, dark))
      gl.drawArrays(gl.LINES, countryMesh.lineStart, countryMesh.lineCount)
    }

    this.bindPositionBuffer(this.flowBuffer)
    this.setClipFront(true, GLOBE_FLOW_CLIP_THRESHOLD)
    for (let index = flows.length - 1; index >= 0; index -= 1) {
      const renderFlow = flows[index]
      if (renderFlow.pointCount < 4) continue
      const hovered = renderFlow.key === hoveredFlowKey
      gl.bufferData(gl.ARRAY_BUFFER, renderFlow.positions, gl.DYNAMIC_DRAW)
      this.setColor(
        getFlowStrokeColor(renderFlow.flow, maxFlowBytes, dark, hovered)
      )
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, renderFlow.pointCount)
    }
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.flush()
  }
}

function getGlobeScreenMetrics(
  canvas: HTMLCanvasElement,
  view: GlobeViewState
): GlobeScreenMetrics {
  const rect = canvas.getBoundingClientRect()
  return {
    centerX: rect.left + rect.width / 2,
    centerY:
      rect.top +
      rect.height / 2 -
      (GLOBE_CENTER_OFFSET_CLIP_Y * rect.height) / 2,
    radius: Math.min(rect.width, rect.height) * GLOBE_RADIUS_RATIO * view.zoom,
  }
}

function rotateGlobeVector(vector: GlobeVector, view: GlobeViewState) {
  const yaw = view.longitude * DEG_TO_RAD
  const pitch = view.latitude * DEG_TO_RAD
  const sinYaw = Math.sin(yaw)
  const cosYaw = Math.cos(yaw)
  const sinPitch = Math.sin(pitch)
  const cosPitch = Math.cos(pitch)
  const x1 = vector.x * cosYaw - vector.z * sinYaw
  const z1 = vector.x * sinYaw + vector.z * cosYaw
  return {
    x: x1,
    y: vector.y * cosPitch - z1 * sinPitch,
    z: vector.y * sinPitch + z1 * cosPitch,
  }
}

function unrotateGlobeVector(vector: GlobeVector, view: GlobeViewState) {
  const yaw = view.longitude * DEG_TO_RAD
  const pitch = view.latitude * DEG_TO_RAD
  const sinYaw = Math.sin(yaw)
  const cosYaw = Math.cos(yaw)
  const sinPitch = Math.sin(pitch)
  const cosPitch = Math.cos(pitch)
  const y1 = vector.y * cosPitch + vector.z * sinPitch
  const z1 = -vector.y * sinPitch + vector.z * cosPitch
  return {
    x: vector.x * cosYaw + z1 * sinYaw,
    y: y1,
    z: -vector.x * sinYaw + z1 * cosYaw,
  }
}

function screenPointToGlobeMapPoint(
  canvas: HTMLCanvasElement,
  view: GlobeViewState,
  clientX: number,
  clientY: number
) {
  const metrics = getGlobeScreenMetrics(canvas, view)
  if (metrics.radius <= 0) return null
  const x = (clientX - metrics.centerX) / metrics.radius
  const y = (metrics.centerY - clientY) / metrics.radius
  const distanceSquared = x * x + y * y
  if (distanceSquared > 1) return null
  const z = Math.sqrt(1 - distanceSquared)
  const world = unrotateGlobeVector({ x, y, z }, view)
  const latitude = Math.asin(clamp(world.y, -1, 1)) * RAD_TO_DEG
  const longitude = normalizeLongitude(
    Math.atan2(world.x, world.z) * RAD_TO_DEG
  )
  return {
    latitude,
    longitude,
    x: ((longitude + 180) / 360) * MAP_WIDTH,
    y: ((90 - latitude) / 180) * MAP_HEIGHT,
  }
}

function projectGlobeVectorToScreen(
  vector: GlobeVector,
  canvas: HTMLCanvasElement,
  view: GlobeViewState
) {
  const metrics = getGlobeScreenMetrics(canvas, view)
  const rotated = rotateGlobeVector(vector, view)
  if (rotated.z <= 0) return null
  return {
    x: metrics.centerX + rotated.x * metrics.radius,
    y: metrics.centerY - rotated.y * metrics.radius,
    z: rotated.z,
  }
}

function projectCountryCenterToScreen(
  country: NodeTrafficMapCountry,
  canvas: HTMLCanvasElement,
  view: GlobeViewState
) {
  return projectGlobeVectorToScreen(
    latLonToGlobeVector(country.latitude, country.longitude),
    canvas,
    view
  )
}

function getDistanceToSegmentSquared(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
) {
  const dx = bx - ax
  const dy = by - ay
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    const pointDx = px - ax
    const pointDy = py - ay
    return pointDx * pointDx + pointDy * pointDy
  }
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1)
  const x = ax + dx * t
  const y = ay + dy * t
  const pointDx = px - x
  const pointDy = py - y
  return pointDx * pointDx + pointDy * pointDy
}

function isMapPointInPolygon(x: number, y: number, polygon: GlobeFlatPoint[]) {
  let inside = false
  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const current = polygon[index]
    const previous = polygon[previousIndex]
    const intersects =
      current.y > y !== previous.y > y &&
      x <
        ((previous.x - current.x) * (y - current.y)) /
          (previous.y - current.y || Number.EPSILON) +
          current.x
    if (intersects) inside = !inside
  }
  return inside
}

function isMapPointInCountryShape(
  x: number,
  y: number,
  shape: GlobeCountryShape
) {
  return shape.polygons.some((polygon) => isMapPointInPolygon(x, y, polygon))
}

function getInitialGlobeFocus(data: NodeTrafficMapData) {
  const focus = data.countries.reduce<NodeTrafficMapCountry | null>(
    (best, country) => {
      if (!best) return country
      if (country.totalBytes > best.totalBytes) return country
      if (
        country.totalBytes === best.totalBytes &&
        country.nodeCount > best.nodeCount
      ) {
        return country
      }
      return best
    },
    null
  )

  return {
    longitude: normalizeLongitude(focus?.longitude ?? 105),
    latitude: clamp(
      focus?.latitude ?? 18,
      GLOBE_MIN_LATITUDE,
      GLOBE_MAX_LATITUDE
    ),
  }
}

function GlobeTrafficMap({ data }: { data: NodeTrafficMapData }) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<GlobeWebGlRenderer | null>(null)
  const frameRef = useRef<number | null>(null)
  const manualRotationRef = useRef(false)
  const [hoveredCode, setHoveredCode] = useState<string | null>(null)
  const [hoveredFlowKey, setHoveredFlowKey] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [webGlError, setWebGlError] = useState(false)
  const [showFlows, setShowFlows] = useState(true)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportCountry, setReportCountry] =
    useState<NodeTrafficMapCountry | null>(null)
  const [flowReportOpen, setFlowReportOpen] = useState(false)
  const [reportFlow, setReportFlow] = useState<NodeTrafficMapFlow | null>(null)
  const windowLabel = getWindowLabel(data.window, data.windowLabel, t)
  const countryByCode = useMemo(() => {
    const map = new Map<string, NodeTrafficMapCountry>()
    for (const country of data.countries) {
      const code = safeCountryCode(country.countryCode)
      if (!code) continue
      const existing = map.get(code)
      if (!existing || country.totalBytes > existing.totalBytes) {
        map.set(code, country)
      }
    }
    return map
  }, [data.countries])
  const parsedCountries = useMemo(() => getParsedWorldCountryShapes(), [])
  const countryShapesByCode = useMemo(() => {
    const map = new Map<string, GlobeCountryShape[]>()
    for (const shape of parsedCountries) {
      if (!shape.code) continue
      const shapes = map.get(shape.code) ?? []
      shapes.push(shape)
      map.set(shape.code, shapes)
    }
    return map
  }, [parsedCountries])
  const flowRenderData = useMemo(
    () => data.flows.map(buildFlowRenderData).filter((item) => item !== null),
    [data.flows]
  )
  const flowByKey = useMemo(() => {
    const map = new Map<string, NodeTrafficMapFlow>()
    for (const flow of data.flows) map.set(flow.key, flow)
    return map
  }, [data.flows])
  const focus = useMemo(() => getInitialGlobeFocus(data), [data])
  const focusRef = useRef(focus)
  const viewRef = useRef<GlobeViewState>({ ...focus, zoom: 1 })
  const countryByCodeRef = useRef(countryByCode)
  const flowRenderDataRef = useRef(flowRenderData)
  const maxCountryBytes = Math.max(
    0,
    ...Array.from(countryByCode.values()).map((country) => country.totalBytes)
  )
  const maxFlowBytes = Math.max(
    0,
    ...flowRenderData.map((flow) => flow.flow.estimatedBytes)
  )
  const maxCountryBytesRef = useRef(maxCountryBytes)
  const maxFlowBytesRef = useRef(maxFlowBytes)
  const hoveredCodeRef = useRef(hoveredCode)
  const hoveredFlowKeyRef = useRef(hoveredFlowKey)
  const showFlowsRef = useRef(showFlows)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startLongitude: number
    startLatitude: number
    countryCode: string | null
    flowKey: string | null
    moved: boolean
  } | null>(null)

  const hoveredFlow = hoveredFlowKey
    ? (flowByKey.get(hoveredFlowKey) ?? null)
    : null
  const hoveredCountry =
    !hoveredFlow && hoveredCode
      ? (countryByCode.get(hoveredCode) ?? null)
      : null
  const locatedPercent = getPercent(data.locatedBytes, data.totalBytes)
  const topCountries = data.countries.slice(0, TRAFFIC_COUNTRY_LIMIT)
  const visibleFlowCount = showFlows ? flowRenderData.length : 0

  const drawGlobe = useCallback(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    renderer.draw({
      view: viewRef.current,
      countryByCode: countryByCodeRef.current,
      maxCountryBytes: maxCountryBytesRef.current,
      flows: showFlowsRef.current ? flowRenderDataRef.current : [],
      maxFlowBytes: maxFlowBytesRef.current,
      hoveredCode: hoveredCodeRef.current,
      hoveredFlowKey: hoveredFlowKeyRef.current,
      dark: document.documentElement.classList.contains("dark"),
    })
  }, [])

  const requestDraw = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      drawGlobe()
    })
  }, [drawGlobe])

  const setHoveredCountryCode = useCallback(
    (code: string | null) => {
      if (hoveredCodeRef.current === code) return
      hoveredCodeRef.current = code
      setHoveredCode(code)
      requestDraw()
    },
    [requestDraw]
  )

  const setHoveredFlow = useCallback(
    (key: string | null) => {
      if (hoveredFlowKeyRef.current === key) return
      hoveredFlowKeyRef.current = key
      setHoveredFlowKey(key)
      requestDraw()
    },
    [requestDraw]
  )

  function openCountry(country: NodeTrafficMapCountry | undefined) {
    if (!country) return
    setReportCountry(country)
    setReportOpen(true)
  }

  function openFlow(flow: NodeTrafficMapFlow | undefined) {
    if (!flow) return
    setReportFlow(flow)
    setFlowReportOpen(true)
  }

  function handleReportOpenChange(open: boolean) {
    setReportOpen(open)
    if (!open) setReportCountry(null)
  }

  function handleFlowReportOpenChange(open: boolean) {
    setFlowReportOpen(open)
    if (!open) setReportFlow(null)
  }

  function resetGlobe() {
    manualRotationRef.current = false
    viewRef.current = { ...focusRef.current, zoom: 1 }
    requestDraw()
  }

  function focusCountry(country: NodeTrafficMapCountry) {
    manualRotationRef.current = true
    viewRef.current = {
      longitude: normalizeLongitude(country.longitude),
      latitude: clamp(country.latitude, GLOBE_MIN_LATITUDE, GLOBE_MAX_LATITUDE),
      zoom: Math.max(viewRef.current.zoom, 1.08),
    }
    setHoveredCountryCode(safeCountryCode(country.countryCode))
    requestDraw()
  }

  function applyZoomDelta(delta: number) {
    viewRef.current = {
      ...viewRef.current,
      zoom: clampGlobeZoom(Number((viewRef.current.zoom + delta).toFixed(2))),
    }
    requestDraw()
  }

  function pickFlowKeyFromPointer(clientX: number, clientY: number) {
    const canvas = canvasRef.current
    if (!canvas || !showFlowsRef.current) return null

    let nearestKey: string | null = null
    let nearestDistance = Number.POSITIVE_INFINITY
    const threshold = GLOBE_FLOW_HIT_RADIUS * GLOBE_FLOW_HIT_RADIUS

    for (const renderFlow of flowRenderDataRef.current) {
      let previous: { x: number; y: number; z: number } | null = null
      for (const sample of renderFlow.samples) {
        const current = projectGlobeVectorToScreen(
          sample,
          canvas,
          viewRef.current
        )
        if (!current) {
          previous = null
          continue
        }
        if (previous) {
          const distance = getDistanceToSegmentSquared(
            clientX,
            clientY,
            previous.x,
            previous.y,
            current.x,
            current.y
          )
          if (distance <= threshold && distance < nearestDistance) {
            nearestDistance = distance
            nearestKey = renderFlow.key
          }
        }
        previous = current
      }
    }

    return nearestKey
  }

  function pickCountryCodeFromPointer(clientX: number, clientY: number) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const mapPoint = screenPointToGlobeMapPoint(
      canvas,
      viewRef.current,
      clientX,
      clientY
    )
    if (!mapPoint) return null

    for (const code of countryByCodeRef.current.keys()) {
      const shapes = countryShapesByCode.get(code)
      if (!shapes) continue
      if (
        shapes.some((shape) =>
          isMapPointInCountryShape(mapPoint.x, mapPoint.y, shape)
        )
      ) {
        return code
      }
    }

    let nearestCode: string | null = null
    let nearestDistance = Number.POSITIVE_INFINITY
    const threshold = GLOBE_HIT_RADIUS * GLOBE_HIT_RADIUS
    for (const [code, country] of countryByCodeRef.current.entries()) {
      const point = projectCountryCenterToScreen(
        country,
        canvas,
        viewRef.current
      )
      if (!point) continue
      const dx = point.x - clientX
      const dy = point.y - clientY
      const distance = dx * dx + dy * dy
      if (distance <= threshold && distance < nearestDistance) {
        nearestDistance = distance
        nearestCode = code
      }
    }
    return nearestCode
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const flowKey = pickFlowKeyFromPointer(event.clientX, event.clientY)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLongitude: viewRef.current.longitude,
      startLatitude: viewRef.current.latitude,
      countryCode: flowKey
        ? null
        : pickCountryCodeFromPointer(event.clientX, event.clientY),
      flowKey,
      moved: false,
    }
    setDragging(true)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = dragRef.current
    if (!current || current.pointerId !== event.pointerId) {
      const flowKey = pickFlowKeyFromPointer(event.clientX, event.clientY)
      setHoveredFlow(flowKey)
      setHoveredCountryCode(
        flowKey
          ? null
          : pickCountryCodeFromPointer(event.clientX, event.clientY)
      )
      return
    }

    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) current.moved = true
    if (!current.moved) return
    manualRotationRef.current = true
    setHoveredFlow(null)
    setHoveredCountryCode(null)
    viewRef.current = {
      longitude: normalizeLongitude(
        current.startLongitude - dx * (0.34 / viewRef.current.zoom)
      ),
      latitude: clamp(
        current.startLatitude + dy * (0.24 / viewRef.current.zoom),
        GLOBE_MIN_LATITUDE,
        GLOBE_MAX_LATITUDE
      ),
      zoom: viewRef.current.zoom,
    }
    requestDraw()
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    const current = dragRef.current
    if (current?.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!current.moved) {
      const flowKey =
        current.flowKey ?? pickFlowKeyFromPointer(event.clientX, event.clientY)
      if (flowKey) {
        openFlow(flowByKey.get(flowKey))
      } else {
        const code =
          current.countryCode ??
          pickCountryCodeFromPointer(event.clientX, event.clientY)
        if (code) openCountry(countryByCodeRef.current.get(code))
      }
    }
    dragRef.current = null
    setDragging(false)
  }

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    function handleNativeWheel(event: globalThis.WheelEvent) {
      event.preventDefault()
      viewRef.current = {
        ...viewRef.current,
        zoom: clampGlobeZoom(
          Number(
            (viewRef.current.zoom + (event.deltaY > 0 ? -0.08 : 0.08)).toFixed(
              2
            )
          )
        ),
      }
      requestDraw()
    }

    element.addEventListener("wheel", handleNativeWheel, { passive: false })
    return () => element.removeEventListener("wheel", handleNativeWheel)
  }, [requestDraw])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    try {
      const renderer = new GlobeWebGlRenderer(canvas, buildGlobeMesh())
      rendererRef.current = renderer
      requestDraw()
    } catch {
      rendererRef.current = null
      window.requestAnimationFrame(() => setWebGlError(true))
      return
    }

    const canvasElement = canvas
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => requestDraw())
    resizeObserver?.observe(canvasElement)

    const mutationObserver = new MutationObserver(() => requestDraw())
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    function handleContextLost(event: Event) {
      event.preventDefault()
      setWebGlError(true)
    }

    canvasElement.addEventListener("webglcontextlost", handleContextLost)

    return () => {
      resizeObserver?.disconnect()
      mutationObserver.disconnect()
      canvasElement.removeEventListener("webglcontextlost", handleContextLost)
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [requestDraw])

  useEffect(() => {
    countryByCodeRef.current = countryByCode
    maxCountryBytesRef.current = maxCountryBytes
    requestDraw()
  }, [countryByCode, maxCountryBytes, requestDraw])

  useEffect(() => {
    flowRenderDataRef.current = flowRenderData
    maxFlowBytesRef.current = maxFlowBytes
    requestDraw()
  }, [flowRenderData, maxFlowBytes, requestDraw])

  useEffect(() => {
    showFlowsRef.current = showFlows
    if (!showFlows) setHoveredFlow(null)
    requestDraw()
  }, [requestDraw, setHoveredFlow, showFlows])

  useEffect(() => {
    focusRef.current = focus
    if (manualRotationRef.current) return
    viewRef.current = { ...viewRef.current, ...focus }
    requestDraw()
  }, [focus, requestDraw])

  useEffect(() => {
    hoveredCodeRef.current = hoveredCode
    requestDraw()
  }, [hoveredCode, requestDraw])

  useEffect(() => {
    hoveredFlowKeyRef.current = hoveredFlowKey
    requestDraw()
  }, [hoveredFlowKey, requestDraw])

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false
      return Boolean(
        target.closest("input, textarea, select, [contenteditable='true']")
      )
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (isEditableTarget(event.target)) return
      if (event.ctrlKey || event.metaKey) {
        if (event.key === "-" || event.key === "_") {
          event.preventDefault()
          viewRef.current = {
            ...viewRef.current,
            zoom: clampGlobeZoom(
              Number((viewRef.current.zoom - 0.08).toFixed(2))
            ),
          }
          requestDraw()
          return
        }
        if (event.key === "+" || event.key === "=") {
          event.preventDefault()
          viewRef.current = {
            ...viewRef.current,
            zoom: clampGlobeZoom(
              Number((viewRef.current.zoom + 0.08).toFixed(2))
            ),
          }
          requestDraw()
          return
        }
        if (event.key === "0") {
          event.preventDefault()
          manualRotationRef.current = false
          viewRef.current = { ...focusRef.current, zoom: 1 }
          requestDraw()
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [requestDraw])

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
      }
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-[calc(100svh-3rem)] touch-none overflow-hidden bg-background select-none",
        dragging ? "cursor-grabbing" : "cursor-grab"
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={() => {
        setHoveredFlow(null)
        setHoveredCountryCode(null)
      }}
    >
      <CountryTrafficReportSheet
        country={reportCountry}
        data={data}
        open={reportOpen}
        onOpenChange={handleReportOpenChange}
      />
      <FlowTrafficReportSheet
        flow={reportFlow}
        open={flowReportOpen}
        onOpenChange={handleFlowReportOpenChange}
      />

      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t("routing.trafficMap.webglAria")}
        className="absolute inset-0 h-full w-full"
      />

      {webGlError ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="max-w-sm rounded-lg border bg-background/95 px-4 py-3 text-center text-sm shadow-sm">
            {t("routing.trafficMap.webglUnsupported")}
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute top-4 left-4 z-20 max-w-xl text-foreground">
        <p className="text-xs font-medium tracking-[0.24em] text-muted-foreground uppercase">
          Node Traffic Globe
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">
          {formatBytes(data.totalBytes)}
        </h1>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground sm:text-sm">
          <span>{windowLabel}</span>
          <span>
            {t("routing.common.tx")} {formatBytes(data.totalTxBytes)}
          </span>
          <span>
            {t("routing.common.rx")} {formatBytes(data.totalRxBytes)}
          </span>
          <span>
            {t("routing.trafficMap.locatedBadge", {
              percent: locatedPercent.toFixed(1),
            })}
          </span>
          {data.unknownNodeCount > 0 ? (
            <span>
              {t("routing.trafficMap.unknownNodeCount", {
                count: data.unknownNodeCount,
              })}
            </span>
          ) : null}
          {data.flows.length > 0 ? (
            <span>
              {t("routing.trafficMap.flowCount", {
                visible: visibleFlowCount,
                total: data.flows.length,
              })}
            </span>
          ) : null}
        </div>
      </div>

      {data.flows.length > 0 ? (
        <div
          className="absolute top-4 right-4 z-20 flex items-center gap-2"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Button
            type="button"
            size="sm"
            variant={showFlows ? "default" : "outline"}
            className="rounded-full bg-background/72 px-3 text-xs text-foreground shadow-sm backdrop-blur hover:bg-background"
            onClick={() => setShowFlows((value) => !value)}
          >
            {t("routing.trafficMap.flowArcToggle", {
              state: showFlows
                ? t("routing.trafficMap.flowArcOn")
                : t("routing.trafficMap.flowArcOff"),
            })}
          </Button>
          <Badge className="bg-background/72 text-foreground shadow-sm backdrop-blur">
            {t("routing.trafficMap.estimatedBadge", {
              traffic: formatBytes(data.flowTotalEstimatedBytes),
            })}
          </Badge>
        </div>
      ) : null}

      <FlowHoverPanel flow={hoveredFlow} />
      <HoverPanel
        country={hoveredCountry}
        totalBytes={data.totalBytes}
        positionClassName="bottom-16 left-4 max-w-[calc(100vw-2rem)]"
      />

      {topCountries.length > 0 ? (
        <div
          className="absolute right-4 bottom-4 z-20 flex max-w-[min(72vw,720px)] flex-wrap justify-end gap-2"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {topCountries.map((country) => (
            <Button
              key={country.key}
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 rounded-full bg-background/72 px-3 text-xs shadow-sm backdrop-blur hover:bg-background"
              onClick={() => focusCountry(country)}
            >
              {getCountryDisplayName(
                country.countryCode,
                country.countryName,
                t
              )}
              <span className="ml-1 font-mono text-muted-foreground">
                {formatBytes(country.totalBytes)}
              </span>
            </Button>
          ))}
        </div>
      ) : null}

      <ButtonGroup
        aria-label={t("routing.trafficMap.globeZoomAria")}
        className="absolute bottom-4 left-4 z-20 shadow-sm"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={t("routing.trafficMap.zoomOutGlobe")}
          title={t("routing.subscriptionRules.zoomOut")}
          onClick={() => applyZoomDelta(-0.1)}
        >
          <Minus />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={t("routing.trafficMap.resetGlobe")}
          title={t("routing.subscriptionRules.zoomReset")}
          onClick={resetGlobe}
        >
          <RotateCcw />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={t("routing.trafficMap.zoomInGlobe")}
          title={t("routing.subscriptionRules.zoomIn")}
          onClick={() => applyZoomDelta(0.1)}
        >
          <Plus />
        </Button>
      </ButtonGroup>
    </div>
  )
}

function FlatWorldTrafficMap({
  data,
  large,
  canvas,
}: {
  data: NodeTrafficMapData
  large: boolean
  canvas: boolean
}) {
  const { t } = useI18n()
  const [hoveredCode, setHoveredCode] = useState<string | null>(null)
  const [viewBox, setViewBox] = useState<CanvasViewBox>(DEFAULT_CANVAS_VIEWBOX)
  const [dragging, setDragging] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportCountry, setReportCountry] =
    useState<NodeTrafficMapCountry | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    scale: number
    countryCode: string | null
    moved: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  const countryByCode = useMemo(() => {
    const map = new Map<string, NodeTrafficMapCountry>()
    for (const country of data.countries) {
      const code = safeCountryCode(country.countryCode)
      if (!code) continue
      const existing = map.get(code)
      if (!existing || country.totalBytes > existing.totalBytes) {
        map.set(code, country)
      }
    }
    return map
  }, [data.countries])
  const worldCountryCodes = useMemo(
    () =>
      new Set(
        WORLD_COUNTRY_PATHS.map((country) =>
          safeCountryCode(country.code)
        ).filter((code) => code !== null)
      ),
    []
  )
  const microCountries = useMemo(
    () =>
      Array.from(countryByCode.entries())
        .filter(([code]) => !worldCountryCodes.has(code))
        .map(([, country]) => country),
    [countryByCode, worldCountryCodes]
  )
  const maxCountryBytes = Math.max(
    0,
    ...Array.from(countryByCode.values()).map((country) => country.totalBytes)
  )
  const hoveredCountry = hoveredCode
    ? (countryByCode.get(hoveredCode) ?? null)
    : null

  function openCountry(country: NodeTrafficMapCountry | undefined) {
    if (!country || suppressClickRef.current) return
    setReportCountry(country)
    setReportOpen(true)
  }

  function handleReportOpenChange(open: boolean) {
    setReportOpen(open)
    if (!open) setReportCountry(null)
  }

  const resetViewport = useCallback(() => {
    setViewBox(DEFAULT_CANVAS_VIEWBOX)
  }, [])

  const zoomViewBox = useCallback(
    (
      current: CanvasViewBox,
      nextZoomInput: number,
      origin?: { clientX: number; clientY: number }
    ): CanvasViewBox => {
      const currentZoom = getCanvasZoom(current)
      const nextZoom = clampCanvasZoom(nextZoomInput)
      if (nextZoom === currentZoom) return current

      const nextWidth = MAP_WIDTH / nextZoom
      const nextHeight = MAP_HEIGHT / nextZoom
      const svg = svgRef.current
      if (origin && svg) {
        const point = getSvgPoint(svg, current, origin.clientX, origin.clientY)
        const ratioX = (point.x - current.x) / current.width
        const ratioY = (point.y - current.y) / current.height
        return {
          x: point.x - nextWidth * ratioX,
          y: point.y - nextHeight * ratioY,
          width: nextWidth,
          height: nextHeight,
        }
      }

      const centerX = current.x + current.width / 2
      const centerY = current.y + current.height / 2
      return {
        x: centerX - nextWidth / 2,
        y: centerY - nextHeight / 2,
        width: nextWidth,
        height: nextHeight,
      }
    },
    []
  )

  const applyZoomDelta = useCallback(
    (delta: number, origin?: { clientX: number; clientY: number }) => {
      setViewBox((current) =>
        zoomViewBox(current, getCanvasZoom(current) + delta, origin)
      )
    },
    [zoomViewBox]
  )

  function handleCanvasPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canvas || event.button !== 0 || !svgRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewBox.x,
      originY: viewBox.y,
      scale: getSvgScale(svgRef.current, viewBox),
      countryCode: getTargetCountryCode(event.target),
      moved: false,
    }
    setDragging(true)
  }

  function handleCanvasPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = dragRef.current
    if (!current || current.pointerId !== event.pointerId) return

    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) current.moved = true
    setViewBox((previous) => ({
      ...previous,
      x: current.originX - dx / current.scale,
      y: current.originY - dy / current.scale,
    }))
  }

  function handleCanvasPointerEnd(event: PointerEvent<HTMLDivElement>) {
    const current = dragRef.current
    if (current?.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (current.moved) {
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    } else if (current.countryCode) {
      openCountry(countryByCode.get(current.countryCode))
    }
    dragRef.current = null
    setDragging(false)
  }

  function handleCanvasWheel(event: WheelEvent<HTMLDivElement>) {
    if (!canvas) return
    event.preventDefault()
    applyZoomDelta(event.deltaY > 0 ? -0.12 : 0.12, {
      clientX: event.clientX,
      clientY: event.clientY,
    })
  }

  useEffect(() => {
    if (!canvas) return

    function isEditableTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false
      return Boolean(
        target.closest("input, textarea, select, [contenteditable='true']")
      )
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || isEditableTarget(event.target)) {
        return
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault()
        applyZoomDelta(-0.12)
        return
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault()
        applyZoomDelta(0.12)
        return
      }
      if (event.key === "0") {
        event.preventDefault()
        resetViewport()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [applyZoomDelta, canvas, resetViewport])

  const mapSvg = (
    <svg
      ref={canvas ? svgRef : undefined}
      viewBox={
        canvas ? formatCanvasViewBox(viewBox) : `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`
      }
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={t("routing.trafficMap.heatMapAria")}
      className={cn(
        "block w-full",
        canvas
          ? "absolute inset-0 h-full w-full"
          : large
            ? "h-auto min-h-125 xl:min-h-150"
            : "h-auto min-h-75"
      )}
    >
      {!canvas ? (
        <rect
          width={MAP_WIDTH}
          height={MAP_HEIGHT}
          className="fill-background"
        />
      ) : null}
      <g strokeLinecap="round" strokeLinejoin="round">
        {WORLD_COUNTRY_PATHS.map((path) => {
          const code = safeCountryCode(path.code)
          const country = code ? countryByCode.get(code) : undefined
          const active = Boolean(country)
          const hovered = Boolean(code && code === hoveredCode && active)
          const opacity = country
            ? getHeatOpacity(country.totalBytes, maxCountryBytes)
            : 0.1
          const countryName = country
            ? getCountryDisplayName(country.countryCode, country.countryName, t)
            : path.name

          return (
            <path
              key={`${path.code ?? "unknown"}-${path.name}`}
              d={path.d}
              data-country-code={active ? code : undefined}
              role={active ? "button" : undefined}
              tabIndex={active ? 0 : undefined}
              aria-label={
                country
                  ? t("routing.trafficMap.countryPathAria", {
                      country: countryName,
                      traffic: formatBytes(country.totalBytes),
                    })
                  : countryName
              }
              vectorEffect="non-scaling-stroke"
              className={cn(
                "stroke-border transition-all duration-150 outline-none",
                active
                  ? "cursor-pointer fill-primary stroke-primary/70 hover:stroke-primary focus-visible:stroke-primary"
                  : "fill-muted/35",
                hovered && "stroke-primary"
              )}
              style={{ fillOpacity: active ? opacity : undefined }}
              strokeWidth={hovered ? 1.35 : active ? 0.9 : 0.55}
              onMouseEnter={() => {
                if (code && active) setHoveredCode(code)
              }}
              onMouseLeave={() => {
                if (code && hoveredCode === code) setHoveredCode(null)
              }}
              onFocus={() => {
                if (code && active) setHoveredCode(code)
              }}
              onBlur={() => {
                if (code && hoveredCode === code) setHoveredCode(null)
              }}
              onClick={() => openCountry(country)}
              onKeyDown={(event) => {
                if (!country) return
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  openCountry(country)
                }
              }}
            >
              <title>
                {country
                  ? t("routing.trafficMap.countryPathTitle", {
                      country: countryName,
                      traffic: formatBytes(country.totalBytes),
                      count: country.nodeCount,
                    })
                  : countryName}
              </title>
            </path>
          )
        })}
        {microCountries.map((country) => {
          const code = safeCountryCode(country.countryCode)
          const hovered = Boolean(code && code === hoveredCode)
          const opacity = getHeatOpacity(country.totalBytes, maxCountryBytes)
          const countryName = getCountryDisplayName(
            country.countryCode,
            country.countryName,
            t
          )

          return (
            <path
              key={`micro-${country.key}`}
              d={getMicroCountryPath(country)}
              data-country-code={code ?? undefined}
              role="button"
              tabIndex={0}
              aria-label={t("routing.trafficMap.countryPathAria", {
                country: countryName,
                traffic: formatBytes(country.totalBytes),
              })}
              vectorEffect="non-scaling-stroke"
              className={cn(
                "cursor-pointer fill-primary stroke-primary transition-all duration-150 outline-none hover:stroke-primary focus-visible:stroke-primary",
                hovered && "stroke-primary"
              )}
              style={{ fillOpacity: opacity }}
              strokeWidth={hovered ? 1.6 : 1}
              onMouseEnter={() => {
                if (code) setHoveredCode(code)
              }}
              onMouseLeave={() => {
                if (code && hoveredCode === code) setHoveredCode(null)
              }}
              onFocus={() => {
                if (code) setHoveredCode(code)
              }}
              onBlur={() => {
                if (code && hoveredCode === code) setHoveredCode(null)
              }}
              onClick={() => openCountry(country)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  openCountry(country)
                }
              }}
            >
              <title>
                {t("routing.trafficMap.countryPathTitle", {
                  country: countryName,
                  traffic: formatBytes(country.totalBytes),
                  count: country.nodeCount,
                })}
              </title>
            </path>
          )
        })}
      </g>
    </svg>
  )

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-background",
        canvas
          ? dragging
            ? "h-[calc(100svh-3rem)] cursor-grabbing touch-none select-none"
            : "h-[calc(100svh-3rem)] cursor-grab touch-none select-none"
          : "rounded-xl border"
      )}
      onPointerDown={canvas ? handleCanvasPointerDown : undefined}
      onPointerMove={canvas ? handleCanvasPointerMove : undefined}
      onPointerUp={canvas ? handleCanvasPointerEnd : undefined}
      onPointerCancel={canvas ? handleCanvasPointerEnd : undefined}
      onWheel={canvas ? handleCanvasWheel : undefined}
    >
      <CountryTrafficReportSheet
        country={reportCountry}
        data={data}
        open={reportOpen}
        onOpenChange={handleReportOpenChange}
      />

      {canvas ? (
        <>
          {mapSvg}
          <HoverPanel country={hoveredCountry} totalBytes={data.totalBytes} />
          {data.countries.length === 0 ? (
            <EmptyHint geoipEnabled={data.geoipEnabled} />
          ) : null}
          <ButtonGroup
            aria-label={t("routing.trafficMap.mapZoomAria")}
            className="absolute bottom-3 left-3 z-20 shadow-sm"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t("routing.trafficMap.zoomOutMap")}
              title={t("routing.subscriptionRules.zoomOut")}
              onClick={() => applyZoomDelta(-0.16)}
            >
              <Minus />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t("routing.trafficMap.resetMap")}
              title={t("routing.subscriptionRules.zoomReset")}
              onClick={resetViewport}
            >
              <RotateCcw />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t("routing.trafficMap.zoomInMap")}
              title={t("routing.subscriptionRules.zoomIn")}
              onClick={() => applyZoomDelta(0.16)}
            >
              <Plus />
            </Button>
          </ButtonGroup>
        </>
      ) : (
        <>
          <HoverPanel country={hoveredCountry} totalBytes={data.totalBytes} />
          {data.countries.length === 0 ? (
            <EmptyHint geoipEnabled={data.geoipEnabled} />
          ) : null}
          {mapSvg}
        </>
      )}
    </div>
  )
}

function WorldTrafficMap({
  data,
  large,
  canvas,
}: {
  data: NodeTrafficMapData
  large: boolean
  canvas: boolean
}) {
  if (canvas) return <GlobeTrafficMap data={data} />
  return <FlatWorldTrafficMap data={data} large={large} canvas={false} />
}

export function NodeTrafficWorldMap({
  data,
  variant = "compact",
}: {
  data: NodeTrafficMapData
  variant?: "compact" | "large" | "canvas"
}) {
  const { t } = useI18n()
  const locatedPercent = getPercent(data.locatedBytes, data.totalBytes)
  const topCountries = data.countries.slice(0, TRAFFIC_COUNTRY_LIMIT)
  const large = variant === "large" || variant === "canvas"
  const canvas = variant === "canvas"
  const windowLabel = getWindowLabel(data.window, data.windowLabel, t)

  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-base font-semibold">
          {t("routing.trafficMap.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("routing.trafficMap.description", { window: windowLabel })}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge>
          {t("routing.trafficMap.totalBadge", {
            traffic: formatBytes(data.totalBytes),
          })}
        </Badge>
        <Badge>
          {t("routing.trafficMap.locatedBadge", {
            percent: locatedPercent.toFixed(1),
          })}
        </Badge>
        {data.unknownNodeCount > 0 ? (
          <Badge>
            {t("routing.trafficMap.unlocatedBadge", {
              count: data.unknownNodeCount,
            })}
          </Badge>
        ) : null}
      </div>
    </div>
  )
  const geoWarning = !data.geoipEnabled ? (
    <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      {t("routing.trafficMap.geoipWarning")}
    </div>
  ) : null
  const stats = large ? (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-lg bg-background/80 p-4 shadow-sm backdrop-blur">
        <p className="text-xs text-muted-foreground">
          {t("routing.trafficMap.windowTotalTraffic")}
        </p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">
          {formatBytes(data.totalBytes)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("routing.trafficMap.txRxSummary", {
            tx: formatBytes(data.totalTxBytes),
            rx: formatBytes(data.totalRxBytes),
          })}
        </p>
      </div>
      <div className="rounded-lg bg-background/80 p-4 shadow-sm backdrop-blur">
        <p className="text-xs text-muted-foreground">
          {t("routing.trafficMap.locatedTraffic")}
        </p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">
          {formatBytes(data.locatedBytes)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("routing.trafficMap.locatedTrafficHint", {
            percent: locatedPercent.toFixed(1),
          })}
        </p>
      </div>
      <div className="rounded-lg bg-background/80 p-4 shadow-sm backdrop-blur">
        <p className="text-xs text-muted-foreground">
          {t("routing.trafficMap.unlocatedTraffic")}
        </p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">
          {formatBytes(data.unknownBytes)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("routing.trafficMap.unlocatedTrafficHint", {
            count: data.unknownNodeCount,
          })}
        </p>
      </div>
      <div className="rounded-lg bg-background/80 p-4 shadow-sm backdrop-blur">
        <p className="text-xs text-muted-foreground">
          {t("routing.trafficMap.regionsAndNodes")}
        </p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">
          {data.countries.length}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("routing.trafficMap.locatedNodesHint", {
            located: data.locatedNodeCount,
            total: data.nodeCount,
          })}
        </p>
      </div>
    </div>
  ) : null
  const map = <WorldTrafficMap data={data} large={large} canvas={canvas} />
  const footer = (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground lg:flex-row lg:items-center lg:justify-between">
      <p>{t("routing.trafficMap.footerHint")}</p>
      {topCountries.length > 0 ? (
        <p className="truncate">
          {t("routing.trafficMap.topPrefix")}
          {topCountries
            .map(
              (country) =>
                `${getCountryDisplayName(country.countryCode, country.countryName, t)} ${formatBytes(country.totalBytes)}`
            )
            .join(" · ")}
        </p>
      ) : null}
    </div>
  )

  if (canvas) {
    return map
  }

  return (
    <Card
      className={cn("overflow-hidden border-border/70", large && "shadow-sm")}
    >
      <CardContent className="space-y-3 p-4">
        {header}
        {geoWarning}
        {stats}
        {map}
        {footer}
      </CardContent>
    </Card>
  )
}
