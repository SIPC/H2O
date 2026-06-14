import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { I18nProvider } from "@/components/i18n-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { getMessage } from "@/lib/i18n/messages"
import { resolveServerLocale } from "@/lib/i18n/server"
import { cn } from "@/lib/utils"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveServerLocale()

  return {
    title: {
      default: getMessage(locale, "metadata.home"),
      template: "%s | H2O",
    },
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await resolveServerLocale()

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
    >
      <body>
        <ThemeProvider>
          <I18nProvider key={locale} initialLocale={locale}>
            {children}
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
