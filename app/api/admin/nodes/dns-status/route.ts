import { promises as dnsPromises } from "node:dns"
import { isIPv4, isIPv6 } from "node:net"

import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"

// GET /api/admin/nodes/dns-status
// 返回每个节点的 DNS 解析状态，前端独立调用，不阻塞节点列表加载
export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const db = getDb()
  const rows = db
    .prepare(`SELECT id, ip, node_ip FROM nodes`)
    .all() as Array<{ id: number; ip: string; node_ip: string | null }>

  // 并行检查所有节点的 DNS 解析状态
  const results = await Promise.all(
    rows.map(async (row) => {
      // ip 是 IP 地址或未设置 node_ip → 跳过
      if (!row.node_ip || isIPv4(row.ip) || isIPv6(row.ip)) {
        return { id: row.id, dns_status: "skip" as const }
      }

      try {
        const isV6 = isIPv6(row.node_ip)
        const records = await Promise.race([
          isV6
            ? dnsPromises.resolve6(row.ip)
            : dnsPromises.resolve4(row.ip),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 3000)
          ),
        ])
        return {
          id: row.id,
          dns_status: records.includes(row.node_ip)
            ? ("match" as const)
            : ("mismatch" as const),
        }
      } catch {
        return { id: row.id, dns_status: "unresolved" as const }
      }
    })
  )

  // 以 id 为 key 返回，方便前端合并
  const statusMap: Record<number, string> = {}
  for (const r of results) {
    statusMap[r.id] = r.dns_status
  }

  return NextResponse.json({ ok: true, data: statusMap })
}
