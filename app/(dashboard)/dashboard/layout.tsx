import type { Metadata } from "next"
import { createLocalizedMetadata } from "@/lib/i18n/metadata"

export function generateMetadata(): Promise<Metadata> {
  return createLocalizedMetadata("metadata.dashboard")
}

export default function DashboardPageLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
