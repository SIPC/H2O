"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { FormEvent, Fragment, ReactNode, useEffect, useState } from "react"
import { useTheme } from "next-themes"
import {
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Moon,
  Shield,
  Sun,
  UserCircle2,
} from "lucide-react"

import { ConfirmProvider } from "@/components/confirm-provider"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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

type VersionCheckData = {
  currentVersion: string
  latestVersion: string | null
  hasUpdate: boolean
  releaseUrl: string
  checkFailed: boolean
  checkedAt: string
}

type AdminSubMenu =
  | { title: string; href: string }
  | { title: string; items: { title: string; href: string }[] }

const adminSubMenus: AdminSubMenu[] = [
  { title: "用户管理", href: "/admin/users" },
  { title: "节点管理", href: "/admin/nodes" },
  { title: "套餐管理", href: "/admin/plans" },
  { title: "订阅管理", href: "/admin/subscriptions" },
  { title: "流量分析", href: "/admin/traffic-analysis" },
  {
    title: "日志",
    items: [
      { title: "事件日志", href: "/admin/event-logs" },
      { title: "认证日志", href: "/admin/auth-logs" },
    ],
  },
  { title: "站点设置", href: "/admin/settings" },
]

function isRouteActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(`${href}/`)
}

type Crumb = { title: string; href?: string }

// 根据当前路径生成面包屑：admin 二级页先挂"管理概览"再挂子页标题；有分组的日志再补一层
function getBreadcrumbs(pathname: string): Crumb[] {
  if (pathname.startsWith("/admin")) {
    const crumbs: Crumb[] = [{ title: "管理概览", href: "/admin" }]
    if (pathname !== "/admin") {
      for (const item of adminSubMenus) {
        if ("items" in item) {
          const child = item.items.find((c) => isRouteActive(pathname, c.href))
          if (child) {
            crumbs.push({ title: item.title }, { title: child.title })
            break
          }
        } else if (isRouteActive(pathname, item.href)) {
          crumbs.push({ title: item.title })
          break
        }
      }
    }
    return crumbs
  }
  if (pathname.startsWith("/dashboard")) {
    return [{ title: "我的订阅" }]
  }
  return []
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [ready, setReady] = useState(false)
  const [adminMenuOpen, setAdminMenuOpen] = useState(
    pathname.startsWith("/admin")
  )
  const [logsMenuOpen, setLogsMenuOpen] = useState(() =>
    adminSubMenus.some(
      (item) =>
        "items" in item &&
        item.items.some((child) => isRouteActive(pathname, child.href))
    )
  )
  const { resolvedTheme, setTheme } = useTheme()

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

  useEffect(() => {
    if (user?.role !== "admin") return

    let mounted = true

    void (async () => {
      const response = await fetch("/api/admin/version-check")
      const json = await response.json()

      if (!mounted) return
      if (!response.ok || !json?.ok) return

      const data = json.data as VersionCheckData
      if (!data.hasUpdate) return

      toast.info(`发现新版本：v${data.latestVersion}`, {
        description: `建议尽快更新以获取最新功能与修复。`,
        action: {
          label: "前往更新",
          onClick: () => {
            window.open(data.releaseUrl, "_blank", "noopener,noreferrer")
          },
        },
        duration: 12000,
      })
    })()

    return () => {
      mounted = false
    }
  }, [user?.role])

  async function logout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await fetch("/api/auth/logout", { method: "POST" })
    router.replace("/login")
  }

  if (!ready || !user) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        加载中...
      </div>
    )
  }

  return (
    <TooltipProvider>
      <ConfirmProvider>
        <Toaster position="bottom-right" />
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
                      <SidebarMenuButton
                        asChild
                        isActive={isRouteActive(pathname, "/dashboard")}
                        tooltip="我的订阅"
                      >
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
                          <SidebarMenuButton
                            asChild
                            isActive={pathname.startsWith("/admin")}
                            tooltip="管理概览"
                          >
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
                              {adminSubMenus.map((item) => {
                                if ("items" in item) {
                                  const isGroupActive = item.items.some(
                                    (child) =>
                                      isRouteActive(pathname, child.href)
                                  )
                                  return (
                                    <Collapsible
                                      key={item.title}
                                      asChild
                                      open={logsMenuOpen}
                                      onOpenChange={setLogsMenuOpen}
                                      className="group/logs-collapsible"
                                    >
                                      <SidebarMenuSubItem>
                                        <CollapsibleTrigger asChild>
                                          <SidebarMenuSubButton
                                            asChild
                                            isActive={isGroupActive}
                                          >
                                            <button
                                              type="button"
                                              className="w-full"
                                            >
                                              <span className="flex-1 text-left">
                                                {item.title}
                                              </span>
                                              <ChevronRight className="ml-auto size-3.5 transition-transform duration-200 group-data-[state=open]/logs-collapsible:rotate-90" />
                                            </button>
                                          </SidebarMenuSubButton>
                                        </CollapsibleTrigger>
                                        <CollapsibleContent>
                                          <SidebarMenuSub>
                                            {item.items.map((child) => (
                                              <SidebarMenuSubItem
                                                key={child.href}
                                              >
                                                <SidebarMenuSubButton
                                                  asChild
                                                  isActive={isRouteActive(
                                                    pathname,
                                                    child.href
                                                  )}
                                                >
                                                  <Link href={child.href}>
                                                    <span>{child.title}</span>
                                                  </Link>
                                                </SidebarMenuSubButton>
                                              </SidebarMenuSubItem>
                                            ))}
                                          </SidebarMenuSub>
                                        </CollapsibleContent>
                                      </SidebarMenuSubItem>
                                    </Collapsible>
                                  )
                                }
                                return (
                                  <SidebarMenuSubItem key={item.href}>
                                    <SidebarMenuSubButton
                                      asChild
                                      isActive={isRouteActive(
                                        pathname,
                                        item.href
                                      )}
                                    >
                                      <Link href={item.href}>
                                        <span>{item.title}</span>
                                      </Link>
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                )
                              })}
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
                    <p className="truncate font-medium text-sidebar-foreground">
                      {user.username}
                    </p>
                    <p className="truncate text-sidebar-foreground/65">
                      {user.role === "admin" ? "管理员" : "普通用户"}
                    </p>
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
                  <span className="group-data-[collapsible=icon]:hidden">
                    退出登录
                  </span>
                </Button>
              </form>
            </SidebarFooter>
          </Sidebar>

          <SidebarInset>
            <header className="sticky top-0 z-20 flex h-12 items-center border-b bg-background/80 px-4 backdrop-blur">
              <SidebarTrigger className="mr-2" />
              <Breadcrumb>
                <BreadcrumbList>
                  {getBreadcrumbs(pathname).map((crumb, index, arr) => {
                    const isLast = index === arr.length - 1
                    return (
                      <Fragment key={`${crumb.title}-${index}`}>
                        {index > 0 ? <BreadcrumbSeparator /> : null}
                        <BreadcrumbItem>
                          {isLast || !crumb.href ? (
                            <BreadcrumbPage>{crumb.title}</BreadcrumbPage>
                          ) : (
                            <BreadcrumbLink asChild>
                              <Link href={crumb.href}>{crumb.title}</Link>
                            </BreadcrumbLink>
                          )}
                        </BreadcrumbItem>
                      </Fragment>
                    )
                  })}
                </BreadcrumbList>
              </Breadcrumb>
              <Button
                variant="outline"
                size="icon"
                className="ml-auto"
                onClick={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
              >
                <Sun className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
                <Moon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
                <span className="sr-only">切换主题</span>
              </Button>
            </header>

            <main className="flex-1">{children}</main>
          </SidebarInset>
        </SidebarProvider>
      </ConfirmProvider>
    </TooltipProvider>
  )
}
