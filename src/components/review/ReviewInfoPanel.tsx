'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Info } from 'lucide-react'
import { cn, formatDate, formatFileSize, formatTimestamp } from '@/lib/utils'

interface ReviewInfoPanelProps {
  video: any
  projectTitle?: string
  projectDescription?: string | null
  clientName?: string | null
  isPasswordProtected?: boolean
  isVideoApproved?: boolean
  defaultQuality: '720p' | '1080p' | '2160p'
  usePreviewForApprovedPlayback?: boolean
  className?: string
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-foreground">{value}</dd>
    </div>
  )
}

export default function ReviewInfoPanel({
  video,
  projectTitle,
  projectDescription,
  clientName,
  isPasswordProtected = false,
  isVideoApproved = false,
  defaultQuality,
  usePreviewForApprovedPlayback = false,
  className,
}: ReviewInfoPanelProps) {
  const t = useTranslations('videos')
  const tc = useTranslations('common')

  if (!video) {
    return <p className={cn('p-4 text-sm text-muted-foreground', className)}>{t('noVideosYet')}</p>
  }

  const qualityLabel = defaultQuality
  const hasPreviewPaths = Boolean(video.preview720Path || video.preview1080Path || video.preview2160Path)
  const hasPreviewStreams = Boolean(video.streamUrl720p || video.streamUrl1080p || video.streamUrl2160p)
  const hasPreview = hasPreviewPaths || hasPreviewStreams
  const hasHls = Boolean(video.hlsUrl720p)

  let playbackLabel: string
  if (isVideoApproved) {
    playbackLabel = usePreviewForApprovedPlayback || hasHls
      ? t('approvedPreview', { quality: qualityLabel })
      : t('approvedOriginal')
  } else if (hasHls) {
    playbackLabel = t('previewQuality')
  } else if (!hasPreview) {
    playbackLabel = t('originalQuality')
  } else {
    playbackLabel = t('downscaledPreview', { quality: qualityLabel })
  }

  return (
    <div className={cn('flex flex-col gap-4 p-3 text-[13px]', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t('videoInformation')}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('videoInfoDescription')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {video.versionLabel && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {video.versionLabel}
            </span>
          )}
          <span className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-medium',
            isVideoApproved ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
          )}>
            {isVideoApproved ? t('approved') : t('pendingReview')}
          </span>
        </div>
      </div>

      {(projectTitle || clientName || projectDescription) && (
        <section className="space-y-2 border-b border-border/70 pb-3">
          {projectTitle && (
            <div>
              <p className="text-xs text-muted-foreground">{t('project')}</p>
              <p className="mt-0.5 font-medium text-foreground">{projectTitle}</p>
            </div>
          )}
          {clientName && (
            <div>
              <p className="text-xs text-muted-foreground">{t('forLabel')}</p>
              <p className="mt-0.5 font-medium text-foreground">
                {isPasswordProtected ? clientName : t('clientLabel')}
              </p>
            </div>
          )}
          {projectDescription && (
            <div>
              <p className="text-xs text-muted-foreground">{tc('description')}</p>
              <p className="mt-0.5 whitespace-pre-wrap font-medium text-foreground">{projectDescription}</p>
            </div>
          )}
        </section>
      )}

      <section>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('originalFileSpecs')}
        </p>
        <dl className="mt-2 space-y-2">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{t('filename')}</dt>
            <dd className="break-all font-medium text-foreground">{video.originalFileName || '—'}</dd>
          </div>
          <InfoRow label={t('resolution')} value={video.width && video.height ? `${video.width}×${video.height}` : '—'} />
          <InfoRow label={t('codec')} value={video.codec || 'N/A'} />
          <InfoRow label={t('duration')} value={video.duration ? formatTimestamp(video.duration) : '—'} />
          <InfoRow label={t('fps')} value={video.fps ? video.fps.toFixed(2) : 'N/A'} />
          <InfoRow
            label={t('fileSize')}
            value={video.originalFileSize ? formatFileSize(Number(video.originalFileSize)) : '—'}
          />
          <InfoRow label={t('uploadDate')} value={video.createdAt ? formatDate(video.createdAt) : '—'} />
        </dl>
      </section>

      <section className="border-t border-border/70 pt-3">
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">{t('playbackStatus')}</span>
          <span className="text-right font-medium text-foreground">{playbackLabel}</span>
        </div>
      </section>
    </div>
  )
}
