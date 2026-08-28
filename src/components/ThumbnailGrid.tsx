'use client'

import Image from 'next/image'
import { useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, Film, Files, Download, Loader2, ChevronRight, Images, MessageSquare } from 'lucide-react'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import type { ShareViewMode } from './ShareViewToggle'
import { cn } from '@/lib/utils'
import { countCommentsByLatestVideoName, getLatestVideo } from '@/lib/video-comment-counts'
import VideoReviewStatusBadge from './VideoReviewStatusBadge'

interface ThumbnailGridProps {
  videosByName: Record<string, any[]>
  thumbnailsByName: Map<string, string>
  thumbnailsLoading: boolean
  onVideoSelect: (videoName: string) => void
  projectTitle?: string
  projectDescription?: string
  clientName?: string
  allowAssetDownload?: boolean
  /** Download-all-videos action, shown in the section header (like the photos section) */
  onDownloadAll?: () => void
  downloadingAll?: boolean
  downloadAllLabel?: string
  /** Page-level view mode, owned by the page top bar */
  viewMode?: ShareViewMode
  /** Album count for the hero meta line (0 hides the entry) */
  albumCount?: number
  comments?: Array<{ videoId?: string | null }>
}

function formatBeijingUploadTime(...candidates: unknown[]): string {
  const value = candidates.find((candidate) => candidate !== null && candidate !== undefined && candidate !== '')
  if (!value) return '时间未知'

  let date: Date
  if (typeof value === 'object' && value !== null && '$date' in value) {
    date = new Date(String((value as { $date?: unknown }).$date))
  } else if (typeof value === 'number' && value > 0 && value < 10_000_000_000) {
    date = new Date(value * 1000)
  } else {
    date = new Date(value as string | number | Date)
  }
  if (Number.isNaN(date.getTime())) return '时间未知'

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
}

function formatMinuteSecondDuration(value?: number | null): string {
  const totalSeconds = typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export default function ThumbnailGrid({
  videosByName,
  thumbnailsByName,
  thumbnailsLoading,
  onVideoSelect,
  projectTitle,
  projectDescription,
  clientName,
  allowAssetDownload = false,
  onDownloadAll,
  downloadingAll = false,
  downloadAllLabel,
  viewMode = 'grid',
  albumCount = 0,
  comments = [],
}: ThumbnailGridProps) {
  const t = useTranslations('share')
  const tv = useTranslations('videos')

  const [showApproveHint, setShowApproveHint] = useState(false)
  const approveHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep the project order stable; approval is a state, not a sort priority.
  const videoNames = useMemo(() => {
    return Object.keys(videosByName).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [videosByName])

  const videoCount = videoNames.length
  const approvedCount = videoNames.filter(name =>
    videosByName[name].some((v: any) => v.approved === true)
  ).length
  const commentCountByName = useMemo(() => {
    return countCommentsByLatestVideoName(videosByName, comments)
  }, [comments, videosByName])

  // With nothing approved yet, the button explains the workflow instead of downloading
  const handleDownloadAllClick = () => {
    if (approvedCount === 0) {
      setShowApproveHint(true)
      if (approveHintTimer.current) clearTimeout(approveHintTimer.current)
      approveHintTimer.current = setTimeout(() => setShowApproveHint(false), 5000)
      return
    }
    onDownloadAll?.()
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Hero — cinematic title block with a faint accent glow */}
      <div className="relative text-center mb-10 sm:mb-14 pt-10 px-4">
        <div
          className="absolute -top-10 inset-x-0 bottom-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 55% 70% at 50% 0%, hsl(var(--primary) / 0.08), transparent 70%)' }}
        />
        {clientName && (
          <p className="relative text-xs font-semibold text-primary uppercase tracking-[0.22em] mb-3">
            {clientName}
          </p>
        )}
        {projectTitle && (
          <h1 className="relative text-3xl sm:text-4xl font-semibold tracking-tight text-foreground max-w-3xl mx-auto mb-4">
            {projectTitle}
          </h1>
        )}
        <div
          className="relative w-14 h-0.5 mx-auto mb-4 rounded-full"
          style={{ background: 'linear-gradient(90deg, transparent, hsl(var(--primary)), transparent)' }}
        />
        {projectDescription && (
          <p className="relative text-sm sm:text-base text-muted-foreground max-w-xl mx-auto mb-5 leading-relaxed">
            {projectDescription}
          </p>
        )}
        <div className="relative flex items-center justify-center gap-3.5 flex-wrap text-[13px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Film className="w-3.5 h-3.5 opacity-70" />
            {t('metaVideos', { count: videoCount })}
          </span>
          {albumCount > 0 && (
            <>
              <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground/50" />
              <span className="inline-flex items-center gap-1.5">
                <Images className="w-3.5 h-3.5 opacity-70" />
                {t('metaAlbums', { count: albumCount })}
              </span>
            </>
          )}
          {approvedCount > 0 && (
            <>
              <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground/50" />
              <span className="inline-flex items-center gap-1.5 text-success">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t('metaApproved', { approved: approvedCount, total: videoCount })}
              </span>
            </>
          )}
        </div>
      </div>

      <div data-tutorial="video-grid">
        {/* Section header — icon badge + title + count, actions right (same anatomy as admin) */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <h2 className="text-xl font-semibold flex items-center gap-2 min-w-0">
            <span className="rounded-md p-1.5 flex-shrink-0 bg-foreground/5 dark:bg-foreground/10">
              <Film className="w-4 h-4 text-primary" />
            </span>
            {t('videos')}
            {videoCount > 0 && (
              <span className="text-xs font-medium text-muted-foreground bg-foreground/5 dark:bg-foreground/10 rounded-full px-2.5 py-0.5">
                {videoCount}
              </span>
            )}
          </h2>
          <div className="flex-1" />
          {onDownloadAll && (
            <Button variant="outline" size="sm" onClick={handleDownloadAllClick} disabled={downloadingAll} data-tutorial="download-all">
              {downloadingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="hidden sm:inline">{downloadAllLabel || t('videos')}</span>
            </Button>
          )}
          {showApproveHint && (
            <p className="w-full text-xs text-muted-foreground text-right">{t('approveToDownloadHint')}</p>
          )}
        </div>

        {videoCount === 0 ? (
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <Film className="w-8 h-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{tv('noVideosYet')}</p>
            </CardContent>
          </Card>
        ) : null}

        {viewMode === 'list' ? (
          <div className="space-y-2">
            {videoNames.map((name) => {
              const videos = videosByName[name]
              const hasAssets = allowAssetDownload && videos.some((v: any) => v.hasAssets === true)
              const latestVideo = getLatestVideo(videos)
              const latestVersionLabel = latestVideo?.versionLabel || `v${latestVideo?.version || 1}`
              const uploadTime = formatBeijingUploadTime(latestVideo?.createdAt, latestVideo?.updatedAt, latestVideo?.created_at, latestVideo?.uploadedAt)
              const feedbackCount = commentCountByName.get(name) || 0
              const thumbnailUrl = thumbnailsByName.get(name)

              return (
                <button
                  key={name}
                  onClick={() => onVideoSelect(name)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card shadow-elevation-md hover:border-primary/50 hover:shadow-elevation-lg transition-all duration-200 text-left"
                >
                  <div className="relative w-20 h-12 rounded-md overflow-hidden bg-black border border-border flex-shrink-0">
                    {thumbnailUrl ? (
                      <Image
                        src={thumbnailUrl}
                        alt={name}
                        fill
                        sizes="80px"
                        className="object-cover"
                        draggable={false}
                        unoptimized
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-muted">
                        <Film className="w-4 h-4 text-muted-foreground/50" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">{name}</p>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                        {latestVersionLabel}
                      </span>
                      <VideoReviewStatusBadge video={latestVideo} className="shrink-0" />
                    </div>
                    <div className="flex min-w-0 items-center justify-between gap-1 text-[9px] text-muted-foreground sm:text-[10px]">
                      <span className="shrink-0 whitespace-nowrap" title={uploadTime}>{uploadTime}</span>
                      <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap"><MessageSquare className="h-3 w-3" />{t('feedbackCount', { count: feedbackCount })}</span>
                    </div>
                  </div>
                  {hasAssets && (
                    <span title={t('includesAssets')} aria-label={t('includesAssets')} className="flex-shrink-0">
                      <Files className="w-4 h-4 text-muted-foreground" />
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </button>
              )
            })}
          </div>
        ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(168px,190px))]">
          {videoNames.map((name) => {
            const videos = videosByName[name]
            const hasAssets = allowAssetDownload && videos.some((v: any) => v.hasAssets === true)
            const latestVideo = getLatestVideo(videos)
            const latestVersionLabel = latestVideo?.versionLabel || `v${latestVideo?.version || 1}`
            const durationLabel = formatMinuteSecondDuration(Number(latestVideo?.duration) || 0)
            const uploadTime = formatBeijingUploadTime(latestVideo?.createdAt, latestVideo?.updatedAt, latestVideo?.created_at, latestVideo?.uploadedAt)
            const feedbackCount = commentCountByName.get(name) || 0
            const thumbnailUrl = thumbnailsByName.get(name)

            return (
              <button
                key={name}
                onClick={() => onVideoSelect(name)}
                className={cn(
                  'group relative overflow-hidden rounded-md text-left',
                  'bg-card border border-border/50 shadow-elevation-md',
                  'hover:border-primary/50 hover:shadow-elevation-lg',
                  'transition-all duration-200',
                  'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background'
                )}
              >
                {/* Thumbnail */}
                <div className="aspect-video relative bg-black">
                  {thumbnailsLoading ? (
                    // Loading skeleton
                    <div className="absolute inset-0 animate-pulse bg-muted" />
                  ) : thumbnailUrl ? (
                    // Thumbnail image - object-contain preserves aspect ratio
                    // unoptimized: in S3 mode /api/content/{token} returns a 302 redirect to a
                    // presigned URL — the Next.js image optimizer cannot follow cross-origin
                    // redirects, so we bypass it and let the browser handle the redirect natively.
                    <Image
                      src={thumbnailUrl}
                      alt={name}
                      fill
                      sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
                      className="object-contain"
                      draggable={false}
                      unoptimized
                    />
                  ) : (
                    // Placeholder
                    <div className="absolute inset-0 flex items-center justify-center bg-muted">
                      <Film className="w-8 h-8 sm:w-12 sm:h-12 text-muted-foreground/50" />
                    </div>
                  )}

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200" />

                  {/* Assets indicator */}
                  {hasAssets && (
                    <div
                      className="absolute top-2 left-2 bg-black/70 text-white rounded-full p-1"
                      title={t('includesAssets')}
                      aria-label={t('includesAssets')}
                    >
                      <Files className="w-3 h-3 sm:w-4 sm:h-4" />
                    </div>
                  )}

                  <VideoReviewStatusBadge video={latestVideo} className="absolute right-2 top-2 max-w-[calc(100%-3.5rem)]" />

                  {/* Duration and annotation badges */}
                  <div className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded bg-white/90 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-black shadow-sm">
                    <Film className="h-2.5 w-2.5" />
                    {durationLabel}
                  </div>
                  <div
                    className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded bg-white/90 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-black shadow-sm"
                    title={t('feedbackCount', { count: feedbackCount })}
                    aria-label={t('feedbackCount', { count: feedbackCount })}
                  >
                    <MessageSquare className="h-2.5 w-2.5" />
                    {feedbackCount}
                  </div>
                </div>

                {/* Info */}
                <div className="px-2.5 py-2">
                  <p className="truncate text-xs font-medium text-foreground">
                    {name}
                  </p>
                  <div className="mt-1 flex min-w-0 items-center justify-between gap-1 text-[9px] text-muted-foreground sm:text-[10px]">
                    <span className="shrink-0 whitespace-nowrap" title={uploadTime}>{uploadTime}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-foreground">
                      {latestVersionLabel}
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
        )}
      </div>
    </div>
  )
}
