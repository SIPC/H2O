import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "事件日志",
}

export default function AdminEventLogsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
