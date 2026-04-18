"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { FormEvent, ReactNode, useEffect, useState } from "react"
import { ChevronRight, LayoutDashboard, LogOut, Shield, UserCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

type SessionUser = {
  id: number
  username: string
  role: "user" | "admin"
}

const adminSubMenus = [
  { title: "用户管理", href: "/admin/users" },
  { title: "节点管理", href: "/admin/nodes" },
  { title: "套餐管理", href: "/admin/plans" },
  { title: "订阅管理", href: "/admin/subscriptions" },
  { title: "日志查询", href: "/admin/logs" },
]

function isRouteActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [ready, setReady] = useState(false)
  const [adminMenuOpen, setAdminMenuOpen] = useState(pathname.startsWith("/admin"))

  useEffect(() => {
    let mounted = true

    void (async () => {
      const response = await fetch("/api/auth/session")
      const json = await response.json()

      if (!mounted) return
      if (!response.ok || !json?.ok) {
        router.replace("/login")
        return
      }

      const currentUser = json.data.user as SessionUser
      setUser(currentUser)

      if (currentUser.role !== "admin" && pathname.startsWith("/admin")) {
        router.replace("/dashboard")
        return
      }

      setReady(true)
    })()

    return () => {
      mounted = false
    }
  }, [pathname, router])

  async function logout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await fetch("/api/auth/logout", { method: "POST" })
    router.replace("/login")
  }

  if (!ready || !user) {
    return <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">加载中...</div>
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader className="p-2 pb-1">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild size="lg" className="h-11">
                  <Link href="/dashboard">
                    <div className="flex h-8 w-[120px] items-center group-data-[collapsible=icon]:hidden">
                      <Image
                        src="/logo-black.png"
                        alt="H2O"
                        width={120}
                        height={32}
                        className="h-8 w-auto dark:hidden"
                        priority
                      />
                      <Image
                        src="/logo-white.png"
                        alt="H2O"
                        width={120}
                        height={32}
                        className="hidden h-8 w-auto dark:block"
                        priority
                      />
                    </div>
                    <div className="hidden size-8 items-center justify-center group-data-[collapsible=icon]:flex">
                      <Image
                        src="/logo-black.png"
                        alt="H2O"
                        width={24}
                        height={24}
                        className="h-6 w-6 object-contain dark:hidden"
                      />
                      <Image
                        src="/logo-white.png"
                        alt="H2O"
                        width={24}
                        height={24}
                        className="hidden h-6 w-6 object-contain dark:block"
                      />
                    </div>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>

          <SidebarContent className="pt-1">
            <SidebarGroup className="py-1">
              <SidebarGroupLabel>菜单</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1">
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isRouteActive(pathname, "/dashboard")} tooltip="我的订阅">
                      <Link href="/dashboard">
                        <LayoutDashboard className="size-4" />
                        <span>我的订阅</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  {user.role === "admin" ? (
                    <Collapsible
                      asChild
                      open={adminMenuOpen}
                      onOpenChange={setAdminMenuOpen}
                      className="group/collapsible"
                    >
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild isActive={pathname.startsWith("/admin")} tooltip="管理概览">
                          <Link href="/admin">
                            <Shield className="size-4" />
                            <span>管理概览</span>
                          </Link>
                        </SidebarMenuButton>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuAction className="group-data-[collapsible=icon]:hidden">
                            <ChevronRight className="transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                            <span className="sr-only">切换子菜单</span>
                          </SidebarMenuAction>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {adminSubMenus.map((item) => (
                              <SidebarMenuSubItem key={item.href}>
                                <SidebarMenuSubButton asChild isActive={isRouteActive(pathname, item.href)}>
                                  <Link href={item.href}>
                                    <span>{item.title}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  ) : null}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="p-2 pt-1">
            <div className="rounded-md border border-sidebar-border/70 p-2 group-data-[collapsible=icon]:p-1.5">
              <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
                <UserCircle2 className="size-4 shrink-0" />
                <div className="min-w-0 text-xs group-data-[collapsible=icon]:hidden">
                  <p className="truncate font-medium text-sidebar-foreground">{user.username}</p>
                  <p className="truncate text-sidebar-foreground/65">{user.role === "admin" ? "管理员" : "普通用户"}</p>
                </div>
              </div>
            </div>
            <form onSubmit={logout}>
              <Button
                type="submit"
                variant="outline"
                className="w-full justify-start group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
              >
                <LogOut className="size-4" />
                <span className="group-data-[collapsible=icon]:hidden">退出登录</span>
              </Button>
            </form>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <header className="sticky top-0 z-20 flex h-12 items-center border-b bg-background/80 px-4 backdrop-blur">
            <SidebarTrigger className="mr-2" />
            <span className="text-sm font-medium">{pathname.startsWith("/admin") ? "管理区" : "用户区"}</span>
          </header>
          <main className="flex-1">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
