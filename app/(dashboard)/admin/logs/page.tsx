"use client"

import { FormEvent, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"

type LogRow = {
  id: number
  created_at: string
  node_id: number | null
  node_name: string | null
  user_id: number | null
  username: string | null
  ip: string | null
  success: 0 | 1
  reason: string | null
}

type SuccessFilter = "all" | "1" | "0"

const reasonLabel: Record<string, string> = {
  OK: "成功",
  NO_NODE: "节点无效",
  NO_USER: "账号不存在",
  USER_DISABLED: "账号已禁用",
  NO_SUB: "无可用订阅",
  TRAFFIC_EXCEEDED: "流量耗尽",
  BAD_PAYLOAD: "参数非法",
}

export default function AdminLogsPage() {
  const [rows, setRows] = useState<LogRow[]>([])
  const [username, setUsername] = useState("")
  const [nodeName, setNodeName] = useState("")
  const [successFilter, setSuccessFilter] = useState<SuccessFilter>("all")

  async function load(filter: SuccessFilter = successFilter, u = username, n = nodeName) {
    const params = new URLSearchParams()
    if (filter !== "all") params.set("success", filter)
    if (u.trim()) params.set("username", u.trim())
    if (n.trim()) params.set("nodeName", n.trim())

    const query = params.toString()
    const response = await fetch(`/api/admin/auth-logs${query ? `?${query}` : ""}`)
    const json = await response.json()
    if (json?.ok) setRows(json.data)
  }

  useEffect(() => {
    let mounted = true

    void (async () => {
      const response = await fetch("/api/admin/auth-logs")
      const json = await response.json()
      if (mounted && json?.ok) setRows(json.data)
    })()

    return () => {
      mounted = false
    }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await load()
  }

  async function switchFilter(next: SuccessFilter) {
    setSuccessFilter(next)
    await load(next)
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>日志查询</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="mb-4 grid gap-3 md:grid-cols-4" onSubmit={submit}>
            <div className="space-y-1">
              <Label>账号</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="用户名" />
            </div>
            <div className="space-y-1">
              <Label>节点</Label>
              <Input value={nodeName} onChange={(e) => setNodeName(e.target.value)} placeholder="节点名" />
            </div>
            <div className="space-y-1">
              <Label>结果</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={successFilter === "all" ? "default" : "outline"}
                  onClick={() => void switchFilter("all")}
                >
                  全部
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={successFilter === "1" ? "default" : "outline"}
                  onClick={() => void switchFilter("1")}
                >
                  成功
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={successFilter === "0" ? "default" : "outline"}
                  onClick={() => void switchFilter("0")}
                >
                  失败
                </Button>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit">查询</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setUsername("")
                  setNodeName("")
                  setSuccessFilter("all")
                  void load("all", "", "")
                }}
              >
                重置
              </Button>
            </div>
          </form>

          <Table>
            <THead>
              <TR>
                <TH>时间</TH>
                <TH>节点</TH>
                <TH>账号</TH>
                <TH>IP</TH>
                <TH>结果</TH>
                <TH>原因</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id}>
                  <TD>{new Date(row.created_at.endsWith("Z") ? row.created_at : `${row.created_at}Z`).toLocaleString()}</TD>
                  <TD>{row.node_name ?? "-"}</TD>
                  <TD>{row.username ?? "-"}</TD>
                  <TD className="font-mono text-xs">{row.ip ?? "-"}</TD>
                  <TD>
                    {row.success === 1 ? (
                      <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">成功</Badge>
                    ) : (
                      <Badge className="bg-destructive/15 text-destructive">失败</Badge>
                    )}
                  </TD>
                  <TD className="text-xs">{row.reason ? (reasonLabel[row.reason] ?? row.reason) : "-"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
