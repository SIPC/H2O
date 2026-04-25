import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "站点设置",
}

export default function AdminSettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
