import { serveSubscription } from "@/lib/subscription/serve-subscription"

// 兼容旧订阅路径：/api/sub/[token]
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  return serveSubscription(request, token)
}
