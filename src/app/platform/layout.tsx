'use client'

import { PlatformAuthProvider } from '@/components/PlatformAuthProvider'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLogin = pathname === '/platform/login'

  return (
    <PlatformAuthProvider requireAuth={!isLogin}>
      <div className="min-h-screen bg-background">
        {!isLogin && (
          <header className="border-b border-border bg-card">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
              <Link href="/platform" className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-5 w-5 text-primary" />
                平台控制台
              </Link>
              <nav className="flex items-center gap-4 text-sm">
                <Link href="/platform/teams" className="text-muted-foreground hover:text-foreground">团队管理</Link>
                <Link href="/platform/users" className="text-muted-foreground hover:text-foreground">平台成员</Link>
                <Link href="/platform/settings" className="text-muted-foreground hover:text-foreground">平台设置</Link>
                <Link href="/platform/security" className="text-muted-foreground hover:text-foreground">安全</Link>
              </nav>
            </div>
          </header>
        )}
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </div>
    </PlatformAuthProvider>
  )
}
