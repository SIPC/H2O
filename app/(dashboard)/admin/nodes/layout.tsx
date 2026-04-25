import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "节点管理",
}

export default function AdminNodesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
