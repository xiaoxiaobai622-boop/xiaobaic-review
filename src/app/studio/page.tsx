'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { StudioPageSkeleton } from '@/components/StudioPageSkeleton'

export default function AdminIndexPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/studio/projects')
  }, [router])

  return <StudioPageSkeleton label="正在打开项目中心" className="p-6" />
}
