"use client"

import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type SessionUser = {
  id: number
  username: string
  role: "user" | "admin"
}

type AdminOverview = {
  users: number
  nodes: number
  plans: number
  subscriptions: number
}

export default function AdminPage() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [overview, setOverview] = useState<AdminOverview>({ users: 0, nodes: 0, plans: 0, subscriptions: 0 })

  useEffect(() => {
    let mounted = true

    void (async () => {
      const [sessionRes, usersRes, nodesRes, plansRes, subsRes] = await Promise.all([
        fetch("/api/auth/session"),
        fetch("/api/admin/users"),
        fetch("/api/admin/nodes"),
        fetch("/api/admin/plans"),
        fetch("/api/admin/subscriptions"),
      ])

      const sessionJson = await sessionRes.json()
      const usersJson = await usersRes.json()
      const nodesJson = await nodesRes.json()
      const plansJson = await plansRes.json()
      const subsJson = await subsRes.json()

      if (!mounted) return

      if (sessionJson?.ok) setUser(sessionJson.data.user)
      setOverview({
        users: usersJson?.ok ? usersJson.data.length : 0,
        nodes: nodesJson?.ok ? nodesJson.data.length : 0,
        plans: plansJson?.ok ? plansJson.data.length : 0,
        subscriptions: subsJson?.ok ? subsJson.data.length : 0,
      })
    })()

    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>管理概览</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm">
          <span>当前用户：{user?.username ?? "-"}</span>
          <Badge>{user?.role ?? "admin"}</Badge>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">用户数</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{overview.users}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">节点数</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{overview.nodes}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">套餐数</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{overview.plans}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">订阅数</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{overview.subscriptions}</CardContent>
        </Card>
      </div>
    </div>
  )
}
