'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import { Video, MessageSquare, ChevronRight, Calendar, FolderOpen } from 'lucide-react'
import type { ViewMode } from '@/components/ViewModeToggle'
import { formatDate } from '@/lib/utils'
import type { ProjectListItem } from '@/lib/projects-filter'
import { PROJECT_DND_MIME, folderPathLabels, type FolderNode } from '@/lib/project-folders'
import { useAuth } from '@/components/AuthProvider'

interface ProjectsListProps {
  projects: ProjectListItem[]
  viewMode: ViewMode
  folders: FolderNode[]
  /** Same rule as the grid's path chip: inside a folder, every row is already there. */
  showFolderColumn: boolean
  emptyMessage?: React.ReactNode
}

const metricIconWrapperClassName = 'rounded-md p-1.5 flex-shrink-0 bg-foreground/5 dark:bg-foreground/10'
const metricIconClassName = 'w-4 h-4 text-primary'
const statusBadgeClassNameBase = 'px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap'

function statusBadgeColorClass(status: string): string {
  if (status === 'APPROVED') return 'bg-success-visible text-success border-2 border-success-visible'
  if (status === 'SHARE_ONLY') return 'bg-info-visible text-info border-2 border-info-visible'
  if (status === 'IN_REVIEW') return 'bg-primary-visible text-primary border-2 border-primary-visible'
  if (status === 'ARCHIVED') return 'bg-muted text-muted-foreground border-2 border-muted'
  return 'bg-muted text-muted-foreground border border-border'
}

function getDueDateColor(dueDate: string, status: string): string {
  if (status === 'APPROVED' || status === 'ARCHIVED' || status === 'SHARE_ONLY') {
    return 'text-muted-foreground'
  }
  const due = new Date(dueDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86400000)
  if (diffDays < 0) return 'text-destructive'
  if (diffDays <= 1) return 'text-warning'
  if (diffDays <= 7) return 'text-primary'
  return 'text-muted-foreground'
}

export default function ProjectsList({
  projects, viewMode, folders, showFolderColumn, emptyMessage,
}: ProjectsListProps) {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const tn = useTranslations('nav')
  const locale = useLocale()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const folderLabels = useMemo(() => folderPathLabels(folders), [folders])
  const statusLabels: Record<string, string> = {
    IN_REVIEW: t('statusInReview'),
    APPROVED: t('statusApproved'),
    SHARE_ONLY: t('statusShareOnly'),
    ARCHIVED: t('statusArchived'),
  }
  const projectHref = (project: ProjectListItem) => user?.role === 'ADMIN'
    ? `/studio/projects/${project.id}`
    : `/share/${project.slug}`

  // Rows drag to the sidebar tree exactly like the grid cards do, so filing a project
  // never depends on switching back to the grid view.
  function startDrag(project: ProjectListItem, e: React.DragEvent) {
    const payload = JSON.stringify([project.id])
    e.dataTransfer.clearData()
    e.dataTransfer.setData(PROJECT_DND_MIME, payload)
    e.dataTransfer.setData('text/plain', payload)
    e.dataTransfer.effectAllowed = 'move'
  }

  const folderCell = (project: ProjectListItem) => {
    const label = project.groupId ? folderLabels.get(project.groupId) : null
    return (
      <span className="w-36 min-w-0 hidden xl:inline-flex items-center gap-1 text-xs text-muted-foreground" title={label || undefined}>
        {label ? (
          <>
            <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </>
        ) : <span aria-hidden>—</span>}
      </span>
    )
  }

  if (projects.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">{emptyMessage || t('noMatchingProjects')}</p>
        </CardContent>
      </Card>
    )
  }

  if (viewMode === 'grid') {
    return (
      <div
        className="grid content-start gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
      >
        {projects.map((project) => {
          const totalVideos = project.videos.length
          return (
            <Link key={project.id} href={projectHref(project)} className="block">
              <Card className="h-full cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/20">
                <CardHeader className="p-2 sm:p-3">
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="mb-1 font-mono text-[11px] text-muted-foreground">ID {project.projectCode}</p>
                      <CardTitle className="font-semibold text-sm sm:text-base">
                        {project.title}
                      </CardTitle>
                    </div>
                    <span className={`${statusBadgeClassNameBase} ${statusBadgeColorClass(project.status)}`}>
                      {statusLabels[project.status] || project.status}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="p-2 pt-0 sm:p-3 sm:pt-0">
                  <div className="flex flex-wrap gap-3 sm:gap-6 text-muted-foreground text-xs sm:text-sm min-h-[28px] sm:min-h-[32px]">
                    <div className="inline-flex items-center gap-2">
                      <span className={metricIconWrapperClassName}>
                        <Video className={metricIconClassName} />
                      </span>
                      <span className="font-medium">{totalVideos}</span>
                      <span className="hidden sm:inline">{totalVideos !== 1 ? t('videosPlural') : t('video')}</span>
                    </div>
                    <div className="inline-flex items-center gap-2">
                      <span className={metricIconWrapperClassName}>
                        <MessageSquare className={metricIconClassName} />
                      </span>
                      <span className="font-medium">{project._count.comments}</span>
                      <span className="hidden sm:inline">{project._count.comments !== 1 ? t('commentsPlural') : t('comment')}</span>
                    </div>
                    {project.dueDate && (
                      <div className={`inline-flex items-center gap-2 ${getDueDateColor(project.dueDate, project.status)}`}>
                        <span className={metricIconWrapperClassName}>
                          <Calendar className={metricIconClassName} />
                        </span>
                        <span className="font-medium text-xs">{new Date(project.dueDate).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 sm:px-5 py-2.5 border-b bg-muted/30">
        <span className="text-sm font-medium">{tn('projects')}</span>
        <span className="text-xs text-muted-foreground">{projects.length} {t('projectsCount')}</span>
      </div>
      <div className="hidden sm:flex items-center gap-4 px-5 py-2 text-xs text-muted-foreground bg-muted/20 border-b">
        <span className="flex-1 min-w-0">{tc('name')}</span>
        {showFolderColumn && <span className="w-36 hidden xl:block">{t('folder')}</span>}
        <span className="w-28">{tc('status')}</span>
        <span className="w-16 text-center hidden lg:block">{t('videos')}</span>
        <span className="w-20 text-center hidden lg:block">{t('comments')}</span>
        <span className="w-20 hidden lg:block">{t('dueDateLabel')}</span>
        <span className="w-24 hidden xl:block">{tc('created')}</span>
        <span className="w-24 hidden lg:block">{tc('updated')}</span>
        <span className="w-4"></span>
      </div>
      <div className="divide-y">
        {projects.map((project) => {
          const totalVideos = project.videos.length
          return (
            <Link
              key={project.id}
              href={projectHref(project)}
              draggable={isAdmin}
              onDragStart={(e) => startDrag(project, e)}
              className="flex items-center gap-4 px-5 py-3 text-sm hover:bg-accent/30 transition-colors"
            >
              <span className="flex-1 min-w-0 font-medium truncate"><span className="mr-2 font-mono text-xs text-muted-foreground">{project.projectCode}</span>{project.title}</span>
              {showFolderColumn && folderCell(project)}
              <span className="w-28">
                <span className={`${statusBadgeClassNameBase} ${statusBadgeColorClass(project.status)}`}>
                  {statusLabels[project.status] || project.status}
                </span>
              </span>
              <span className="w-16 text-center text-xs text-muted-foreground tabular-nums hidden lg:block">{totalVideos}</span>
              <span className="w-20 text-center text-xs text-muted-foreground tabular-nums hidden lg:block">{project._count.comments}</span>
              <span className={`w-20 text-xs hidden lg:block ${project.dueDate ? getDueDateColor(project.dueDate, project.status) : 'text-muted-foreground'}`}>
                {project.dueDate ? new Date(project.dueDate).toLocaleDateString(locale, { month: 'short', day: 'numeric' }) : '—'}
              </span>
              <span className="w-24 text-xs text-muted-foreground hidden xl:block">
                {formatDate(project.createdAt)}
              </span>
              <span className="w-24 text-xs text-muted-foreground hidden lg:block">
                {formatDate(project.updatedAt)}
              </span>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            </Link>
          )
        })}
      </div>
    </Card>
  )
}
