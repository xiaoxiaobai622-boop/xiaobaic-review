'use client'
import { AuthProvider } from '@/components/AuthProvider'

export default function SsoLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider requireAuth>{children}</AuthProvider>
}
