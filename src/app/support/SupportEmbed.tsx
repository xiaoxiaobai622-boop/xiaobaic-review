'use client'

import { useEffect } from 'react'
import { SupportWidget } from '@/components/support/SupportWidget'

export function SupportEmbed() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new Event('vidx-open-support'))
    }, 200)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <main style={{ height: '100dvh', overflow: 'hidden' }}>
      <SupportWidget placement="side" hideLauncher embed />
    </main>
  )
}
