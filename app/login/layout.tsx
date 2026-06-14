import type { Metadata } from "next"
import { createLocalizedMetadata } from "@/lib/i18n/metadata"

export function generateMetadata(): Promise<Metadata> {
  return createLocalizedMetadata("metadata.login")
}

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
