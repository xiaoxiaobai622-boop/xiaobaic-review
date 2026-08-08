'use client'

import { AuthProvider, useAuth } from '@/components/AuthProvider'
import AdminHeader from '@/components/AdminHeader'
import SessionMonitor from '@/components/SessionMonitor'
import KofiWidget from '@/components/KofiWidget'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

function AdminRoleGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (user?.role === 'MEMBER') {
      router.replace('/profile')
    }
  }, [router, user?.role])

  if (user?.role === 'MEMBER') {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">正在返回个人中心...</div>
  }

  return children
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headerRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const hideHeader = pathname?.match(/^\/admin\/projects\/[^/]+\/share/)

  // Prevent caching of admin pages
  useEffect(() => {
    // Set cache control headers via meta tags as fallback
    const metaCache = document.querySelector('meta[http-equiv="Cache-Control"]')
    if (!metaCache) {
      const meta = document.createElement('meta')
      meta.httpEquiv = 'Cache-Control'
      meta.content = 'no-store, no-cache, must-revalidate, private'
      document.head.appendChild(meta)
      
      const metaPragma = document.createElement('meta')
      metaPragma.httpEquiv = 'Pragma'
      metaPragma.content = 'no-cache'
      document.head.appendChild(metaPragma)
      
      const metaExpires = document.createElement('meta')
      metaExpires.httpEquiv = 'Expires'
      metaExpires.content = '0'
      document.head.appendChild(metaExpires)
    }
  }, [])

  // Allow components (e.g. share sidebar) to size to viewport minus header.
  useEffect(() => {
    if (hideHeader) {
      document.documentElement.style.setProperty('--admin-header-height', '0px')
      return
    }

    const headerEl = headerRef.current
    if (!headerEl) return

    const update = () => {
      document.documentElement.style.setProperty('--admin-header-height', `${headerEl.offsetHeight}px`)
    }

    update()

    const observer = new ResizeObserver(() => update())
    observer.observe(headerEl)

    return () => {
      observer.disconnect()
      document.documentElement.style.setProperty('--admin-header-height', '0px')
    }
  }, [hideHeader])

  return (
    <AuthProvider requireAuth={true}>
      <AdminRoleGate><div className="flex flex-1 min-h-0 bg-background flex-col overflow-x-hidden">
        {!hideHeader && (
          <div ref={headerRef}>
            <AdminHeader />
          </div>
        )}
        <div className="flex-1 min-h-0 flex flex-col">
          {children}
        </div>
        <SessionMonitor />
        <KofiWidget />
      </div></AdminRoleGate>
    </AuthProvider>
  )
}
