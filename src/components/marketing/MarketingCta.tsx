'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { cn } from '@/lib/utils'

const DEFAULT_CLASS = 'inline-flex items-center rounded-md bg-[#245fe7] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1c4bcc]'

export default function MarketingCta({
  href,
  label,
  className,
}: {
  href: string
  label: string
  className?: string
}) {
  const [authenticated, setAuthenticated] = useState(false)

  useEffect(() => {
    if (href !== '/login') return
    let cancelled = false
    apiFetch('/api/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        if (cancelled || !response.ok) return
        const data = await response.json().catch(() => null)
        if (data?.authenticated && data.user) setAuthenticated(true)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [href])

  return (
    <Link
      href={authenticated ? '/studio/projects' : href}
      className={cn(DEFAULT_CLASS, className)}
    >
      {authenticated ? '进入工作台' : label}
    </Link>
  )
}
