'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { SupportWidget } from './SupportWidget'

// 全局客服只在团队后台挂载，默认不挂：白名单外的路由直接 return null，组件根本不会被实例化，
// 所以也不会发 /api/support/bootstrap、不会建 SSE 连接。
// 入口是左栏的「客服」按钮（派发 vidx-open-support），所以这里始终收起旧的左中悬浮边签；
// 审片页没有左栏，入口改在右上「更多」菜单里（同样派发 vidx-open-support）。
// 另外两个客服面不走这里：运营侧是 /platform/support 收件箱（独立页面，不挂访客 widget，
// 免得管理员自己变成一条访客会话）；小程序已确认不再打开 Web /support（2026-11-25 用户确认）。
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
  return <SupportWidget placement="side" hideLauncher />
}
