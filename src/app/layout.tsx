import type { Metadata } from "next";
import "./globals.css";
import { AccentColorProvider } from "@/components/AccentColorProvider";
import { ServiceWorkerProvider } from "@/components/ServiceWorkerProvider";
import GlobalActivityTracker from "@/components/GlobalActivityTracker";
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

  const icons: Metadata['icons'] = customFavicon
    ? {
        icon: [{ url: customFavicon }],
        apple: [{ url: customFavicon }],
        shortcut: customFavicon,
      }
    : {
        icon: [{ url: '/brand/logo.png', type: 'image/png' }],
        apple: [
          { url: '/brand/logo.png', sizes: '256x256', type: 'image/png' },
        ],
        shortcut: '/brand/logo.png',
      }

  return {
    title: { default: BRAND.zh, template: BRAND.titleTemplate },
    description: BRAND.description,
    robots: { index: true, follow: true },
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
        {/* Parser-blocking and first in the document, so the theme is on <html>
            before any content is painted — no flash of the default theme. */}
        <script nonce={cspNonce} dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <NextIntlClientProvider messages={messages}>
          <StorageConfigProvider provider={storageProvider}>
            <AppDialogProvider>
              <AccentColorProvider />
              <ServiceWorkerProvider />
              <GlobalActivityTracker />
              <main className="flex-1 min-h-0 flex flex-col">{children}</main>
            </AppDialogProvider>
          </StorageConfigProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
