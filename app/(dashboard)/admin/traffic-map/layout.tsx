import type { Metadata } from "next"
import { createLocalizedMetadata } from "@/lib/i18n/metadata"

export function generateMetadata(): Promise<Metadata> {
  return createLocalizedMetadata("metadata.admin.trafficMap")
}

export default function AdminTrafficMapLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
