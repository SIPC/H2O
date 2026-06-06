import { NextResponse } from "next/server"

function hasSessionCookie(request: Request) {
  const cookie = request.headers.get("cookie")
  if (!cookie) return false
  return cookie
    .split(";")
    .map((item) => item.trim())
    .some((item) => item.startsWith("h2o_session="))
}

export function proxy(request: Request) {
  const url = new URL(request.url)
  const pathname = url.pathname
  const loggedIn = hasSessionCookie(request)

  if (
    !loggedIn &&
    (pathname.startsWith("/dashboard") || pathname.startsWith("/admin"))
  ) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  if (loggedIn && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/login", "/register"],
}
