"use client"

import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

type Settings = {
  registration_enabled: boolean
  login_enabled: boolean
  new_user_default_active: boolean
}

const DEFAULTS: Settings = {
  registration_enabled: true,
  login_enabled: true,
  new_user_default_active: true,
}

// 单个开关行，复用 Checkbox + Label
function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string
  label: string
  description?: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
      />
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {label}
        </Label>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  )
}

export default function AdminSettingsPage() {
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState<Settings>(DEFAULTS)
  const [draft, setDraft] = useState<Settings>(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{
    kind: "ok" | "err"
    text: string
  } | null>(null)

  const dirty = useMemo(() => {
    return (
      draft.registration_enabled !== saved.registration_enabled ||
      draft.login_enabled !== saved.login_enabled ||
      draft.new_user_default_active !== saved.new_user_default_active
    )
  }, [draft, saved])

  useEffect(() => {
    let mounted = true

    void (async () => {
      const response = await fetch("/api/admin/settings")
      const json = await response.json()
      if (!mounted) return
      if (json?.ok) {
        const next: Settings = { ...DEFAULTS, ...json.data }
        setSaved(next)
        setDraft(next)
      }
      setLoaded(true)
    })()

    return () => {
      mounted = false
    }
  }, [])

  async function save() {
    setSaving(true)
    setMessage(null)

    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    })

    const json = await response.json()
    setSaving(false)

    if (!response.ok || !json.ok) {
      setMessage({ kind: "err", text: json?.error?.message ?? "保存失败" })
      return
    }

    const next: Settings = { ...DEFAULTS, ...json.data }
    setSaved(next)
    setDraft(next)
    setMessage({ kind: "ok", text: "已保存" })
  }

  function reset() {
    setDraft(saved)
    setMessage(null)
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>站点设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!loaded ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : (
            <>
              <ToggleRow
                id="registration_enabled"
                label="允许新用户注册"
                description="关闭后注册页不可用，注册接口直接返回错误"
                checked={draft.registration_enabled}
                onChange={(next) =>
                  setDraft((prev) => ({ ...prev, registration_enabled: next }))
                }
              />
              <ToggleRow
                id="login_enabled"
                label="允许用户登录"
                description="关闭后普通用户无法登录；管理员账号不受影响，可用于维护"
                checked={draft.login_enabled}
                onChange={(next) =>
                  setDraft((prev) => ({ ...prev, login_enabled: next }))
                }
              />
              <ToggleRow
                id="new_user_default_active"
                label="新注册用户自动启用"
                description="关闭后新注册用户为 disabled 状态，需要管理员手动启用才能登录"
                checked={draft.new_user_default_active}
                onChange={(next) =>
                  setDraft((prev) => ({
                    ...prev,
                    new_user_default_active: next,
                  }))
                }
              />

              <div className="flex items-center gap-2 pt-2">
                <Button onClick={save} disabled={!dirty || saving}>
                  {saving ? "保存中..." : "保存"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={reset}
                  disabled={!dirty || saving}
                >
                  撤销
                </Button>
                {message ? (
                  <span
                    className={
                      message.kind === "ok"
                        ? "text-sm text-green-600"
                        : "text-sm text-destructive"
                    }
                  >
                    {message.text}
                  </span>
                ) : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
