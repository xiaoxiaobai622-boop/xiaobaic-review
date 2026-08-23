'use client'

import Image from 'next/image'
import { useRef, useEffect, useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, ChevronLeft, ChevronRight, Film, ArrowLeft, GitCompareArrows, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import ThemeToggle from '@/components/ThemeToggle'
import LanguageToggle from '@/components/LanguageToggle'
import { countCommentsByLatestVideoName, getLatestVideo } from '@/lib/video-comment-counts'

interface ThumbnailReelProps {
  videosByName: Record<string, any[]>
  thumbnailsByName: Map<string, string>
  activeVideoName: string
  onVideoSelect: (videoName: string) => void
  onBackToGrid?: () => void
  showBackButton?: boolean
  backButtonLabel?: string
  // Comment panel controls
  showCommentToggle?: boolean
  isCommentPanelVisible?: boolean
  onToggleCommentPanel?: () => void
  // Toolbar capabilities vary between internal and client review pages.
  showLanguageToggle?: boolean
  showComparisonAction?: boolean
  // Optional slot rendered after ThemeToggle (e.g. tutorial help button)
  trailingAction?: React.ReactNode
  // Optional action rendered between version comparison and language controls
  beforeToolbarAction?: React.ReactNode
  // Optional action before the overview button (e.g. return to source page)
  leadingAction?: React.ReactNode
  comments?: Array<{ videoId?: string | null }>
}

export default function ThumbnailReel({
  videosByName,
  thumbnailsByName,
  activeVideoName,
  onVideoSelect,
  onBackToGrid,
  showBackButton = true,
  backButtonLabel,
  showCommentToggle = false,
  isCommentPanelVisible = true,
  onToggleCommentPanel,
  showLanguageToggle = true,
  showComparisonAction = true,
  trailingAction,
  beforeToolbarAction,
  leadingAction,
  comments = [],
}: ThumbnailReelProps) {
  const tShare = useTranslations('share')
  const tVideos = useTranslations('videos')
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // Start collapsed on first load
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedVersionId, setSelectedVersionId] = useState<string>('')
  const hasScrolledRef = useRef(false)

  const handleToggleExpanded = () => {
    setIsExpanded(!isExpanded)
  }

  // Keep the project order stable; approval is a state, not a sort priority.
  const videoNames = useMemo(() => {
    return Object.keys(videosByName).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [videosByName])

  const activeIndex = videoNames.indexOf(activeVideoName)
  const totalVideos = videoNames.length
  const commentCountByName = useMemo(() => {
    return countCommentsByLatestVideoName(videosByName, comments)
  }, [comments, videosByName])

  // Navigation
  const handlePrevVideo = () => {
    if (activeIndex > 0) {
      onVideoSelect(videoNames[activeIndex - 1])
    }
  }

  const handleNextVideo = () => {
    if (activeIndex < totalVideos - 1) {
      onVideoSelect(videoNames[activeIndex + 1])
    }
  }

  // Scroll to active thumbnail when expanded
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || !activeVideoName || !isExpanded) return

    // Reset scroll flag when expanding
    if (!hasScrolledRef.current) {
      const idx = videoNames.indexOf(activeVideoName)
      if (idx === -1) return

      // Find the active thumbnail element
      const thumbnails = container.querySelectorAll('[data-thumbnail]')
      const activeThumbnail = thumbnails[idx] as HTMLElement
      if (!activeThumbnail) return

      // Scroll to center the active thumbnail
      const containerWidth = container.clientWidth
      const thumbnailLeft = activeThumbnail.offsetLeft
      const thumbnailWidth = activeThumbnail.offsetWidth
      const scrollTo = thumbnailLeft - containerWidth / 2 + thumbnailWidth / 2

      container.scrollTo({ left: scrollTo, behavior: 'smooth' })
      hasScrolledRef.current = true
    }
  }, [activeVideoName, videoNames, isExpanded])

  // Reset scroll flag when collapsing
  useEffect(() => {
    if (!isExpanded) {
      hasScrolledRef.current = false
    }
  }, [isExpanded])

  // Get current video info
  const currentVideos = activeVideoName ? videosByName[activeVideoName] : []

  useEffect(() => {
    const available = currentVideos.some((video: any) => video.id === selectedVersionId)
    if (!available) setSelectedVersionId(currentVideos[0]?.id || '')
  }, [activeVideoName, currentVideos, selectedVersionId])

  useEffect(() => {
    const handleVersionChanged = (event: Event) => {
      const videoId = (event as CustomEvent).detail?.videoId
      if (videoId) setSelectedVersionId(videoId)
    }
    window.addEventListener('reviewVersionChanged', handleVersionChanged)
    return () => window.removeEventListener('reviewVersionChanged', handleVersionChanged)
  }, [])

  return (
    <div className="relative z-20 shrink-0">
      {/* Compact Control Bar - Always visible */}
      <div className="h-14 border-b border-border/70 bg-card px-3 sm:px-4">
        <div className="flex h-full items-center gap-1.5 sm:gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {leadingAction}
            {showBackButton && onBackToGrid && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onBackToGrid}
                className="h-9 w-9 shrink-0"
                title={backButtonLabel || tShare('backToOverview')}
                aria-label={backButtonLabel || tShare('backToOverview')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <button
              type="button"
              onClick={handleToggleExpanded}
              className="min-w-0 truncate text-left text-sm font-semibold text-foreground hover:text-primary"
              title={activeVideoName}
            >
              {activeVideoName}
            </button>
            {currentVideos.length > 0 && (
              <select
                aria-label="切换版本"
                value={selectedVersionId || currentVideos[0]?.id}
                onChange={(event) => {
                  setSelectedVersionId(event.target.value)
                  window.dispatchEvent(new CustomEvent('selectReviewVersion', { detail: { videoId: event.target.value } }))
                }}
                className="h-7 min-w-[46px] max-w-[72px] shrink-0 rounded-[4px] border border-border bg-background px-1.5 text-xs font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {currentVideos.map((video: any) => (
                  <option key={video.id} value={video.id}>{video.versionLabel || `v${video.version}`}</option>
                ))}
              </select>
            )}
            <div className="hidden items-center gap-0.5 sm:flex">
              <Button variant="ghost" size="icon" onClick={handlePrevVideo} disabled={activeIndex <= 0} className="h-7 w-7" title={tShare('previousVideo')}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="min-w-9 text-center text-xs text-muted-foreground tabular-nums">{activeIndex + 1}/{totalVideos}</span>
              <Button variant="ghost" size="icon" onClick={handleNextVideo} disabled={activeIndex >= totalVideos - 1} className="h-7 w-7" title={tShare('nextVideo')}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {showComparisonAction && currentVideos.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                className="flex h-8 gap-1.5 px-2 sm:px-3"
                onClick={() => window.dispatchEvent(new CustomEvent('openReviewComparison'))}
              >
                <GitCompareArrows className="h-4 w-4" />
                <span className="hidden sm:inline">{tVideos('compare')}</span>
              </Button>
            )}

            {beforeToolbarAction}

            {/* Language and theme toggles */}
            {showLanguageToggle && <LanguageToggle className="h-8 shadow-none" />}
            <ThemeToggle />
            {trailingAction}
          </div>
        </div>
      </div>

      {/* Floating Thumbnail Overlay - Appears below the bar, overlays content */}
      {isExpanded && (
        <div
          className="absolute left-2 right-2 top-full z-30 mt-1 sm:left-4 sm:right-4"
        >
          <div className="rounded-md border border-border/70 bg-background/95 shadow-lg backdrop-blur-md">
            <div className="px-2 py-3 sm:px-4">
              {/* Thumbnails container */}
              <div
                ref={scrollContainerRef}
                className="flex gap-2 sm:gap-3 overflow-x-auto overscroll-x-contain snap-x snap-mandatory justify-center"
                style={{
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {videoNames.map((name) => {
                  const videos = videosByName[name]
                  const hasApprovedVideo = videos.some((v: any) => v.approved === true)
                  const latestVideo = getLatestVideo(videos)
                  const latestVersionLabel = latestVideo?.versionLabel || `v${latestVideo?.version || 1}`
                  const feedbackCount = commentCountByName.get(name) || 0
                  const thumbnailUrl = thumbnailsByName.get(name)
                  const isActive = activeVideoName === name

                  return (
                    <button
                      key={name}
                      data-thumbnail
                      onClick={() => {
                        onVideoSelect(name)
                        setIsExpanded(false) // Close after selection
                      }}
                      className={cn(
                        'shrink-0 rounded-md sm:rounded-lg overflow-hidden snap-start',
                        'bg-muted border-2 transition-all duration-150',
                        'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-background',
                        'w-[80px] sm:w-[110px] md:w-[130px] lg:w-[150px]',
                        isActive
                          ? 'border-primary ring-2 ring-primary/30'
                          : 'border-transparent hover:border-border'
                      )}
                    >
                      {/* Thumbnail */}
                      <div className="aspect-video relative bg-black">
                        {thumbnailUrl ? (
                          <Image
                            src={thumbnailUrl}
                            alt={name}
                            fill
                            sizes="(min-width: 1024px) 150px, (min-width: 640px) 110px, 80px"
                            className="object-contain"
                            draggable={false}
                            unoptimized
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center bg-muted">
                            <Film className="w-5 h-5 sm:w-6 sm:h-6 text-muted-foreground/50" />
                          </div>
                        )}

                        {/* Approved badge */}
                        {hasApprovedVideo && (
                          <div className="absolute top-1 right-1 bg-success text-success-foreground rounded-full p-0.5">
                            <CheckCircle2 className="w-3 h-3" />
                          </div>
                        )}

                        {/* Latest version badge */}
                        <div className="absolute bottom-1 right-1 rounded bg-white/90 px-1.5 py-0.5 text-[9px] font-medium text-black shadow-sm sm:text-[10px]">
                          {latestVersionLabel}
                        </div>

                        {/* Active overlay */}
                        {isActive && (
                          <div className="absolute inset-0 bg-primary/10" />
                        )}
                      </div>

                      {/* Name */}
                      <div className="px-1.5 py-1 sm:px-2 sm:py-1.5 bg-card/80">
                        <p
                          className={cn(
                            'text-[10px] sm:text-xs truncate text-center',
                            isActive ? 'text-primary font-medium' : 'text-foreground'
                          )}
                        >
                          {name}
                        </p>
                        <p className="mt-0.5 flex items-center justify-center gap-1 text-[9px] sm:text-[10px] text-muted-foreground">
                          <MessageSquare className="h-2.5 w-2.5" />
                          {tShare('feedbackCount', { count: feedbackCount })}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Click outside to close */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => {
            setIsExpanded(false)
          }}
          aria-hidden="true"
        />
      )}
    </div>
  )
}
