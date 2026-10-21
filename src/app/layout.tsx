import type { Metadata } from "next";
import "./globals.css";
import { AccentColorProvider } from "@/components/AccentColorProvider";
import { ServiceWorkerProvider } from "@/components/ServiceWorkerProvider";
import GlobalActivityTracker from "@/components/GlobalActivityTracker";
import DesktopBridge from "@/components/DesktopBridge";
import { StorageConfigProvider, type StorageProvider } from "@/components/StorageConfigProvider";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { prisma } from "@/lib/db";
import { headers } from "next/headers";
import { AppDialogProvider } from "@/components/AppDialogProvider";
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme'
import { BRAND } from '@/lib/marketing/brand'

// Force Node.js runtime across the app to allow use of Node APIs (e.g., crypto).
export const runtime = 'nodejs';

// Prevent caching to ensure fresh appearance settings on every request
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  // Resolve the admin's custom favicon (if any). When set, it overrides all
  // built-in icon entries so the browser uses the operator's branding.
  // When not set, fall back to the built-in /brand/icon.svg endpoints.
  let customFavicon: string | null = null
  try {
    const row = await prisma.settings.findUnique({
      where: { id: 'default' },
      select: { brandingFaviconPath: true },
    })
    customFavicon = row?.brandingFaviconPath || null
  } catch {
    customFavicon = null
  }

  // 静态 ICO 始终在列，管理端上传的那枚（多为 SVG）跟在它后面。
  // 依据是 10-21 的生产日志全窗口：Googlebot-Image 10-15/10-17、Baiduspider 10-20 都取到了
  // `/api/branding/favicon`（200），而 **Bingbot 一次都没请求过图标**——它最认 `<link rel="icon">`
  // 指向的 ICO，SVG 是它最不认的格式。三条声明全指 SVG 时，等于对 Bing 没有图标可读。
  //
  // `?v=` 是刻意的：引擎与浏览器的图标缓存都按 **URL** 做键，同一个地址它取过一次就不再取。
  // 换版本号＝给它一个没见过的 URL，才会重新下载这张图（下次换图标时把日期再改一次）。
  const FAVICON_URL = '/favicon.ico?v=20261021'
  const icons: Metadata['icons'] = {
    icon: [
      { url: FAVICON_URL, sizes: '16x16 32x32 48x48', type: 'image/x-icon' },
      ...(customFavicon
        ? [
            { url: customFavicon },
            // 光栅格式再给一份：有的抓取方只收 PNG，SVG 与 ICO 都不认。
            { url: '/brand/logo-192.png', sizes: '192x192', type: 'image/png' },
          ]
        : [
            { url: '/brand/icon.svg', type: 'image/svg+xml' },
            { url: '/brand/logo-192.png', sizes: '192x192', type: 'image/png' },
          ]),
    ],
    // iOS 只吃 PNG：这条此前指向 SVG 接口（10-17 台账 #62），换成仓库里那张 180×180。
    apple: [{ url: '/brand/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: FAVICON_URL,
  }

  return {
    title: { default: BRAND.tabTitle, template: BRAND.titleTemplate },
    description: BRAND.description,
    robots: { index: true, follow: true },
    // 挂在根 layout 是因为 Google 的资源型验证要求整站每页都带这枚 meta；它是公开的
    // （渲染在每页 <head>），不是凭据。去掉这行等于让 Search Console 的验证状态失效。
    verification: { google: 'jcbUCYdaa4CZ9pyjSOvZ5vQhZRC2tfHjwTarSqENXuo' },
    manifest: '/manifest.json',
    icons,
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      title: '逐帧审阅',
    },
  }
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#111318',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve locale and storage settings server-side.
  const locale = await getLocale()
  const messages = await getMessages()
  const storageProvider = (process.env.STORAGE_PROVIDER === 's3' ? 's3' : 'local') as StorageProvider
  // src/proxy.ts publishes this request's CSP nonce; without it the pre-paint
  // theme script is blocked, and a saved dark/mint choice never survives reload.
  const cspNonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-dvh overflow-x-clip font-sans flex flex-col">
        {/* Parser-blocking and first in the document, so a saved colour theme is
            on <html> before any content is painted — no flash of the default. */}
        <script nonce={cspNonce} dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <NextIntlClientProvider messages={messages}>
          <StorageConfigProvider provider={storageProvider}>
            <AppDialogProvider>
              <AccentColorProvider />
              <ServiceWorkerProvider />
              <DesktopBridge />
              <GlobalActivityTracker />
              <main className="flex-1 min-h-0 flex flex-col">{children}</main>
            </AppDialogProvider>
          </StorageConfigProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
