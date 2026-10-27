'use client'

import { useLayoutEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Video, Images, FolderUp, Trash2 } from 'lucide-react'
import {
  VIDEO_CARD_MAX_WIDTH,
  VIDEO_GRID_TEMPLATE,
  VIDEO_THUMB_ASPECT_RATIO,
  loadVideoDisplayPrefs,
  type VideoDisplayPrefs,
} from '@/lib/video-view-prefs'

// 骨架必须坐在真页面那一套壳里，否则内容一到就整屏跳一次版式。
// 这三串是从 src/app/studio/projects/[id]/page.tsx 的 SHELL_GRID_COLS /
// SHELL_TRACK_MIN / 外层容器抄来的「首屏 plain 档」：加载期播放器与批注栏都还没挂，
// 所以永远只有 plain 这一种列模板。check-overlay-occlusion.mts 会把骨架与真内容的
// 列位、卡尺寸逐条对，改了那边要同步这里。
const SHELL_OUTER = 'flex-1 min-h-0 bg-background lg:h-[calc(100dvh-var(--admin-header-height))] lg:overflow-hidden'
const SHELL_INNER = 'w-full px-3 py-3 sm:px-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:pl-0 lg:pr-[2px] lg:pt-0 lg:pb-[2px]'
const SHELL_HEADER = 'mb-[2px] flex flex-wrap items-center justify-between gap-3 rounded-[8px] bg-popover px-3 py-1 lg:py-4'
const SHELL_GRID = 'min-h-[calc(100dvh-var(--admin-header-height)-5rem)] lg:min-h-0 lg:flex-1 lg:grid'
const SHELL_GRID_COLS = {
  withSidebar: 'lg:grid-cols-[288px_var(--shell-grid)]',
  collapsed: 'lg:grid-cols-[var(--shell-grid)]',
} as const
const SIDEBAR_COLLAPSED_KEY = 'vitransfer-admin-project-sidebar-collapsed'
const SHELL_TRACKS = { '--shell-grid': 'minmax(248px,1fr)' } as React.CSSProperties
const ASIDE_NAV = 'scrollbar-hidden flex gap-1 overflow-x-auto rounded-[8px] bg-popover p-2 lg:flex-col lg:overflow-y-auto lg:py-4'
const MAIN_PANE = 'scrollbar-hidden relative min-w-0 overscroll-contain bg-popover p-3 sm:p-4 lg:min-h-0 lg:overflow-y-auto lg:rounded-[8px]'

export function ProjectWorkspaceSkeleton({
  label,
  activeWorkspace = 'videos',
  onOpenWorkspace,
}: {
  label: string
  activeWorkspace?: string
  onOpenWorkspace?: (workspace: 'videos' | 'photos' | 'uploads' | 'trash') => void
}) {
  const t = useTranslations('projects')
  // 卡片尺寸与封面比例是用户偏好，存在 localStorage 里。放到 layout effect 读：
  // 服务端拿不到 window，写进首次渲染会在注水时和 HTML 对不上。
  const [prefs, setPrefs] = useState<VideoDisplayPrefs | null>(null)
  const [railCollapsed, setRailCollapsed] = useState(false)
  useLayoutEffect(() => {
    setPrefs(loadVideoDisplayPrefs())
    try { setRailCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1') } catch {}
  }, [])
  const size = prefs?.size ?? 'lg'
  const aspect = VIDEO_THUMB_ASPECT_RATIO[prefs?.aspect ?? '16:9']

  // 四枚工作区入口只吃路由和页内状态，不吃项目详情，所以加载期就该能点。
  const nav = [
    { id: 'videos' as const, label: t('videos'), icon: Video },
    { id: 'photos' as const, label: t('photoAlbums'), icon: Images },
    { id: 'uploads' as const, label: t('collection'), icon: FolderUp },
    { id: 'trash' as const, label: t('recycleBin'), icon: Trash2 },
  ]

  return (
    <div className={SHELL_OUTER} aria-busy="true">
      <span className="sr-only" role="status" aria-live="polite">{label}</span>
      <div className={SHELL_INNER}>
        {/* 页头：面包屑、成员、上传、两块面板开关。位置照真页面，内容还没到手所以全是占位。 */}
        <div className={SHELL_HEADER}>
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="skeleton h-5 w-32 rounded" />
            <div className="skeleton h-5 w-40 rounded" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="skeleton h-9 w-16 rounded-md" />
            <div className="skeleton h-9 w-[132px] rounded-md" />
            <div className="skeleton h-9 w-[132px] rounded-md" />
            <div className="skeleton h-9 w-16 rounded-md" />
          </div>
        </div>

        <div className={`${SHELL_GRID} ${railCollapsed ? SHELL_GRID_COLS.collapsed : SHELL_GRID_COLS.withSidebar}`} style={SHELL_TRACKS}>
          <aside className={`flex min-w-0 flex-col lg:mr-[2px] lg:grid lg:min-h-0 lg:grid-rows-[2fr_3fr] ${railCollapsed ? 'hidden' : ''}`}>
            <nav className={ASIDE_NAV} aria-label={t('dashboard')}>
              {nav.map((item) => {
                const Icon = item.icon
                const active = activeWorkspace === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!onOpenWorkspace}
                    onClick={() => onOpenWorkspace?.(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex min-w-max items-center gap-2 rounded-md px-3 py-2 text-[14px] transition-colors lg:w-full ${
                      active
                        ? 'bg-accent text-foreground font-semibold'
                        : 'font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2.5} />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </nav>
            <section className="scrollbar-hidden hidden rounded-[8px] bg-popover px-2 lg:mt-[2px] lg:block lg:min-h-0 lg:overflow-y-auto">
              <div className="space-y-2 px-3 pb-3 pt-3">
                <div className="skeleton h-5 w-2/3 rounded" />
                <div className="skeleton h-4 w-1/2 rounded" />
                <div className="skeleton h-4 w-3/5 rounded" />
                <div className="skeleton h-9 w-full rounded-md" />
              </div>
            </section>
          </aside>

          <main className={MAIN_PANE}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="skeleton h-9 w-[132px] rounded-md" />
              <div className="skeleton h-9 w-[132px] rounded-md" />
              <div className="skeleton ml-auto h-9 w-56 rounded-md" />
            </div>
            <div
              className="grid content-start items-start gap-3"
              style={{ gridTemplateColumns: VIDEO_GRID_TEMPLATE[size] }}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7].map((key) => (
                <div
                  key={key}
                  data-skeleton-card
                  className="rounded-lg border border-border/70 bg-card shadow-elevation-md"
                  style={{ maxWidth: VIDEO_CARD_MAX_WIDTH[size] }}
                >
                  <div className="space-y-0 p-2.5">
                    <div className="flex min-w-0 flex-col items-stretch gap-3">
                      <div className="skeleton w-full rounded-md border border-border" style={{ aspectRatio: String(aspect) }} />
                      <div className="skeleton h-5 w-3/4 rounded" />
                      <div className="skeleton mt-1 h-4 w-1/2 rounded" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
