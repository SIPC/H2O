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
  Languages,
  LayoutDashboard,
  LogOut,
  Moon,
  Shield,
  Sun,
} from "lucide-react"

import { ConfirmProvider } from "@/components/confirm-provider"
import { tr, useI18n } from "@/components/i18n-provider"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { toast } from "sonner"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import type { UserLocalePreference } from "@/lib/i18n/locales"
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
  preferredLocale?: UserLocalePreference
  resolvedLocale?: "zh-CN" | "en-US"
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
  | { titleKey: string; href: string }
  | { titleKey: string; items: { titleKey: string; href: string }[] }

const adminSubMenus: AdminSubMenu[] = [
  {
    titleKey: "shell.menu.business",
    items: [
      { titleKey: "metadata.admin.users", href: "/admin/users" },
      { titleKey: "metadata.admin.plans", href: "/admin/plans" },
      {
        titleKey: "metadata.admin.subscriptions",
        href: "/admin/subscriptions",
      },
    ],
  },
  {
    titleKey: "shell.menu.nodesAndRouting",
    items: [
      { titleKey: "metadata.admin.nodes", href: "/admin/nodes" },
      { titleKey: "metadata.admin.routingAcls", href: "/admin/routing/acls" },
      {
        titleKey: "metadata.admin.routingOutbounds",
        href: "/admin/routing/outbounds",
      },
      {
        titleKey: "metadata.admin.subscriptionRules",
        href: "/admin/subscription-rules",
      },
    ],
  },
  {
    titleKey: "shell.menu.analytics",
    items: [
      { titleKey: "metadata.admin.trafficMap", href: "/admin/traffic-map" },
      {
        titleKey: "metadata.admin.trafficAnalysis",
        href: "/admin/traffic-analysis",
      },
    ],
  },
  {
    titleKey: "shell.menu.logs",
    items: [
      { titleKey: "metadata.admin.eventLogs", href: "/admin/event-logs" },
      {
        titleKey: "metadata.admin.notifications",
        href: "/admin/notifications",
      },
      { titleKey: "metadata.admin.authLogs", href: "/admin/auth-logs" },
      { titleKey: "metadata.admin.reportLogs", href: "/admin/report-logs" },
      { titleKey: "metadata.admin.agentTasks", href: "/admin/agent-tasks" },
    ],
  },
  { titleKey: "metadata.admin.settings", href: "/admin/settings" },
]

function isRouteActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(`${href}/`)
}

type Crumb = { titleKey: string; href?: string }

// 根据当前路径生成面包屑：admin 二级页先挂"管理概览"，再按菜单分组补齐层级
function getBreadcrumbs(pathname: string): Crumb[] {
  if (pathname.startsWith("/admin")) {
    const crumbs: Crumb[] = [
      { titleKey: "metadata.admin.overview", href: "/admin" },
    ]
    if (pathname !== "/admin") {
      for (const item of adminSubMenus) {
        if ("items" in item) {
          const child = item.items.find((c) => isRouteActive(pathname, c.href))
          if (child) {
            crumbs.push(
              { titleKey: item.titleKey },
              { titleKey: child.titleKey }
            )
            break
          }
        } else if (isRouteActive(pathname, item.href)) {
          crumbs.push({ titleKey: item.titleKey })
          break
        }
      }
    }
    return crumbs
  }
  if (pathname.startsWith("/dashboard")) {
    return [{ titleKey: "shell.dashboard" }]
  }
  return []
}

function SidebarUserMenu({
  user,
  isDarkTheme,
  onLogout,
  onNotifications,
  onToggleTheme,
  onLanguageChange,
}: {
  user: SessionUser
  isDarkTheme: boolean
  onLogout: () => void
  onNotifications: () => void
  onToggleTheme: () => void
  onLanguageChange: (preference: UserLocalePreference) => void
}) {
  const { isMobile } = useSidebar()
  const { setUserLocalePreference, t } = useI18n()
  const initial = user.username.trim().charAt(0).toUpperCase() || "H"
  const roleLabel = user.role === "admin" ? t("shell.admin") : t("shell.user")

  async function changeLanguage(preference: UserLocalePreference) {
    const result = await setUserLocalePreference(preference)
    if (result.ok) {
      onLanguageChange(preference)
      toast.success(tr("settings.languageSaved"))
      return
    }
    toast.error(result.message ?? t("common.retryLater"))
  }

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
            <DropdownMenuItem onSelect={onNotifications}>
              <Bell className="size-4" />
              <span>{t("shell.notifications")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <Languages className="mr-1 inline size-3" />
              {t("common.language")}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={user.preferredLocale ?? "inherit"}
              onValueChange={(value) =>
                void changeLanguage(value as UserLocalePreference)
              }
            >
              <DropdownMenuRadioItem value="inherit">
                {t("common.inheritSite")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="zh-CN">
                {t("language.zhCN")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="en-US">
                {t("language.enUS")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onToggleTheme}>
              {isDarkTheme ? (
                <Moon className="size-4" />
              ) : (
                <Sun className="size-4" />
              )}
              <span>{t("shell.toggleTheme")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onLogout}>
              <LogOut className="size-4" />
              <span>{t("auth.logout")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const { t } = useI18n()
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
            item.titleKey,
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

      toast.info(
        t("shell.versionUpdateFound", { version: data.latestVersion }),
        {
          description: t("shell.versionUpdateDescription"),
          action: {
            label: t("shell.versionUpdateAction"),
            onClick: () => {
              window.open(data.releaseUrl, "_blank", "noopener,noreferrer")
            },
          },
          duration: 12000,
        }
      )
    })()

    return () => {
      mounted = false
    }
  }, [t, user?.role])

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" })
    router.replace("/login")
  }

  if (!ready || !user) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        {t("common.loading")}
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
                <SidebarGroupLabel>{t("shell.menu")}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu className="gap-1">
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        isActive={isRouteActive(pathname, "/dashboard")}
                        tooltip={t("shell.dashboard")}
                      >
                        <Link href="/dashboard">
                          <LayoutDashboard className="size-4" />
                          <span>{t("shell.dashboard")}</span>
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
                            tooltip={t("shell.adminOverview")}
                          >
                            <Link href="/admin">
                              <Shield className="size-4" />
                              <span>{t("shell.adminOverview")}</span>
                            </Link>
                          </SidebarMenuButton>
                          <CollapsibleTrigger asChild>
                            <SidebarMenuAction className="group-data-[collapsible=icon]:hidden">
                              <ChevronRight className="transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                              <span className="sr-only">
                                {t("shell.toggleSubmenu")}
                              </span>
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
                                      key={item.titleKey}
                                      asChild
                                      open={
                                        groupMenuOpen[item.titleKey] ?? false
                                      }
                                      onOpenChange={(open) =>
                                        setGroupMenuOpen((current) => ({
                                          ...current,
                                          [item.titleKey]: open,
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
                                                {t(item.titleKey)}
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
                                                    <span>
                                                      {t(child.titleKey)}
                                                    </span>
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
                                        <span>{t(item.titleKey)}</span>
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
              <SidebarUserMenu
                user={user}
                isDarkTheme={resolvedTheme === "dark"}
                onLogout={() => void logout()}
                onNotifications={() => {
                  if (user.role === "admin") {
                    router.push("/admin/notifications")
                    return
                  }
                  toast.info(t("shell.noNotifications"))
                }}
                onToggleTheme={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
                onLanguageChange={(preferredLocale) => {
                  setUser((current) =>
                    current ? { ...current, preferredLocale } : current
                  )
                }}
              />
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
                      <Fragment key={`${crumb.titleKey}-${index}`}>
                        {index > 0 ? <BreadcrumbSeparator /> : null}
                        <BreadcrumbItem>
                          {isLast || !crumb.href ? (
                            <BreadcrumbPage>{t(crumb.titleKey)}</BreadcrumbPage>
                          ) : (
                            <BreadcrumbLink asChild>
                              <Link href={crumb.href}>{t(crumb.titleKey)}</Link>
                            </BreadcrumbLink>
                          )}
                        </BreadcrumbItem>
                      </Fragment>
                    )
                  })}
                </BreadcrumbList>
              </Breadcrumb>
            </header>

            <main className="flex-1">{children}</main>
          </SidebarInset>
        </SidebarProvider>
      </ConfirmProvider>
    </TooltipProvider>
  )
}
