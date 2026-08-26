'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Comment } from '@prisma/client'
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward, Repeat } from 'lucide-react'
import { getUserColor } from '@/lib/utils'
import { timecodeToSeconds, timecodeToSeekSeconds, secondsToTimecode, formatCommentTimestamp } from '@/lib/timecode'
import { InitialsAvatar } from '@/components/InitialsAvatar'
import TimelineHoverPreview from './TimelineHoverPreview'

type CommentWithReplies = Comment & {
  replies?: Comment[]
}

interface CustomVideoControlsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  previewVideoUrl?: string | null
  videoDuration: number
  currentTime: number
  isPlaying: boolean
  volume: number
  isMuted: boolean
  isFullscreen: boolean
  onPlayPause: () => void
  onSeek: (time: number) => void
  onVolumeChange: (volume: number) => void
  onToggleMute: () => void
  onToggleFullscreen: () => void
  onFrameStep: (direction: 'forward' | 'backward') => void
  isLooping: boolean
  onToggleLoop: () => void
  comments?: CommentWithReplies[]
  videoFps?: number
  videoId?: string
  isAdmin?: boolean
  timestampDisplayMode?: 'TIMECODE' | 'AUTO'
  onMarkerClick?: (commentId: string) => void // Callback when a timeline marker is clicked
  pendingRangeStart?: number | null
  pendingRangeEnd?: number | null
  isSelectingRange?: boolean
  onRangeStartChange?: (time: number) => void
  onRangeEndChange?: (time: number) => void
  surfaceClassName?: string
}

// Color map for marker backgrounds - IDENTICAL to InitialsAvatar component
const COLOR_MAP: Record<string, { bg: string; ring: string; text: string }> = {
  'border-gray-500': {
    bg: 'bg-gray-500/20 dark:bg-gray-500/30',
    ring: 'ring-gray-500/30',
    text: 'text-gray-700 dark:text-gray-100',
  },
  'border-red-500': {
    bg: 'bg-red-500/20 dark:bg-red-500/30',
    ring: 'ring-red-500/30',
    text: 'text-red-700 dark:text-red-100',
  },
  'border-orange-500': {
    bg: 'bg-orange-500/20 dark:bg-orange-500/30',
    ring: 'ring-orange-500/30',
    text: 'text-orange-700 dark:text-orange-100',
  },
  'border-amber-500': {
    bg: 'bg-amber-500/20 dark:bg-amber-500/30',
    ring: 'ring-amber-500/30',
    text: 'text-amber-800 dark:text-amber-100',
  },
  'border-yellow-400': {
    bg: 'bg-yellow-400/25 dark:bg-yellow-400/30',
    ring: 'ring-yellow-400/30',
    text: 'text-yellow-900 dark:text-yellow-100',
  },
  'border-lime-500': {
    bg: 'bg-lime-500/20 dark:bg-lime-500/30',
    ring: 'ring-lime-500/30',
    text: 'text-lime-800 dark:text-lime-100',
  },
  'border-green-500': {
    bg: 'bg-green-500/20 dark:bg-green-500/30',
    ring: 'ring-green-500/30',
    text: 'text-green-800 dark:text-green-100',
  },
  'border-emerald-500': {
    bg: 'bg-emerald-500/20 dark:bg-emerald-500/30',
    ring: 'ring-emerald-500/30',
    text: 'text-emerald-800 dark:text-emerald-100',
  },
  'border-pink-500': {
    bg: 'bg-pink-500/20 dark:bg-pink-500/30',
    ring: 'ring-pink-500/30',
    text: 'text-pink-800 dark:text-pink-100',
  },
  'border-rose-500': {
    bg: 'bg-rose-500/20 dark:bg-rose-500/30',
    ring: 'ring-rose-500/30',
    text: 'text-rose-800 dark:text-rose-100',
  },
  'border-fuchsia-500': {
    bg: 'bg-fuchsia-500/20 dark:bg-fuchsia-500/30',
    ring: 'ring-fuchsia-500/30',
    text: 'text-fuchsia-800 dark:text-fuchsia-100',
  },
  'border-teal-500': {
    bg: 'bg-teal-500/20 dark:bg-teal-500/30',
    ring: 'ring-teal-500/30',
    text: 'text-teal-800 dark:text-teal-100',
  },
  'border-cyan-500': {
    bg: 'bg-cyan-500/20 dark:bg-cyan-500/30',
    ring: 'ring-cyan-500/30',
    text: 'text-cyan-800 dark:text-cyan-100',
  },
  'border-sky-500': {
    bg: 'bg-sky-500/20 dark:bg-sky-500/30',
    ring: 'ring-sky-500/30',
    text: 'text-sky-800 dark:text-sky-100',
  },
  'border-blue-500': {
    bg: 'bg-blue-500/20 dark:bg-blue-500/30',
    ring: 'ring-blue-500/30',
    text: 'text-blue-800 dark:text-blue-100',
  },
  'border-indigo-500': {
    bg: 'bg-indigo-500/20 dark:bg-indigo-500/30',
    ring: 'ring-indigo-500/30',
    text: 'text-indigo-800 dark:text-indigo-100',
  },
  'border-violet-500': {
    bg: 'bg-violet-500/20 dark:bg-violet-500/30',
    ring: 'ring-violet-500/30',
    text: 'text-violet-800 dark:text-violet-100',
  },
  'border-purple-500': {
    bg: 'bg-purple-500/20 dark:bg-purple-500/30',
    ring: 'ring-purple-500/30',
    text: 'text-purple-800 dark:text-purple-100',
  },
  'border-red-600': {
    bg: 'bg-red-600/20 dark:bg-red-600/30',
    ring: 'ring-red-600/30',
    text: 'text-red-900 dark:text-red-100',
  },
  'border-orange-600': {
    bg: 'bg-orange-600/20 dark:bg-orange-600/30',
    ring: 'ring-orange-600/30',
    text: 'text-orange-900 dark:text-orange-100',
  },
  'border-yellow-500': {
    bg: 'bg-yellow-500/25 dark:bg-yellow-500/30',
    ring: 'ring-yellow-500/30',
    text: 'text-yellow-900 dark:text-yellow-100',
  },
  // Sender palette (darker, earth tones)
  'border-amber-700': {
    bg: 'bg-amber-700/15 dark:bg-amber-700/30',
    ring: 'ring-amber-600/30',
    text: 'text-amber-900 dark:text-amber-50',
  },
  'border-orange-800': {
    bg: 'bg-orange-800/15 dark:bg-orange-800/30',
    ring: 'ring-orange-700/30',
    text: 'text-orange-950 dark:text-orange-50',
  },
  'border-stone-600': {
    bg: 'bg-stone-600/15 dark:bg-stone-600/30',
    ring: 'ring-stone-500/30',
    text: 'text-stone-900 dark:text-stone-50',
  },
  'border-yellow-700': {
    bg: 'bg-yellow-700/15 dark:bg-yellow-700/30',
    ring: 'ring-yellow-600/30',
    text: 'text-yellow-950 dark:text-yellow-50',
  },
  'border-lime-700': {
    bg: 'bg-lime-700/15 dark:bg-lime-700/30',
    ring: 'ring-lime-600/30',
    text: 'text-lime-950 dark:text-lime-50',
  },
  'border-green-700': {
    bg: 'bg-green-700/15 dark:bg-green-700/30',
    ring: 'ring-green-600/30',
    text: 'text-green-950 dark:text-green-50',
  },
  'border-emerald-800': {
    bg: 'bg-emerald-800/15 dark:bg-emerald-800/30',
    ring: 'ring-emerald-700/30',
    text: 'text-emerald-950 dark:text-emerald-50',
  },
  'border-teal-800': {
    bg: 'bg-teal-800/15 dark:bg-teal-800/30',
    ring: 'ring-teal-700/30',
    text: 'text-teal-950 dark:text-teal-50',
  },
  'border-slate-600': {
    bg: 'bg-slate-600/15 dark:bg-slate-600/30',
    ring: 'ring-slate-500/30',
    text: 'text-slate-900 dark:text-slate-50',
  },
  'border-zinc-600': {
    bg: 'bg-zinc-600/15 dark:bg-zinc-600/30',
    ring: 'ring-zinc-500/30',
    text: 'text-zinc-900 dark:text-zinc-50',
  },
  'border-amber-800': {
    bg: 'bg-amber-800/15 dark:bg-amber-800/30',
    ring: 'ring-amber-700/30',
    text: 'text-amber-950 dark:text-amber-50',
  },
  'border-yellow-800': {
    bg: 'bg-yellow-800/15 dark:bg-yellow-800/30',
    ring: 'ring-yellow-700/30',
    text: 'text-yellow-950 dark:text-yellow-50',
  },
  'border-lime-800': {
    bg: 'bg-lime-800/15 dark:bg-lime-800/30',
    ring: 'ring-lime-700/30',
    text: 'text-lime-950 dark:text-lime-50',
  },
  'border-green-800': {
    bg: 'bg-green-800/15 dark:bg-green-800/30',
    ring: 'ring-green-700/30',
    text: 'text-green-950 dark:text-green-50',
  },
  'border-teal-700': {
    bg: 'bg-teal-700/15 dark:bg-teal-700/30',
    ring: 'ring-teal-600/30',
    text: 'text-teal-950 dark:text-teal-50',
  },
  'border-cyan-800': {
    bg: 'bg-cyan-800/15 dark:bg-cyan-800/30',
    ring: 'ring-cyan-700/30',
    text: 'text-cyan-950 dark:text-cyan-50',
  },
  'border-stone-700': {
    bg: 'bg-stone-700/15 dark:bg-stone-700/30',
    ring: 'ring-stone-600/30',
    text: 'text-stone-950 dark:text-stone-50',
  },
  'border-slate-700': {
    bg: 'bg-slate-700/15 dark:bg-slate-700/30',
    ring: 'ring-slate-600/30',
    text: 'text-slate-950 dark:text-slate-50',
  },
  'border-neutral-600': {
    bg: 'bg-neutral-600/15 dark:bg-neutral-600/30',
    ring: 'ring-neutral-500/30',
    text: 'text-neutral-900 dark:text-neutral-50',
  },
  'border-orange-900': {
    bg: 'bg-orange-900/15 dark:bg-orange-900/30',
    ring: 'ring-orange-800/30',
    text: 'text-orange-950 dark:text-orange-50',
  },
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '00:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

function formatTimeWithMode(
  seconds: number,
  fps: number,
  videoDurationSeconds: number,
  mode: 'TIMECODE' | 'AUTO'
): string {
  if (mode === 'AUTO') return formatTime(seconds)
  if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '00:00:00:00'
  
  const timecode = secondsToTimecode(seconds, fps)
  return formatCommentTimestamp({
    timecode,
    fps,
    videoDurationSeconds,
    mode,
  })
}

interface MarkerData {
  id: string
  timestamp: number
  authorName: string | null
  isInternal: boolean
  colorKey: string
  content: string
  position: number
}

interface RangeBarData {
  id: string
  startPosition: number
  endPosition: number
  colorKey: string
}

export default function CustomVideoControls({
  videoRef,
  previewVideoUrl = null,
  videoDuration,
  currentTime,
  isPlaying,
  volume,
  isMuted,
  isFullscreen,
  onPlayPause,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleFullscreen,
  onFrameStep,
  isLooping,
  onToggleLoop,
  comments = [],
  videoFps = 24,
  videoId = '',
  isAdmin: _isAdmin = false,
  timestampDisplayMode = 'TIMECODE',
  onMarkerClick,
  pendingRangeStart = null,
  pendingRangeEnd = null,
  isSelectingRange = false,
  onRangeStartChange,
  onRangeEndChange,
  surfaceClassName = 'bg-background',
}: CustomVideoControlsProps) {
  const t = useTranslations('controls')
  const tComments = useTranslations('comments')
  const [isDragging, setIsDragging] = useState(false)
  const [showVolume, setShowVolume] = useState(false)
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null)
  const [hoveredTime, setHoveredTime] = useState<number | null>(null)
  const [loadedProgress, setLoadedProgress] = useState(0)
  const timelineRef = useRef<HTMLDivElement>(null)
  const suppressTimelineClickRef = useRef(false)
  const volumeTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const touchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Process comments into markers
  const markers = useMemo((): MarkerData[] => {
    if (!videoDuration || videoDuration <= 0 || !comments.length) return []

    return comments
      .filter((comment) => {
        if (comment.parentId) return false
        if (videoId && comment.videoId !== videoId) return false
        // Allow 00:00:00:00 timecode - it's a valid timestamp at the start
        if (!comment.timecode) {
          return false
        }
        return true
      })
      .map((comment) => {
        const timestamp = timecodeToSeekSeconds(comment.timecode!, videoFps)
        const effectiveAuthorName = comment.authorName ||
          ((comment as any).user?.name || (comment as any).user?.email || null)
        // Use isInternal from comment, default to false if not present (client comment)
        const isCommentInternal = (comment as any).isInternal ?? false
        const colorKey = getUserColor(effectiveAuthorName, isCommentInternal).border
        const rawContent = comment.content ?? ''
        const normalizedContent = rawContent.replace(/[<>]/g, ' ')

        return {
          id: comment.id,
          timestamp,
          authorName: effectiveAuthorName,
          isInternal: isCommentInternal,
          colorKey,
          content: normalizedContent.slice(0, 100),
          position: Math.min(100, Math.max(0, (timestamp / videoDuration) * 100)),
        }
      })
      .sort((a, b) => a.timestamp - b.timestamp)
  }, [comments, videoDuration, videoFps, videoId])

  // Range bars for comments with timecodeEnd
  const rangeBars = useMemo((): RangeBarData[] => {
    if (!videoDuration || videoDuration <= 0 || !comments.length) return []

    return comments
      .filter((comment) => {
        if (comment.parentId) return false
        if (videoId && comment.videoId !== videoId) return false
        if (!comment.timecode || !(comment as any).timecodeEnd) return false
        return true
      })
      .map((comment) => {
        const start = timecodeToSeconds(comment.timecode!, videoFps)
        const end = timecodeToSeconds((comment as any).timecodeEnd!, videoFps)
        const effectiveAuthorName = comment.authorName ||
          ((comment as any).user?.name || (comment as any).user?.email || null)
        const isCommentInternal = (comment as any).isInternal ?? false
        const colorKey = getUserColor(effectiveAuthorName, isCommentInternal).border

        return {
          id: comment.id,
          startPosition: Math.max(0, (start / videoDuration) * 100),
          endPosition: Math.min(100, (end / videoDuration) * 100),
          colorKey,
        }
      })
  }, [comments, videoDuration, videoFps, videoId])

  // Group markers that are close together
  const groupedMarkers = useMemo(() => {
    if (markers.length === 0) return []

    const groups: MarkerData[][] = []
    // Dynamic threshold based on video duration
    // For short videos (<60s): 3% threshold
    // For medium videos (60s-600s): 2% threshold  
    // For long videos (>600s): 1.5% threshold
    const threshold = videoDuration < 60 ? 3 : videoDuration < 600 ? 2 : 1.5

    markers.forEach((marker) => {
      const lastGroup = groups[groups.length - 1]
      if (lastGroup && Math.abs(marker.position - lastGroup[0].position) < threshold) {
        lastGroup.push(marker)
      } else {
        groups.push([marker])
      }
    })

    return groups
  }, [markers, videoDuration])

  const seekFromClientX = useCallback((clientX: number) => {
    if (!timelineRef.current || !videoDuration) return

    const rect = timelineRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const percentage = Math.max(0, Math.min(1, x / rect.width))
    const time = percentage * videoDuration

    onSeek(time)
  }, [videoDuration, onSeek])

  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressTimelineClickRef.current) return
    seekFromClientX(e.clientX)
  }, [seekFromClientX])

  const handleTimelinePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input, a')) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    videoRef.current?.pause()
    document.body.style.userSelect = 'none'
    suppressTimelineClickRef.current = false
    setIsDragging(true)
    seekFromClientX(e.clientX)
  }, [seekFromClientX, videoRef])

  const handleTimelinePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !videoDuration) return
    const isCaptured = e.currentTarget.hasPointerCapture(e.pointerId)
    if (isDragging && isCaptured) {
      e.preventDefault()
      suppressTimelineClickRef.current = true
      seekFromClientX(e.clientX)
    }

    const rect = timelineRef.current.getBoundingClientRect()
    const percentage = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setHoveredTime(percentage * videoDuration)
  }, [isDragging, seekFromClientX, videoDuration])

  const handleTimelinePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    document.body.style.userSelect = ''
    setIsDragging(false)
    window.setTimeout(() => { suppressTimelineClickRef.current = false }, 0)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const updateLoadedProgress = () => {
      if (!videoDuration || video.buffered.length === 0) {
        setLoadedProgress(0)
        return
      }
      const loadedUntil = video.buffered.end(video.buffered.length - 1)
      setLoadedProgress(Math.min(100, Math.max(0, (loadedUntil / videoDuration) * 100)))
    }

    video.addEventListener('progress', updateLoadedProgress)
    video.addEventListener('loadedmetadata', updateLoadedProgress)
    video.addEventListener('durationchange', updateLoadedProgress)
    updateLoadedProgress()
    return () => {
      video.removeEventListener('progress', updateLoadedProgress)
      video.removeEventListener('loadedmetadata', updateLoadedProgress)
      video.removeEventListener('durationchange', updateLoadedProgress)
      document.body.style.userSelect = ''
    }
  }, [videoDuration, videoRef])

  const handleTimelinePointerLeave = useCallback(() => {
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
    const finishPointerInteraction = () => {
      setIsDragging(false)
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointerup', finishPointerInteraction)
    window.addEventListener('pointercancel', finishPointerInteraction)
    window.addEventListener('blur', finishPointerInteraction)
    return () => {
      window.removeEventListener('pointerup', finishPointerInteraction)
      window.removeEventListener('pointercancel', finishPointerInteraction)
      window.removeEventListener('blur', finishPointerInteraction)
    }
  }, [])

  const updateRangeEndFromPointer = useCallback((clientX: number) => {
    if (!timelineRef.current || !videoDuration || !onRangeEndChange) return
    const rect = timelineRef.current.getBoundingClientRect()
    const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const nextTime = Math.max(pendingRangeStart ?? 0, percentage * videoDuration)
    onRangeEndChange(nextTime)
    onSeek(nextTime)
  }, [onRangeEndChange, onSeek, pendingRangeStart, videoDuration])

  const updateRangeStartFromPointer = useCallback((clientX: number) => {
    if (!timelineRef.current || !videoDuration || !onRangeStartChange) return
    const rect = timelineRef.current.getBoundingClientRect()
    const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const nextTime = Math.min(pendingRangeEnd ?? videoDuration, percentage * videoDuration)
    onRangeStartChange(nextTime)
    onSeek(nextTime)
  }, [onRangeStartChange, onSeek, pendingRangeEnd, videoDuration])

  const handleRangePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    videoRef.current?.pause()
    document.body.style.userSelect = 'none'
  }, [videoRef])

  const handleRangePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.preventDefault()
    e.stopPropagation()
    updateRangeEndFromPointer(e.clientX)
  }, [updateRangeEndFromPointer])

  const handleRangeStartPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    videoRef.current?.pause()
    document.body.style.userSelect = 'none'
  }, [videoRef])

  const handleRangeStartPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.preventDefault()
    e.stopPropagation()
    updateRangeStartFromPointer(e.clientX)
  }, [updateRangeStartFromPointer])

  const handleRangePointerEnd = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    document.body.style.userSelect = ''
  }, [])

  const handleMarkerClick = useCallback((marker: MarkerData, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    videoRef.current?.pause()
    onSeek(marker.timestamp)
    // Notify parent to scroll to comment
    if (onMarkerClick) {
      onMarkerClick(marker.id)
    }
  }, [onSeek, onMarkerClick, videoRef])

  const handleMarkerTouchEnd = useCallback((marker: MarkerData, e: React.TouchEvent) => {
    e.stopPropagation()
    e.preventDefault()
    videoRef.current?.pause()
    onSeek(marker.timestamp)
    // Notify parent to scroll to comment
    if (onMarkerClick) {
      onMarkerClick(marker.id)
    }
  }, [onSeek, onMarkerClick, videoRef])

  const handleMarkerMouseEnter = useCallback((markerId: string) => {
    setHoveredMarkerId(markerId)
  }, [])

  const handleMarkerMouseLeave = useCallback(() => {
    setHoveredMarkerId(null)
  }, [])

  const handleMarkerTouchStart = useCallback((markerId: string, e: React.TouchEvent) => {
    e.stopPropagation()
    if (touchTimeoutRef.current) {
      clearTimeout(touchTimeoutRef.current)
    }
    setHoveredMarkerId(markerId)
    touchTimeoutRef.current = setTimeout(() => {
      setHoveredMarkerId(null)
    }, 3000)
  }, [])

  const handleVolumeMouseEnter = useCallback(() => {
    if (volumeTimeoutRef.current) {
      clearTimeout(volumeTimeoutRef.current)
    }
    setShowVolume(true)
  }, [])

  const handleVolumeMouseLeave = useCallback(() => {
    volumeTimeoutRef.current = setTimeout(() => {
      setShowVolume(false)
    }, 500)
  }, [])

  const safeDuration = Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : 0
  const safeCurrentTime = safeDuration > 0
    ? Math.min(safeDuration, Math.max(0, Number.isFinite(currentTime) ? currentTime : 0))
    : 0
  const progress = safeDuration > 0 ? (safeCurrentTime / safeDuration) * 100 : 0
  const isTimelineActive = isDragging || hoveredTime !== null

  const getTooltipAlignment = (position: number): string => {
    if (position < 20) return 'left-0'
    if (position > 80) return 'right-0'
    return 'left-1/2 -translate-x-1/2'
  }

  return (
    <div className={`absolute left-0 right-0 top-full z-30 min-h-0 text-foreground ${surfaceClassName}`} style={{ borderRadius: '0 0 6px 6px' }}>
      {/* 6px progress rail + 32px annotation lane, matching the reference behavior. */}
      <div className="mb-0">
        <div
          ref={timelineRef}
          data-testid="video-timeline"
          className={`group relative h-8 cursor-pointer touch-none select-none ${isDragging ? 'cursor-ew-resize' : ''}`}
          onPointerDown={handleTimelinePointerDown}
          onClick={handleTimelineClick}
          onPointerMove={handleTimelinePointerMove}
          onPointerLeave={handleTimelinePointerLeave}
          onPointerUp={handleTimelinePointerUp}
          onPointerCancel={handleTimelinePointerUp}
          onSelect={(event) => event.preventDefault()}
          role="slider"
          tabIndex={0}
          aria-label="视频时间轴"
          aria-valuemin={0}
          aria-valuemax={safeDuration}
          aria-valuenow={safeCurrentTime}
          onKeyDown={handleTimelineKeyDown}
        >
          {/* The rail grows upward on hover/drag, so the controls below never move. */}
          <div
            data-testid="progress-rail"
            className={`absolute left-0 right-0 top-0 origin-bottom overflow-visible bg-[#34363f] transition-[height,transform] duration-100 ${
              isTimelineActive ? 'h-[12px] -translate-y-[6px]' : 'h-[6px] translate-y-0'
            }`}
          >
            <div
              className="pointer-events-none absolute inset-y-0 left-0 bg-white/30"
              style={{ width: `${loadedProgress}%` }}
            />
            <div
              className="pointer-events-none absolute inset-y-0 left-0 bg-primary"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Playhead stays attached to the progress rail. */}
          <div
            className={`pointer-events-none absolute top-0 z-30 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-sm transition-opacity duration-100 ${
              isTimelineActive ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ left: `${Math.min(100, Math.max(0, progress))}%` }}
          />

          {/* The annotation lane is intentionally independent from the rail. */}
          <div data-testid="annotation-lane" className={`pointer-events-none absolute inset-x-0 bottom-0 h-[26px] ${surfaceClassName}`} />

          {/* Range Bars for comments with timecodeEnd */}
          {rangeBars.map((bar) => {
            const width = bar.endPosition - bar.startPosition
            return (
              <div
                data-testid="comment-range-line"
                key={`range-${bar.id}`}
                className="pointer-events-none absolute top-[19px] h-[3px] -translate-y-1/2 bg-sky-400/85"
                style={{
                  left: `${bar.startPosition}%`,
                  width: `${Math.max(width, 0.5)}%`,
                }}
              />
            )
          })}

          {isSelectingRange && pendingRangeStart !== null && pendingRangeStart !== undefined && videoDuration > 0 && (
            <>
              <div
                className="pointer-events-none absolute top-[19px] h-1 bg-primary/40"
                style={{
                  left: `${Math.min(100, Math.max(0, (pendingRangeStart / videoDuration) * 100))}%`,
                  width: `${Math.max(0, Math.min(100, (((pendingRangeEnd ?? pendingRangeStart) - pendingRangeStart) / videoDuration) * 100))}%`,
                }}
              />
              <button
                type="button"
                data-testid="range-start-handle"
                aria-label="批注开始时间"
                className="group/range absolute top-[19px] z-20 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 touch-none cursor-ew-resize items-center justify-center bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                style={{ left: `${Math.min(100, Math.max(0, (pendingRangeStart / videoDuration) * 100))}%` }}
                onPointerDown={handleRangeStartPointerDown}
                onPointerMove={handleRangeStartPointerMove}
                onPointerUp={handleRangePointerEnd}
                onPointerCancel={handleRangePointerEnd}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="flex h-6 w-2 items-center justify-center rounded-[3px] border border-primary/70 bg-background shadow-[0_1px_4px_rgba(0,0,0,0.22)] transition-colors group-hover/range:border-primary group-hover/range:bg-primary/10">
                  <span className="h-3 w-px bg-primary/80" />
                </span>
              </button>
              <button
                type="button"
                data-testid="range-end-handle"
                aria-label="批注结束时间"
                className="group/range absolute top-[19px] z-20 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 touch-none cursor-ew-resize items-center justify-center bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                style={{ left: `${Math.min(100, Math.max(0, ((pendingRangeEnd ?? pendingRangeStart) / videoDuration) * 100))}%` }}
                onPointerDown={handleRangePointerDown}
                onPointerMove={handleRangePointerMove}
                onPointerUp={handleRangePointerEnd}
                onPointerCancel={handleRangePointerEnd}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="flex h-6 w-2 items-center justify-center rounded-[3px] border border-primary/70 bg-background shadow-[0_1px_4px_rgba(0,0,0,0.22)] transition-colors group-hover/range:border-primary group-hover/range:bg-primary/10">
                  <span className="h-3 w-px bg-primary/80" />
                </span>
              </button>
            </>
          )}

          {/* Comment Markers */}
          {groupedMarkers.map((group) => {
            const primaryMarker = group[0]
            const isHovered = group.some((m) => m.id === hoveredMarkerId)
            const isStacked = group.length > 1

            return (
              <div
                key={primaryMarker.id}
                className={`absolute z-30 -translate-y-1/2 ${isDragging ? 'pointer-events-none' : 'pointer-events-auto'}`}
                style={{
                  left: `${primaryMarker.position}%`,
                  top: '19px',
                  transform: 'translateX(-50%) translateY(-50%)',
                }}
              >
                <button
                  type="button"
                  data-testid="comment-marker"
                  onClick={(e) => handleMarkerClick(primaryMarker, e)}
                  onTouchEnd={(e) => handleMarkerTouchEnd(primaryMarker, e)}
                  onMouseEnter={() => handleMarkerMouseEnter(primaryMarker.id)}
                  onMouseLeave={handleMarkerMouseLeave}
                  onTouchStart={(e) => handleMarkerTouchStart(primaryMarker.id, e)}
                  className={`
                    relative flex items-center justify-center
                    h-5 w-5 min-h-5 min-w-5 shrink-0
                    rounded-full select-none
                    transition-[filter,box-shadow] duration-150 ease-out
                    hover:brightness-105
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-white
                    ${isHovered ? 'ring-2 ring-primary/70 shadow-md z-30' : 'z-10'}
                  `}
                  aria-label={`Comment by ${primaryMarker.authorName || tComments('anonymous')} at ${formatTime(primaryMarker.timestamp)}`}
                >
                  <InitialsAvatar
                    name={primaryMarker.authorName}
                    size="xs"
                    isInternal={primaryMarker.isInternal}
                    className="pointer-events-none h-5 w-5 min-h-5 min-w-5 max-h-5 max-w-5 text-[9px]"
                  />

                  {isStacked && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-0.5 bg-foreground text-background text-[8px] font-bold rounded-full flex items-center justify-center shadow-md">
                      {group.length}
                    </span>
                  )}
                </button>

                {/* Tooltip */}
                {isHovered && (
                  <div
                    className={`
                      absolute bottom-full mb-2 ${getTooltipAlignment(primaryMarker.position)}
                      bg-black/95 text-white backdrop-blur-sm
                      rounded-lg shadow-2xl
                      p-2 w-[180px] sm:w-[220px] max-w-[calc(100vw-2rem)]
                      z-50
                      animate-in fade-in-0 slide-in-from-bottom-1 duration-150
                    `}
                  >
                    {group.slice(0, 3).map((marker, idx) => {
                      return (
                        <div
                          key={marker.id}
                          className={`${idx > 0 ? 'mt-2 pt-2 border-t border-white/20' : ''}`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <InitialsAvatar
                              name={marker.authorName}
                              size="xs"
                              isInternal={marker.isInternal}
                            />
                            <div className="flex-1 min-w-0">
                              <span className="font-semibold text-[10px] text-white truncate block">
                                {marker.authorName || tComments('anonymous')}
                              </span>
                            </div>
                            <span className="text-[9px] text-white/70 font-sans tabular-nums">
                              {formatTime(marker.timestamp)}
                            </span>
                          </div>
                          <p className="text-[10px] text-white/80 leading-relaxed line-clamp-2 pl-6">
                            {marker.content || 'No content'}
                          </p>
                        </div>
                      )
                    })}
                    {group.length > 3 && (
                      <p className="text-[9px] text-white/60 mt-2 pt-2 border-t border-white/20">
                        {t('moreComments', { count: group.length - 3 })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Hover Time Indicator */}
          {!isDragging && (
            <TimelineHoverPreview
              videoUrl={previewVideoUrl}
              hoveredTime={hoveredTime}
              duration={videoDuration}
              fps={videoFps}
              timestampDisplayMode={timestampDisplayMode}
            />
          )}
        </div>
      </div>

      {/* Control Buttons */}
      <div className="relative flex h-9 items-center justify-between px-1">
        {/* Left Controls */}
        <div className="relative z-[2] flex items-center">
          {/* Frame Back / Play / Frame Forward — desktop only; mobile shows these as a center overlay (see VideoPlayer.tsx) */}
          <div className="hidden sm:flex h-[26px] items-center gap-1">
            <button
              onClick={() => onFrameStep('backward')}
              className="flex items-center justify-center text-foreground opacity-80 transition-opacity hover:opacity-100"
              aria-label={t('previousFrame')}
              title={`${t('previousFrame')} (Ctrl+J)`}
            >
              <SkipBack className="h-[14px] w-[14px]" />
            </button>

            <button
              onClick={onPlayPause}
              className="mx-1 flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted"
              aria-label={isPlaying ? t('pauseVideo') : t('playVideo')}
              title={isPlaying ? `${t('pauseVideo')} (Ctrl+Space)` : `${t('playVideo')} (Ctrl+Space)`}
            >
              {isPlaying ? (
                <Pause className="h-5 w-5 fill-current" />
              ) : (
                <Play className="h-5 w-5 fill-current" />
              )}
            </button>

            <button
              onClick={() => onFrameStep('forward')}
              className="flex items-center justify-center text-foreground opacity-80 transition-opacity hover:opacity-100"
              aria-label={t('nextFrame')}
              title={`${t('nextFrame')} (Ctrl+L)`}
            >
              <SkipForward className="h-[14px] w-[14px]" />
            </button>
          </div>

          {/* Time Display */}
          <div className="mx-1 flex items-center rounded px-1.5 py-0.5 text-[13px] tabular-nums transition-colors hover:bg-muted">
            <span className="text-foreground">{formatTimeWithMode(safeCurrentTime, videoFps, safeDuration, timestampDisplayMode)}</span>
            <span className="text-muted-foreground">&nbsp;/&nbsp;{formatTimeWithMode(safeDuration, videoFps, safeDuration, timestampDisplayMode)}</span>
          </div>
        </div>

        {/* Keep the range-cancel hint centered without intercepting timeline drags. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 right-0 z-[1] hidden items-center justify-center sm:flex">
          {isSelectingRange && pendingRangeStart !== null && (
            <button
              type="button"
              className="pointer-events-auto flex h-8 items-center justify-center rounded bg-muted px-2.5"
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))}
            >
              <span className="text-[12px] font-normal text-foreground">取消批注</span>
              <span className="ml-1.5 rounded bg-foreground/10 px-1 py-0.5 text-[12px] text-[#FFC001]">Esc</span>
            </button>
          )}
        </div>

        {/* Right Controls */}
        <div className="relative z-[2] flex items-center gap-1 sm:gap-2">
          {/* Volume */}
          <div
            className="relative"
            onMouseEnter={handleVolumeMouseEnter}
            onMouseLeave={handleVolumeMouseLeave}
          >
            <button
              onClick={onToggleMute}
              className="p-2 sm:p-2.5 hover:bg-foreground/10 active:bg-foreground/20 rounded-lg transition-colors touch-manipulation"
              aria-label={isMuted ? t('unmute') : t('mute')}
              title={isMuted ? t('unmute') : t('mute')}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4 sm:w-5 sm:h-5 text-foreground" />
              ) : (
                <Volume2 className="w-4 h-4 sm:w-5 sm:h-5 text-foreground" />
              )}
            </button>

            {/* Volume Slider */}
            {showVolume && (
              <div className="absolute bottom-full right-0 mb-2 bg-black/90 p-3 rounded-lg shadow-xl border border-white/20 flex items-center justify-center backdrop-blur-sm">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                  aria-label="音量"
                  className="h-20 sm:h-24 w-2 cursor-pointer accent-primary"
                  style={{
                    writingMode: 'vertical-lr',
                    direction: 'rtl',
                  }}
                />
              </div>
            )}
          </div>

          {/* Loop */}
          <button
            onClick={onToggleLoop}
            className={`p-2 sm:p-2.5 hover:bg-foreground/10 active:bg-foreground/20 rounded-lg transition-colors touch-manipulation ${isLooping ? 'bg-foreground/10' : ''}`}
            aria-label={t('loop')}
            aria-pressed={isLooping}
            title={t('loop')}
          >
            <Repeat className={`w-4 h-4 sm:w-5 sm:h-5 ${isLooping ? 'text-primary' : 'text-foreground'}`} />
          </button>

          {/* Fullscreen */}
          <button
            onClick={onToggleFullscreen}
            className="p-2 sm:p-2.5 hover:bg-foreground/10 active:bg-foreground/20 rounded-lg transition-colors touch-manipulation"
            aria-label={isFullscreen ? t('exitFullscreen') : t('fullscreen')}
            title={isFullscreen ? t('exitFullscreen') : t('fullscreen')}
          >
            {isFullscreen ? (
              <Minimize className="w-4 h-4 sm:w-5 sm:h-5 text-foreground" />
            ) : (
              <Maximize className="w-4 h-4 sm:w-5 sm:h-5 text-foreground" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
