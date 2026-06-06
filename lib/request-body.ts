export class RequestBodyTooLargeError extends Error {
  constructor(message = "请求体过大") {
    super(message)
    this.name = "RequestBodyTooLargeError"
  }
}

export class InvalidJsonBodyError extends Error {
  constructor(message = "请求体不合法") {
    super(message)
    this.name = "InvalidJsonBodyError"
  }
}

export async function readTextWithLimit(request: Request, maxBytes: number) {
  const contentLength = request.headers.get("content-length")
  if (contentLength && /^\d+$/.test(contentLength)) {
    const length = Number(contentLength)
    if (Number.isFinite(length) && length > maxBytes) {
      throw new RequestBodyTooLargeError()
    }
  }

  const reader = request.body?.getReader()
  if (!reader) return ""

  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      try {
        await reader.cancel()
      } catch {
        // 忽略取消读取异常
      }
      throw new RequestBodyTooLargeError()
    }
    chunks.push(value)
  }

  return new TextDecoder().decode(concatChunks(chunks, total))
}

export async function readJsonWithLimit<T>(request: Request, maxBytes: number) {
  const text = await readTextWithLimit(request, maxBytes)
  if (!text.trim()) throw new InvalidJsonBodyError()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new InvalidJsonBodyError()
  }
}

function concatChunks(chunks: Uint8Array[], total: number) {
  if (chunks.length === 1) return chunks[0]
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}
