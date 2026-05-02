// Cloudflare DNS API 封装：zone 查询、DNS 记录 CRUD
// 文档：https://developers.cloudflare.com/api/resources/dns/subresources/records/

const CF_API = "https://api.cloudflare.com/client/v4"

// Cloudflare API 中 ttl=1 是“自动”，显式 60 才是一分钟
export const PANEL_DNS_TTL_SECONDS = 60

type CfResponse<T> = {
  success: boolean
  errors: Array<{ code: number; message: string }>
  result: T
}

async function cfFetch<T>(
  apiToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })

  const data = (await res.json()) as CfResponse<T>
  if (!data.success) {
    const msg = data.errors.map((e) => e.message).join("; ")
    throw new Error(`Cloudflare API 错误: ${msg}`)
  }
  return data.result
}

// 从域名中提取根域（zone 域名）
// 如 "sub.example.com" → 尝试 "example.com"、"sub.example.com"
function extractZoneCandidates(domain: string): string[] {
  const parts = domain.split(".")
  const candidates: string[] = []
  // 从两级开始向上尝试（example.com、sub.example.com 的上级等）
  for (let i = 2; i <= parts.length; i++) {
    candidates.push(parts.slice(-i).join("."))
  }
  return candidates
}

type ZoneResult = {
  zoneId: string
  zoneName: string
}

// 查找域名所属的 Cloudflare zone
export async function findZone(
  apiToken: string,
  domain: string
): Promise<ZoneResult | null> {
  const candidates = extractZoneCandidates(domain)
  for (const name of candidates) {
    const results = await cfFetch<Array<{ id: string; name: string }>>(
      apiToken,
      `/zones?name=${encodeURIComponent(name)}&status=active`
    )
    if (results.length > 0) {
      return { zoneId: results[0].id, zoneName: results[0].name }
    }
  }
  return null
}

type DnsRecord = {
  id: string
  name: string
  type: string
  content: string
  ttl: number
  proxied: boolean
}

// 查找已有的 DNS 记录
export async function findDnsRecord(
  apiToken: string,
  zoneId: string,
  name: string,
  type: string = "A"
): Promise<DnsRecord | null> {
  const results = await cfFetch<DnsRecord[]>(
    apiToken,
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}&type=${type}`
  )
  return results.length > 0 ? results[0] : null
}

// 创建 DNS 记录
export async function createDnsRecord(
  apiToken: string,
  zoneId: string,
  name: string,
  content: string,
  type: string = "A",
  proxied: boolean = false
): Promise<{ recordId: string }> {
  const result = await cfFetch<{ id: string }>(
    apiToken,
    `/zones/${zoneId}/dns_records`,
    {
      method: "POST",
      body: JSON.stringify({
        type,
        name,
        content,
        ttl: PANEL_DNS_TTL_SECONDS,
        proxied,
      }),
    }
  )
  return { recordId: result.id }
}

// 更新 DNS 记录
export async function updateDnsRecord(
  apiToken: string,
  zoneId: string,
  recordId: string,
  name: string,
  content: string,
  type: string = "A",
  proxied: boolean = false
): Promise<void> {
  await cfFetch<unknown>(apiToken, `/zones/${zoneId}/dns_records/${recordId}`, {
    method: "PUT",
    body: JSON.stringify({
      type,
      name,
      content,
      ttl: PANEL_DNS_TTL_SECONDS,
      proxied,
    }),
  })
}

// 判断字符串是否为域名（非纯 IP）
export function isDomain(value: string): boolean {
  if (!value || typeof value !== "string") return false
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false
  // IPv6
  if (/^\[/.test(value)) return false
  // 至少包含一个点，且不含空格
  return value.includes(".") && !value.includes(" ")
}
