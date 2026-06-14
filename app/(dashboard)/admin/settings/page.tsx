"use client"

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { useConfirm } from "@/components/confirm-provider"
import { TurnstileWidget } from "@/components/turnstile-widget"
import {
  ACME_CA_PROVIDER_LABELS,
  ACME_CA_PROVIDERS,
  type AcmeCaProvider,
} from "@/lib/acme-config"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

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
  acme_ca_provider: AcmeCaProvider
  acme_ca_url: string
  geoip_enabled: boolean
  telegram_notifications_enabled: boolean
  telegram_bot_token: string
  telegram_chat_id: string
  telegram_message_thread_id: string
  telegram_notify_node_status: boolean
  telegram_notify_hy2_status: boolean
  telegram_notify_subscription_traffic_exceeded: boolean
  telegram_notify_host_traffic_exceeded: boolean
  telegram_notify_agent_task_failed: boolean
  telegram_node_offline_threshold_minutes: number
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
  acme_ca_provider: "letsencrypt",
  acme_ca_url: "",
  geoip_enabled: true,
  telegram_notifications_enabled: false,
  telegram_bot_token: "",
  telegram_chat_id: "",
  telegram_message_thread_id: "",
  telegram_notify_node_status: true,
  telegram_notify_hy2_status: true,
  telegram_notify_subscription_traffic_exceeded: true,
  telegram_notify_host_traffic_exceeded: true,
  telegram_notify_agent_task_failed: true,
  telegram_node_offline_threshold_minutes: 5,
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
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3 transition-colors hover:bg-muted/40"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </label>
  )
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-4 border-t pt-6 first:border-t-0 first:pt-0 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div className="flex flex-col gap-1 px-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid items-stretch gap-4 md:grid-cols-2 lg:grid-cols-12">
        {children}
      </div>
    </section>
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
  const [telegramTesting, setTelegramTesting] = useState(false)
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
      draft.acme_email !== saved.acme_email ||
      draft.acme_ca_provider !== saved.acme_ca_provider ||
      draft.acme_ca_url !== saved.acme_ca_url ||
      draft.geoip_enabled !== saved.geoip_enabled ||
      draft.telegram_notifications_enabled !==
        saved.telegram_notifications_enabled ||
      draft.telegram_bot_token !== saved.telegram_bot_token ||
      draft.telegram_chat_id !== saved.telegram_chat_id ||
      draft.telegram_message_thread_id !== saved.telegram_message_thread_id ||
      draft.telegram_notify_node_status !== saved.telegram_notify_node_status ||
      draft.telegram_notify_hy2_status !== saved.telegram_notify_hy2_status ||
      draft.telegram_notify_subscription_traffic_exceeded !==
        saved.telegram_notify_subscription_traffic_exceeded ||
      draft.telegram_notify_host_traffic_exceeded !==
        saved.telegram_notify_host_traffic_exceeded ||
      draft.telegram_notify_agent_task_failed !==
        saved.telegram_notify_agent_task_failed ||
      draft.telegram_node_offline_threshold_minutes !==
        saved.telegram_node_offline_threshold_minutes
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

  async function testTelegram() {
    if (!draft.telegram_bot_token.trim() || !draft.telegram_chat_id.trim()) {
      toast.error("无法测试", {
        description: "请先填写 Telegram Bot Token 和 Chat ID",
      })
      return
    }

    setTelegramTesting(true)
    try {
      const response = await fetch("/api/admin/notifications/telegram-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          botToken: draft.telegram_bot_token,
          chatId: draft.telegram_chat_id,
          messageThreadId: draft.telegram_message_thread_id,
        }),
      })
      const json = await response.json()
      if (!response.ok || !json?.ok) {
        toast.error("测试通知失败", {
          description: json?.error?.message ?? "请检查 Telegram 配置",
        })
        return
      }
      toast.success("测试通知已发送", {
        description: "可在 Telegram 和通知历史中查看结果",
      })
    } catch {
      toast.error("测试通知失败", {
        description: "网络错误，请稍后重试",
      })
    } finally {
      setTelegramTesting(false)
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
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold">站点设置</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                全局配置项，修改后需点击保存生效。
              </p>
            </div>
            <Button disabled>保存</Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index}>
              <CardHeader className="p-4 pb-1">
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
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
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* 页面标题与保存操作 */}
      <div className="sticky top-12 z-10 rounded-xl border bg-card/95 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex max-w-3xl flex-col gap-1">
            <h1 className="text-2xl font-bold">站点设置</h1>
            <p className="text-sm text-muted-foreground">
              集中管理访问安全、通知、节点部署与数据保留策略。修改后统一保存生效。
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            <Badge
              className={cn(
                dirty ? "bg-primary/15 text-primary" : "text-muted-foreground"
              )}
            >
              {dirty ? "有未保存更改" : "已保存"}
            </Badge>
            <Button onClick={save} disabled={saveDisabled}>
              {saving ? "保存中..." : "保存更改"}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-8">
        <SettingsSection
          title="访问与安全"
          description="控制账号入口、人机验证和新用户默认启用策略。"
        >
          {/* === 基础设置：中卡 === */}
          <Card className="flex h-full flex-col md:col-span-1 lg:col-span-4">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                基础设置
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <ToggleRow
                id="registration_enabled"
                label="允许新用户注册"
                description="关闭后，用户将无法通过注册页面创建账号"
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
                description="关闭后，新注册用户需由管理员启用后才能登录"
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

          {/* === Cloudflare Turnstile：大卡 === */}
          <Card className="flex h-full flex-col md:col-span-2 lg:col-span-8">
            <CardHeader className="flex flex-col gap-2 p-4 pb-1 sm:flex-row sm:items-start sm:justify-between">
              <CardTitle className="text-base leading-none font-semibold">
                Turnstile 人机验证
              </CardTitle>
              <Badge
                className={cn(
                  ts.tone === "ok" && "bg-primary/15 text-primary",
                  ts.tone === "err" && "bg-destructive/15 text-destructive",
                  ts.tone === "muted" && "text-muted-foreground"
                )}
              >
                {ts.label}
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                同时填写 Site Key 与 Secret Key
                后启用；全部留空则关闭。保存后立即生效。
              </p>
              <div className="flex flex-col gap-1">
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
              <div className="flex flex-col gap-1">
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
                <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
                  <div className="flex flex-col gap-1">
                    <Label>保存前测试验证</Label>
                    <p className="text-xs text-muted-foreground">
                      请使用新的 Site Key 完成验证，验证通过后即可保存。
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
                    className={cn(
                      "text-xs",
                      turnstileProofValidForDraft
                        ? "text-primary"
                        : turnstileVerifying
                          ? "text-muted-foreground"
                          : turnstileVerifyMessage
                            ? "text-destructive"
                            : "text-muted-foreground"
                    )}
                  >
                    {turnstileVerifyMessage || "等待完成测试验证。"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </SettingsSection>

        <SettingsSection
          title="通知触达"
          description="配置 Telegram Bot 通知接收人、触发事件和节点离线阈值。"
        >
          {/* === Telegram 接收配置：大卡 === */}
          <Card className="flex h-full flex-col md:col-span-2 lg:col-span-7">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                接收配置
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <ToggleRow
                id="telegram_notifications_enabled"
                label="启用 Telegram Bot 通知"
                description="启用后，节点上下线、流量超限和 Agent 异常会发送到指定 Telegram 会话"
                checked={draft.telegram_notifications_enabled}
                onChange={(next) =>
                  setDraft((prev) => ({
                    ...prev,
                    telegram_notifications_enabled: next,
                  }))
                }
              />
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1 md:col-span-2">
                  <Label htmlFor="telegram_bot_token">Bot Token</Label>
                  <Input
                    id="telegram_bot_token"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="123456789:AA..."
                    value={draft.telegram_bot_token}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        telegram_bot_token: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="telegram_chat_id">Chat ID</Label>
                  <Input
                    id="telegram_chat_id"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="-100... 或 @channel"
                    value={draft.telegram_chat_id}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        telegram_chat_id: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="telegram_message_thread_id">
                    Topic ID（可选）
                  </Label>
                  <Input
                    id="telegram_message_thread_id"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="群组话题 ID"
                    value={draft.telegram_message_thread_id}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        telegram_message_thread_id: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="telegram_node_offline_threshold_minutes">
                    离线阈值（分钟）
                  </Label>
                  <Input
                    id="telegram_node_offline_threshold_minutes"
                    type="number"
                    min={1}
                    max={1440}
                    step={1}
                    value={draft.telegram_node_offline_threshold_minutes}
                    onChange={(e) =>
                      setDraft((prev) => {
                        const next = Number(e.target.value)
                        if (!Number.isInteger(next)) return prev
                        return {
                          ...prev,
                          telegram_node_offline_threshold_minutes: Math.min(
                            1440,
                            Math.max(1, next)
                          ),
                        }
                      })
                    }
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={telegramTesting}
                    onClick={() => void testTelegram()}
                  >
                    {telegramTesting ? "发送中..." : "发送测试通知"}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Bot Token
                会保存到站点设置中，事件日志只记录是否已设置，不记录明文。
              </p>
            </CardContent>
          </Card>

          {/* === 通知事件：中卡 === */}
          <Card className="flex h-full flex-col md:col-span-2 lg:col-span-5">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                通知事件
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <ToggleRow
                id="telegram_notify_node_status"
                label="节点上线 / 离线"
                checked={draft.telegram_notify_node_status}
                onChange={(next) =>
                  setDraft((prev) => ({
                    ...prev,
                    telegram_notify_node_status: next,
                  }))
                }
              />
              <ToggleRow
                id="telegram_notify_hy2_status"
                label="Hysteria2 异常 / 恢复"
                checked={draft.telegram_notify_hy2_status}
                onChange={(next) =>
                  setDraft((prev) => ({
                    ...prev,
                    telegram_notify_hy2_status: next,
                  }))
                }
              />
              <ToggleRow
                id="telegram_notify_subscription_traffic_exceeded"
                label="订阅流量超限"
                checked={draft.telegram_notify_subscription_traffic_exceeded}
                onChange={(next) =>
                  setDraft((prev) => ({
                    ...prev,
                    telegram_notify_subscription_traffic_exceeded: next,
                  }))
                }
              />
              <ToggleRow
                id="telegram_notify_host_traffic_exceeded"
                label="节点宿主机流量超限"
                checked={draft.telegram_notify_host_traffic_exceeded}
                onChange={(next) =>
                  setDraft((prev) => ({
                    ...prev,
                    telegram_notify_host_traffic_exceeded: next,
                  }))
                }
              />
              <ToggleRow
                id="telegram_notify_agent_task_failed"
                label="Agent 任务失败"
                checked={draft.telegram_notify_agent_task_failed}
                onChange={(next) =>
                  setDraft((prev) => ({
                    ...prev,
                    telegram_notify_agent_task_failed: next,
                  }))
                }
              />
            </CardContent>
          </Card>
        </SettingsSection>

        <SettingsSection
          title="证书、DNS 与订阅"
          description="管理节点证书默认值、Cloudflare DNS Token 和订阅分流维护操作。"
        >
          {/* === 证书与 DNS：大卡 === */}
          <Card className="flex h-full flex-col md:col-span-2 lg:col-span-8">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                证书与 DNS
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                全局默认配置，节点未单独填写时使用这些值。
              </p>
              <div className="flex flex-col gap-1">
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
              <div className="flex flex-col gap-1">
                <Label>默认 ACME CA</Label>
                <Select
                  value={draft.acme_ca_provider}
                  onValueChange={(value) =>
                    setDraft((prev) => ({
                      ...prev,
                      acme_ca_provider: value as AcmeCaProvider,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      {ACME_CA_PROVIDERS.map((provider) => (
                        <SelectItem key={provider} value={provider}>
                          {ACME_CA_PROVIDER_LABELS[provider]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  选择默认 ACME CA，节点可单独覆盖此设置。
                </p>
              </div>
              {draft.acme_ca_provider === "custom" && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="acme_ca_url">ACME Directory URL</Label>
                  <Input
                    id="acme_ca_url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="https://acme.example.com/directory"
                    value={draft.acme_ca_url}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        acme_ca_url: e.target.value,
                      }))
                    }
                  />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <Label htmlFor="cloudflare_api_token">
                  Cloudflare API Token
                </Label>
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

          {/* === 订阅分流：小卡 === */}
          <Card className="flex h-full flex-col md:col-span-2 lg:col-span-4">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                订阅分流
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-4">
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
        </SettingsSection>

        <SettingsSection
          title="节点部署与数据"
          description="管理 Agent 安装包、GeoIP 地图能力和统计数据保留周期。"
        >
          {/* === Agent 配置：中卡 === */}
          <Card className="flex h-full flex-col md:col-span-2 lg:col-span-6">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                Agent 配置
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="agent_bundle_url">安装包地址</Label>
                <p className="text-xs text-muted-foreground">
                  用于节点一键部署时下载 H2O Agent
                  安装包；留空则使用官方默认地址。
                </p>
                <Input
                  id="agent_bundle_url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="使用官方默认地址"
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

          {/* === GeoIP 与地图：小卡 === */}
          <Card className="flex h-full flex-col md:col-span-1 lg:col-span-3">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                GeoIP 与地图
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <ToggleRow
                id="geoip_enabled"
                label="启用 GeoIP 解析"
                description="启用后将节点公网 IP 提交至第三方 GeoIP 服务，用于获取地理位置并展示；关闭后仅保存公网 IP。"
                checked={draft.geoip_enabled}
                onChange={(next) =>
                  setDraft((prev) => ({ ...prev, geoip_enabled: next }))
                }
              />
            </CardContent>
          </Card>

          {/* === 数据统计：小卡 === */}
          <Card className="flex h-full flex-col md:col-span-1 lg:col-span-3">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                数据统计
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <div className="flex flex-col gap-1">
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
        </SettingsSection>

        <SettingsSection
          title="支持"
          description="遇到问题或有建议时，可通过官方反馈渠道联系我们。"
        >
          {/* 问题反馈：小卡 */}
          <Card className="flex h-full flex-col md:col-span-1 lg:col-span-4">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                问题反馈
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                如需帮助或提交建议，请通过官方反馈渠道联系我们。
              </p>
              <Button asChild variant="outline">
                <a href="https://t.me/h2o_msg" target="_blank" rel="noreferrer">
                  前往反馈群
                </a>
              </Button>
            </CardContent>
          </Card>
        </SettingsSection>
      </div>
    </div>
  )
}
