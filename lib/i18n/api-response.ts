import { NextResponse } from "next/server"

import { translateApiErrorMessage } from "@/lib/i18n/messages"
import { resolveLocaleFromRequest } from "@/lib/i18n/server"

type JsonBody = Record<string, unknown>

type ErrorBody = JsonBody & {
  ok?: false
  error?: {
    code?: string
    message?: string
    [key: string]: unknown
  }
}

function localizeBody(request: Request, body: unknown): unknown {
  if (!body || typeof body !== "object") return body
  const next = body as ErrorBody
  if (next.ok !== false || !next.error || typeof next.error !== "object") {
    return body
  }

  const locale = resolveLocaleFromRequest(request)
  return {
    ...next,
    error: {
      ...next.error,
      message: translateApiErrorMessage(
        next.error.code,
        next.error.message,
        locale
      ),
    },
  }
}

export function localizedJson(
  request: Request,
  body: unknown,
  init?: ResponseInit
) {
  return NextResponse.json(localizeBody(request, body), init)
}

export function jsonError(
  request: Request,
  code: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>
) {
  return localizedJson(
    request,
    {
      ok: false,
      error: { code, message, ...extra },
    },
    { status }
  )
}
