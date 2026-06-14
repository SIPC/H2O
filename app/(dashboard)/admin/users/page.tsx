"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { MoreVertical, Pencil, Plus, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { useConfirm } from "@/components/confirm-provider"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DataTable,
  DataTableColumnHeader,
  DataTableFacetedFilter,
  DataTableViewOptions,
} from "@/components/data-table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"

type Role = "user" | "admin"

type UserRow = {
  id: number
  username: string
  role: Role
  status: "active" | "disabled"
  auth_token: string
  created_at: string
}

function roleLabelKey(role: Role) {
  return role === "admin" ? "adminBasic.role.admin" : "adminBasic.role.user"
}

function userStatusLabelKey(status: UserRow["status"] | undefined) {
  return status === "active"
    ? "adminBasic.status.enabled"
    : "adminBasic.status.disabled"
}

// 用户表单（创建 / 编辑共用）
function UserForm({
  username,
  setUsername,
  password,
  setPassword,
  role,
  setRole,
  isEdit,
  status,
  setStatus,
  newPassword,
  setNewPassword,
  showResetToken,
  onResetToken,
  onSubmit,
  submitLabel,
  onCancel,
}: {
  username: string
  setUsername: (v: string) => void
  password: string
  setPassword: (v: string) => void
  role: Role
  setRole: (v: Role) => void
  isEdit: boolean
  status?: "active" | "disabled"
  setStatus?: (v: "active" | "disabled") => void
  newPassword: string
  setNewPassword: (v: string) => void
  showResetToken?: boolean
  onResetToken?: () => void
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  submitLabel: string
  onCancel?: () => void
}) {
  const { t } = useI18n()

  return (
    <form
      className="space-y-4 **:data-[slot=label]:text-xs"
      onSubmit={onSubmit}
    >
      {/* === 基础信息 === */}
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            {t("adminUsers.form.basicInfo")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>{t("adminUsers.form.username")}</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isEdit}
              required={!isEdit}
            />
          </div>
          {!isEdit && (
            <div className="space-y-1">
              <Label>{t("adminUsers.form.password")}</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          )}
          <div className="space-y-1">
            <Label>{t("adminUsers.form.role")}</Label>
            <div className="flex gap-2">
              {(["user", "admin"] as Role[]).map((r) => (
                <Button
                  key={r}
                  type="button"
                  variant={role === r ? "default" : "outline"}
                  size="sm"
                  onClick={() => setRole(r)}
                >
                  {t(roleLabelKey(r))}
                </Button>
              ))}
            </div>
          </div>
          {isEdit && setStatus && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label>{t("adminUsers.form.status")}</Label>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch
                    checked={status === "active"}
                    onCheckedChange={(next) =>
                      setStatus(next ? "active" : "disabled")
                    }
                    size="sm"
                  />
                  {t(userStatusLabelKey(status))}
                </label>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {isEdit && (
        <>
          {/* === 安全设置 === */}
          <Card>
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                {t("adminUsers.form.security")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>{t("adminUsers.form.changePassword")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("adminUsers.form.changePasswordHelp")}
                </p>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t("adminUsers.form.newPasswordPlaceholder")}
                />
              </div>
              {showResetToken && onResetToken && (
                <div className="space-y-3 rounded-md border border-destructive/30 p-3">
                  <div className="space-y-1">
                    <Label>{t("adminUsers.form.resetAuthKey")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("adminUsers.form.resetAuthKeyHelp")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={onResetToken}
                  >
                    {t("adminUsers.form.resetAuthKeyButton")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <div className="flex gap-2 pt-2">
        <Button type="submit">{submitLabel}</Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </form>
  )
}

export default function AdminUsersPage() {
  const { confirm, alert } = useConfirm()
  const { locale, t } = useI18n()
  const [rows, setRows] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)

  // 表格列定义
  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      {
        accessorKey: "id",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("adminBasic.label.id")}
          />
        ),
        meta: { label: t("adminBasic.label.id") },
      },
      {
        accessorKey: "username",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("adminBasic.label.username")}
          />
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.getValue("username")}</span>
        ),
        meta: { label: t("adminBasic.label.username") },
      },
      {
        accessorKey: "role",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("adminUsers.form.role")}
          />
        ),
        cell: ({ row }) => {
          const role = row.getValue<Role>("role")
          return (
            <Badge
              className={
                role === "admin" ? "bg-primary/15 text-primary" : undefined
              }
            >
              {t(roleLabelKey(role))}
            </Badge>
          )
        },
        filterFn: "arrIncludesSome",
        meta: { label: t("adminUsers.form.role") },
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("adminUsers.form.status")}
          />
        ),
        cell: ({ row }) => {
          const status = row.getValue<UserRow["status"]>("status")
          return (
            <Badge
              className={
                status === "active"
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground"
              }
            >
              {t(userStatusLabelKey(status))}
            </Badge>
          )
        },
        filterFn: "arrIncludesSome",
        meta: { label: t("adminUsers.form.status") },
      },
      {
        accessorKey: "auth_token",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("adminUsers.column.authKey")}
          />
        ),
        cell: ({ row }) => (
          <span className="max-w-65 truncate font-mono text-xs">
            {row.getValue("auth_token")}
          </span>
        ),
        enableSorting: false,
        meta: { label: t("adminUsers.column.authKey") },
      },
      {
        accessorKey: "created_at",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t("adminBasic.label.createdAt")}
          />
        ),
        cell: ({ row }) =>
          new Date(row.getValue<string>("created_at")).toLocaleString(locale),
        meta: { label: t("adminBasic.label.createdAt") },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("common.actions")}</span>,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => {
          const r = row.original
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => startEdit(r)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  {t("adminBasic.action.edit")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => void remove(r)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("adminBasic.action.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, t]
  )

  // 创建面板
  const [createOpen, setCreateOpen] = useState(false)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<Role>("user")

  // 编辑面板
  const [editingRow, setEditingRow] = useState<UserRow | null>(null)
  const [editRole, setEditRole] = useState<Role>("user")
  const [editStatus, setEditStatus] = useState<"active" | "disabled">("active")
  const [editNewPassword, setEditNewPassword] = useState("")

  async function load() {
    setLoading(true)
    try {
      const response = await fetch("/api/admin/users")
      const json = await response.json()
      if (json?.ok) setRows(json.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true

    void (async () => {
      try {
        const response = await fetch("/api/admin/users")
        const json = await response.json()
        if (mounted && json?.ok) setRows(json.data)
      } finally {
        if (mounted) setLoading(false)
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  function resetCreateForm() {
    setUsername("")
    setPassword("")
    setRole("user")
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, role }),
    })

    const json = await response.json()
    if (!response.ok || !json.ok) return

    resetCreateForm()
    setCreateOpen(false)
    await load()
  }

  function startEdit(row: UserRow) {
    setEditingRow(row)
    setEditRole(row.role)
    setEditStatus(row.status)
    setEditNewPassword("")
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingRow) return

    const body: Record<string, unknown> = {}

    // 角色变更
    if (editRole !== editingRow.role) {
      body.role = editRole
    }

    // 状态变更
    if (editStatus !== editingRow.status) {
      body.status = editStatus
    }

    // 密码变更
    if (editNewPassword) {
      body.newPassword = editNewPassword
    }

    // 无变更则关闭
    if (Object.keys(body).length === 0) {
      setEditingRow(null)
      return
    }

    const response = await fetch(`/api/admin/users/${editingRow.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })

    const json = await response.json()
    if (!response.ok || !json.ok) return

    setEditingRow(null)
    await load()
  }

  async function remove(row: UserRow) {
    const ok = await confirm({
      title: t("adminUsers.delete.confirmTitle", {
        id: row.id,
        username: row.username,
      }),
      description: t("adminUsers.delete.confirmDescription"),
      confirmText: t("common.delete"),
      variant: "destructive",
    })
    if (!ok) return

    const response = await fetch(`/api/admin/users/${row.id}`, {
      method: "DELETE",
    })
    const json = await response.json()
    if (!response.ok || !json.ok) {
      await alert({
        title: t("adminUsers.delete.failedTitle"),
        description: json?.error?.message ?? t("common.retryLater"),
        variant: "destructive",
      })
      return
    }
    await load()
  }

  async function resetAuthToken() {
    if (!editingRow) return

    const ok = await confirm({
      title: t("adminUsers.resetAuthKey.confirmTitle", {
        username: editingRow.username,
      }),
      description: t("adminUsers.resetAuthKey.confirmDescription"),
      confirmText: t("common.reset"),
      variant: "destructive",
    })
    if (!ok) return

    const response = await fetch(`/api/admin/users/${editingRow.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resetAuthToken: true }),
    })

    const json = await response.json()
    if (!response.ok || !json.ok) return
    await load()
  }

  return (
    <div className="mx-auto flex w-full max-w-450 flex-col gap-4 p-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("adminUsers.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("adminUsers.count", { count: rows.length })}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t("adminUsers.add")}
        </Button>
      </div>

      {/* 用户列表 */}
      {rows.length === 0 && !loading ? (
        <Card className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-sm">{t("adminUsers.empty.title")}</p>
          <p className="mt-1 text-xs">{t("adminUsers.empty.description")}</p>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          defaultPageSize={20}
          pageSizeOptions={[10, 20, 50, 100]}
          loading={loading}
          loadingRowCount={8}
          renderToolbar={(table) => (
            <>
              <Input
                placeholder={t("adminUsers.searchPlaceholder")}
                value={
                  (table.getColumn("username")?.getFilterValue() as string) ??
                  ""
                }
                onChange={(e) =>
                  table.getColumn("username")?.setFilterValue(e.target.value)
                }
                className="h-8 max-w-60"
              />
              <DataTableFacetedFilter
                column={table.getColumn("role")}
                title={t("adminUsers.form.role")}
                options={[
                  { label: t("adminBasic.role.admin"), value: "admin" },
                  { label: t("adminBasic.role.user"), value: "user" },
                ]}
              />
              <DataTableFacetedFilter
                column={table.getColumn("status")}
                title={t("adminUsers.form.status")}
                options={[
                  { label: t("adminBasic.status.enabled"), value: "active" },
                  { label: t("adminBasic.status.disabled"), value: "disabled" },
                ]}
              />
              <DataTableViewOptions table={table} />
            </>
          )}
        />
      )}

      {/* 创建用户 - 右侧滑出面板 */}
      <Sheet
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) resetCreateForm()
        }}
      >
        <SheetContent className="data-[side=right]:sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t("adminUsers.create.title")}</SheetTitle>
            <SheetDescription>
              {t("adminUsers.create.description")}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <UserForm
              username={username}
              setUsername={setUsername}
              password={password}
              setPassword={setPassword}
              role={role}
              setRole={setRole}
              isEdit={false}
              newPassword=""
              setNewPassword={() => {}}
              onSubmit={create}
              submitLabel={t("adminUsers.create.submit")}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* 编辑用户 - 右侧滑出面板 */}
      <Sheet
        open={editingRow !== null}
        onOpenChange={(open) => {
          if (!open) setEditingRow(null)
        }}
      >
        <SheetContent className="data-[side=right]:sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {t("adminUsers.edit.title")}{" "}
              {editingRow ? `#${editingRow.id} (${editingRow.username})` : ""}
            </SheetTitle>
            <SheetDescription>
              {t("adminUsers.edit.description")}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <UserForm
              username={editingRow?.username ?? ""}
              setUsername={() => {}}
              password=""
              setPassword={() => {}}
              role={editRole}
              setRole={setEditRole}
              isEdit
              status={editStatus}
              setStatus={setEditStatus}
              newPassword={editNewPassword}
              setNewPassword={setEditNewPassword}
              showResetToken
              onResetToken={() => void resetAuthToken()}
              onSubmit={submitEdit}
              submitLabel={t("adminUsers.edit.submit")}
              onCancel={() => setEditingRow(null)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
