"use client"

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { useConfirm } from "@/components/confirm-provider"
import { useI18n } from "@/components/i18n-provider"
import { TurnstileWidget } from "@/components/turnstile-widget"
import { ACME_CA_PROVIDERS, type AcmeCaProvider } from "@/lib/acme-config"
import type { Locale } from "@/lib/i18n/locales"
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
  ui_language: Locale
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
  ui_language: "zh-CN",
}

// 根据两 key 填写情况推断 Turnstile 当前状态，与后端 getTurnstileStatus 一致
function turnstileStatus(site: string, secret: string) {
  const s = site.trim()
  const k = secret.trim()
  if (!s && !k)
    return {
      labelKey: "adminSettings.turnstile.status.disabled",
      tone: "muted" as const,
    }
  if (s && k)
    return {
      labelKey: "adminSettings.turnstile.status.enabled",
      tone: "ok" as const,
    }
  return {
    labelKey: "adminSettings.turnstile.status.misconfigured",
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
  const { setLocale, t } = useI18n()
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
        saved.telegram_node_offline_threshold_minutes ||
      draft.ui_language !== saved.ui_language
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
    setTurnstileVerifyMessage(t("adminSettings.turnstile.verify.verifying"))

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
          json?.error?.message ?? t("adminSettings.turnstile.verify.failed")
        )
        return
      }

      setTurnstileVerifyProof(json.data.proof)
      setTurnstileVerifiedKeys({ siteKey, secretKey })
      setTurnstileVerifyMessage(t("adminSettings.turnstile.verify.success"))
    } catch {
      if (requestSeq !== turnstileVerifySeq.current) return
      setTurnstileVerifyMessage(
        t("adminSettings.turnstile.verify.requestFailed")
      )
    } finally {
      if (requestSeq === turnstileVerifySeq.current) {
        setTurnstileVerifying(false)
      }
    }
  }

  async function resetSubscriptionRules() {
    const ok = await confirm({
      title: t("adminSettings.resetRules.confirmTitle"),
      description: t("adminSettings.resetRules.confirmDescription"),
      confirmText: t("common.reset"),
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
        toast.error(t("adminSettings.resetRules.failedTitle"), {
          description: json?.error?.message ?? t("common.retryLater"),
        })
        return
      }
      toast.success(t("adminSettings.resetRules.successTitle"), {
        description: t("adminSettings.resetRules.successDescription"),
      })
    } catch {
      toast.error(t("adminSettings.resetRules.failedTitle"), {
        description: t("common.networkError"),
      })
    }
  }

  async function testTelegram() {
    if (!draft.telegram_bot_token.trim() || !draft.telegram_chat_id.trim()) {
      toast.error(t("adminSettings.telegram.cannotTestTitle"), {
        description: t("adminSettings.telegram.cannotTestDescription"),
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
        toast.error(t("adminSettings.telegram.testFailedTitle"), {
          description:
            json?.error?.message ?? t("adminSettings.telegram.checkConfig"),
        })
        return
      }
      toast.success(t("adminSettings.telegram.testSuccessTitle"), {
        description: t("adminSettings.telegram.testSuccessDescription"),
      })
    } catch {
      toast.error(t("adminSettings.telegram.testFailedTitle"), {
        description: t("common.networkError"),
      })
    } finally {
      setTelegramTesting(false)
    }
  }

  async function save() {
    if (requiresTurnstileVerification && !turnstileProofValidForDraft) {
      toast.error(t("adminSettings.save.cannotSaveTitle"), {
        description: t("adminSettings.save.turnstileRequired"),
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
        toast.error(t("adminSettings.save.failedTitle"), {
          description: json?.error?.message ?? t("common.retryLater"),
        })
        return
      }

      const next: Settings = { ...DEFAULTS, ...json.data }
      setSaved(next)
      setDraft(next)
      resetTurnstileVerification()
      setLocale(next.ui_language)
      toast.success(t("adminSettings.save.successTitle"), {
        description: t("adminSettings.save.successDescription"),
      })
    } catch {
      toast.error(t("adminSettings.save.failedTitle"), {
        description: t("common.networkError"),
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
              <h1 className="text-2xl font-bold">{t("adminSettings.title")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("adminSettings.loadingDescription")}
              </p>
            </div>
            <Button disabled>{t("common.save")}</Button>
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
            <h1 className="text-2xl font-bold">{t("adminSettings.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("adminSettings.description")}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            <Badge
              className={cn(
                dirty ? "bg-primary/15 text-primary" : "text-muted-foreground"
              )}
            >
              {dirty ? t("adminSettings.dirty") : t("adminSettings.saved")}
            </Badge>
            <Button onClick={save} disabled={saveDisabled}>
              {saving
                ? t("adminSettings.saving")
                : t("adminSettings.saveChanges")}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-8">
        <SettingsSection
          title={t("adminSettings.language.sectionTitle")}
          description={t("adminSettings.language.sectionDescription")}
        >
          <Card className="flex h-full flex-col md:col-span-2 lg:col-span-6">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                {t("adminSettings.language.globalTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="text-sm text-muted-foreground">
                {t("adminSettings.language.globalDescription")}
              </p>
              <Select
                value={draft.ui_language}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    ui_language: value as Locale,
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh-CN">
                    {t("adminSettings.language.locale.zhCN")}
                  </SelectItem>
                  <SelectItem value="en-US">
                    {t("adminSettings.language.locale.enUS")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </SettingsSection>

        <SettingsSection
          title={t("adminSettings.access.sectionTitle")}
          description={t("adminSettings.access.sectionDescription")}
        >
          {/* === 基础设置：中卡 === */}
          <Card className="flex h-full flex-col md:col-span-1 lg:col-span-4">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                {t("adminSettings.access.basicTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <ToggleRow
                id="registration_enabled"
                label={t("adminSettings.access.registrationLabel")}
                description={t("adminSettings.access.registrationDescription")}
                checked={draft.registration_enabled}
                onChange={(next) =>
                  setDraft((prev) => ({ ...prev, registration_enabled: next }))
                }
              />
              <ToggleRow
                id="login_enabled"
                label={t("adminSettings.access.loginLabel")}
                description={t("adminSettings.access.loginDescription")}
                checked={draft.login_enabled}
                onChange={(next) =>
                  setDraft((prev) => ({ ...prev, login_enabled: next }))
                }
              />
              <ToggleRow
                id="new_user_default_active"
                label={t("adminSettings.access.newUserActiveLabel")}
                description={t("adminSettings.access.newUserActiveDescription")}
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
                {t("adminSettings.turnstile.title")}
              </CardTitle>
              <Badge
                className={cn(
                  ts.tone === "ok" && "bg-primary/15 text-primary",
                  ts.tone === "err" && "bg-destructive/15 text-destructive",
                  ts.tone === "muted" && "text-muted-foreground"
                )}
              >
                {t(ts.labelKey)}
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                {t("adminSettings.turnstile.description")}
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
                    <Label>{t("adminSettings.turnstile.testTitle")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("adminSettings.turnstile.testDescription")}
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
                    {turnstileVerifyMessage ||
                      t("adminSettings.turnstile.verify.waiting")}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </SettingsSection>

        <SettingsSection
          title={t("adminSettings.notifications.sectionTitle")}
          description={t("adminSettings.notifications.sectionDescription")}
        >
          {/* === Telegram 接收配置：大卡 === */}
          <Card className="flex h-full flex-col md:col-span-2 lg:col-span-7">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                {t("adminSettings.telegram.receiverTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <ToggleRow
                id="telegram_notifications_enabled"
                label={t("adminSettings.telegram.enableLabel")}
                description={t("adminSettings.telegram.enableDescription")}
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
                    placeholder={t("adminSettings.telegram.chatIdPlaceholder")}
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
                    {t("adminSettings.telegram.topicLabel")}
                  </Label>
                  <Input
                    id="telegram_message_thread_id"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t("adminSettings.telegram.topicPlaceholder")}
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
                    {t("adminSettings.telegram.offlineThresholdLabel")}
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
                    {telegramTesting
                      ? t("adminSettings.telegram.sending")
                      : t("adminSettings.telegram.sendTest")}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("adminSettings.telegram.secretNotice")}
              </p>
            </CardContent>
          </Card>

          {/* === 通知事件：中卡 === */}
          <Card className="flex h-full flex-col md:col-span-2 lg:col-span-5">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                {t("adminSettings.notifications.eventsTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <ToggleRow
                id="telegram_notify_node_status"
                label={t("adminSettings.notifications.nodeStatus")}
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
                label={t("adminSettings.notifications.hy2Status")}
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
                label={t("adminSettings.notifications.subscriptionExceeded")}
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
                label={t("adminSettings.notifications.hostExceeded")}
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
                label={t("adminSettings.notifications.agentTaskFailed")}
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
          title={t("adminSettings.certs.sectionTitle")}
          description={t("adminSettings.certs.sectionDescription")}
        >
          {/* === 证书与 DNS：大卡 === */}
          <Card className="flex h-full flex-col md:col-span-2 lg:col-span-8">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                {t("adminSettings.certs.cardTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                {t("adminSettings.certs.description")}
              </p>
              <div className="flex flex-col gap-1">
                <Label htmlFor="acme_email">
                  {t("adminSettings.certs.acmeEmailLabel")}
                </Label>
                <Input
                  id="acme_email"
                  type="email"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t("adminSettings.certs.acmeEmailPlaceholder")}
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
                <Label>{t("adminSettings.certs.acmeCaLabel")}</Label>
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
                          {t(`adminSettings.acmeCa.${provider}`)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("adminSettings.certs.acmeCaDescription")}
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
                  placeholder={t(
                    "adminSettings.certs.cloudflareTokenPlaceholder"
                  )}
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
                {t("adminSettings.certs.subscriptionRoutingTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                {t("adminSettings.certs.subscriptionRoutingDescription")}
              </p>
              <Button
                variant="outline"
                onClick={() => void resetSubscriptionRules()}
              >
                {t("adminSettings.certs.resetPolicy")}
              </Button>
            </CardContent>
          </Card>
        </SettingsSection>

        <SettingsSection
          title={t("adminSettings.deploy.sectionTitle")}
          description={t("adminSettings.deploy.sectionDescription")}
        >
          {/* === Agent 配置：中卡 === */}
          <Card className="flex h-full flex-col md:col-span-2 lg:col-span-6">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                {t("adminSettings.agent.cardTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="agent_bundle_url">
                  {t("adminSettings.agent.bundleUrlLabel")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("adminSettings.agent.bundleUrlDescription")}
                </p>
                <Input
                  id="agent_bundle_url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t("adminSettings.agent.bundleUrlPlaceholder")}
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
                {t("adminSettings.geoip.cardTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <ToggleRow
                id="geoip_enabled"
                label={t("adminSettings.geoip.enableLabel")}
                description={t("adminSettings.geoip.enableDescription")}
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
                {t("adminSettings.stats.cardTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="stats_retention_days">
                  {t("adminSettings.stats.retentionLabel")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("adminSettings.stats.retentionDescription")}
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
          title={t("adminSettings.support.sectionTitle")}
          description={t("adminSettings.support.sectionDescription")}
        >
          {/* 问题反馈：小卡 */}
          <Card className="flex h-full flex-col md:col-span-1 lg:col-span-4">
            <CardHeader className="p-4 pb-1">
              <CardTitle className="text-base leading-none font-semibold">
                {t("adminSettings.support.feedbackTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                {t("adminSettings.support.feedbackDescription")}
              </p>
              <Button asChild variant="outline">
                <a href="https://t.me/h2o_msg" target="_blank" rel="noreferrer">
                  {t("adminSettings.support.feedbackButton")}
                </a>
              </Button>
            </CardContent>
          </Card>
        </SettingsSection>
      </div>
    </div>
  )
}
