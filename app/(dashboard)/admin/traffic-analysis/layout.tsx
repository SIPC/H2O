import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "流量分析",
}

export default function AdminTrafficAnalysisLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
