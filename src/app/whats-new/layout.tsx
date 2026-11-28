import type { Metadata } from 'next'
import Link from 'next/link'
import BrandLogo from '@/components/BrandLogo'
import BeianPolice from '@/components/BeianPolice'
import { BrandLd } from '@/components/marketing/BrandLd'
import { BRAND } from '@/lib/marketing/brand'
import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'

const SITE_NAV = [
  { href: '/features', label: '功能' },
  { href: '/compare', label: '对比' },
  { href: '/guides', label: '指南' },
  { href: '/whats-new', label: '产品更新' },
  { href: '/news/beta', label: '内测公告' },
]

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteUrlFromRequest()
  return {
    metadataBase: new URL(site),
    openGraph: {
      type: 'website',
      siteName: BRAND.zh,
      locale: 'zh_CN',
      url: site,
      images: [{ url: '/og/brand-1200x630.png', width: 1200, height: 630, alt: BRAND.zh }],
    },
    twitter: { card: 'summary_large_image', title: BRAND.zh, images: ['/og/brand-1200x630.png'] },
    robots: { index: true, follow: true },
  }
}

export default function WhatsNewLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const year = new Date().getFullYear()

  return (
    <div className="flex min-h-dvh flex-col bg-white text-foreground dark:bg-background">
      <BrandLd />
      <header className="site-header border-b border-border bg-white dark:bg-background">
        <div className="header-layout-wrapper mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 sm:px-8 lg:px-[25px]">
          <div className="header-branding flex shrink-0 items-center">
            <Link
              href="/"
              className="site-logo flex items-center gap-2 rounded-md text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BrandLogo height={24} ariaHidden />
              <span className="text-[15px] font-semibold">{BRAND.zh}</span>
            </Link>
          </div>

          <div className="primary-menu-container flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-3">
            <nav
              aria-label="站点导航"
              className="primary-menu-wrapper order-3 -mx-1 w-full overflow-x-auto pb-1 lg:order-none lg:mx-0 lg:flex lg:w-auto lg:flex-1 lg:justify-center lg:overflow-visible lg:pb-0"
            >
              <ul className="primary-menu flex items-center gap-x-5 text-[15px] font-semibold text-foreground">
                {SITE_NAV.map((item) => (
                  <li key={item.href} className="menu-item shrink-0">
                    <Link
                      href={item.href}
                      className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="primary-menu-section section-right ml-auto shrink-0">
              <Link
                href="/studio/projects"
                className="app-cta inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                进入工作台
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="site-footer border-t border-border bg-white dark:bg-background">
        <div className="site-footer-inner mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-5 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-[25px]">
          <span>© {year} {BRAND.zh} · {BRAND.legalName}</span>
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href="/privacy" className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              隐私政策
            </Link>
            <Link href="/terms" className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              服务条款
            </Link>
            <a
              href="https://beian.miit.gov.cn"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {BRAND.icpNumber}
            </a>
            <BeianPolice className="transition-colors hover:text-foreground" />
          </nav>
        </div>
      </footer>
    </div>
  )
}
