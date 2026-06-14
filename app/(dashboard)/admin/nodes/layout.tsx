import type { Metadata } from "next"
import { createLocalizedMetadata } from "@/lib/i18n/metadata"

export function generateMetadata(): Promise<Metadata> {
  return createLocalizedMetadata("metadata.admin.nodes")
}

export default function AdminNodesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
