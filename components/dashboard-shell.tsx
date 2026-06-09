"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Fragment, ReactNode, useEffect, useState } from "react"
import { useTheme } from "next-themes"
import {
  Bell,
  ChevronRight,
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  Moon,
  Shield,
  Sun,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  useSidebar,
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
  {
    title: "业务管理",
    items: [
      { title: "用户管理", href: "/admin/users" },
      { title: "套餐管理", href: "/admin/plans" },
      { title: "订阅管理", href: "/admin/subscriptions" },
    ],
  },
  {
    title: "节点与路由",
    items: [
      { title: "节点管理", href: "/admin/nodes" },
      { title: "ACL 策略", href: "/admin/routing/acls" },
      { title: "出站配置", href: "/admin/routing/outbounds" },
      { title: "订阅分流", href: "/admin/subscription-rules" },
    ],
  },
  {
    title: "数据分析",
    items: [{ title: "流量分析", href: "/admin/traffic-analysis" }],
  },
  {
    title: "日志审计",
    items: [
      { title: "事件日志", href: "/admin/event-logs" },
      { title: "认证日志", href: "/admin/auth-logs" },
      { title: "上报日志", href: "/admin/report-logs" },
      { title: "Agent 队列", href: "/admin/agent-tasks" },
    ],
  },
  { title: "站点设置", href: "/admin/settings" },
]

function isRouteActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(`${href}/`)
}

type Crumb = { title: string; href?: string }

// 根据当前路径生成面包屑：admin 二级页先挂"管理概览"，再按菜单分组补齐层级
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

function SidebarUserMenu({
  user,
  onLogout,
}: {
  user: SessionUser
  onLogout: () => void
}) {
  const { isMobile } = useSidebar()
  const initial = user.username.trim().charAt(0).toUpperCase() || "H"
  const roleLabel = user.role === "admin" ? "管理员" : "普通用户"

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="h-14 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              tooltip={user.username}
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-sky-500 via-fuchsia-500 to-amber-400 text-sm font-semibold text-white shadow-sm">
                {initial}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium">{user.username}</span>
                <span className="truncate text-xs text-sidebar-foreground/65">
                  {roleLabel}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-sidebar-foreground/65 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
            className="min-w-48"
          >
            <DropdownMenuItem onSelect={() => toast.info("暂无通知")}>
              <Bell className="size-4" />
              <span>通知</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onLogout}>
              <LogOut className="size-4" />
              <span>退出登录</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [ready, setReady] = useState(false)
  const [adminMenuOpen, setAdminMenuOpen] = useState(
    pathname.startsWith("/admin")
  )
  const [groupMenuOpen, setGroupMenuOpen] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        adminSubMenus
          .filter((item) => "items" in item)
          .map((item) => [
            item.title,
            "items" in item &&
              item.items.some((child) => isRouteActive(pathname, child.href)),
          ])
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

  async function logout() {
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
                      <div className="flex h-8 w-30 items-center group-data-[collapsible=icon]:hidden">
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
                                      open={groupMenuOpen[item.title] ?? false}
                                      onOpenChange={(open) =>
                                        setGroupMenuOpen((current) => ({
                                          ...current,
                                          [item.title]: open,
                                        }))
                                      }
                                      className="group/sub-collapsible"
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
                                              <ChevronRight className="ml-auto size-3.5 transition-transform duration-200 group-data-[state=open]/sub-collapsible:rotate-90" />
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
              <SidebarUserMenu user={user} onLogout={() => void logout()} />
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
