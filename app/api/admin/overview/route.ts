import { localizedJson } from "@/lib/i18n/api-response"

import packageJson from "@/package.json"
import { requireAdmin } from "@/lib/auth"
import { getDb } from "@/lib/db"

function getCurrentVersion() {
  const raw =
    typeof packageJson.version === "string" ? packageJson.version : "0.0.0"
  const normalized = raw.trim().replace(/^v/i, "")
  return normalized || "0.0.0"
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const db = getDb()
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM nodes) AS nodes,
         (SELECT COUNT(*) FROM plans) AS plans,
         (SELECT COUNT(*) FROM subscriptions) AS subscriptions`
    )
    .get() as
    | {
        users: number
        nodes: number
        plans: number
        subscriptions: number
      }
    | undefined

  return localizedJson(request, {
    ok: true,
    data: {
      user: auth.user,
      currentVersion: getCurrentVersion(),
      overview: {
        users: row?.users ?? 0,
        nodes: row?.nodes ?? 0,
        plans: row?.plans ?? 0,
        subscriptions: row?.subscriptions ?? 0,
      },
    },
  })
}
