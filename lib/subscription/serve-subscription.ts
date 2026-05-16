import { getDb } from "@/lib/db"
import { buildHysteriaUri, type NodeForUri } from "@/lib/hysteria-uri"
import { writeEventLog } from "@/lib/logs-db"
import { buildClashConfig } from "@/lib/subscription/build-clash"
import { buildSingboxConfig } from "@/lib/subscription/build-singbox"
import { detectFormat, type SubFormat } from "@/lib/subscription/client-type"
import { getClientIp } from "@/lib/turnstile"

type UserRow = {
  id: number
  username: string
  status: "active" | "disabled"
}

type NodeRow = NodeForUri & {
  id: number
  status: "enabled" | "disabled"
}

type SubscriptionAggregate = {
  used: number
  total: number
  maxExpire: string | null
}

function buildUserInfoHeader(agg: SubscriptionAggregate) {
  const expireTs = agg.maxExpire
    ? Math.floor(new Date(agg.maxExpire).getTime() / 1000)
    : 0
  return `upload=0; download=${agg.used}; total=${agg.total}; expire=${expireTs}`
}

// 订阅 token 脱敏：保留前 4 + … + 后 4，避免完整 token 落进日志里
function maskToken(raw: string): string {
  if (!raw) return ""
  if (raw.length <= 8) return "…"
  return `${raw.slice(0, 4)}…${raw.slice(-4)}`
}

// 把 URL 中出现的订阅 token 替换为脱敏形式，兼容路径和查询参数两种格式
function maskUrl(rawUrl: string, token: string): string {
  let masked = rawUrl
  const replaceToken = (value: string | null) => {
    if (!value) return
    masked = masked.split(value).join(maskToken(value))
  }

  replaceToken(token)

  try {
    const url = new URL(rawUrl)
    replaceToken(url.searchParams.get("token"))
  } catch {
    // rawUrl 不是合法 URL 时保留上面的字符串替换结果
  }

  return masked
}

// 从 X-Forwarded-Host/Proto 还原客户端真实 URL；无代理头时回退 request.url
function getPublicUrl(request: Request): string {
  const url = new URL(request.url)
  const xfp = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
  const xfh = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
  if (xfp && xfh) return `${xfp}://${xfh}${url.pathname}${url.search}`
  return request.url
}

// 订阅拉取日志统一入口：记录 URL、请求头、格式、节点数，方便在事件日志里回溯
function logFetch(params: {
  user: { id: number; username: string } | null
  ip: string | null
  success: boolean
  reason: string
  format: SubFormat | null
  request: Request
  token: string
  nodeCount: number | null
}) {
  const headers = params.request.headers
  const userAgent = headers.get("user-agent")

  const detail: Record<string, unknown> = {
    method: params.request.method,
    url: maskUrl(getPublicUrl(params.request), params.token),
  }
  if (params.format) detail.format = params.format
  if (userAgent) detail.ua = userAgent
  const accept = headers.get("accept")
  if (accept) detail.accept = accept
  const acceptEncoding = headers.get("accept-encoding")
  if (acceptEncoding) detail.accept_encoding = acceptEncoding
  const referer = headers.get("referer")
  if (referer) detail.referer = referer
  if (params.nodeCount !== null) detail.nodes = params.nodeCount

  writeEventLog({
    event: "SUBSCRIPTION_FETCH",
    user_id: params.user?.id ?? null,
    username: params.user?.username ?? null,
    ip: params.ip,
    success: params.success,
    reason: params.reason,
    detail: JSON.stringify(detail),
  })
}

export async function serveSubscription(
  request: Request,
  rawToken: string | null | undefined
) {
  const token = rawToken?.trim() ?? ""
  const ip = getClientIp(request)
  const userAgent = request.headers.get("user-agent")

  if (!token || token.length < 16) {
    logFetch({
      user: null,
      ip,
      success: false,
      reason: "INVALID_TOKEN",
      format: null,
      request,
      token,
      nodeCount: null,
    })
    return new Response("Not Found", { status: 404 })
  }

  const db = getDb()

  const user = db
    .prepare(
      `SELECT id, username, status FROM users WHERE auth_token = ? LIMIT 1`
    )
    .get(token) as UserRow | undefined

  if (!user) {
    logFetch({
      user: null,
      ip,
      success: false,
      reason: "NO_USER",
      format: null,
      request,
      token,
      nodeCount: null,
    })
    return new Response("Not Found", { status: 404 })
  }

  if (user.status !== "active") {
    logFetch({
      user,
      ip,
      success: false,
      reason: "USER_DISABLED",
      format: null,
      request,
      token,
      nodeCount: null,
    })
    return new Response("Not Found", { status: 404 })
  }

  // 所有 active 且未过期的订阅关联的启用节点，按节点聚合
  // 同一节点可能被多个套餐覆盖，限速取"最宽松"：任一套餐 0（不限速）→ 最终 0；否则取 MAX
  const nodes = db
    .prepare(
      `SELECT n.id, n.name, n.ip, n.port, n.port_hopping, n.status, n.sni, n.obfs, n.obfs_password, n.insecure, n.pin_sha256,
              CASE WHEN MIN(p.up_mbps) = 0 THEN 0 ELSE MAX(p.up_mbps) END AS up_mbps,
              CASE WHEN MIN(p.down_mbps) = 0 THEN 0 ELSE MAX(p.down_mbps) END AS down_mbps
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       JOIN plan_nodes pn ON pn.plan_id = p.id
       JOIN nodes n ON n.id = pn.node_id
       WHERE s.user_id = ?
         AND s.status = 'active'
         AND s.expire_time > datetime('now')
         AND n.status = 'enabled'
       GROUP BY n.id
       ORDER BY n.sort_order ASC, n.id ASC`
    )
    .all(user.id) as NodeRow[]

  // 汇总用于 Subscription-Userinfo：所有订阅求和 + 最迟到期
  const aggRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(s.used_traffic_bytes), 0) AS used,
         COALESCE(SUM(p.traffic_limit_bytes), 0) AS total,
         MAX(s.expire_time) AS max_expire
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = ? AND s.status = 'active'`
    )
    .get(user.id) as
    | { used: number; total: number; max_expire: string | null }
    | undefined

  const agg: SubscriptionAggregate = {
    used: aggRow?.used ?? 0,
    total: aggRow?.total ?? 0,
    maxExpire: aggRow?.max_expire ?? null,
  }

  const url = new URL(request.url)
  const format = detectFormat(url, userAgent)

  const commonHeaders: Record<string, string> = {
    "Cache-Control": "no-store",
    "Subscription-Userinfo": buildUserInfoHeader(agg),
    "Profile-Update-Interval": "24",
  }

  // Clash / sing-box 需要至少一个节点，否则 proxy-group / urltest 会解析失败
  if (nodes.length === 0 && (format === "clash" || format === "singbox")) {
    logFetch({
      user,
      ip,
      success: false,
      reason: "NO_NODES",
      format,
      request,
      token,
      nodeCount: 0,
    })
    return new Response("暂无可用节点", { status: 404 })
  }

  if (format === "clash") {
    logFetch({
      user,
      ip,
      success: true,
      reason: "OK",
      format,
      request,
      token,
      nodeCount: nodes.length,
    })
    return new Response(buildClashConfig(token, nodes), {
      status: 200,
      headers: { ...commonHeaders, "Content-Type": "text/yaml; charset=utf-8" },
    })
  }

  if (format === "singbox") {
    logFetch({
      user,
      ip,
      success: true,
      reason: "OK",
      format,
      request,
      token,
      nodeCount: nodes.length,
    })
    return new Response(buildSingboxConfig(token, nodes), {
      status: 200,
      headers: {
        ...commonHeaders,
        "Content-Type": "application/json; charset=utf-8",
      },
    })
  }

  // 默认输出 Hysteria 原生 URI 列表（base64 或明文）
  const plain = nodes.map((node) => buildHysteriaUri(token, node)).join("\n")
  const body =
    format === "plain" ? plain : Buffer.from(plain, "utf8").toString("base64")

  logFetch({
    user,
    ip,
    success: true,
    reason: "OK",
    format,
    request,
    token,
    nodeCount: nodes.length,
  })

  return new Response(body, {
    status: 200,
    headers: { ...commonHeaders, "Content-Type": "text/plain; charset=utf-8" },
  })
}
