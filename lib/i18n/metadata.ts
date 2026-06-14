import type { Metadata } from "next"

import { getMessage, type TranslationKey } from "@/lib/i18n/messages"
import { resolveServerLocale } from "@/lib/i18n/server"

export async function createLocalizedMetadata(
  titleKey: TranslationKey
): Promise<Metadata> {
  const locale = await resolveServerLocale()
  return { title: getMessage(locale, titleKey) }
}
