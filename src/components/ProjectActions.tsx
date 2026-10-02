'use client'

import { appAlert, appConfirm } from '@/components/AppDialogProvider'

import { useState, useEffect, useRef, type ElementType } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Project } from '@prisma/client'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Trash2, Link2, Archive, ArchiveRestore, RotateCcw, CheckCircle, BarChart3, FolderKanban, Calendar, Copy, Check } from 'lucide-react'
import { UnapproveModal } from './UnapproveModal'
import { FeishuPushButton } from './FeishuPushButton'
import { apiPost, apiPatch, apiDelete, apiFetch } from '@/lib/api-client'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useAuth } from '@/components/AuthProvider'

interface Video {
  id: string
  name: string
  versionLabel: string
  status: string
  approved: boolean
}

interface ProjectActionsProps {
  project: Project
  videos: Video[]
  onRefresh?: () => void
  /** 侧栏下半区不要白底卡片壳：只换掉 Card 三层外壳，结构、间距与交互一字不动。 */
  bare?: boolean
  /** 「分享审阅链接」按下的那一下由页面接管：整项目范围的创建弹窗只有页面那份状态能开。 */
  onShareReview: () => void
  /** 还没有可复制的收录链接时，这枚按钮开的也是页面那枚创建窗。 */
  onCreateCollectLink: () => void
}

export default function ProjectActions({ project, videos, onRefresh, bare = false, onShareReview, onCreateCollectLink }: ProjectActionsProps) {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const { user } = useAuth()
  const [isDeleting, setIsDeleting] = useState(false)
  const [isTogglingApproval, setIsTogglingApproval] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)

  const [showUnapproveModal, setShowUnapproveModal] = useState(false)

  // 「复制收录链接」是读操作：拿该项目最新一条有效收录短链写进剪贴板，
  // 已取消与已过期的都不算——复制出去只会让人拿到打不开的地址。
  const [collectLinkBusy, setCollectLinkBusy] = useState(false)
  const [collectLinkCopied, setCollectLinkCopied] = useState(false)
  const collectCopiedTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (collectCopiedTimer.current !== null) window.clearTimeout(collectCopiedTimer.current)
  }, [])

  const handleCopyCollectLink = async () => {
    if (collectLinkBusy) return
    setCollectLinkBusy(true)
    try {
      const response = await apiFetch(`/api/projects/${project.id}/share-links`, { cache: 'no-store' })
      if (!response.ok) {
        appAlert(tc('errorTryAgain'))
        return
      }
      const data = await response.json()
      const collect = (Array.isArray(data.shareLinks) ? data.shareLinks : []).find(
        (link: any) => link.type === 'COLLECT' && link.scopeType === 'PROJECT' && link.status === 'ACTIVE',
      )
      if (!collect) {
        onCreateCollectLink()
        return
      }
      if (!await copyTextToClipboard(collect.url)) {
        appAlert(tc('errorTryAgain'))
        return
      }
      setCollectLinkCopied(true)
      if (collectCopiedTimer.current !== null) window.clearTimeout(collectCopiedTimer.current)
      collectCopiedTimer.current = window.setTimeout(() => setCollectLinkCopied(false), 1500)
    } catch {
      appAlert(tc('errorTryAgain'))
    } finally {
      setCollectLinkBusy(false)
    }
  }

  // Check if user has admin privileges (ADMIN or SUPER_ADMIN)
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'

  // Filter only ready videos
  const readyVideos = videos.filter(v => v.status === 'READY')

  // Check if all unique videos have at least one approved version
  const videosByNameForApproval = readyVideos.reduce((acc, video) => {
    if (!acc[video.name]) {
      acc[video.name] = []
    }
    acc[video.name].push(video)
    return acc
  }, {} as Record<string, Video[]>)

  const allVideosHaveApprovedVersion = Object.values(videosByNameForApproval).every((versions: Video[]) =>
    versions.some(v => v.approved)
  )

  const canApproveProject = readyVideos.length > 0 && allVideosHaveApprovedVersion

  const handleToggleApproval = async () => {
    // Prevent double-clicks during approval toggle
    if (isTogglingApproval) return

    const isCurrentlyApproved = project.status === 'APPROVED'

    if (isCurrentlyApproved) {
      setShowUnapproveModal(true)
    } else {
      if (!await appConfirm(t('confirmApproveProject'))) {
        return
      }

      setIsTogglingApproval(true)

      apiPatch(`/api/projects/${project.id}`, { status: 'APPROVED' })
        .then(() => {
          appAlert(t('approvedSuccessfully'))
          onRefresh?.()
          router.refresh()
        })
        .catch(() => {
          appAlert(t('failedToApprove'))
        })
        .finally(() => {
          setIsTogglingApproval(false)
        })
    }
  }

  const handleUnapprove = async (unapproveVideos: boolean) => {
    // Prevent double-clicks during unapproval
    if (isTogglingApproval) return

    setIsTogglingApproval(true)
    setShowUnapproveModal(false)

    apiPost(`/api/projects/${project.id}/unapprove`, { unapproveVideos })
      .then((data) => {
        // Show appropriate success message
        if (data.unapprovedVideos && data.unapprovedCount > 0) {
          appAlert(`${t('unapprovedSuccessfully')} ${data.unapprovedCount} ${t('videosUnapproved')}`)
        } else if (data.unapprovedVideos && data.unapprovedCount === 0) {
          appAlert(`${t('unapprovedSuccessfully')} ${t('noVideosApproved')}`)
        } else {
          appAlert(`${t('unapprovedSuccessfully')} ${t('videosRemainApproved')}`)
        }
        onRefresh?.()
        router.refresh()
      })
      .catch(() => {
        appAlert(t('failedToUnapprove'))
      })
      .finally(() => {
        setIsTogglingApproval(false)
      })
  }

  const handleUnapproveProjectOnly = () => {
    handleUnapprove(false)
  }

  const handleUnapproveAll = () => {
    handleUnapprove(true)
  }

  const handleCancelUnapprove = () => {
    setShowUnapproveModal(false)
  }

  const handleDelete = async () => {
    // Prevent double-clicks during deletion
    if (isDeleting) return

    if (!await appConfirm(t('deleteConfirm'))) {
      return
    }

    // Double confirmation for safety
    if (!await appConfirm(t('deleteLastWarning'))) {
      return
    }

    setIsDeleting(true)

    apiDelete(`/api/projects/${project.id}`)
      .then(() => {
        router.push('/studio/projects')
        router.refresh()
      })
      .catch(() => {
        appAlert(t('failedToDelete'))
        setIsDeleting(false)
      })
  }

  const handleToggleArchive = async () => {
    if (isArchiving) return

    const isCurrentlyArchived = project.status === 'ARCHIVED'
    const action = isCurrentlyArchived ? 'unarchive' : 'archive'
    const newStatus = isCurrentlyArchived ? 'IN_REVIEW' : 'ARCHIVED'

    if (!await appConfirm(isCurrentlyArchived ? t('unarchiveConfirm') : t('archiveConfirm'))) {
      return
    }

    setIsArchiving(true)

    apiPatch(`/api/projects/${project.id}`, { status: newStatus })
      .then(() => {
        appAlert(action === 'archive' ? t('archivedSuccessfully') : t('unarchivedSuccessfully'))
        onRefresh?.()
        router.refresh()
      })
      .catch(() => {
        appAlert(action === 'archive' ? t('failedToArchive') : t('failedToUnarchive'))
      })
      .finally(() => {
        setIsArchiving(false)
      })
  }

  // bare 时三层外壳换成普通 div：Card 的 bg-card、border 和 shadow 就是那块要拿掉的白底。
  const Shell: ElementType = bare ? 'div' : Card
  const ShellHeader: ElementType = bare ? 'div' : CardHeader
  const ShellContent: ElementType = bare ? 'div' : CardContent

  return (
    <>
      <Shell>
        <ShellHeader className={bare ? 'border-b border-border pb-3' : undefined}>
          <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
            <div className="min-w-0 flex-1">
              <CardTitle className="flex items-center gap-2 break-words mb-2">
                <span className="rounded-md p-1.5 flex-shrink-0 bg-foreground/5 dark:bg-foreground/10">
                  <FolderKanban className="w-4 h-4 text-primary" />
                </span>
                <span className="min-w-0 break-words">{project.title}</span>
              </CardTitle>
              <p className="text-sm text-muted-foreground break-words">{(project as any).description}</p>
            </div>
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0 ${
                project.status === 'APPROVED'
                  ? 'bg-success-visible text-success border-2 border-success-visible'
                  : project.status === 'SHARE_ONLY'
                  ? 'bg-info-visible text-info border-2 border-info-visible'
                  : project.status === 'IN_REVIEW'
                  ? 'bg-primary-visible text-primary border-2 border-primary-visible'
                  : 'bg-muted text-muted-foreground border border-border'
              }`}
            >
              {{
                IN_REVIEW: t('statusInReview'),
                APPROVED: t('statusApproved'),
                SHARE_ONLY: t('statusShareOnly'),
                ARCHIVED: t('statusArchived'),
              }[project.status] || project.status}
            </span>
          </div>
        </ShellHeader>
        <ShellContent className={bare ? 'space-y-3 pt-3' : 'space-y-3 pb-2'}>
          {/* Due Date */}
          {(project as any).dueDate && (() => {
            const due = new Date((project as any).dueDate)
            const today = new Date()
            // Compare using UTC dates to avoid timezone shifts
            today.setHours(0, 0, 0, 0)
            const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
            const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86400000)
            const isCompleted = project.status === 'APPROVED' || project.status === 'ARCHIVED' || project.status === 'SHARE_ONLY'
            let colorClass = ''
            if (!isCompleted) {
              if (diffDays < 0) colorClass = 'text-destructive'
              else if (diffDays <= 1) colorClass = 'text-warning'
              else if (diffDays <= 7) colorClass = 'text-primary'
            }
            const dateStr = due.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })

            return (
              <div className="pb-3 border-b border-border">
                <div className="text-sm">
                  <p className="text-muted-foreground mb-1">{t('dueDateLabel')}</p>
                  <p className={`font-medium flex items-center gap-2 ${colorClass}`}>
                    <Calendar className="w-4 h-4" />
                    {dateStr}
                  </p>
                  {!isCompleted && diffDays < 0 && <p className="text-xs text-destructive mt-1">{Math.abs(diffDays)} {Math.abs(diffDays) !== 1 ? t('days') : t('day')} {t('overdue')}</p>}
                  {!isCompleted && diffDays === 0 && <p className="text-xs text-warning mt-1">{t('dueToday')}</p>}
                  {!isCompleted && diffDays === 1 && <p className="text-xs text-warning mt-1">{t('dueTomorrow')}</p>}
                  {!isCompleted && diffDays > 1 && diffDays <= 7 && <p className="text-xs text-primary mt-1">{diffDays} {t('daysRemaining')}</p>}
                  {!isCompleted && diffDays > 7 && <p className="text-xs text-muted-foreground mt-1">{diffDays} {t('daysRemaining')}</p>}
                </div>
              </div>
            )
          })()}

          <Button
            variant="outline"
            size="default"
            className="w-full"
            onClick={onShareReview}
          >
            <Link2 className="w-4 h-4 mr-2" />
            {t('shareReviewLink')}
          </Button>

          {/* 上传接口在项目没开「允许客户提交素材」时一律 403，所以入口照分享记录面板的规矩只在开着时给。 */}
          {project.allowReverseShare && (
            <Button
              variant="outline"
              size="default"
              className="w-full"
              data-tutorial="copy-collect-link"
              disabled={collectLinkBusy}
              onClick={() => void handleCopyCollectLink()}
            >
              {collectLinkCopied
                ? <Check className="w-4 h-4 mr-2 text-emerald-600" />
                : <Copy className="w-4 h-4 mr-2" />}
              {collectLinkCopied ? tc('copied') : t('copyCollectLink')}
            </Button>
          )}

          <Button
            variant="outline"
            size="default"
            className="w-full"
            onClick={() => router.push(`/studio/projects/${project.id}/analytics`)}
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            {t('viewAnalytics')}
          </Button>

          {/* Push Project Button - only for ADMIN and SUPER_ADMIN */}
          {isAdmin && (
            <FeishuPushButton
              projectId={project.id}
              className="w-full"
              size="default"
            />
          )}

          {/* Approve/Unapprove Toggle Button - hidden when archived */}
          {project.status !== 'ARCHIVED' && (
            <div>
              <Button
                variant="outline"
                size="default"
                className="w-full"
                onClick={handleToggleApproval}
                disabled={isTogglingApproval || (project.status !== 'APPROVED' && !canApproveProject)}
                title={
                  project.status !== 'APPROVED' && !canApproveProject
                    ? t('approveFirst')
                    : ''
                }
              >
                {project.status === 'APPROVED' ? (
                  <>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {isTogglingApproval ? tc('changing') : t('unapproveProject')}
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {isTogglingApproval ? tc('changing') : t('approveProject')}
                  </>
                )}
              </Button>
              {project.status !== 'APPROVED' && !canApproveProject && (
                <p className="text-xs text-muted-foreground mt-1 px-1">
                  {t('approveFirstLong')}
                </p>
              )}
            </div>
          )}

          <Button
            variant="outline"
            size="default"
            className="w-full"
            onClick={handleToggleArchive}
            disabled={isArchiving}
          >
            {project.status === 'ARCHIVED' ? (
              <>
                <ArchiveRestore className="w-4 h-4 mr-2" />
                {isArchiving ? t('unarchiving') : t('unarchiveProject')}
              </>
            ) : (
              <>
                <Archive className="w-4 h-4 mr-2" />
                {isArchiving ? t('archiving') : t('archiveProject')}
              </>
            )}
          </Button>

          <Button
            variant="destructive"
            size="default"
            className="w-full"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {isDeleting ? tc('deleting') : t('deleteProject')}
          </Button>
        </ShellContent>
      </Shell>

      {/* Unapprove Modal */}
      <UnapproveModal
        show={showUnapproveModal}
        onCancel={handleCancelUnapprove}
        onUnapproveProjectOnly={handleUnapproveProjectOnly}
        onUnapproveAll={handleUnapproveAll}
        processing={isTogglingApproval}
      />
    </>
  )
}
