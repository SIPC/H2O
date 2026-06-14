import type { Metadata } from "next"
import { createLocalizedMetadata } from "@/lib/i18n/metadata"

export function generateMetadata(): Promise<Metadata> {
  return createLocalizedMetadata("metadata.admin.notifications")
}

export default function AdminNotificationsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
