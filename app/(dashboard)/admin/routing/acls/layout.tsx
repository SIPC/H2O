import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "ACL 策略",
}

export default function AdminRoutingAclsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
