import type { Metadata } from "next"
import { createLocalizedMetadata } from "@/lib/i18n/metadata"

export function generateMetadata(): Promise<Metadata> {
  return createLocalizedMetadata("metadata.init")
}

export default function InitLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
