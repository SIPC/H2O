"use client"

import { Languages } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Locale } from "@/lib/i18n/locales"

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n()

  return (
    <div className={className}>
      <Select
        value={locale}
        onValueChange={(value) => setLocale(value as Locale)}
      >
        <SelectTrigger
          className="h-8 w-36 gap-2 text-xs"
          aria-label={t("common.language")}
        >
          <Languages className="size-3.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="zh-CN">{t("language.zhCN")}</SelectItem>
          <SelectItem value="en-US">{t("language.enUS")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
