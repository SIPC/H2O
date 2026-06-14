import type { Metadata } from "next"
import { createLocalizedMetadata } from "@/lib/i18n/metadata"

export function generateMetadata(): Promise<Metadata> {
  return createLocalizedMetadata("metadata.admin.reportLogs")
}

export default function AdminReportLogsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
