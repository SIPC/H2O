import type { Metadata } from "next"
import { createLocalizedMetadata } from "@/lib/i18n/metadata"

export function generateMetadata(): Promise<Metadata> {
  return createLocalizedMetadata("metadata.admin.trafficAnalysis")
}

export default function AdminTrafficAnalysisLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
