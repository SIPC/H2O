const PORT_MIN = 1
const PORT_MAX = 65535

export type PortRange = {
  start: number
  end: number
}

export type PortHoppingParseSuccess = {
  ok: true
  ranges: PortRange[]
  normalized: string | null
  totalPorts: number
}

export type PortHoppingParseFailure = {
  ok: false
  error: string
}

export type PortHoppingParseResult =
  | PortHoppingParseSuccess
  | PortHoppingParseFailure

function parsePort(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const port = Number(value)
  if (!Number.isSafeInteger(port)) return null
  return port
}

function isValidPort(port: number): boolean {
  return port >= PORT_MIN && port <= PORT_MAX
}

function parseToken(rawToken: string): PortRange | null {
  const token = rawToken.replace(/\s+/g, "")
  if (!token) return null

  // 单端口
  if (!token.includes("-")) {
    const port = parsePort(token)
    if (port == null || !isValidPort(port)) return null
    return { start: port, end: port }
  }

  // 端口范围
  const parts = token.split("-")
  if (parts.length !== 2) return null

  const start = parsePort(parts[0] ?? "")
  const end = parsePort(parts[1] ?? "")
  if (start == null || end == null) return null
  if (!isValidPort(start) || !isValidPort(end)) return null
  if (start > end) return null

  return { start, end }
}

function mergeRanges(ranges: PortRange[]): PortRange[] {
  if (ranges.length === 0) return []

  const sorted = [...ranges].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start
    return a.end - b.end
  })

  const merged: PortRange[] = []
  for (const curr of sorted) {
    const last = merged[merged.length - 1]
    if (!last) {
      merged.push({ ...curr })
      continue
    }

    // 重叠或相邻区间合并，得到规范化表达
    if (curr.start <= last.end + 1) {
      if (curr.end > last.end) last.end = curr.end
      continue
    }

    merged.push({ ...curr })
  }

  return merged
}

function countPorts(ranges: PortRange[]): number {
  return ranges.reduce((sum, item) => sum + (item.end - item.start + 1), 0)
}

function stringifyRanges(ranges: PortRange[]): string | null {
  if (ranges.length === 0) return null
  return ranges
    .map((item) =>
      item.start === item.end ? String(item.start) : `${item.start}-${item.end}`
    )
    .join(",")
}

/**
 * 解析并规范化端口跳跃字符串
 * 输入示例：
 * - "443,5000-6000,7000"
 * - "20000-50000"
 */
export function parsePortHopping(
  raw: string | null | undefined
): PortHoppingParseResult {
  const text = raw?.trim() ?? ""
  if (!text) {
    return { ok: true, ranges: [], normalized: null, totalPorts: 0 }
  }

  const tokens = text.split(",").map((v) => v.trim())
  if (tokens.some((v) => v.length === 0)) {
    return { ok: false, error: "端口跳跃格式错误：存在空段" }
  }

  const parsed: PortRange[] = []
  for (const token of tokens) {
    const range = parseToken(token)
    if (!range) {
      return { ok: false, error: `端口跳跃格式错误：${token}` }
    }
    parsed.push(range)
  }

  const merged = mergeRanges(parsed)
  const totalPorts = countPorts(merged)

  // 理论最大不超过 1~65535 全量端口
  if (totalPorts > PORT_MAX) {
    return { ok: false, error: "端口跳跃端口数量超过上限" }
  }

  return {
    ok: true,
    ranges: merged,
    normalized: stringifyRanges(merged),
    totalPorts,
  }
}

/**
 * 严格规范化：非法输入直接抛错，便于上层 API 返回 400
 */
export function normalizePortHopping(raw: string | null | undefined) {
  const parsed = parsePortHopping(raw)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.normalized
}

/**
 * 根据端口跳跃配置构建 Hysteria 地址段
 * - 配置有效：host:443,5000-6000
 * - 配置为空/非法：回退 host:<fallbackPort>
 */
export function buildHysteriaAddress(
  host: string,
  fallbackPort: number,
  portHopping: string | null | undefined
): string {
  const parsed = parsePortHopping(portHopping)
  if (!parsed.ok || !parsed.normalized) return `${host}:${fallbackPort}`
  return `${host}:${parsed.normalized}`
}

/**
 * Clash Meta 的 ports 字段（未配置则返回 undefined）
 */
export function toClashPorts(portHopping: string | null | undefined) {
  const parsed = parsePortHopping(portHopping)
  if (!parsed.ok || !parsed.normalized) return undefined
  return parsed.normalized
}

/**
 * sing-box 的 server_ports 字段（未配置则返回 undefined）
 * sing-box 范围格式使用 "start:end"
 */
export function toSingboxServerPorts(portHopping: string | null | undefined) {
  const parsed = parsePortHopping(portHopping)
  if (!parsed.ok || parsed.ranges.length === 0) return undefined

  return parsed.ranges.map((item) =>
    item.start === item.end ? String(item.start) : `${item.start}:${item.end}`
  )
}

export type UnifiedPortInputSuccess = {
  ok: true
  // 主端口：单端口时就是该端口；端口跳跃时取归一化后的首端口
  port: number
  // 端口跳跃串：单端口为 null，多端口/范围为归一化后的字符串
  portHopping: string | null
  // 是否识别为端口跳跃
  isHopping: boolean
}

export type UnifiedPortInputFailure = {
  ok: false
  error: string
}

export type UnifiedPortInputResult =
  | UnifiedPortInputSuccess
  | UnifiedPortInputFailure

/**
 * 统一端口输入解析：
 * - 输入 "1145" => 单端口
 * - 输入 "1145,1155,1157" / "1145-1155" => 端口跳跃
 */
export function parseUnifiedPortInput(
  raw: string | null | undefined
): UnifiedPortInputResult {
  const text = raw?.trim() ?? ""
  if (!text) {
    return { ok: false, error: "端口不能为空" }
  }

  const parsed = parsePortHopping(text)
  if (!parsed.ok) {
    return { ok: false, error: parsed.error }
  }

  const first = parsed.ranges[0]
  if (!first) {
    return { ok: false, error: "端口不能为空" }
  }

  const isSingle = parsed.ranges.length === 1 && first.start === first.end
  if (isSingle) {
    return {
      ok: true,
      port: first.start,
      portHopping: null,
      isHopping: false,
    }
  }

  return {
    ok: true,
    port: first.start,
    portHopping: parsed.normalized,
    isHopping: true,
  }
}
