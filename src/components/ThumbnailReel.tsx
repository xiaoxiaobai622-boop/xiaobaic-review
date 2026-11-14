'use client'

import Image from 'next/image'
import { useId, useRef, useEffect, useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Check, CheckCircle2, ChevronLeft, ChevronRight, FileDown, Film, ArrowLeft, GitCompareArrows, MessageSquare, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InitialsAvatar } from '@/components/InitialsAvatar'
import ReviewMoreMenu from '@/components/ReviewMoreMenu'
import popupStyles from '@/components/review-popup.module.css'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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
  showThemeToggle?: boolean
  showComparisonAction?: boolean
  /** 项目所属团队；审片顶栏只显示团队头像。 */
  teamName?: string
  teamAvatarUrl?: string | null
  /** Lets the player area make room for the left video list while it is open. */
  onExpandedChange?: (open: boolean) => void
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
  showThemeToggle = true,
  showComparisonAction = true,
  teamName = '',
  teamAvatarUrl = null,
  onExpandedChange,
  trailingAction,
  beforeToolbarAction,
  leadingAction,
  comments = [],
}: ThumbnailReelProps) {
  const tShare = useTranslations('share')
  const tVideos = useTranslations('videos')
  const tComments = useTranslations('comments')
  const tc = useTranslations('common')
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // Start collapsed on first load
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedVersionId, setSelectedVersionId] = useState<string>('')
  const hasScrolledRef = useRef(false)
  const nameTriggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  const handleToggleExpanded = () => {
    setIsExpanded((current) => !current)
  }

  useEffect(() => {
    onExpandedChange?.(isExpanded)
  }, [isExpanded, onExpandedChange])

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

  // The popup list mounts a frame after opening; center the active video once it exists.
  useEffect(() => {
    if (!isExpanded || !activeVideoName || hasScrolledRef.current) return
    let frame = 0
    let tries = 0
    const centerActive = () => {
      const container = scrollContainerRef.current
      const idx = videoNames.indexOf(activeVideoName)
      const activeOption = idx === -1 ? undefined : container?.querySelectorAll('[data-video-option]')[idx] as HTMLElement | undefined
      if (!container || !activeOption) {
        if (tries++ < 60) frame = requestAnimationFrame(centerActive)
        return
      }
      const scrollTo = activeOption.offsetTop - container.clientHeight / 2 + activeOption.offsetHeight / 2
      // Jump before the panel finishes fading in; a smooth scroll here reads as jitter.
      container.scrollTo({ top: scrollTo })
      hasScrolledRef.current = true
    }
    centerActive()
    return () => cancelAnimationFrame(frame)
  }, [activeVideoName, videoNames, isExpanded])

  // Reset scroll flag when collapsing
  useEffect(() => {
    if (!isExpanded) {
      hasScrolledRef.current = false
    }
  }, [isExpanded])

  // Get current video info
  const currentVideos = useMemo(
    () => (activeVideoName ? videosByName[activeVideoName] : []),
    [activeVideoName, videosByName]
  )
  // Only READY versions can be played; listing failed/transcoding versions made
  // the dropdown selectable but switching to them left the player unchanged.
  const playableVideos = useMemo(
    () => currentVideos.filter((video: any) => video.status === 'READY'),
    [currentVideos]
  )
  const selectedVersion = useMemo(
    () => playableVideos.find((video: any) => video.id === selectedVersionId) ?? playableVideos[0] ?? null,
    [playableVideos, selectedVersionId]
  )
  const latestVersion = useMemo(
    () => playableVideos.reduce((best: any, video: any) => (
      !best || video.version > best.version ? video : best
    ), null),
    [playableVideos]
  )
  const newerVersion = latestVersion && selectedVersion &&
    latestVersion.id !== selectedVersion.id &&
    latestVersion.version > selectedVersion.version
    ? latestVersion
    : null

  useEffect(() => {
    if (playableVideos.length === 0) {
      if (selectedVersionId) setSelectedVersionId('')
      return
    }
    const available = playableVideos.some((video: any) => video.id === selectedVersionId)
    if (!available) setSelectedVersionId(playableVideos[0].id)
  }, [playableVideos, selectedVersionId])

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
      <div
        className="h-[39px] rounded-[8px] px-3 sm:h-[50px] sm:px-4"
        style={{ backgroundColor: 'hsl(var(--review-chrome, var(--card)))' }}
      >
        <div className="flex h-full items-center gap-1.5 sm:gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {leadingAction}
            {showBackButton && onBackToGrid && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onBackToGrid}
                className="h-[28px] w-[28px] shrink-0 sm:rounded-[8px]"
                title={backButtonLabel || tShare('backToOverview')}
                aria-label={backButtonLabel || tShare('backToOverview')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {teamName && (
              <div className="hidden shrink-0 items-center sm:flex">
                <InitialsAvatar name={teamName} src={teamAvatarUrl} size="sm" isInternal />
              </div>
            )}
            <button
              ref={nameTriggerRef}
              type="button"
              data-review-popup-trigger
              onClick={handleToggleExpanded}
              aria-haspopup="menu"
              aria-expanded={isExpanded}
              aria-controls={isExpanded ? menuId : undefined}
              className="min-w-0 truncate text-left text-sm font-semibold text-foreground hover:text-primary sm:text-[13px] sm:font-medium"
              title={activeVideoName}
            >
              {activeVideoName}
            </button>
            {playableVideos.length > 1 && (
              <select
                aria-label="切换版本"
                value={selectedVersionId || playableVideos[0]?.id}
                onChange={(event) => {
                  setSelectedVersionId(event.target.value)
                  window.dispatchEvent(new CustomEvent('selectReviewVersion', { detail: { videoId: event.target.value } }))
                }}
                className="h-[28px] min-w-[46px] max-w-[72px] shrink-0 rounded-[6px] border border-border bg-background px-1.5 text-xs font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring sm:rounded-[8px] sm:text-[13px]"
              >
                {playableVideos.map((video: any) => (
                  <option key={video.id} value={video.id}>{video.versionLabel || `v${video.version}`}</option>
                ))}
              </select>
            )}
            {newerVersion && (
              <button
                type="button"
                onClick={() => {
                  setSelectedVersionId(newerVersion.id)
                  window.dispatchEvent(new CustomEvent('selectReviewVersion', { detail: { videoId: newerVersion.id } }))
                }}
                className="flex h-[28px] shrink-0 items-center gap-1 rounded-[6px] border border-border bg-background px-1.5 text-xs font-medium tabular-nums text-foreground outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring sm:rounded-[8px] sm:text-[13px]"
                title={`${tc('version')} ${newerVersion.versionLabel || `v${newerVersion.version}`}`}
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>{newerVersion.versionLabel || `v${newerVersion.version}`}</span>
              </button>
            )}
            <div className="hidden items-center gap-0.5 sm:flex sm:gap-0 sm:rounded-[6px] sm:bg-[hsl(var(--muted))]">
              <Button variant="ghost" size="icon" onClick={handlePrevVideo} disabled={activeIndex <= 0} className="h-[28px] w-[28px] sm:rounded-[8px]" title={tShare('previousVideo')}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="min-w-9 text-center text-xs text-muted-foreground tabular-nums sm:min-w-[26px] sm:text-[12px] sm:text-foreground">{activeIndex + 1}/{totalVideos}</span>
              <Button variant="ghost" size="icon" onClick={handleNextVideo} disabled={activeIndex >= totalVideos - 1} className="h-[28px] w-[28px] sm:rounded-[8px]" title={tShare('nextVideo')}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {showComparisonAction && playableVideos.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                className="flex h-[28px] gap-1.5 px-2 sm:rounded-[8px] sm:px-3 sm:text-[13px]"
                onClick={() => window.dispatchEvent(new CustomEvent('openReviewComparison'))}
              >
                <GitCompareArrows className="h-4 w-4" />
                <span className="hidden sm:inline">{tVideos('compare')}</span>
              </Button>
            )}

            {beforeToolbarAction}
            {trailingAction}
            <ReviewMoreMenu />
            <span aria-hidden="true" className="h-[20px] w-px shrink-0 rounded-full bg-border" />

            {/* Language and theme toggles */}
            {showLanguageToggle && <LanguageToggle compact />}
            {showThemeToggle && <ThemeToggle compact />}
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-disabled="true"
                    aria-label={tComments('exportComments')}
                    onClick={(event) => event.preventDefault()}
                    className="inline-flex h-[28px] w-[28px] shrink-0 cursor-default items-center justify-center rounded-[6px] text-muted-foreground opacity-60 outline-none transition-colors hover:bg-transparent hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <FileDown className="h-[20px] w-[20px]" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{tComments('exportComingSoon')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {showCommentToggle && onToggleCommentPanel && (
              <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px]">
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={onToggleCommentPanel}
                        aria-label={isCommentPanelVisible ? tShare('hideAssetInfo') : tShare('showAssetInfo')}
                        aria-pressed={isCommentPanelVisible}
                        className="h-[28px] w-[28px] shrink-0 rounded-[6px] bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ width: 20, height: 20 }}>
                          <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="2.75" stroke="currentColor" strokeWidth="1.75" />
                          <rect x="15" y="6.25" width="5" height="11.5" rx="1" fill="currentColor" />
                        </svg>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {isCommentPanelVisible ? tShare('hideAssetInfo') : tShare('showAssetInfo')}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </span>
            )}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => setIsExpanded(false)}
          aria-hidden="true"
        />
      )}
      <div
        id={menuId}
        ref={scrollContainerRef}
        role="menu"
        aria-label={activeVideoName}
        aria-hidden={!isExpanded}
        inert={!isExpanded ? true : undefined}
        data-video-menu-panel
        data-open={isExpanded ? 'true' : 'false'}
        className="scrollbar-hidden absolute left-2 top-full z-40 mt-1 max-h-[calc(100dvh-47px)] w-[270px] max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain rounded-md border border-border/70 bg-background/95 p-1.5 shadow-lg backdrop-blur-md sm:max-h-[calc(100dvh-58px)]"
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
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                data-video-option
                onClick={() => {
                  onVideoSelect(name)
                  setIsExpanded(false)
                }}
                className={popupStyles.item}
              >
                <span className="relative block aspect-video w-[72px] shrink-0 overflow-hidden rounded-[4px] bg-black">
                  {thumbnailUrl ? (
                    <Image
                      src={thumbnailUrl}
                      alt={name}
                      fill
                      sizes="72px"
                      className="object-contain"
                      draggable={false}
                      unoptimized
                    />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center bg-muted">
                      <Film className="h-4 w-4 text-muted-foreground/50" />
                    </span>
                  )}

                  {hasApprovedVideo && (
                    <span className="absolute right-0.5 top-0.5 rounded-full bg-success p-0.5 text-success-foreground">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                    </span>
                  )}

                  <span className="absolute bottom-0.5 right-0.5 rounded bg-white/90 px-1 py-px text-[9px] font-medium text-black shadow-sm">
                    {latestVersionLabel}
                  </span>

                  {isActive && <span className="absolute inset-0 bg-primary/10" />}
                </span>

                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[13px] leading-5', isActive ? 'font-medium text-primary' : 'text-foreground')}>
                    {name}
                  </span>
                  <span className="mt-1 flex items-center gap-1 text-[11px] leading-4 text-muted-foreground">
                    <MessageSquare className="h-3 w-3" aria-hidden="true" />
                    {tShare('feedbackCount', { count: feedbackCount })}
                  </span>
                </span>

                {isActive && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            )
          })}
      </div>
    </div>
  )
}
