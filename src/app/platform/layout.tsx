'use client'

import { PlatformAuthProvider } from '@/components/PlatformAuthProvider'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, MessageSquarePlus, Settings2, ShieldCheck, UserCog, Users, type LucideIcon } from 'lucide-react'

const sections: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: '团队总览', href: '/platform', icon: LayoutDashboard },
  { label: '团队管理', href: '/platform/teams', icon: Users },
  { label: '平台成员', href: '/platform/users', icon: UserCog },
  { label: '平台设置', href: '/platform/settings', icon: Settings2 },
  { label: '消息与反馈', href: '/platform/messages', icon: MessageSquarePlus },
  { label: '安全', href: '/platform/security', icon: ShieldCheck },
]

/** 和团队管理侧栏同一套选中态：底色用 primary-visible，只加粗不换图标颜色以外的花样。 */
function isActive(pathname: string, href: string) {
  return href === '/platform' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? ''
  const isLogin = pathname === '/platform/login'

  return (
    <PlatformAuthProvider requireAuth={!isLogin}>
      {isLogin ? (
        // 登录页不吃栏面结构，但保留原来的居中容器：页面自己没有左右内边距。
        <div className="min-h-screen bg-background">
          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        </div>
      ) : (
        // 栏面结构与 TeamAdminShell 一致：画布透出 2px 缝，左导航与右侧内容各自 8px 圆角。
        // 这一层不能写 h-full：本壳层的高度是 flex 撑出来的（父级 body 只有 min-h-dvh），
        // 百分比高度在这里算不出确定值会退回内容高，整块栏面就缩成内容那么长；交叉轴 stretch 本身就铺满。
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
