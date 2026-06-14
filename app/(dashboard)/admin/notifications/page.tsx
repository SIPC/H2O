"use client"

import { FormEvent, useEffect, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import { DataTable, DataTableColumnHeader } from "@/components/data-table"
import { useI18n } from "@/components/i18n-provider"
import type { Locale } from "@/lib/i18n/locales"
import { translateText } from "@/lib/i18n/messages"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

type NotificationRow = {
  id: number
  created_at: string
  channel: string
  event: string
  level: string
  title: string
  message: string
  target: string | null
  subject_type: string | null
  subject_id: string | null
  success: 0 | 1
  reason: string | null
  detail: string | null
}

type SelectOption = { labelKey: string; value: string }

type TFunction = ReturnType<typeof useI18n>["t"]

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

const channelLabelKey: Record<string, string> = {
  telegram: "logs.notifications.channel.telegram",
  system: "logs.notifications.channel.system",
}

const eventLabelKey: Record<string, string> = {
  NODE_STATUS: "logs.notifications.event.NODE_STATUS",
  HY2_STATUS: "logs.notifications.event.HY2_STATUS",
  SUBSCRIPTION_TRAFFIC_EXCEEDED:
    "logs.notifications.event.SUBSCRIPTION_TRAFFIC_EXCEEDED",
  HOST_TRAFFIC_EXCEEDED: "logs.notifications.event.HOST_TRAFFIC_EXCEEDED",
  AGENT_TASK_FAILED: "logs.notifications.event.AGENT_TASK_FAILED",
  TEST: "logs.notifications.event.TEST",
}

const levelLabelKey: Record<string, string> = {
  info: "logs.notifications.level.info",
  success: "logs.notifications.level.success",
  warning: "logs.notifications.level.warning",
  error: "logs.notifications.level.error",
}

const channelOptions: SelectOption[] = [
  { labelKey: "logs.notifications.allChannels", value: "all" },
  { labelKey: "logs.notifications.channel.telegram", value: "telegram" },
  { labelKey: "logs.notifications.channel.system", value: "system" },
]

const eventOptions: SelectOption[] = [
  { labelKey: "logs.common.allEvents", value: "all" },
  { labelKey: "logs.notifications.event.NODE_STATUS", value: "NODE_STATUS" },
  { labelKey: "logs.notifications.event.HY2_STATUS", value: "HY2_STATUS" },
  {
    labelKey: "logs.notifications.event.SUBSCRIPTION_TRAFFIC_EXCEEDED",
    value: "SUBSCRIPTION_TRAFFIC_EXCEEDED",
  },
  {
    labelKey: "logs.notifications.event.HOST_TRAFFIC_EXCEEDED",
    value: "HOST_TRAFFIC_EXCEEDED",
  },
  {
    labelKey: "logs.notifications.event.AGENT_TASK_FAILED",
    value: "AGENT_TASK_FAILED",
  },
  { labelKey: "logs.notifications.event.TEST", value: "TEST" },
]

const levelOptions: SelectOption[] = [
  { labelKey: "logs.notifications.allLevels", value: "all" },
  { labelKey: "logs.notifications.level.info", value: "info" },
  { labelKey: "logs.notifications.level.success", value: "success" },
  { labelKey: "logs.notifications.level.warning", value: "warning" },
  { labelKey: "logs.notifications.level.error", value: "error" },
]

const successOptions: SelectOption[] = [
  { labelKey: "logs.common.allResults", value: "all" },
  { labelKey: "logs.common.success", value: "1" },
  { labelKey: "logs.common.failure", value: "0" },
]

function formatDate(value: string) {
  return new Date(value.endsWith("Z") ? value : `${value}Z`).toLocaleString()
}

function getChannelLabel(t: TFunction, channel: string) {
  return t(channelLabelKey[channel] ?? channel)
}

function getEventLabel(t: TFunction, event: string) {
  return t(eventLabelKey[event] ?? event)
}

function getLevelLabel(t: TFunction, level: string) {
  return t(levelLabelKey[level] ?? level)
}

function getReasonLabel(t: TFunction, reason: string | null | undefined) {
  if (!reason) return "-"
  const key = `logs.reason.${reason}`
  const label = t(key)
  return label === key ? reason : label
}

function getNotificationDetailLabel(t: TFunction, key: string) {
  const labelKey = `logs.notifications.detail.${key}`
  const label = t(labelKey)
  return label === labelKey ? key : label
}

function parseDetail(detail: string | null): Array<[string, unknown]> | null {
  if (!detail) return null
  try {
    const obj = JSON.parse(detail) as Record<string, unknown>
    return Object.entries(obj)
  } catch {
    return [["raw", detail]]
  }
}

function translateNotificationText(locale: Locale, text: string) {
  return text
    .split("\n")
    .map((line) => translateText(line, locale))
    .join("\n")
}

function renderDetailValue(t: TFunction, value: unknown): string {
  if (value === null || value === undefined) return "-"
  if (typeof value === "boolean") {
    return value ? t("logs.common.yes") : t("logs.common.no")
  }
  if (typeof value === "object") return JSON.stringify(value, null, 2)
  return String(value)
}

function levelBadgeClass(level: string) {
  if (level === "error") return "bg-destructive/15 text-destructive"
  if (level === "warning") return "bg-muted text-foreground"
  if (level === "success") return "bg-primary/15 text-primary"
  return "bg-muted text-muted-foreground"
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
}) {
  const { t } = useI18n()

  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

export default function AdminNotificationsPage() {
  const { locale, t } = useI18n()
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [query, setQuery] = useState("")
  const [channelFilter, setChannelFilter] = useState("all")
  const [eventFilter, setEventFilter] = useState("all")
  const [levelFilter, setLevelFilter] = useState("all")
  const [successFilter, setSuccessFilter] = useState("all")
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [activeRow, setActiveRow] = useState<NotificationRow | null>(null)

  async function load(
    opts: {
      page?: number
      pageSize?: number
      query?: string
      channel?: string
      event?: string
      level?: string
      success?: string
    } = {}
  ) {
    const nextPage = opts.page ?? page
    const nextPageSize = opts.pageSize ?? pageSize
    const nextQuery = opts.query ?? query
    const nextChannel = opts.channel ?? channelFilter
    const nextEvent = opts.event ?? eventFilter
    const nextLevel = opts.level ?? levelFilter
    const nextSuccess = opts.success ?? successFilter

    const params = new URLSearchParams()
    if (nextQuery.trim()) params.set("q", nextQuery.trim())
    if (nextChannel !== "all") params.set("channel", nextChannel)
    if (nextEvent !== "all") params.set("event", nextEvent)
    if (nextLevel !== "all") params.set("level", nextLevel)
    if (nextSuccess !== "all") params.set("success", nextSuccess)
    params.set("page", String(nextPage))
    params.set("pageSize", String(nextPageSize))

    setLoading(true)
    try {
      const response = await fetch(
        `/api/admin/notifications?${params.toString()}`
      )
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
        const response = await fetch(
          `/api/admin/notifications?${params.toString()}`
        )
        const json = await response.json()
        if (!mounted) return
        if (json?.ok) {
          setRows(json.data.rows)
          setTotal(json.data.total)
          setPage(json.data.page)
          setPageSize(json.data.pageSize)
        }
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
    await load({ page: 1 })
  }

  async function switchChannel(next: string) {
    setChannelFilter(next)
    await load({ page: 1, channel: next })
  }

  async function switchEvent(next: string) {
    setEventFilter(next)
    await load({ page: 1, event: next })
  }

  async function switchLevel(next: string) {
    setLevelFilter(next)
    await load({ page: 1, level: next })
  }

  async function switchSuccess(next: string) {
    setSuccessFilter(next)
    await load({ page: 1, success: next })
  }

  async function changePage(next: number) {
    await load({ page: next })
  }

  async function changePageSize(next: number) {
    await load({ page: 1, pageSize: next })
  }

  function resetFilters() {
    setQuery("")
    setChannelFilter("all")
    setEventFilter("all")
    setLevelFilter("all")
    setSuccessFilter("all")
    void load({
      page: 1,
      query: "",
      channel: "all",
      event: "all",
      level: "all",
      success: "all",
    })
  }

  async function runCheckNow() {
    setChecking(true)
    try {
      const response = await fetch("/api/admin/notifications/check", {
        method: "POST",
      })
      const json = await response.json()
      if (!response.ok || !json?.ok) {
        toast.error(t("logs.notifications.checkFailed"), {
          description: json?.error?.message ?? t("logs.common.retryLater"),
        })
        return
      }
      toast.success(t("logs.notifications.checkCompleted"), {
        description: t("logs.notifications.checkCompletedDescription", {
          processed: json.data?.processed ?? 0,
          sent: json.data?.sent ?? 0,
        }),
      })
      await load({ page: 1 })
    } catch {
      toast.error(t("logs.notifications.checkFailed"), {
        description: t("logs.common.networkError"),
      })
    } finally {
      setChecking(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const columns: ColumnDef<NotificationRow>[] = [
    {
      accessorKey: "created_at",
      header: t("logs.common.time"),
      cell: ({ row }) => formatDate(row.original.created_at),
    },
    {
      accessorKey: "channel",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("logs.common.channel")}
        />
      ),
      cell: ({ row }) => (
        <Badge>{getChannelLabel(t, row.original.channel)}</Badge>
      ),
    },
    {
      accessorKey: "event",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("logs.common.event")} />
      ),
      cell: ({ row }) => getEventLabel(t, row.original.event),
    },
    {
      accessorKey: "level",
      header: t("logs.common.level"),
      cell: ({ row }) => (
        <Badge className={levelBadgeClass(row.original.level)}>
          {getLevelLabel(t, row.original.level)}
        </Badge>
      ),
    },
    {
      accessorKey: "title",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t("logs.common.content")}
        />
      ),
      cell: ({ row }) => (
        <div className="flex max-w-80 flex-col gap-0.5">
          <span className="truncate font-medium">
            {translateNotificationText(locale, row.original.title)}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {translateNotificationText(locale, row.original.message)}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "target",
      header: t("logs.common.target"),
      cell: ({ row }) => row.original.target ?? "-",
    },
    {
      accessorKey: "success",
      header: t("logs.common.result"),
      cell: ({ row }) =>
        row.original.success === 1 ? (
          <Badge className="bg-primary/15 text-primary">
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
    {
      id: "actions",
      header: t("logs.common.actions"),
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => setActiveRow(row.original)}
        >
          {t("logs.common.details")}
        </Button>
      ),
    },
  ]

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {t("logs.notifications.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("logs.notifications.description")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={checking}
          onClick={() => void runCheckNow()}
        >
          {checking
            ? t("logs.notifications.checking")
            : t("logs.notifications.checkNow")}
        </Button>
      </div>

      <form className="grid gap-3 md:grid-cols-6" onSubmit={submit}>
        <div className="flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="notification_query">{t("logs.common.search")}</Label>
          <Input
            id="notification_query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("logs.notifications.searchPlaceholder")}
          />
        </div>
        <FilterSelect
          label={t("logs.common.channel")}
          value={channelFilter}
          options={channelOptions}
          onChange={(next) => void switchChannel(next)}
        />
        <FilterSelect
          label={t("logs.common.event")}
          value={eventFilter}
          options={eventOptions}
          onChange={(next) => void switchEvent(next)}
        />
        <FilterSelect
          label={t("logs.common.level")}
          value={levelFilter}
          options={levelOptions}
          onChange={(next) => void switchLevel(next)}
        />
        <FilterSelect
          label={t("logs.common.result")}
          value={successFilter}
          options={successOptions}
          onChange={(next) => void switchSuccess(next)}
        />
        <div className="flex items-end justify-end gap-2 md:col-span-6">
          <Button type="submit">{t("logs.common.query")}</Button>
          <Button type="button" variant="outline" onClick={resetFilters}>
            {t("logs.common.reset")}
          </Button>
        </div>
      </form>

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

      <NotificationDetailSheet
        row={activeRow}
        onClose={() => setActiveRow(null)}
      />
    </div>
  )
}

function NotificationDetailSheet({
  row,
  onClose,
}: {
  row: NotificationRow | null
  onClose: () => void
}) {
  const { locale, t } = useI18n()
  const entries = parseDetail(row?.detail ?? null)
  const createdAt = row ? formatDate(row.created_at) : ""

  return (
    <Sheet
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t("logs.notifications.detailTitle")}</SheetTitle>
          <SheetDescription>
            {row ? `#${row.id} · ${getEventLabel(t, row.event)}` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {row ? (
            <div className="flex flex-col gap-3 text-sm">
              <DetailField label={t("logs.common.time")} value={createdAt} />
              <DetailField
                label={t("logs.common.channel")}
                value={getChannelLabel(t, row.channel)}
              />
              <DetailField
                label={t("logs.common.event")}
                value={getEventLabel(t, row.event)}
              />
              <DetailField
                label={t("logs.common.level")}
                value={getLevelLabel(t, row.level)}
              />
              <DetailField
                label={t("logs.common.title")}
                value={translateNotificationText(locale, row.title)}
              />
              <DetailField
                label={t("logs.common.content")}
                value={translateNotificationText(locale, row.message)}
                multiline
              />
              <DetailField
                label={t("logs.common.target")}
                value={row.target ?? "-"}
              />
              <DetailField
                label={t("logs.common.subject")}
                value={
                  row.subject_type || row.subject_id
                    ? `${row.subject_type ?? "-"}:${row.subject_id ?? "-"}`
                    : "-"
                }
                mono
              />
              <DetailField
                label={t("logs.common.result")}
                value={
                  row.success === 1
                    ? t("logs.common.success")
                    : t("logs.common.failure")
                }
              />
              <DetailField
                label={t("logs.common.reason")}
                value={getReasonLabel(t, row.reason)}
              />
              {entries && entries.length > 0 ? (
                <div className="mt-2 rounded-md border">
                  <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                    {t("logs.common.data")}
                  </div>
                  <div className="divide-y">
                    {entries.map(([key, value]) => (
                      <div
                        key={key}
                        className="grid grid-cols-[120px_1fr] gap-2 px-3 py-2 text-xs"
                      >
                        <div className="text-muted-foreground">
                          {getNotificationDetailLabel(t, key)}
                        </div>
                        <div className="font-mono break-all whitespace-pre-wrap">
                          {renderDetailValue(t, value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DetailField({
  label,
  value,
  mono,
  multiline,
}: {
  label: string
  value: string
  mono?: boolean
  multiline?: boolean
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-sm break-all",
          mono && "font-mono text-xs",
          multiline && "whitespace-pre-wrap"
        )}
      >
        {value}
      </div>
    </div>
  )
}
