import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "仪表盘",
}

export default function DashboardPageLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
