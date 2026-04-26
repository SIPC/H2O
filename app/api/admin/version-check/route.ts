import { NextResponse } from "next/server"

import packageJson from "@/package.json"
import { requireAdmin } from "@/lib/auth"

const GITHUB_API_LATEST =
  "https://api.github.com/repos/SIPC/H2O/releases/latest"
const RELEASES_FALLBACK_URL = "https://github.com/SIPC/H2O/releases/latest"

type ParsedVersion = {
  core: Array<number | string>
  pre: Array<number | string>
}

type GithubLatestRelease = {
  tag_name?: unknown
  html_url?: unknown
  name?: unknown
  published_at?: unknown
}

function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, "").split("+")[0]
}

function parseIdentifiers(raw: string): Array<number | string> | null {
  const parts = raw
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return null

  return parts.map((part) => (/^\d+$/.test(part) ? Number(part) : part))
}

function parseVersion(raw: string): ParsedVersion | null {
  const normalized = normalizeVersion(raw)
  if (!normalized) return null

  const dashIndex = normalized.indexOf("-")
  const coreRaw = dashIndex >= 0 ? normalized.slice(0, dashIndex) : normalized
  const preRaw = dashIndex >= 0 ? normalized.slice(dashIndex + 1) : ""

  const core = parseIdentifiers(coreRaw)
  if (!core) return null

  const pre = preRaw ? parseIdentifiers(preRaw) : []
  if (preRaw && !pre) return null

  return {
    core,
    pre: pre ?? [],
  }
}

function comparePre(a: Array<number | string>, b: Array<number | string>) {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1

  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i += 1) {
    const ai = a[i]
    const bi = b[i]
    if (ai === undefined) return -1
    if (bi === undefined) return 1

    if (typeof ai === "number" && typeof bi === "number") {
      if (ai > bi) return 1
      if (ai < bi) return -1
      continue
    }

    if (typeof ai === "number" && typeof bi === "string") return -1
    if (typeof ai === "string" && typeof bi === "number") return 1

    const cmp = String(ai).localeCompare(String(bi))
    if (cmp > 0) return 1
    if (cmp < 0) return -1
  }

  return 0
}

function compareIdentifier(a: number | string, b: number | string) {
  if (typeof a === "number" && typeof b === "number") {
    if (a > b) return 1
    if (a < b) return -1
    return 0
  }

  if (typeof a === "number" && typeof b === "string") return 1
  if (typeof a === "string" && typeof b === "number") return -1

  const cmp = String(a).localeCompare(String(b))
  if (cmp > 0) return 1
  if (cmp < 0) return -1
  return 0
}

function compareCore(a: Array<number | string>, b: Array<number | string>) {
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i += 1) {
    const ai = a[i]
    const bi = b[i]
    if (ai === undefined) return -1
    if (bi === undefined) return 1

    const cmp = compareIdentifier(ai, bi)
    if (cmp !== 0) return cmp
  }

  return 0
}

function compareVersion(a: ParsedVersion, b: ParsedVersion) {
  const coreCmp = compareCore(a.core, b.core)
  if (coreCmp !== 0) return coreCmp
  return comparePre(a.pre, b.pre)
}

function toSafeHttpUrl(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback
  try {
    const u = new URL(raw)
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString()
    return fallback
  } catch {
    return fallback
  }
}

export async function GET(request: Request) {
  const auth = requireAdmin(request)
  if (!auth.ok) return auth.response

  const currentRaw =
    typeof packageJson.version === "string" ? packageJson.version : "0.0.0"
  const currentVersion = normalizeVersion(currentRaw)
  const currentParsed = parseVersion(currentVersion)

  if (!currentParsed) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_CURRENT_VERSION",
          message: "当前版本号格式不合法",
        },
      },
      { status: 500 }
    )
  }

  try {
    const response = await fetch(GITHUB_API_LATEST, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "H2O-Version-Checker",
      },
      next: { revalidate: 1800 },
    })

    if (!response.ok) {
      return NextResponse.json({
        ok: true,
        data: {
          currentVersion,
          latestVersion: null,
          hasUpdate: false,
          releaseUrl: RELEASES_FALLBACK_URL,
          checkFailed: true,
          checkedAt: new Date().toISOString(),
        },
      })
    }

    const payload = (await response.json()) as GithubLatestRelease
    const latestTag =
      typeof payload.tag_name === "string" ? payload.tag_name : ""
    const latestVersion = normalizeVersion(latestTag)
    const latestParsed = parseVersion(latestVersion)

    if (!latestParsed) {
      return NextResponse.json({
        ok: true,
        data: {
          currentVersion,
          latestVersion: null,
          hasUpdate: false,
          releaseUrl: RELEASES_FALLBACK_URL,
          checkFailed: true,
          checkedAt: new Date().toISOString(),
        },
      })
    }

    const hasUpdate = compareVersion(latestParsed, currentParsed) > 0

    return NextResponse.json({
      ok: true,
      data: {
        currentVersion,
        latestVersion,
        hasUpdate,
        releaseUrl: toSafeHttpUrl(payload.html_url, RELEASES_FALLBACK_URL),
        checkFailed: false,
        checkedAt: new Date().toISOString(),
      },
    })
  } catch {
    return NextResponse.json({
      ok: true,
      data: {
        currentVersion,
        latestVersion: null,
        hasUpdate: false,
        releaseUrl: RELEASES_FALLBACK_URL,
        checkFailed: true,
        checkedAt: new Date().toISOString(),
      },
    })
  }
}
