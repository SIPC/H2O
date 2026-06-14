import { localizedJson } from "@/lib/i18n/api-response"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"

type RollingRow = {
  subscription_id: number
  idx: number
  bucket_date: string
  bucket_hour: number
  tx_bytes: number | null
  rx_bytes: number | null
}

type HourPoint = {
  index: number
  bucketDate: string
  hour: number
  label: string
  txBytes: number
  rxBytes: number
}

const MAX_IDS = 200

function parseIds(raw: string | null): number[] | null {
  if (!raw) return null

  const uniq = new Set<number>()
  for (const part of raw.split(",")) {
    const n = Number(part.trim())
    if (!Number.isInteger(n) || n <= 0) return null
    uniq.add(n)
  }

  const ids = Array.from(uniq)
  if (ids.length === 0 || ids.length > MAX_IDS) return null
  return ids
}

// 兜底：构造一个“滚动 24 小时”空序列（仅在极端异常时使用）
function buildFallbackRolling(): HourPoint[] {
  const out: HourPoint[] = []
  const now = new Date()

  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getTime() - (23 - i) * 3600 * 1000)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    const hour = d.getHours()

    out.push({
      index: i,
      bucketDate: `${year}-${month}-${day}`,
      hour,
      label: String(hour).padStart(2, "0"),
      txBytes: 0,
      rxBytes: 0,
    })
  }

  return out
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  // ids: 逗号分隔的订阅 ID 列表，如 ?ids=12,13,22
  const ids = parseIds(url.searchParams.get("ids"))

  if (!ids) {
    return localizedJson(
      request,
      {
        ok: false,
        error: {
          code: "INVALID_PAYLOAD",
          message: `ids 参数不合法（1~${MAX_IDS} 个正整数）`,
        },
      },
      { status: 400 }
    )
  }

  const db = getDb()

  const nowRow = db
    .prepare(
      `SELECT
         date('now', 'localtime') AS local_date,
         CAST(strftime('%H', 'now', 'localtime') AS INTEGER) AS local_hour`
    )
    .get() as { local_date: string; local_hour: number } | undefined

  const localDate = nowRow?.local_date ?? ""
  const localHour =
    typeof nowRow?.local_hour === "number" && Number.isFinite(nowRow.local_hour)
      ? Math.min(23, Math.max(0, Math.floor(nowRow.local_hour)))
      : 0

  const valuesSql = ids.map(() => "(?)").join(", ")

  // 对每个订阅返回“滚动 24 小时”序列：从最早到最新，跨天自动衔接
  const rows = db
    .prepare(
      `WITH RECURSIVE seq(i) AS (
         SELECT 0
         UNION ALL
         SELECT i + 1 FROM seq WHERE i < 23
       ),
       sub_ids(id) AS (
         VALUES ${valuesSql}
       )
       SELECT
         sub_ids.id AS subscription_id,
         seq.i AS idx,
         date('now', 'localtime', printf('-%d hours', 23 - seq.i)) AS bucket_date,
         CAST(
           strftime('%H', 'now', 'localtime', printf('-%d hours', 23 - seq.i))
           AS INTEGER
         ) AS bucket_hour,
         sht.tx_bytes AS tx_bytes,
         sht.rx_bytes AS rx_bytes
       FROM sub_ids
       CROSS JOIN seq
       LEFT JOIN subscription_hourly_traffic sht
         ON sht.subscription_id = sub_ids.id
        AND sht.bucket_date = date('now', 'localtime', printf('-%d hours', 23 - seq.i))
        AND sht.bucket_hour = CAST(
          strftime('%H', 'now', 'localtime', printf('-%d hours', 23 - seq.i))
          AS INTEGER
        )
       ORDER BY sub_ids.id ASC, seq.i ASC`
    )
    .all(...ids) as RollingRow[]

  const hourlyById = new Map<number, HourPoint[]>()
  for (const id of ids) hourlyById.set(id, [])

  for (const row of rows) {
    const hourly = hourlyById.get(row.subscription_id)
    if (!hourly) continue

    const hour =
      typeof row.bucket_hour === "number" && Number.isFinite(row.bucket_hour)
        ? Math.min(23, Math.max(0, Math.floor(row.bucket_hour)))
        : 0

    const idx =
      typeof row.idx === "number" && Number.isFinite(row.idx)
        ? Math.min(23, Math.max(0, Math.floor(row.idx)))
        : 0

    const txBytes =
      typeof row.tx_bytes === "number" && Number.isFinite(row.tx_bytes)
        ? Math.max(0, Math.floor(row.tx_bytes))
        : 0
    const rxBytes =
      typeof row.rx_bytes === "number" && Number.isFinite(row.rx_bytes)
        ? Math.max(0, Math.floor(row.rx_bytes))
        : 0

    hourly.push({
      index: idx,
      bucketDate: row.bucket_date ?? "",
      hour,
      label: String(hour).padStart(2, "0"),
      txBytes,
      rxBytes,
    })
  }

  const items = ids.map((subscriptionId) => {
    const hourly = hourlyById.get(subscriptionId) ?? []
    const safeHourly = hourly.length === 24 ? hourly : buildFallbackRolling()

    const todayTxBytes = safeHourly.reduce((sum, p) => sum + p.txBytes, 0)
    const todayRxBytes = safeHourly.reduce((sum, p) => sum + p.rxBytes, 0)

    return {
      subscriptionId,
      todayTxBytes,
      todayRxBytes,
      hourly: safeHourly,
    }
  })

  return localizedJson(request, {
    ok: true,
    data: {
      date: localDate,
      localHour,
      // 兼容旧前端：旧逻辑按 currentLocalHour 截断；固定 23 表示“显示完整滚动 24 点”
      currentLocalHour: 23,
      currentRollingIndex: 23,
      windowHours: 24,
      items,
    },
  })
}
