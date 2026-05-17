import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "出站配置",
}

export default function AdminRoutingOutboundsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
