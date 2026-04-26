"use client"

import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Settings = {
  registration_enabled: boolean
  login_enabled: boolean
  new_user_default_active: boolean
  turnstile_site_key: string
  turnstile_secret_key: string
  agent_bundle_url: string
  stats_retention_days: number
}

const DEFAULTS: Settings = {
  registration_enabled: true,
  login_enabled: true,
  new_user_default_active: true,
  turnstile_site_key: "",
  turnstile_secret_key: "",
  agent_bundle_url: "",
  stats_retention_days: 30,
}

// 根据两 key 填写情况推断 Turnstile 当前状态，与后端 getTurnstileStatus 一致
function turnstileStatus(site: string, secret: string) {
  const s = site.trim()
  const k = secret.trim()
  if (!s && !k) return { label: "未启用", tone: "muted" as const }
  if (s && k) return { label: "已启用", tone: "ok" as const }
  return {
    label: "配置错误：仅填了一个 key，登录/注册会被拒绝",
    tone: "err" as const,
  }
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
      draft.new_user_default_active !== saved.new_user_default_active ||
      draft.turnstile_site_key !== saved.turnstile_site_key ||
      draft.turnstile_secret_key !== saved.turnstile_secret_key ||
      draft.agent_bundle_url !== saved.agent_bundle_url ||
      draft.stats_retention_days !== saved.stats_retention_days
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

              <div className="space-y-3 rounded-md border p-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-sm font-medium">
                      Cloudflare Turnstile 人机验证
                    </Label>
                    {(() => {
                      const s = turnstileStatus(
                        draft.turnstile_site_key,
                        draft.turnstile_secret_key
                      )
                      const cls =
                        s.tone === "ok"
                          ? "text-xs text-green-600"
                          : s.tone === "err"
                            ? "text-xs text-destructive"
                            : "text-xs text-muted-foreground"
                      return <span className={cls}>{s.label}</span>
                    })()}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    两者都填=启用；都留空=关闭；只填其中一个视为配置错误，登录/注册将被拒绝。保存后立即生效，刷新登录/注册页可见。
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="turnstile_site_key" className="text-xs">
                    Site Key
                  </Label>
                  <Input
                    id="turnstile_site_key"
                    autoComplete="off"
                    spellCheck={false}
                    value={draft.turnstile_site_key}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        turnstile_site_key: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="turnstile_secret_key" className="text-xs">
                    Secret Key
                  </Label>
                  <Input
                    id="turnstile_secret_key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={draft.turnstile_secret_key}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        turnstile_secret_key: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-md border p-3">
                <div className="space-y-1">
                  <Label
                    htmlFor="agent_bundle_url"
                    className="text-sm font-medium"
                  >
                    Agent 安装包地址
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    用于节点「一键部署」下载 h2o-agent
                    安装包（h2o-agent-bundle.tar.gz）。 留空时默认使用 GitHub
                    Releases 最新地址。
                  </p>
                </div>
                <Input
                  id="agent_bundle_url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://github.com/SIPC/H2O/releases/latest/download/h2o-agent-bundle.tar.gz"
                  value={draft.agent_bundle_url}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      agent_bundle_url: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-3 rounded-md border p-3">
                <div className="space-y-1">
                  <Label
                    htmlFor="stats_retention_days"
                    className="text-sm font-medium"
                  >
                    统计保留天数
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    超过该天数的面板小时统计会自动清理（全局/节点/订阅趋势）。建议
                    30~90 天。
                  </p>
                </div>
                <Input
                  id="stats_retention_days"
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  value={draft.stats_retention_days}
                  onChange={(e) =>
                    setDraft((prev) => {
                      const next = Number(e.target.value)
                      if (!Number.isInteger(next)) return prev
                      return {
                        ...prev,
                        stats_retention_days: Math.min(365, Math.max(1, next)),
                      }
                    })
                  }
                />
              </div>

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

      <Card>
        <CardHeader>
          <CardTitle>问题反馈</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            使用中遇到问题或有功能建议，欢迎加入交流群反馈。
          </p>
          <Button asChild variant="outline">
            <a href="https://t.me/h2o_msg" target="_blank" rel="noreferrer">
              前往反馈群
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
