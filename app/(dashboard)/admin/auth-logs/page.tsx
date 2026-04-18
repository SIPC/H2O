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

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

export default function AdminLogsPage() {
  const [rows, setRows] = useState<LogRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [username, setUsername] = useState("")
  const [nodeName, setNodeName] = useState("")
  const [successFilter, setSuccessFilter] = useState<SuccessFilter>("all")

  // 统一的加载函数：筛选 + 分页都走这个入口
  async function load(
    opts: {
      page?: number
      pageSize?: number
      filter?: SuccessFilter
      username?: string
      nodeName?: string
    } = {}
  ) {
    const nextPage = opts.page ?? page
    const nextPageSize = opts.pageSize ?? pageSize
    const nextFilter = opts.filter ?? successFilter
    const nextUsername = opts.username ?? username
    const nextNodeName = opts.nodeName ?? nodeName

    const params = new URLSearchParams()
    if (nextFilter !== "all") params.set("success", nextFilter)
    if (nextUsername.trim()) params.set("username", nextUsername.trim())
    if (nextNodeName.trim()) params.set("nodeName", nextNodeName.trim())
    params.set("page", String(nextPage))
    params.set("pageSize", String(nextPageSize))

    const response = await fetch(`/api/admin/auth-logs?${params.toString()}`)
    const json = await response.json()
    if (!json?.ok) return

    setRows(json.data.rows)
    setTotal(json.data.total)
    setPage(json.data.page)
    setPageSize(json.data.pageSize)
  }

  useEffect(() => {
    let mounted = true

    void (async () => {
      const params = new URLSearchParams({ page: "1", pageSize: "50" })
      const response = await fetch(`/api/admin/auth-logs?${params.toString()}`)
      const json = await response.json()
      if (mounted && json?.ok) {
        setRows(json.data.rows)
        setTotal(json.data.total)
        setPage(json.data.page)
        setPageSize(json.data.pageSize)
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // 筛选条件变更回到第 1 页
    await load({ page: 1 })
  }

  async function switchFilter(next: SuccessFilter) {
    setSuccessFilter(next)
    await load({ page: 1, filter: next })
  }

  async function changePage(next: number) {
    await load({ page: next })
  }

  async function changePageSize(next: number) {
    await load({ page: 1, pageSize: next })
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(total, page * pageSize)

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>认证日志</CardTitle>
          <p className="text-xs text-muted-foreground">
            Hysteria2 节点 HTTP 认证回调记录；登录 / 注册 / 轮换 Key 等业务事件请查看「事件日志」。
          </p>
        </CardHeader>
        <CardContent>
          <form className="mb-4 grid gap-3 md:grid-cols-4" onSubmit={submit}>
            <div className="space-y-1">
              <Label>账号</Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="用户名"
              />
            </div>
            <div className="space-y-1">
              <Label>节点</Label>
              <Input
                value={nodeName}
                onChange={(e) => setNodeName(e.target.value)}
                placeholder="节点名"
              />
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
                  void load({
                    page: 1,
                    filter: "all",
                    username: "",
                    nodeName: "",
                  })
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
                  <TD>
                    {new Date(
                      row.created_at.endsWith("Z")
                        ? row.created_at
                        : `${row.created_at}Z`
                    ).toLocaleString()}
                  </TD>
                  <TD>{row.node_name ?? "-"}</TD>
                  <TD>{row.username ?? "-"}</TD>
                  <TD className="font-mono text-xs">{row.ip ?? "-"}</TD>
                  <TD>
                    {row.success === 1 ? (
                      <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        成功
                      </Badge>
                    ) : (
                      <Badge className="bg-destructive/15 text-destructive">
                        失败
                      </Badge>
                    )}
                  </TD>
                  <TD className="text-xs">
                    {row.reason ? (reasonLabel[row.reason] ?? row.reason) : "-"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-3 text-muted-foreground">
              <span>
                共 {total} 条
                {total > 0 ? `，当前 ${rangeStart}–${rangeEnd}` : ""}
              </span>
              <span className="flex items-center gap-1">
                每页
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <Button
                    key={size}
                    type="button"
                    size="xs"
                    variant={pageSize === size ? "default" : "outline"}
                    onClick={() => void changePageSize(size)}
                  >
                    {size}
                  </Button>
                ))}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => void changePage(1)}
              >
                首页
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => void changePage(page - 1)}
              >
                上一页
              </Button>
              <span className="text-muted-foreground">
                第 {page} / {totalPages} 页
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => void changePage(page + 1)}
              >
                下一页
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => void changePage(totalPages)}
              >
                末页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
