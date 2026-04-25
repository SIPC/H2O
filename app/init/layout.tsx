import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "初始化",
}

export default function InitLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
