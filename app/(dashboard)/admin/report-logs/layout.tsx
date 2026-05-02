import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "上报日志",
}

export default function AdminReportLogsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
