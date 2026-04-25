import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "订阅管理",
}

export default function AdminSubscriptionsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
