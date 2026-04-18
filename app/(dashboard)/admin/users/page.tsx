"use client"

import { FormEvent, useEffect, useState } from "react"
import { ChevronsUpDown } from "lucide-react"

import { useConfirm } from "@/components/confirm-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { cn } from "@/lib/utils"

type Role = "user" | "admin"

const roleOptions: Array<{ label: string; value: Role }> = [
  { label: "user", value: "user" },
  { label: "admin", value: "admin" },
]

type UserRow = {
  id: number
  username: string
  role: Role
  status: "active" | "disabled"
  auth_token: string
  created_at: string
}

function RoleCombobox({
  value,
  onChange,
  className,
}: {
  value: Role
  onChange: (value: Role) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn("justify-between", className)}
        >
          {value}
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[180px] p-0">
        <Command>
          <CommandList>
            <CommandEmpty>无匹配项</CommandEmpty>
            <CommandGroup>
              {roleOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  data-checked={value === option.value}
                  onSelect={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                >
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export default function AdminUsersPage() {
  const { confirm, alert } = useConfirm()
  const [rows, setRows] = useState<UserRow[]>([])
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<Role>("user")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null)
  const [newPassword, setNewPassword] = useState("")

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

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, role }),
    })

    const json = await response.json()
    if (!response.ok || !json.ok) return

    setUsername("")
    setPassword("")
    setRole("user")
    await load()
  }

  async function updateUser(userId: number, body: Record<string, unknown>) {
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })

    const json = await response.json()
    if (!response.ok || !json.ok) return
    await load()
  }

  async function removeUser(user: UserRow) {
    const ok = await confirm({
      title: `删除用户 #${user.id} (${user.username})？`,
      description: "其订阅与会话会一并清理，不可恢复。",
      confirmText: "删除",
      variant: "destructive",
    })
    if (!ok) return

    const response = await fetch(`/api/admin/users/${user.id}`, {
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

  async function resetAuthToken(user: UserRow) {
    const ok = await confirm({
      title: `重置 ${user.username} 的节点登录 Key？`,
      description: "此操作会使当前订阅链接立刻失效，已连接的节点需要重新导入。",
      confirmText: "重置",
      variant: "destructive",
    })
    if (!ok) return
    await updateUser(user.id, { resetAuthToken: true })
  }

  function openPasswordDialog(user: UserRow) {
    setSelectedUser(user)
    setNewPassword("")
    setDialogOpen(true)
  }

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedUser || !newPassword) return

    await updateUser(selectedUser.id, { newPassword })
    setDialogOpen(false)
    setSelectedUser(null)
    setNewPassword("")
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-7xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>用户管理</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="mb-4 grid gap-3 md:grid-cols-4" onSubmit={create}>
            <div className="space-y-1">
              <Label>用户名</Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>密码</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>角色</Label>
              <RoleCombobox
                value={role}
                onChange={setRole}
                className="h-9 w-full"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit">创建用户</Button>
            </div>
          </form>

          <Table>
            <THead>
              <TR>
                <TH>ID</TH>
                <TH>用户名</TH>
                <TH>角色</TH>
                <TH>状态</TH>
                <TH>节点登录Key</TH>
                <TH>创建时间</TH>
                <TH>操作</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id}>
                  <TD>{row.id}</TD>
                  <TD>{row.username}</TD>
                  <TD>
                    <RoleCombobox
                      value={row.role}
                      onChange={(nextRole) =>
                        void updateUser(row.id, { role: nextRole })
                      }
                      className="h-8 w-[120px]"
                    />
                  </TD>
                  <TD>{row.status}</TD>
                  <TD className="max-w-[260px] truncate font-mono text-xs">
                    {row.auth_token}
                  </TD>
                  <TD>{new Date(row.created_at).toLocaleString()}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-2">
                      {row.status === "active" ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            void updateUser(row.id, { status: "disabled" })
                          }
                        >
                          禁用
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            void updateUser(row.id, { status: "active" })
                          }
                        >
                          启用
                        </Button>
                      )}
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => openPasswordDialog(row)}
                      >
                        改密
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => void resetAuthToken(row)}
                      >
                        重置Key
                      </Button>
                      <Button
                        size="xs"
                        variant="destructive"
                        onClick={() => void removeUser(row)}
                      >
                        删除
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) {
            setSelectedUser(null)
            setNewPassword("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改密码 - {selectedUser?.username ?? ""}</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={submitPasswordChange}>
            <div className="space-y-1">
              <Label>新密码（至少 6 位）</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit">确认修改</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                取消
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
