'use client'

import { appAlert, appConfirm } from '@/components/AppDialogProvider'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Project } from '@prisma/client'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Trash2, ExternalLink, Archive, ArchiveRestore, RotateCcw, CheckCircle, BarChart3, FolderKanban, Copy, Check, Calendar } from 'lucide-react'
import { UnapproveModal } from './UnapproveModal'
import { apiPost, apiPatch, apiDelete } from '@/lib/api-client'
import { copyTextToClipboard } from '@/lib/clipboard'

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
  shareUrl?: string
}

export default function ProjectActions({ project, videos, onRefresh, shareUrl = '' }: ProjectActionsProps) {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const [isDeleting, setIsDeleting] = useState(false)
  const [isTogglingApproval, setIsTogglingApproval] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  const [showUnapproveModal, setShowUnapproveModal] = useState(false)

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

  const handleViewSharePage = () => {
    router.push(`/studio/projects/${project.id}/share`)
  }

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

  return (
    <>
      <Card>
        <CardHeader>
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
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Due Date */}
          {(project as any).dueDate && (() => {
            const due = new Date((project as any).dueDate)
            const today = new Date()
            // Compare using UTC dates to avoid timezone shifts
            today.setHours(0, 0, 0, 0)
            const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
            const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86400000)
            const isCompleted = project.status === 'APPROVED' || project.status === 'ARCHIVED' || project.status === 'SHARE_ONLY'
            const colorClass = isCompleted ? '' : diffDays < 0 ? 'text-destructive' : diffDays <= 1 ? 'text-warning' : diffDays <= 7 ? 'text-primary' : ''
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

          {/* Share Link */}
          {shareUrl && (
            <div className="pb-3 border-b border-border">
              <p className="text-sm text-muted-foreground mb-2">{t('shareLink')}</p>
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 px-3 py-2 border rounded-md text-xs bg-muted truncate"
                />
                <div className="flex gap-2">
                  <Button 
                    onClick={async () => {
                      if (await copyTextToClipboard(shareUrl)) {
                        setLinkCopied(true)
                        setTimeout(() => setLinkCopied(false), 2000)
                      } else {
                        appAlert(tc('errorTryAgain'))
                      }
                    }} 
                    variant="outline" 
                    size="sm"
                    className="flex-1"
                  >
                    {linkCopied ? (
                      <>
                        <Check className="w-4 h-4 mr-2 text-success" />
                        {tc('copied')}
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" />
                        {tc('copy')}
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => window.open(shareUrl, '_blank', 'noopener,noreferrer')}
                    variant="outline"
                    size="sm"
                    className="flex-1"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    {tc('open')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <Button
            variant="outline"
            size="default"
            className="w-full"
            onClick={handleViewSharePage}
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            {t('viewSharePage')}
          </Button>

          <Button
            variant="outline"
            size="default"
            className="w-full"
            onClick={() => router.push(`/studio/projects/${project.id}/analytics`)}
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            {t('viewAnalytics')}
          </Button>

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
        </CardContent>
      </Card>

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
