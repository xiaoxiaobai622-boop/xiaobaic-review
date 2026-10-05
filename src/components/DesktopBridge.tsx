'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getDesktopBridge, parseDesktopDeepLink } from '@/lib/desktop-bridge'

/**
 * 只负责把客户端转来的 vidx:// 深链交给站内路由，所以挂在根布局：
 * 通知可能指向审阅页，而审阅页上没有侧栏组件。
 */
export default function DesktopBridge() {
  const router = useRouter()

  useEffect(() => {
    const desktop = getDesktopBridge()
    if (!desktop) return
    return desktop.onDeepLink((url) => {
      const href = parseDesktopDeepLink(url)
      if (href) router.push(href)
    })
  }, [router])

  return null
}
