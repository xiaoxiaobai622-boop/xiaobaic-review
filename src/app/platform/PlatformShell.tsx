'use client'

import { PlatformAuthProvider } from '@/components/PlatformAuthProvider'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Headphones, LayoutDashboard, Megaphone, MessageSquarePlus, Settings2, ShieldCheck, UserCog, Users, type LucideIcon } from 'lucide-react'

const sections: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: '团队总览', href: '/platform', icon: LayoutDashboard },
  { label: '团队管理', href: '/platform/teams', icon: Users },
  { label: '平台账号', href: '/platform/users', icon: UserCog },
  { label: '平台设置', href: '/platform/settings', icon: Settings2 },
  { label: '公告', href: '/platform/announcements', icon: Megaphone },
  { label: '客服', href: '/platform/support', icon: Headphones },
  { label: '消息与反馈', href: '/platform/messages', icon: MessageSquarePlus },
  { label: '安全', href: '/platform/security', icon: ShieldCheck },
]

function isActive(pathname: string, href: string) {
  return href === '/platform' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
}

export default function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? ''
  const isLogin = pathname === '/platform/login'

  return (
    <PlatformAuthProvider requireAuth={!isLogin}>
      {isLogin ? (
        <div className="min-h-screen bg-background">
          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        </div>
      ) : (
        <div className="scrollbar-hidden flex min-h-0 flex-1 overflow-y-auto bg-background lg:h-[calc(100dvh-var(--admin-header-height))] lg:overflow-hidden">
          <div className="flex w-full min-w-0 flex-1 flex-col lg:flex lg:min-h-0 lg:flex-row lg:pr-[2px] lg:pb-[2px]">
            <aside className="shrink-0 border-b border-border bg-card lg:mr-[2px] lg:min-h-0 lg:w-56 lg:overflow-y-auto lg:rounded-[8px] lg:border-b-0 lg:bg-popover">
              <div className="px-4 py-4 lg:px-5 lg:py-6">
                <p className="text-base font-semibold">平台控制台</p>
              </div>
              <nav aria-label="平台控制台菜单" className="grid min-w-0 grid-cols-2 gap-1 px-3 pb-3 lg:block lg:space-y-1 lg:px-3 lg:pb-0">
                {sections.map(({ label, href, icon: Icon }) => {
                  const active = isActive(pathname, href)
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={`flex min-w-0 items-center gap-2 rounded-md px-3 py-2.5 text-sm transition-colors lg:w-full ${active ? 'bg-primary-visible font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </Link>
                  )
                })}
              </nav>
            </aside>

            <main className="scrollbar-hidden min-w-0 flex-1 px-4 py-5 sm:px-6 lg:min-h-0 lg:overflow-y-auto lg:rounded-[8px] lg:bg-popover lg:px-8 lg:py-7">
              {children}
            </main>
          </div>
        </div>
      )}
    </PlatformAuthProvider>
  )
}
