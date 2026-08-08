import type { Metadata } from 'next'
import HomeClient from './home-client'

export const metadata: Metadata = {
  title: '逐帧审阅 - 专业视频审阅与交付平台',
  description: '面向影视团队的在线审片、版本管理、素材收录与安全交付平台。',
}

export default function HomePage() {
  return <HomeClient />
}
