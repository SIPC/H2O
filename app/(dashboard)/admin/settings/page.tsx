"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { useConfirm } from "@/components/confirm-provider"
import { TurnstileWidget } from "@/components/turnstile-widget"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

type Settings = {
  registration_enabled: boolean
  login_enabled: boolean
  new_user_default_active: boolean
  turnstile_site_key: string
  turnstile_secret_key: string
  agent_bundle_url: string
  stats_retention_days: number
  cloudflare_api_token: string
  acme_email: string
}

const DEFAULTS: Settings = {
  registration_enabled: true,
  login_enabled: true,
  new_user_default_active: true,
  turnstile_site_key: "",
  turnstile_secret_key: "",
  agent_bundle_url: "",
  stats_retention_days: 30,
  cloudflare_api_token: "",
  acme_email: "",
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
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
      />
      <div className="min-w-0 space-y-0.5">
        <span className="text-sm font-medium">{label}</span>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </label>
  )
}

export default function AdminSettingsPage() {
  const { confirm } = useConfirm()
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState<Settings>(DEFAULTS)
  const [draft, setDraft] = useState<Settings>(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [turnstileVerifyProof, setTurnstileVerifyProof] = useState("")
  const [turnstileVerifiedKeys, setTurnstileVerifiedKeys] = useState<{
    siteKey: string
    secretKey: string
  } | null>(null)
  const [turnstileVerifying, setTurnstileVerifying] = useState(false)
  const [turnstileVerifyMessage, setTurnstileVerifyMessage] = useState("")
  const turnstileVerifySeq = useRef(0)

  const dirty = useMemo(() => {
    return (
      draft.registration_enabled !== saved.registration_enabled ||
      draft.login_enabled !== saved.login_enabled ||
      draft.new_user_default_active !== saved.new_user_default_active ||
      draft.turnstile_site_key !== saved.turnstile_site_key ||
      draft.turnstile_secret_key !== saved.turnstile_secret_key ||
      draft.agent_bundle_url !== saved.agent_bundle_url ||
      draft.stats_retention_days !== saved.stats_retention_days ||
      draft.cloudflare_api_token !== saved.cloudflare_api_token ||
      draft.acme_email !== saved.acme_email
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

  const turnstileKeysChanged =
    draft.turnstile_site_key.trim() !== saved.turnstile_site_key.trim() ||
    draft.turnstile_secret_key.trim() !== saved.turnstile_secret_key.trim()
  const turnstileDraftEnabled = Boolean(
    draft.turnstile_site_key.trim() && draft.turnstile_secret_key.trim()
  )
  const requiresTurnstileVerification =
    turnstileKeysChanged && turnstileDraftEnabled
  const turnstileProofValidForDraft = Boolean(
    turnstileVerifyProof &&
    turnstileVerifiedKeys?.siteKey === draft.turnstile_site_key.trim() &&
    turnstileVerifiedKeys?.secretKey === draft.turnstile_secret_key.trim()
  )

  function resetTurnstileVerification() {
    turnstileVerifySeq.current += 1
    setTurnstileVerifyProof("")
    setTurnstileVerifiedKeys(null)
    setTurnstileVerifying(false)
    setTurnstileVerifyMessage("")
  }

  async function verifyTurnstileDraft(token: string) {
    const siteKey = draft.turnstile_site_key.trim()
    const secretKey = draft.turnstile_secret_key.trim()
    if (!siteKey || !secretKey) return

    const requestSeq = turnstileVerifySeq.current + 1
    turnstileVerifySeq.current = requestSeq
    setTurnstileVerifyProof("")
    setTurnstileVerifiedKeys(null)
    setTurnstileVerifying(true)
    setTurnstileVerifyMessage("正在用 Secret Key 验证...")

    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          turnstileVerifySiteKey: siteKey,
          turnstileVerifySecretKey: secretKey,
          turnstileVerifyToken: token,
        }),
      })
      const json = await response.json()
      if (requestSeq !== turnstileVerifySeq.current) return

      if (!response.ok || !json?.ok || typeof json.data?.proof !== "string") {
        setTurnstileVerifyMessage(
          json?.error?.message ?? "Secret Key 校验失败，请检查后重试"
        )
        return
      }

      setTurnstileVerifyProof(json.data.proof)
      setTurnstileVerifiedKeys({ siteKey, secretKey })
      setTurnstileVerifyMessage(
        "Site Key 与 Secret Key 均已通过 Cloudflare 校验，可以保存。"
      )
    } catch {
      if (requestSeq !== turnstileVerifySeq.current) return
      setTurnstileVerifyMessage("校验请求失败，请稍后重试")
    } finally {
      if (requestSeq === turnstileVerifySeq.current) {
        setTurnstileVerifying(false)
      }
    }
  }

  async function resetSubscriptionRules() {
    const ok = await confirm({
      title: "重置订阅分流策略",
      description:
        "确定要重置订阅分流策略吗？所有自定义规则、远程规则、策略组和内置策略修改都会恢复默认。",
      confirmText: "重置",
    })
    if (!ok) return

    try {
      const response = await fetch("/api/admin/subscription-rules", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      const json = await response.json()
      if (!response.ok || !json.ok) {
        toast.error("重置失败", {
          description: json?.error?.message ?? "请稍后重试",
        })
        return
      }
      toast.success("已重置", {
        description: "订阅分流策略已恢复默认",
      })
    } catch {
      toast.error("重置失败", {
        description: "网络错误，请稍后重试",
      })
    }
  }

  async function save() {
    if (requiresTurnstileVerification && !turnstileProofValidForDraft) {
      toast.error("无法保存", {
        description:
          "请先完成 Turnstile 配置测试，确认 Site Key 与 Secret Key 都有效",
      })
      return
    }

    setSaving(true)

    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...draft,
          ...(turnstileProofValidForDraft ? { turnstileVerifyProof } : {}),
        }),
      })

      const json = await response.json()

      if (!response.ok || !json.ok) {
        toast.error("保存失败", {
          description: json?.error?.message ?? "请稍后重试",
        })
        return
      }

      const next: Settings = { ...DEFAULTS, ...json.data }
      setSaved(next)
      setDraft(next)
      resetTurnstileVerification()
      toast.success("已保存", {
        description: "站点设置已更新",
      })
    } catch {
      toast.error("保存失败", {
        description: "网络错误，请稍后重试",
      })
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">站点设置</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              全局配置项，修改后需点击保存生效。
            </p>
          </div>
          <Button disabled>保存</Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index}>
              <CardHeader className="p-4 pb-1">
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-5/6" />
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  const ts = turnstileStatus(
    draft.turnstile_site_key,
    draft.turnstile_secret_key
  )
  const saveDisabled =
    !dirty ||
    saving ||
    turnstileVerifying ||
    (requiresTurnstileVerification && !turnstileProofValidForDraft)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      {/* 页面标题 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">站点设置</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            全局配置项，修改后需点击保存生效。
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button onClick={save} disabled={saveDisabled}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* === 基础设置 === */}
        <Card>
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-base leading-none font-semibold">
              基础设置
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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
          </CardContent>
        </Card>

        {/* === Cloudflare Turnstile === */}
        <Card>
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-base leading-none font-semibold">
              <div className="flex items-center justify-between gap-2">
                <span>Turnstile 人机验证</span>
                <span
                  className={
                    ts.tone === "ok"
                      ? "text-xs text-green-600"
                      : ts.tone === "err"
                        ? "text-xs text-destructive"
                        : "text-xs text-muted-foreground"
                  }
                >
                  {ts.label}
                </span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              两者都填=启用；都留空=关闭；只填一个视为配置错误。保存后立即生效。
            </p>
            <div className="space-y-1">
              <Label htmlFor="turnstile_site_key">Site Key</Label>
              <Input
                id="turnstile_site_key"
                autoComplete="off"
                spellCheck={false}
                value={draft.turnstile_site_key}
                onChange={(e) => {
                  resetTurnstileVerification()
                  setDraft((prev) => ({
                    ...prev,
                    turnstile_site_key: e.target.value,
                  }))
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="turnstile_secret_key">Secret Key</Label>
              <Input
                id="turnstile_secret_key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={draft.turnstile_secret_key}
                onChange={(e) => {
                  resetTurnstileVerification()
                  setDraft((prev) => ({
                    ...prev,
                    turnstile_secret_key: e.target.value,
                  }))
                }}
              />
            </div>
            {turnstileKeysChanged && turnstileDraftEnabled && (
              <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                <div className="space-y-1">
                  <Label>保存前测试验证</Label>
                  <p className="text-xs text-muted-foreground">
                    请用上方新 Site Key 完成一次验证；组件返回 token
                    后，后端会立刻用新 Secret Key 调用 Cloudflare
                    校验，校验失败不会允许保存。
                  </p>
                </div>
                <TurnstileWidget
                  key={draft.turnstile_site_key.trim()}
                  siteKey={draft.turnstile_site_key.trim()}
                  onVerify={(token) => void verifyTurnstileDraft(token)}
                  onExpire={resetTurnstileVerification}
                  onError={resetTurnstileVerification}
                />
                <p
                  className={
                    turnstileProofValidForDraft
                      ? "text-xs text-green-600"
                      : turnstileVerifying
                        ? "text-xs text-muted-foreground"
                        : turnstileVerifyMessage
                          ? "text-xs text-destructive"
                          : "text-xs text-muted-foreground"
                  }
                >
                  {turnstileVerifyMessage || "等待完成测试验证。"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* === Agent 配置 === */}
        <Card>
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-base leading-none font-semibold">
              Agent 配置
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="agent_bundle_url">安装包地址</Label>
              <p className="text-xs text-muted-foreground">
                用于节点「一键部署」下载 h2o-agent 安装包。留空时默认使用 GitHub
                Releases 最新地址。
              </p>
              <Input
                id="agent_bundle_url"
                autoComplete="off"
                spellCheck={false}
                placeholder="默认使用 GitHub Releases"
                value={draft.agent_bundle_url}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    agent_bundle_url: e.target.value,
                  }))
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* === 证书与 DNS === */}
        <Card>
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-base leading-none font-semibold">
              证书与 DNS
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              全局默认配置，节点未单独填写时使用这些值。
            </p>
            <div className="space-y-1">
              <Label htmlFor="acme_email">ACME 邮箱</Label>
              <Input
                id="acme_email"
                type="email"
                autoComplete="off"
                spellCheck={false}
                placeholder="邮箱"
                value={draft.acme_email}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    acme_email: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cloudflare_api_token">Cloudflare API Token</Label>
              <Input
                id="cloudflare_api_token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="留空表示不使用"
                value={draft.cloudflare_api_token}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    cloudflare_api_token: e.target.value,
                  }))
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* === 数据统计 === */}
        <Card className="md:col-span-2">
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-base leading-none font-semibold">
              数据统计
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="stats_retention_days">统计保留天数</Label>
              <p className="text-xs text-muted-foreground">
                超过该天数的面板小时统计会自动清理（全局/节点/订阅趋势）。建议
                30~90 天。
              </p>
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
          </CardContent>
        </Card>

        {/* === 订阅分流 === */}
        <Card className="md:col-span-2">
          <CardHeader className="p-4 pb-1">
            <CardTitle className="text-base leading-none font-semibold">
              订阅分流
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              一键恢复默认订阅分流策略，包括被删除的内置策略、规则、远程规则和策略组。
            </p>
            <Button
              variant="outline"
              onClick={() => void resetSubscriptionRules()}
            >
              重置策略
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* 问题反馈 */}
      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            问题反馈
          </CardTitle>
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
