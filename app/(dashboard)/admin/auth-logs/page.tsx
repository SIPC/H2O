"use client"

import { FormEvent, useEffect, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { ChevronsUpDown, X } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { DataTable, DataTableColumnHeader } from "@/components/data-table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

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

type UserRow = { id: number; username: string }
type NodeRow = { id: number; name: string }

type SuccessFilter = "all" | "1" | "0"

type TFunction = ReturnType<typeof useI18n>["t"]

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

function getReasonLabel(t: TFunction, reason: string | null | undefined) {
  if (!reason) return "-"
  const key = `logs.reason.${reason}`
  const label = t(key)
  return label === key ? reason : label
}

// 账号 / 节点筛选下拉：value 为空字符串表示不筛选
function NamedEntityCombobox({
  items,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  clearLabel,
  emptyText,
  className,
}: {
  items: Array<{ id: number; name: string }>
  value: string
  onChange: (value: string) => void
  placeholder: string
  searchPlaceholder: string
  clearLabel: string
  emptyText: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = items.find((i) => i.name === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn("justify-between font-normal", className)}
        >
          <span className={selected ? "" : "text-muted-foreground"}>
            {selected ? `#${selected.id} ${selected.name}` : placeholder}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__clear__"
                onSelect={() => {
                  onChange("")
                  setOpen(false)
                }}
              >
                <X className="size-4 opacity-60" />
                {clearLabel}
              </CommandItem>
              {items.map((i) => (
                <CommandItem
                  key={i.id}
                  value={i.name}
                  data-checked={value === i.name}
                  onSelect={() => {
                    onChange(i.name)
                    setOpen(false)
                  }}
                >
                  #{i.id} {i.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export default function AdminLogsPage() {
  const { t } = useI18n()
  const [rows, setRows] = useState<LogRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [username, setUsername] = useState("")
  const [nodeName, setNodeName] = useState("")
  const [ip, setIp] = useState("")
  const [successFilter, setSuccessFilter] = useState<SuccessFilter>("all")
  const [users, setUsers] = useState<UserRow[]>([])
  const [nodes, setNodes] = useState<NodeRow[]>([])
  const [loading, setLoading] = useState(true)

  // 统一的加载函数：筛选 + 分页都走这个入口
  async function load(
    opts: {
      page?: number
      pageSize?: number
      filter?: SuccessFilter
      username?: string
      nodeName?: string
      ip?: string
    } = {}
  ) {
    const nextPage = opts.page ?? page
    const nextPageSize = opts.pageSize ?? pageSize
    const nextFilter = opts.filter ?? successFilter
    const nextUsername = opts.username ?? username
    const nextNodeName = opts.nodeName ?? nodeName
    const nextIp = opts.ip ?? ip

    const params = new URLSearchParams()
    if (nextFilter !== "all") params.set("success", nextFilter)
    if (nextUsername.trim()) params.set("username", nextUsername.trim())
    if (nextNodeName.trim()) params.set("nodeName", nextNodeName.trim())
    if (nextIp.trim()) params.set("ip", nextIp.trim())
    params.set("page", String(nextPage))
    params.set("pageSize", String(nextPageSize))

    setLoading(true)
    try {
      const response = await fetch(`/api/admin/auth-logs?${params.toString()}`)
      const json = await response.json()
      if (!json?.ok) return

      setRows(json.data.rows)
      setTotal(json.data.total)
      setPage(json.data.page)
      setPageSize(json.data.pageSize)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true

    void (async () => {
      try {
        const params = new URLSearchParams({ page: "1", pageSize: "50" })
        const [logRes, userRes, nodeRes] = await Promise.all([
          fetch(`/api/admin/auth-logs?${params.toString()}`),
          fetch("/api/admin/users"),
          fetch("/api/admin/nodes"),
        ])
        const logJson = await logRes.json()
        const userJson = await userRes.json()
        const nodeJson = await nodeRes.json()
        if (!mounted) return
        if (logJson?.ok) {
          setRows(logJson.data.rows)
          setTotal(logJson.data.total)
          setPage(logJson.data.page)
          setPageSize(logJson.data.pageSize)
        }
        if (userJson?.ok) setUsers(userJson.data)
        if (nodeJson?.ok) setNodes(nodeJson.data)
      } finally {
        if (mounted) setLoading(false)
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

  async function switchUsername(next: string) {
    setUsername(next)
    await load({ page: 1, username: next })
  }

  async function switchNode(next: string) {
    setNodeName(next)
    await load({ page: 1, nodeName: next })
  }

  async function changePage(next: number) {
    await load({ page: next })
  }

  async function changePageSize(next: number) {
    await load({ page: 1, pageSize: next })
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const columns: ColumnDef<LogRow>[] = [
    {
      accessorKey: "created_at",
      header: t("logs.common.time"),
      cell: ({ row }) => {
        const v = row.original.created_at
        return new Date(v.endsWith("Z") ? v : `${v}Z`).toLocaleString()
      },
    },
    {
      accessorKey: "node_name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("logs.common.node")} />
      ),
      cell: ({ row }) => row.original.node_name ?? "-",
    },
    {
      accessorKey: "username",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("logs.common.account")}
        />
      ),
      cell: ({ row }) => row.original.username ?? "-",
    },
    {
      accessorKey: "ip",
      header: "IP",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.ip ?? "-"}</span>
      ),
    },
    {
      accessorKey: "success",
      header: t("logs.common.result"),
      cell: ({ row }) =>
        row.original.success === 1 ? (
          <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            {t("logs.common.success")}
          </Badge>
        ) : (
          <Badge className="bg-destructive/15 text-destructive">
            {t("logs.common.failure")}
          </Badge>
        ),
    },
    {
      accessorKey: "reason",
      header: t("logs.common.reason"),
      cell: ({ row }) => (
        <span className="text-xs">
          {getReasonLabel(t, row.original.reason)}
        </span>
      ),
    },
  ]

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold">{t("logs.auth.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("logs.auth.description")}
        </p>
      </div>

      {/* 筛选条件 */}
      <form className="grid gap-3 md:grid-cols-5" onSubmit={submit}>
        <div className="space-y-1">
          <Label>{t("logs.common.account")}</Label>
          <NamedEntityCombobox
            items={users.map((u) => ({ id: u.id, name: u.username }))}
            value={username}
            onChange={(v) => void switchUsername(v)}
            placeholder={t("logs.common.allAccounts")}
            searchPlaceholder={t("logs.common.searchUsername")}
            clearLabel={t("logs.common.allAccounts")}
            emptyText={t("logs.common.noMatchingAccounts")}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label>{t("logs.common.node")}</Label>
          <NamedEntityCombobox
            items={nodes}
            value={nodeName}
            onChange={(v) => void switchNode(v)}
            placeholder={t("logs.common.allNodes")}
            searchPlaceholder={t("logs.common.searchNodeName")}
            clearLabel={t("logs.common.allNodes")}
            emptyText={t("logs.common.noMatchingNodes")}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <Label>{t("logs.common.ip")}</Label>
          <Input
            value={ip}
            onChange={(event) => setIp(event.target.value)}
            placeholder={t("logs.common.ipSearchPlaceholder")}
          />
        </div>
        <div className="space-y-1">
          <Label>{t("logs.common.result")}</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={successFilter === "all" ? "default" : "outline"}
              onClick={() => void switchFilter("all")}
            >
              {t("logs.common.all")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={successFilter === "1" ? "default" : "outline"}
              onClick={() => void switchFilter("1")}
            >
              {t("logs.common.success")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={successFilter === "0" ? "default" : "outline"}
              onClick={() => void switchFilter("0")}
            >
              {t("logs.common.failure")}
            </Button>
          </div>
        </div>
        <div className="flex items-end justify-end gap-2">
          <Button type="submit">{t("logs.common.query")}</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setUsername("")
              setNodeName("")
              setIp("")
              setSuccessFilter("all")
              void load({
                page: 1,
                filter: "all",
                username: "",
                nodeName: "",
                ip: "",
              })
            }}
          >
            {t("logs.common.reset")}
          </Button>
        </div>
      </form>

      {/* 日志列表 */}
      <DataTable
        columns={columns}
        data={rows}
        manualPagination
        pageCount={totalPages}
        page={page}
        pageSize={pageSize}
        totalRows={total}
        onPageChange={changePage}
        onPageSizeChange={changePageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        loading={loading}
        loadingRowCount={10}
      />
    </div>
  )
}
