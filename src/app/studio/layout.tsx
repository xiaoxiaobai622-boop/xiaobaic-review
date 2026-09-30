'use client'

import { AuthProvider } from '@/components/AuthProvider'
import StudioRail from '@/components/StudioRail'
import SessionMonitor from '@/components/SessionMonitor'
import KofiWidget from '@/components/KofiWidget'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const hideHeader = pathname?.match(/^\/studio\/projects\/[^/]+\/share/)
  const isProjectWorkspace = Boolean(pathname?.match(/^\/studio\/projects\/[^/]+$/))

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

  // 顶栏已移除（功能迁至左侧图标栏），依赖该变量的组件按 0px 取尺寸。
  useEffect(() => {
    document.documentElement.style.setProperty('--admin-header-height', '0px')
  }, [])

  return (
    <AuthProvider requireAuth={true}>
      <div className="flex flex-1 min-h-0 bg-background overflow-x-clip">
        <a href="#main-content" className="skip-link">
          跳到主要内容
        </a>
        {!hideHeader && <StudioRail />}
        <main id="main-content" tabIndex={-1} className={`flex-1 min-h-0 flex flex-col outline-none ${isProjectWorkspace ? 'lg:overflow-hidden' : ''}`}>
          {children}
        </main>
        <SessionMonitor />
        <KofiWidget />
      </div>
    </AuthProvider>
  )
}
