'use client'

import { AuthProvider } from '@/components/AuthProvider'

/**
 * 改版草稿页原先任何人不登录就能打开（GET /lab/projects 直接 200），页面自己还写着
 * 「本地试做页 · 未接生产」。守卫照抄 studio 那套：没登录就跳登录页，草稿不外泄。
 */
export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider requireAuth={true}>{children}</AuthProvider>
}
