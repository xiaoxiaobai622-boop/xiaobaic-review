import type { Metadata } from 'next'
import PlatformShell from './PlatformShell'

export const metadata: Metadata = {
  manifest: '/platform.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '逐帧审阅 运营',
  },
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>
}
