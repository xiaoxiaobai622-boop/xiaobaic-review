'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { SupportWidget } from './SupportWidget'

const MARKETING_ROUTES = /^\/(?:$|features(?:\/|$)|compare(?:\/|$)|news(?:\/|$))/

export function SupportWidgetMount() {
  const pathname = usePathname() || '/'
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return null
  if (pathname.startsWith('/platform') || pathname.startsWith('/login')) return null
  if (pathname.startsWith('/studio')) return <SupportWidget placement="side" hideLauncher />
  if (pathname.startsWith('/share/')) return <SupportWidget placement="side" />
  if (MARKETING_ROUTES.test(pathname)) return <SupportWidget placement="bottom" />
  return null
}
