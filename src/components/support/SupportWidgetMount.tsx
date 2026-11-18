'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { SupportWidget } from './SupportWidget'

// 全局客服只在团队后台挂载，默认不挂：白名单外的路由直接 return null，组件根本不会被实例化，
// 所以也不会发 /api/support/bootstrap、不会建 SSE 连接。
// 入口是左栏的「客服」按钮（派发 vidx-open-support），所以这里把原来的左中悬浮边签收起来。
// 另外两个客服面不走这里：运营侧是 /platform/support 收件箱（独立页面，不挂访客 widget，
// 免得管理员自己变成一条访客会话）；小程序内嵌的 /support 页由 SupportEmbed 自己挂 embed 版。
const SUPPORT_WIDGET_SURFACES = [/^\/studio(?:\/|$)/]

function shouldMountSupportWidget(pathname: string) {
  return SUPPORT_WIDGET_SURFACES.some((surface) => surface.test(pathname))
}

export function SupportWidgetMount() {
  const pathname = usePathname() || '/'
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return null
  if (!shouldMountSupportWidget(pathname)) return null
  // 分享页不渲染左侧图标栏，那里仍留悬浮边签当入口；其余后台页用左栏「客服」。
  const railHidden = /^\/studio\/projects\/[^/]+\/share(?:\/|$)/.test(pathname)
  return <SupportWidget placement="side" hideLauncher={!railHidden} />
}
