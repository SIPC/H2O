import { serveSubscription } from "@/lib/subscription/serve-subscription"

// 新订阅路径：/api/sub?token=...
export async function GET(request: Request) {
  const url = new URL(request.url)
  return serveSubscription(request, url.searchParams.get("token"))
}
