import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"

type DailyRow = {
  bucket_date: string
  tx_bytes: number | null
  rx_bytes: number | null
}

type NodeRow = {
  node_id: number
  node_name: string
  tx_bytes: number | null
  rx_bytes: number | null
}

type UserRow = {
  user_id: number
  username: string
  tx_bytes: number | null
  rx_bytes: number | null
}

type DailyNodeRow = {
  node_id: number
  node_name: string
  bucket_date: string
  tx_bytes: number | null
  rx_bytes: number | null
}

// 校验日期格式 YYYY-MM-DD
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00`).getTime())
}

// 获取最近 N 天的日期字符串
function recentDate(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function todayDate(): string {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const fromParam = url.searchParams.get("from")?.trim() ?? ""
  const toParam = url.searchParams.get("to")?.trim() ?? ""

  // 默认最近 7 天
  const fromDate = fromParam && isValidDate(fromParam) ? fromParam : recentDate(6)
  const toDate = toParam && isValidDate(toParam) ? toParam : todayDate()

  if (fromDate > toDate) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: "起始日期不能晚于结束日期" },
      },
      { status: 400 }
    )
  }

  const db = getDb()

  // 1. 全局每日流量趋势
  const dailyRows = db
    .prepare(
      `SELECT bucket_date,
              COALESCE(SUM(tx_bytes), 0) AS tx_bytes,
              COALESCE(SUM(rx_bytes), 0) AS rx_bytes
       FROM traffic_hourly_stats
       WHERE bucket_date BETWEEN ? AND ?
       GROUP BY bucket_date
       ORDER BY bucket_date ASC`
    )
    .all(fromDate, toDate) as DailyRow[]

  const daily = dailyRows.map((row) => ({
    date: row.bucket_date,
    txBytes: Math.max(0, Math.floor(row.tx_bytes ?? 0)),
    rxBytes: Math.max(0, Math.floor(row.rx_bytes ?? 0)),
    totalBytes:
      Math.max(0, Math.floor(row.tx_bytes ?? 0)) +
      Math.max(0, Math.floor(row.rx_bytes ?? 0)),
  }))

  // 2. 按节点汇总
  const nodeRows = db
    .prepare(
      `SELECT nht.node_id, n.name AS node_name,
              COALESCE(SUM(nht.tx_bytes), 0) AS tx_bytes,
              COALESCE(SUM(nht.rx_bytes), 0) AS rx_bytes
       FROM node_hourly_traffic nht
       JOIN nodes n ON n.id = nht.node_id
       WHERE nht.bucket_date BETWEEN ? AND ?
       GROUP BY nht.node_id
       ORDER BY (COALESCE(SUM(nht.tx_bytes), 0) + COALESCE(SUM(nht.rx_bytes), 0)) DESC`
    )
    .all(fromDate, toDate) as NodeRow[]

  const byNode = nodeRows.map((row) => ({
    nodeId: row.node_id,
    nodeName: row.node_name,
    txBytes: Math.max(0, Math.floor(row.tx_bytes ?? 0)),
    rxBytes: Math.max(0, Math.floor(row.rx_bytes ?? 0)),
    totalBytes:
      Math.max(0, Math.floor(row.tx_bytes ?? 0)) +
      Math.max(0, Math.floor(row.rx_bytes ?? 0)),
  }))

  // 3. 按用户汇总（通过订阅小时流量聚合）
  const userRows = db
    .prepare(
      `SELECT u.id AS user_id, u.username,
              COALESCE(SUM(sht.tx_bytes), 0) AS tx_bytes,
              COALESCE(SUM(sht.rx_bytes), 0) AS rx_bytes
       FROM subscription_hourly_traffic sht
       JOIN subscriptions s ON s.id = sht.subscription_id
       JOIN users u ON u.id = s.user_id
       WHERE sht.bucket_date BETWEEN ? AND ?
       GROUP BY u.id
       ORDER BY (COALESCE(SUM(sht.tx_bytes), 0) + COALESCE(SUM(sht.rx_bytes), 0)) DESC`
    )
    .all(fromDate, toDate) as UserRow[]

  const byUser = userRows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    txBytes: Math.max(0, Math.floor(row.tx_bytes ?? 0)),
    rxBytes: Math.max(0, Math.floor(row.rx_bytes ?? 0)),
    totalBytes:
      Math.max(0, Math.floor(row.tx_bytes ?? 0)) +
      Math.max(0, Math.floor(row.rx_bytes ?? 0)),
  }))

  // 4. 每日按节点拆分（多折线图数据）
  const dailyNodeRows = db
    .prepare(
      `SELECT nht.node_id, n.name AS node_name, nht.bucket_date,
              COALESCE(SUM(nht.tx_bytes), 0) AS tx_bytes,
              COALESCE(SUM(nht.rx_bytes), 0) AS rx_bytes
       FROM node_hourly_traffic nht
       JOIN nodes n ON n.id = nht.node_id
       WHERE nht.bucket_date BETWEEN ? AND ?
       GROUP BY nht.node_id, nht.bucket_date
       ORDER BY nht.bucket_date ASC, nht.node_id ASC`
    )
    .all(fromDate, toDate) as DailyNodeRow[]

  const dailyByNode = dailyNodeRows.map((row) => ({
    nodeId: row.node_id,
    nodeName: row.node_name,
    date: row.bucket_date,
    txBytes: Math.max(0, Math.floor(row.tx_bytes ?? 0)),
    rxBytes: Math.max(0, Math.floor(row.rx_bytes ?? 0)),
    totalBytes:
      Math.max(0, Math.floor(row.tx_bytes ?? 0)) +
      Math.max(0, Math.floor(row.rx_bytes ?? 0)),
  }))

  // 汇总
  let totalTxBytes = 0
  let totalRxBytes = 0
  for (const d of daily) {
    totalTxBytes += d.txBytes
    totalRxBytes += d.rxBytes
  }

  return NextResponse.json({
    ok: true,
    data: {
      from: fromDate,
      to: toDate,
      totalTxBytes,
      totalRxBytes,
      totalBytes: totalTxBytes + totalRxBytes,
      daily,
      byNode,
      byUser,
      dailyByNode,
    },
  })
}
