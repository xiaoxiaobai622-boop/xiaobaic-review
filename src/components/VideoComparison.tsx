'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Video } from '@prisma/client'
import { X, ChevronDown } from 'lucide-react'
import { Button } from './ui/button'
import VideoComparisonControls from './VideoComparisonControls'
import VideoComparisonSlider from './VideoComparisonSlider'
import AnnotationOverlay, { type AnnotationAuthorMeta } from './AnnotationOverlay'
import { useHlsSource } from '@/hooks/useHlsSource'
import { ComparisonSide, useDualVideoSync } from '@/hooks/useDualVideoSync'
import { formatCommentTimestamp } from '@/lib/timecode'
import type { AnnotationData } from '@/types/annotations'

export interface VideoComparisonComment {
  id: string
  videoId?: string | null
  timecode: string
  timecodeEnd?: string | null
  content: string
  authorName?: string | null
  avatarUrl?: string | null
  user?: { avatarUrl?: string | null } | null
  isInternal?: boolean
  resolved?: boolean
  /** Shape payload as stored on the comment; validated by the overlay itself. */
  annotations?: unknown
}

interface VideoComparisonTimelineComment extends VideoComparisonComment {
  comparisonSide: 'A' | 'B'
  versionLabel: string
}

interface VideoComparisonProps {
  videoVersions: Video[]
  defaultQuality?: '720p' | '1080p' | '2160p'
  defaultVersionA?: number
  defaultVersionB?: number
  timestampDisplayMode?: 'TIMECODE' | 'AUTO'
  comments?: VideoComparisonComment[]
  onClose: () => void
}

function getVideoFallbackUrl(video: Video, quality: '720p' | '1080p' | '2160p'): string {
  if (quality === '2160p') {
    return (video as any).streamUrl2160p || (video as any).streamUrl1080p || (video as any).streamUrl720p || ''
  }
  if (quality === '1080p') {
    return (video as any).streamUrl1080p || (video as any).streamUrl720p || (video as any).streamUrl2160p || ''
  }
  return (video as any).streamUrl720p || (video as any).streamUrl1080p || (video as any).streamUrl2160p || ''
}

export default function VideoComparison({
  videoVersions,
  defaultQuality = '720p',
  defaultVersionA,
  defaultVersionB,
  timestampDisplayMode = 'TIMECODE',
  comments = [],
  onClose,
}: VideoComparisonProps) {
  const t = useTranslations('videos')
  const sorted = [...videoVersions].sort((a, b) => a.version - b.version)

  // Default: A = second-to-last (previous), B = last (latest)
  const initialA = defaultVersionA !== undefined
    ? sorted.findIndex(v => v.version === defaultVersionA)
    : Math.max(0, sorted.length - 2)
  const initialB = defaultVersionB !== undefined
    ? sorted.findIndex(v => v.version === defaultVersionB)
    : sorted.length - 1

  const [versionAIndex, setVersionAIndex] = useState(Math.max(0, initialA))
  const [versionBIndex, setVersionBIndex] = useState(Math.max(0, initialB))
  const [mode, setMode] = useState<'side-by-side' | 'slider'>('side-by-side')
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [audioSide, setAudioSide] = useState<'none' | ComparisonSide>('none')
  const [showSelectorA, setShowSelectorA] = useState(false)
  const [showSelectorB, setShowSelectorB] = useState(false)

  const videoRefA = useRef<HTMLVideoElement | null>(null)
  const videoRefB = useRef<HTMLVideoElement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const versionA = sorted[versionAIndex]
  const versionB = sorted[versionBIndex]
  const videoUrlA = getVideoFallbackUrl(versionA, defaultQuality)
  const videoUrlB = getVideoFallbackUrl(versionB, defaultQuality)
  const hlsUrlA = (versionA as any)?.hlsUrl720p || ''
  const hlsUrlB = (versionB as any)?.hlsUrl720p || ''

  useHlsSource({
    videoRef: videoRefA,
    hlsUrl: hlsUrlA,
    fallbackUrl: videoUrlA,
    attachmentKey: `${mode}:${versionA?.id ?? 'none'}`,
  })
  useHlsSource({
    videoRef: videoRefB,
    hlsUrl: hlsUrlB,
    fallbackUrl: videoUrlB,
    attachmentKey: `${mode}:${versionB?.id ?? 'none'}`,
  })

  const videoFps = versionA?.fps || versionB?.fps || 24
  const {
    isPlaying,
    currentTime,
    duration: videoDuration,
    waitingSide,
    toggle: togglePlayPause,
    seekTo: handleSeek,
    stepFrame,
    setSpeed,
  } = useDualVideoSync({
    videoRefA,
    videoRefB,
    fps: videoFps,
    speed: playbackSpeed,
    attachmentKey: `${mode}:${versionA?.id ?? 'none'}:${versionB?.id ?? 'none'}`,
  })

  const timelineComments = useMemo(
    () => comments.flatMap<VideoComparisonTimelineComment>((comment) => {
      const avatarUrl = comment.avatarUrl ?? comment.user?.avatarUrl ?? null
      if (comment.videoId === versionA?.id) {
        return [{
          ...comment,
          avatarUrl,
          comparisonSide: 'A' as const,
          versionLabel: versionA.versionLabel || `v${versionA.version}`,
        }]
      }
      if (comment.videoId === versionB?.id && versionB?.id !== versionA?.id) {
        return [{
          ...comment,
          avatarUrl,
          comparisonSide: 'B' as const,
          versionLabel: versionB.versionLabel || `v${versionB.version}`,
        }]
      }
      return []
    }),
    [comments, versionA, versionB],
  )

  // Drawings and author badges belong to the version the comment was made on,
  // so each side gets its own overlay input.
  const annotationsBySide = useMemo(() => {
    const forSide = (side: 'A' | 'B') => {
      const list = timelineComments.filter((comment) => comment.comparisonSide === side)
      return {
        comments: list.map(({ id, timecode, timecodeEnd, annotations }) => ({
          id, timecode, timecodeEnd,
          annotations: (annotations ?? null) as AnnotationData | null,
        })),
        authors: new Map<string, AnnotationAuthorMeta>(list.map((comment) => [
          comment.id,
          {
            name: comment.authorName || t('anonymousReviewer'),
            avatarUrl: comment.avatarUrl ?? null,
            isInternal: comment.isInternal,
            timecode: formatCommentTimestamp({
              timecode: comment.timecode,
              fps: videoFps,
              videoDurationSeconds: videoDuration,
              mode: timestampDisplayMode,
            }),
            content: comment.content,
          },
        ])),
      }
    }

    return { A: forSide('A'), B: forSide('B') }
  }, [timelineComments, timestampDisplayMode, t, videoDuration, videoFps])

  // The hook layers catch-up adjustments on top of the user's speed, so both
  // elements only ever get the base rate from here.
  useEffect(() => {
    setSpeed(playbackSpeed)
  }, [playbackSpeed, setSpeed])

  // Keyboard shortcuts — match the main player exactly (Ctrl+ prefix)
  useEffect(() => {
    const handleKeyboard = (e: KeyboardEvent) => {
      // Escape: close comparison (no Ctrl needed)
      if (e.key === 'Escape') {
        onClose()
        return
      }

      // Ctrl+Space: Play/Pause
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault()
        e.stopPropagation()
        togglePlayPause()
        return
      }

      // Ctrl+, or Ctrl+<: Decrease speed by 0.25x
      if (e.ctrlKey && (e.code === 'Comma' || e.key === '<')) {
        e.preventDefault()
        e.stopPropagation()
        setPlaybackSpeed(prev => Math.max(0.25, prev - 0.25))
        return
      }

      // Ctrl+. or Ctrl+>: Increase speed by 0.25x
      if (e.ctrlKey && (e.code === 'Period' || e.key === '>')) {
        e.preventDefault()
        e.stopPropagation()
        setPlaybackSpeed(prev => Math.min(2.0, prev + 0.25))
        return
      }

      // Ctrl+/: Reset speed to 1.0x
      if (e.ctrlKey && (e.code === 'Slash' || e.key === '/' || e.key === '?')) {
        e.preventDefault()
        e.stopPropagation()
        setPlaybackSpeed(1.0)
        return
      }

      // Ctrl+J: Go back one frame
      if (e.ctrlKey && e.code === 'KeyJ') {
        e.preventDefault()
        e.stopPropagation()
        stepFrame('backward')
        return
      }

      // Ctrl+L: Go forward one frame
      if (e.ctrlKey && e.code === 'KeyL') {
        e.preventDefault()
        e.stopPropagation()
        stepFrame('forward')
        return
      }
    }

    // Use capture phase like the main player
    window.addEventListener('keydown', handleKeyboard, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyboard, { capture: true })
  }, [onClose, stepFrame, togglePlayPause])

  // Both layers sit inside the respective picture box, so they letterbox with it.
  const overlayA = (
    <AnnotationOverlay
      comments={annotationsBySide.A.comments}
      authors={annotationsBySide.A.authors}
      currentTime={currentTime}
      videoFps={videoFps}
      videoRef={videoRefA}
    />
  )
  const overlayB = (
    <AnnotationOverlay
      comments={annotationsBySide.B.comments}
      authors={annotationsBySide.B.authors}
      currentTime={currentTime}
      videoFps={videoFps}
      videoRef={videoRefB}
    />
  )

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">
            {t('compareVersions')}
          </h2>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {versionA?.name}
          </span>
        </div>

        {/* Version Selectors */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Version A Selector */}
          <div className="relative">
            <button
              onClick={() => { setShowSelectorA(!showSelectorA); setShowSelectorB(false) }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-blue-500/15 text-blue-500 rounded-md border border-blue-500/30 hover:bg-blue-500/25 transition-colors"
            >
              版本 A · {versionA?.versionLabel}
              <ChevronDown className="w-3 h-3" />
            </button>
            {showSelectorA && (
              <div className="absolute top-full mt-1 right-0 bg-popover border border-border rounded-lg shadow-xl z-50 min-w-[120px] py-1">
                {sorted.map((v, i) => (
                  <button
                    key={v.id}
                    onClick={() => { setVersionAIndex(i); setShowSelectorA(false) }}
                    disabled={i === versionBIndex}
                    className={`w-full px-3 py-1.5 text-left text-xs hover:bg-accent transition-colors ${
                      i === versionAIndex ? 'bg-accent font-semibold' : ''
                    } ${i === versionBIndex ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {v.versionLabel}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Version B Selector */}
          <div className="relative">
            <button
              onClick={() => { setShowSelectorB(!showSelectorB); setShowSelectorA(false) }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-green-500/15 text-green-500 rounded-md border border-green-500/30 hover:bg-green-500/25 transition-colors"
            >
              版本 B · {versionB?.versionLabel}
              <ChevronDown className="w-3 h-3" />
            </button>
            {showSelectorB && (
              <div className="absolute top-full mt-1 right-0 bg-popover border border-border rounded-lg shadow-xl z-50 min-w-[120px] py-1">
                {sorted.map((v, i) => (
                  <button
                    key={v.id}
                    onClick={() => { setVersionBIndex(i); setShowSelectorB(false) }}
                    disabled={i === versionAIndex}
                    className={`w-full px-3 py-1.5 text-left text-xs hover:bg-accent transition-colors ${
                      i === versionBIndex ? 'bg-accent font-semibold' : ''
                    } ${i === versionAIndex ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {v.versionLabel}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Button variant="ghost" size="sm" onClick={onClose} className="ml-1">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Video Area */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 flex flex-col p-2 sm:p-4"
        onClick={() => { setShowSelectorA(false); setShowSelectorB(false) }}
      >
        <div className="flex-1 min-h-0 relative">
          {mode === 'side-by-side' ? (
            /* Side-by-Side Mode */
            <div className="h-full flex flex-col sm:flex-row gap-2">
              {/* Video A */}
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="text-xs font-medium text-blue-500 mb-1 px-1">
                  版本 A · {versionA?.versionLabel}
                </div>
                <div className="flex-1 min-h-0 relative rounded-xl overflow-hidden bg-muted/50 backdrop-blur-sm"
                  style={{ aspectRatio: '16 / 9' }}
                >
                  <video
                    ref={videoRefA}
                    key={`a-${versionA?.id}`}
                    poster={(versionA as any)?.thumbnailUrl || undefined}
                    className="w-full h-full object-contain cursor-pointer"
                    crossOrigin="anonymous"
                    playsInline
                    preload="auto"
                    muted={audioSide !== 'A'}
                    onClick={togglePlayPause}
                  />
                  {overlayA}
                </div>
              </div>

              {/* Video B */}
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="text-xs font-medium text-green-500 mb-1 px-1">
                  版本 B · {versionB?.versionLabel}
                </div>
                <div className="flex-1 min-h-0 relative rounded-xl overflow-hidden bg-muted/50 backdrop-blur-sm"
                  style={{ aspectRatio: '16 / 9' }}
                >
                  <video
                    ref={videoRefB}
                    key={`b-${versionB?.id}`}
                    poster={(versionB as any)?.thumbnailUrl || undefined}
                    className="w-full h-full object-contain cursor-pointer"
                    crossOrigin="anonymous"
                    playsInline
                    preload="auto"
                    muted={audioSide !== 'B'}
                    onClick={togglePlayPause}
                  />
                  {overlayB}
                </div>
              </div>
            </div>
          ) : (
            /* Slider Mode */
            <div className="h-full min-h-0 min-w-0 flex items-center justify-center overflow-hidden">
              <div className="h-full w-full min-h-0 min-w-0">
                <VideoComparisonSlider
                  videoRefA={videoRefA}
                  videoRefB={videoRefB}
                  labelA={`版本 A · ${versionA?.versionLabel}`}
                  labelB={`版本 B · ${versionB?.versionLabel}`}
                  posterA={(versionA as any)?.thumbnailUrl}
                  posterB={(versionB as any)?.thumbnailUrl}
                  mutedA={audioSide !== 'A'}
                  mutedB={audioSide !== 'B'}
                  overlayA={overlayA}
                  overlayB={overlayB}
                />
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex-shrink-0 mt-2">
          <VideoComparisonControls
            videoDuration={videoDuration}
            currentTime={currentTime}
            isPlaying={isPlaying}
            onPlayPause={togglePlayPause}
            onSeek={handleSeek}
            onFrameStep={stepFrame}
            mode={mode}
            onModeChange={setMode}
            playbackSpeed={playbackSpeed}
            onSpeedChange={setPlaybackSpeed}
            videoFps={videoFps}
            timestampDisplayMode={timestampDisplayMode}
            waitingSide={waitingSide}
            audioSide={audioSide}
            onAudioChange={setAudioSide}
            comments={timelineComments}
          />
        </div>
      </div>

      {/* Speed indicator */}
      {playbackSpeed !== 1 && (
        <div className="absolute top-16 right-6 bg-black/80 text-white px-3 py-1.5 rounded-md text-sm font-medium pointer-events-none z-30">
          {playbackSpeed.toFixed(2)}x
        </div>
      )}
    </div>
  )
}
