import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "套餐管理",
}

export default function AdminPlansLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
