'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Play, Pause, SkipBack, SkipForward, Columns2, SplitSquareHorizontal, MessageSquare, X } from 'lucide-react'
import { secondsToTimecode, formatCommentTimestamp, timecodeToSeconds } from '@/lib/timecode'
import { InitialsAvatar } from './InitialsAvatar'

function formatTimeWithMode(
  seconds: number,
  fps: number,
  videoDurationSeconds: number,
  mode: 'TIMECODE' | 'AUTO'
): string {
  if (!seconds || isNaN(seconds) || !isFinite(seconds)) return mode === 'TIMECODE' ? '00:00:00:00' : '0:00'
  const timecode = secondsToTimecode(seconds, fps)
  return formatCommentTimestamp({ timecode, fps, videoDurationSeconds, mode })
}

interface VideoComparisonControlsProps {
  videoDuration: number
  currentTime: number
  isPlaying: boolean
  onPlayPause: () => void
  onSeek: (time: number) => void
  onFrameStep: (direction: 'forward' | 'backward') => void
  mode: 'side-by-side' | 'slider'
  onModeChange: (mode: 'side-by-side' | 'slider') => void
  playbackSpeed: number
  onSpeedChange: (speed: number) => void
  videoFps: number
  timestampDisplayMode: 'TIMECODE' | 'AUTO'
  comments?: Array<{
    id: string
    timecode: string
    content: string
    authorName?: string | null
    avatarUrl?: string | null
    isInternal?: boolean
    resolved?: boolean
    comparisonSide: 'A' | 'B'
    versionLabel: string
  }>
}

export default function VideoComparisonControls({
  videoDuration,
  currentTime,
  isPlaying,
  onPlayPause,
  onSeek,
  onFrameStep,
  mode,
  onModeChange,
  playbackSpeed,
  onSpeedChange,
  videoFps,
  timestampDisplayMode,
  comments = [],
}: VideoComparisonControlsProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [hoveredTime, setHoveredTime] = useState<number | null>(null)
  const [activeCommentGroupKey, setActiveCommentGroupKey] = useState<string | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const t = useTranslations('videos')

  const progress = videoDuration > 0 ? (currentTime / videoDuration) * 100 : 0
  const commentGroups = useMemo(() => {
    const groups = new Map<string, {
      key: string
      time: number
      comments: typeof comments
    }>()

    for (const comment of comments) {
      let seconds = 0
      try {
        seconds = timecodeToSeconds(comment.timecode, videoFps)
      } catch {
        continue
      }
      if (!Number.isFinite(seconds) || seconds < 0) continue
      const markerTime = videoDuration > 0 ? Math.min(seconds, videoDuration) : seconds
      const key = markerTime.toFixed(2)
      const existing = groups.get(key)
      if (existing) existing.comments.push(comment)
      else groups.set(key, { key, time: markerTime, comments: [comment] })
    }

    return [...groups.values()].sort((a, b) => a.time - b.time)
  }, [comments, videoDuration, videoFps])
  const activeCommentGroup = commentGroups.find(group => group.key === activeCommentGroupKey) || null

  useEffect(() => {
    if (activeCommentGroupKey && !commentGroups.some(group => group.key === activeCommentGroupKey)) {
      setActiveCommentGroupKey(null)
    }
  }, [activeCommentGroupKey, commentGroups])

  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !videoDuration) return
    const rect = timelineRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const percentage = Math.max(0, Math.min(1, x / rect.width))
    setActiveCommentGroupKey(null)
    onSeek(percentage * videoDuration)
  }, [videoDuration, onSeek])

  const handleTimelineMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true)
    handleTimelineClick(e)
  }, [handleTimelineClick])

  const handleTimelineTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !videoDuration) return
    setIsDragging(true)
    const touch = e.touches[0]
    const rect = timelineRef.current.getBoundingClientRect()
    const x = touch.clientX - rect.left
    const percentage = Math.max(0, Math.min(1, x / rect.width))
    onSeek(percentage * videoDuration)
  }, [videoDuration, onSeek])

  const handleTimelineTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !videoDuration || !isDragging) return
    const touch = e.touches[0]
    const rect = timelineRef.current.getBoundingClientRect()
    const x = touch.clientX - rect.left
    const percentage = Math.max(0, Math.min(1, x / rect.width))
    onSeek(percentage * videoDuration)
  }, [isDragging, videoDuration, onSeek])

  const handleTimelineTouchEnd = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleTimelineMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !videoDuration) return
    const rect = timelineRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const percentage = Math.max(0, Math.min(1, x / rect.width))
    setHoveredTime(percentage * videoDuration)
    if (isDragging) {
      onSeek(percentage * videoDuration)
    }
  }, [isDragging, videoDuration, onSeek])

  const handleTimelineMouseLeave = useCallback(() => {
    setHoveredTime(null)
  }, [])

  const handleTimelineKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!videoDuration) return
    const step = videoFps ? 1 / videoFps : 1
    let nextTime: number | null = null
    if (event.key === 'ArrowLeft') nextTime = Math.max(0, currentTime - (event.shiftKey ? 5 : step))
    if (event.key === 'ArrowRight') nextTime = Math.min(videoDuration, currentTime + (event.shiftKey ? 5 : step))
    if (event.key === 'Home') nextTime = 0
    if (event.key === 'End') nextTime = videoDuration
    if (nextTime === null) return
    event.preventDefault()
    onSeek(nextTime)
  }, [currentTime, onSeek, videoDuration, videoFps])

  useEffect(() => {
    const handleMouseUp = () => {
      if (isDragging) setIsDragging(false)
    }
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [isDragging])

  return (
    <div className="relative rounded-lg border border-border/70 bg-muted/90 p-2 shadow-sm sm:p-3">
      {/* Timeline */}
      <div className="mb-2 sm:mb-3 px-1">
        {activeCommentGroup && (
          <div
            className="absolute bottom-[7.25rem] left-1/2 z-40 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-xl"
            role="dialog"
            aria-label={t('timelineComments')}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-3 border-b border-border pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <MessageSquare className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate text-sm font-semibold">{t('timelineComments')}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{activeCommentGroup.comments.length}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatTimeWithMode(activeCommentGroup.time, videoFps, videoDuration, timestampDisplayMode)}
                </span>
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setActiveCommentGroupKey(null)}
                  aria-label={t('closeTimelineComments')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
              {activeCommentGroup.comments.map((comment) => (
                <div key={comment.id} className="rounded-md bg-muted/60 px-3 py-2.5">
                  <div className="mb-1.5 flex min-w-0 items-center gap-2 text-xs">
                    <InitialsAvatar
                      name={comment.authorName || t('anonymousReviewer')}
                      src={comment.avatarUrl}
                      size="xs"
                      className="shrink-0"
                      isInternal={comment.isInternal}
                    />
                    <span className={`rounded px-1.5 py-0.5 font-medium ${
                      comment.comparisonSide === 'A'
                        ? 'bg-blue-500/15 text-blue-600 dark:text-blue-300'
                        : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    }`}>
                      {comment.comparisonSide} · {comment.versionLabel}
                    </span>
                    <span className="truncate font-medium">{comment.authorName || t('anonymousReviewer')}</span>
                    {comment.resolved && <span className="ml-auto shrink-0 text-muted-foreground">{t('resolvedComment')}</span>}
                  </div>
                  <div
                    className="line-clamp-4 break-words text-sm leading-5 [&_p]:m-0"
                    dangerouslySetInnerHTML={{ __html: comment.content }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="group relative h-12 touch-none sm:h-14">
          <div
            ref={timelineRef}
            className="absolute inset-0 cursor-pointer"
            onMouseDown={handleTimelineMouseDown}
            onClick={handleTimelineClick}
            onMouseMove={handleTimelineMouseMove}
            onMouseLeave={handleTimelineMouseLeave}
            onTouchStart={handleTimelineTouchStart}
            onTouchMove={handleTimelineTouchMove}
            onTouchEnd={handleTimelineTouchEnd}
            role="slider"
            tabIndex={0}
            aria-label={t('comparisonTimeline')}
            aria-valuemin={0}
            aria-valuemax={videoDuration}
            aria-valuenow={Math.min(videoDuration, Math.max(0, currentTime))}
            onKeyDown={handleTimelineKeyDown}
          >
            {/* Background Track */}
            <div className="absolute bottom-1 left-0 right-0 h-1.5 overflow-hidden rounded-full bg-foreground/10 sm:h-2">
              <div className="absolute inset-0 bg-foreground/10" />
              <div
                className="absolute inset-y-0 left-0 bg-primary transition-all duration-100"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Playhead */}
            <div
              className="pointer-events-none absolute bottom-0 z-20"
              style={{ left: `${progress}%` }}
            >
              <div className="w-4 h-4 sm:w-5 sm:h-5 bg-white rounded-full shadow-lg border-2 border-primary -translate-x-1/2 group-hover:scale-110 transition-transform" />
            </div>

            {/* Hover Time Indicator */}
            {hoveredTime !== null && !isDragging && (
              <div
                className="pointer-events-none absolute bottom-full mb-2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 font-sans text-xs tabular-nums text-popover-foreground shadow-md"
                style={{
                  left: `${(hoveredTime / videoDuration) * 100}%`,
                  transform: 'translateX(-50%)',
                }}
              >
                {formatTimeWithMode(hoveredTime, videoFps, videoDuration, timestampDisplayMode)}
              </div>
            )}
          </div>

          {/* Comment markers */}
          {videoDuration > 0 && commentGroups.map((group) => {
            const markerPosition = Math.max(0, Math.min(100, (group.time / videoDuration) * 100))
            const firstComment = group.comments[0]
            const authorName = firstComment.authorName || t('anonymousReviewer')
            const mixedVersions = group.comments.some(comment => comment.comparisonSide !== firstComment.comparisonSide)
            const markerLabel = t('openTimelineComment', {
              author: authorName,
              time: formatTimeWithMode(group.time, videoFps, videoDuration, timestampDisplayMode),
            })
            return (
              <button
                key={group.key}
                type="button"
                className={`absolute bottom-4 z-30 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full border-2 bg-background text-[10px] font-semibold text-foreground shadow-md transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  mixedVersions
                    ? 'border-primary'
                    : firstComment.comparisonSide === 'A'
                      ? 'border-blue-500'
                      : 'border-emerald-500'
                }`}
                style={{ left: `${markerPosition}%` }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onSeek(group.time)
                  setActiveCommentGroupKey(current => current === group.key ? null : group.key)
                }}
                aria-label={markerLabel}
                aria-expanded={activeCommentGroupKey === group.key}
                title={markerLabel}
              >
                <span aria-hidden="true">
                  <InitialsAvatar
                    name={authorName}
                    src={firstComment.avatarUrl}
                    size="xs"
                    className="ring-0"
                    isInternal={firstComment.isInternal}
                  />
                </span>
                {group.comments.length > 1 && (
                  <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-primary px-1 text-[9px] leading-4 text-primary-foreground">
                    {group.comments.length}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Control Buttons */}
      <div className="flex items-center justify-between gap-2 sm:gap-3 px-1">
        {/* Left Controls */}
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => onFrameStep('backward')}
            className="p-2 sm:p-2.5 hover:bg-foreground/10 active:bg-foreground/15 rounded-lg transition-colors touch-manipulation"
            aria-label={t('previousFrame')}
            title={t('previousFrame') + ' (Ctrl+J)'}
          >
            <SkipBack className="w-4 h-4 sm:w-5 sm:h-5 text-foreground" />
          </button>

          <button
            onClick={onPlayPause}
            className="p-2.5 sm:p-3 hover:bg-foreground/10 active:bg-foreground/15 rounded-lg transition-colors touch-manipulation"
            aria-label={isPlaying ? t('pause') : t('playPause')}
            title={(isPlaying ? t('pause') : t('playPause')) + ' (Ctrl+Space)'}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 sm:w-6 sm:h-6 text-foreground fill-foreground" />
            ) : (
              <Play className="w-5 h-5 sm:w-6 sm:h-6 text-foreground fill-foreground" />
            )}
          </button>

          <button
            onClick={() => onFrameStep('forward')}
            className="p-2 sm:p-2.5 hover:bg-foreground/10 active:bg-foreground/15 rounded-lg transition-colors touch-manipulation"
            aria-label={t('nextFrame')}
            title={t('nextFrame') + ' (Ctrl+L)'}
          >
            <SkipForward className="w-4 h-4 sm:w-5 sm:h-5 text-foreground" />
          </button>

          {/* Time Display */}
          <div className="text-foreground text-xs sm:text-sm font-sans font-medium tabular-nums ml-1 sm:ml-2 whitespace-nowrap">
            {formatTimeWithMode(currentTime, videoFps, videoDuration, timestampDisplayMode)} / {formatTimeWithMode(videoDuration, videoFps, videoDuration, timestampDisplayMode)}
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Speed */}
          <button
            onClick={() => {
              const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
              const idx = speeds.indexOf(playbackSpeed)
              const next = idx >= 0 && idx < speeds.length - 1 ? speeds[idx + 1] : speeds[0]
              onSpeedChange(next)
            }}
            className="px-2 py-1 sm:px-2.5 sm:py-1.5 hover:bg-foreground/10 active:bg-foreground/15 rounded-lg transition-colors text-foreground text-xs sm:text-sm font-sans tabular-nums touch-manipulation"
            aria-label={t('playbackSpeed')}
            title={t('cycleSpeed')}
          >
            {playbackSpeed}x
          </button>

          {/* Mode Toggle */}
          <button
            onClick={() => onModeChange(mode === 'side-by-side' ? 'slider' : 'side-by-side')}
            className="p-2 sm:p-2.5 hover:bg-foreground/10 active:bg-foreground/15 rounded-lg transition-colors touch-manipulation"
            aria-label={mode === 'side-by-side' ? t('switchToSlider') : t('switchToSideBySide')}
            title={mode === 'side-by-side' ? t('sliderMode') : t('sideBySideMode')}
          >
            {mode === 'side-by-side' ? (
              <SplitSquareHorizontal className="w-4 h-4 sm:w-5 sm:h-5 text-foreground" />
            ) : (
              <Columns2 className="w-4 h-4 sm:w-5 sm:h-5 text-foreground" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
