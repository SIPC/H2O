import type { Metadata } from "next"
import { createLocalizedMetadata } from "@/lib/i18n/metadata"

export function generateMetadata(): Promise<Metadata> {
  return createLocalizedMetadata("metadata.admin.authLogs")
}

export default function AuthLogsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
