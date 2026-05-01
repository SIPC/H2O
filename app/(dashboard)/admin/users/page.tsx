"use client"

import { FormEvent, useEffect, useState } from "react"
import { MoreVertical, Pencil, Plus, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { useConfirm } from "@/components/confirm-provider"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"

type Role = "user" | "admin"

type UserRow = {
  id: number
  username: string
  role: Role
  status: "active" | "disabled"
  auth_token: string
  created_at: string
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
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="space-y-1">
        <Label>用户名</Label>
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={isEdit}
          required={!isEdit}
        />
      </div>
      {!isEdit && (
        <div className="space-y-1">
          <Label>密码</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
      )}
      <div className="space-y-1">
        <Label>角色</Label>
        <div className="flex gap-2">
          {(["user", "admin"] as Role[]).map((r) => (
            <Button
              key={r}
              type="button"
              variant={role === r ? "default" : "outline"}
              size="sm"
              onClick={() => setRole(r)}
            >
              {r}
            </Button>
          ))}
        </div>
      </div>

      {isEdit && setStatus && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label>状态</Label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <Switch
                checked={status === "active"}
                onCheckedChange={(next) =>
                  setStatus(next ? "active" : "disabled")
                }
                size="sm"
              />
              {status === "active" ? "启用" : "禁用"}
            </label>
          </div>
        </div>
      )}

      {isEdit && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="space-y-1">
            <Label>修改密码</Label>
            <p className="text-xs text-muted-foreground">留空则不修改密码</p>
          </div>
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="输入新密码（至少 6 位）"
          />
        </div>
      )}

      {isEdit && showResetToken && onResetToken && (
        <div className="space-y-3 rounded-md border border-destructive/30 p-3">
          <div className="space-y-1">
            <Label>重置节点登录 Key</Label>
            <p className="text-xs text-muted-foreground">
              会使当前订阅链接立刻失效，已连接的节点需要重新导入
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onResetToken}
          >
            重置 Key
          </Button>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button type="submit">{submitLabel}</Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
        )}
      </div>
    </form>
  )
}

export default function AdminUsersPage() {
  const { confirm, alert } = useConfirm()
  const [rows, setRows] = useState<UserRow[]>([])

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
    const response = await fetch("/api/admin/users")
    const json = await response.json()
    if (json?.ok) setRows(json.data)
  }

  useEffect(() => {
    let mounted = true

    void (async () => {
      const response = await fetch("/api/admin/users")
      const json = await response.json()
      if (mounted && json?.ok) setRows(json.data)
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
      title: `删除用户 #${row.id} (${row.username})？`,
      description: "其订阅与会话会一并清理，不可恢复。",
      confirmText: "删除",
      variant: "destructive",
    })
    if (!ok) return

    const response = await fetch(`/api/admin/users/${row.id}`, {
      method: "DELETE",
    })
    const json = await response.json()
    if (!response.ok || !json.ok) {
      await alert({
        title: "删除失败",
        description: json?.error?.message ?? "请稍后重试",
        variant: "destructive",
      })
      return
    }
    await load()
  }

  async function resetAuthToken() {
    if (!editingRow) return

    const ok = await confirm({
      title: `重置 ${editingRow.username} 的节点登录 Key？`,
      description: "此操作会使当前订阅链接立刻失效，已连接的节点需要重新导入。",
      confirmText: "重置",
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
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 p-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">用户管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {rows.length} 个用户
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          添加用户
        </Button>
      </div>

      {/* 用户列表 */}
      {rows.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="text-sm">暂无用户</p>
          <p className="mt-1 text-xs">点击右上角「添加用户」创建第一个用户</p>
        </Card>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>ID</TH>
              <TH>用户名</TH>
              <TH>角色</TH>
              <TH>状态</TH>
              <TH>节点登录 Key</TH>
              <TH>创建时间</TH>
              <TH className="w-12"></TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD>{row.id}</TD>
                <TD className="font-medium">{row.username}</TD>
                <TD>
                  <Badge
                    className={
                      row.role === "admin"
                        ? "bg-primary/15 text-primary"
                        : undefined
                    }
                  >
                    {row.role}
                  </Badge>
                </TD>
                <TD>
                  <Badge
                    className={
                      row.status === "active"
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {row.status === "active" ? "启用" : "禁用"}
                  </Badge>
                </TD>
                <TD className="max-w-[260px] truncate font-mono text-xs">
                  {row.auth_token}
                </TD>
                <TD>{new Date(row.created_at).toLocaleString()}</TD>
                <TD>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => startEdit(row)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        编辑
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => void remove(row)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
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
            <SheetTitle>添加用户</SheetTitle>
            <SheetDescription>
              创建新用户，设置用户名、密码和角色。
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
              submitLabel="创建用户"
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
              编辑用户{" "}
              {editingRow ? `#${editingRow.id} (${editingRow.username})` : ""}
            </SheetTitle>
            <SheetDescription>修改用户配置，保存后立即生效。</SheetDescription>
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
              submitLabel="保存修改"
              onCancel={() => setEditingRow(null)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
