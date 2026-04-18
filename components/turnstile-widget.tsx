"use client"

import { Turnstile } from "@marsidev/react-turnstile"
import { useTheme } from "next-themes"
import { useEffect, useRef, useSyncExternalStore } from "react"

type Props = {
  onVerify: (token: string) => void
  onExpire?: () => void
  onError?: () => void
  className?: string
}

// 仅在客户端渲染为 true，用来避免 SSR 与 next-themes 首渲 theme 不一致
function useMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
}

// Turnstile 组件封装：未配置 site key 时直接返回 null，组件在 onVerify 传回 token 后由父组件带去服务端
export function TurnstileWidget({
  onVerify,
  onExpire,
  onError,
  className,
}: Props) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const { resolvedTheme } = useTheme()
  const mounted = useMounted()
  const onVerifyRef = useRef(onVerify)
  const onExpireRef = useRef(onExpire)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onVerifyRef.current = onVerify
    onExpireRef.current = onExpire
    onErrorRef.current = onError
  }, [onVerify, onExpire, onError])

  if (!siteKey) return null
  if (!mounted) return null

  return (
    <div className={className}>
      <Turnstile
        siteKey={siteKey}
        onSuccess={(token) => onVerifyRef.current(token)}
        onExpire={() => onExpireRef.current?.()}
        onError={() => onErrorRef.current?.()}
        options={{
          theme: resolvedTheme === "dark" ? "dark" : "light",
          size: "flexible",
        }}
      />
    </div>
  )
}

export function isTurnstileClientEnabled() {
  return Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
}
