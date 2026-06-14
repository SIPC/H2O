import type { Metadata } from "next"
import { createLocalizedMetadata } from "@/lib/i18n/metadata"

export function generateMetadata(): Promise<Metadata> {
  return createLocalizedMetadata("metadata.register")
}

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
