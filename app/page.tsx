import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function Page() {
  return (
    <div className="flex min-h-svh p-6">
      <div className="flex max-w-2xl min-w-0 flex-col gap-4 text-sm leading-loose">
        <div>
          <h1 className="font-medium">H2O</h1>
          <p>企业内网使用</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/login">登录</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/register">注册</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
