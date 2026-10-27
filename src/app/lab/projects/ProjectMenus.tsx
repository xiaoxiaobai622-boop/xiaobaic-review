'use client'

import { useState } from 'react'
import ProjectsSortMenu from '@/components/projects/ProjectsSortMenu'
import VideoSortMenu from '@/components/projects/VideoSortMenu'
import VideoDisplayMenu from '@/components/projects/VideoDisplayMenu'
import ProjectSwitcher from '@/components/projects/ProjectSwitcher'
import FilterDropdown from '@/components/FilterDropdown'
import CommentSortMenu, { type CommentSortMode } from '@/components/CommentSortMenu'
import type { SortKey } from '@/lib/projects-filter'
import type { VideoDisplayPrefs, VideoSortPrefs } from '@/lib/video-view-prefs'

export default function ProjectMenus() {
  const [sort, setSort] = useState<SortKey>('updatedDesc')
  const [videoSort, setVideoSort] = useState<VideoSortPrefs>({ field: 'updated', dir: 'desc' })
  const [display, setDisplay] = useState<VideoDisplayPrefs>({ size: 'md', aspect: '16:9', showInfo: true, titleLines: 2 })
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid')
  const [statuses, setStatuses] = useState<Set<string>>(new Set(['IN_REVIEW']))
  const [commentSort, setCommentSort] = useState<CommentSortMode>('timecode')

  return (
    <main data-project-menus className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold">项目与文件菜单 · 本地样本</h1>
          <p className="mt-1 text-sm text-muted-foreground">真实组件，样本数据，不保存也不写接口。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown
            width={260}
            groups={[{
              key: 'status',
              label: '状态',
              options: [
                { value: 'IN_REVIEW', label: '审阅中' },
                { value: 'APPROVED', label: '已通过' },
                { value: 'SHARE_ONLY', label: '仅分享' },
              ],
              selected: statuses,
              onChange: setStatuses,
            }]}
          />
          <ProjectsSortMenu value={sort} onChange={setSort} />
          <VideoSortMenu value={videoSort} onChange={setVideoSort} />
          <VideoDisplayMenu value={display} onChange={setDisplay} viewMode={viewMode} onViewModeChange={setViewMode} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <ProjectSwitcher currentProjectId="sample-1" currentTitle="城市之间 · 调色审阅" />
          <span className="text-xs text-muted-foreground">⌘K 打开项目切换</span>
        </div>
        <div data-review-surface className="rounded-lg border border-border bg-popover p-3 text-popover-foreground">
          <p className="mb-2 text-xs font-medium text-muted-foreground">审片表面 · 批注排序</p>
          <CommentSortMenu value={commentSort} onChange={setCommentSort} />
        </div>
        <output data-menu-state className="break-words text-xs text-muted-foreground">
          {JSON.stringify({ sort, videoSort, display, viewMode, statuses: [...statuses], commentSort })}
        </output>
      </div>
    </main>
  )
}
