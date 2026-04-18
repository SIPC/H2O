import { getDb } from "@/lib/db"
import { buildHysteriaUri, type NodeForUri } from "@/lib/hysteria-uri"

type UserRow = {
  id: number
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  if (!token || token.length < 16) {
    return new Response("Not Found", { status: 404 })
  }

  const db = getDb()

  const user = db
    .prepare(`SELECT id, status FROM users WHERE auth_token = ? LIMIT 1`)
    .get(token) as UserRow | undefined

  if (!user || user.status !== "active") {
    return new Response("Not Found", { status: 404 })
  }

  // 所有 active 且未过期的订阅关联的启用节点，去重
  const nodes = db
    .prepare(
      `SELECT DISTINCT n.id, n.name, n.ip, n.port, n.status, n.sni, n.obfs, n.obfs_password, n.insecure, n.pin_sha256
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       JOIN plan_nodes pn ON pn.plan_id = p.id
       JOIN nodes n ON n.id = pn.node_id
       WHERE s.user_id = ?
         AND s.status = 'active'
         AND s.expire_time > datetime('now')
         AND n.status = 'enabled'
       ORDER BY n.id ASC`
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

  const lines = nodes.map((node) => buildHysteriaUri(token, node))
  const plain = lines.join("\n")

  const url = new URL(request.url)
  const format = url.searchParams.get("format")
  const body =
    format === "plain" ? plain : Buffer.from(plain, "utf8").toString("base64")

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Subscription-Userinfo": buildUserInfoHeader(agg),
      "Profile-Update-Interval": "24",
    },
  })
}
