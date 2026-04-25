import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "认证日志",
}

export default function AuthLogsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
