'use client'

import { useEffect } from 'react'
import { SupportWidget } from '@/components/support/SupportWidget'

export default function SupportEmbedPage() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new Event('vidx-open-support'))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <main style={{ minHeight: '100vh', background: '#0B0D16' }}>
      <SupportWidget placement="side" hideLauncher />
    </main>
  )
}
