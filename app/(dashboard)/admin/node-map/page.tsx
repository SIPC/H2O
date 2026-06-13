"use client"

import { useEffect, useState } from "react"

import {
  EMPTY_NODE_TRAFFIC_MAP,
  NodeTrafficWorldMap,
  normalizeNodeTrafficMapData,
  type NodeTrafficMapData,
} from "@/components/admin/node-traffic-world-map"
import { Skeleton } from "@/components/ui/skeleton"

export default function AdminNodeMapPage() {
  const [data, setData] = useState<NodeTrafficMapData>(EMPTY_NODE_TRAFFIC_MAP)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    void (async () => {
      try {
        const response = await fetch("/api/admin/traffic/node-map")
        const json = await response.json()
        if (!mounted) return
        if (json?.ok) setData(normalizeNodeTrafficMapData(json.data))
      } finally {
        if (mounted) setLoading(false)
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  if (loading) {
    return (
      <div className="relative h-[calc(100svh-3rem)] overflow-hidden bg-background">
        <Skeleton className="h-full w-full rounded-none" />
      </div>
    )
  }

  return (
    <div className="w-full">
      <NodeTrafficWorldMap data={data} variant="canvas" />
    </div>
  )
}
