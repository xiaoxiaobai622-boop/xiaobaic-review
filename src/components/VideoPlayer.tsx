'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Video, ProjectStatus, Comment } from '@prisma/client'
import { Button } from './ui/button'
import { CheckCircle2, ChevronLeft, ChevronRight, GitCompareArrows, Play, Pause, SkipBack, SkipForward } from 'lucide-react'
import CustomVideoControls from './CustomVideoControls'
import VideoComparison from './VideoComparison'
import ProjectInfo from './ProjectInfo'
import AnnotationOverlay from './AnnotationOverlay'
import AnnotationCanvas from './AnnotationCanvas'
import AnnotationToolbar from './AnnotationToolbar'
import { useAnnotationDrawing } from '@/hooks/useAnnotationDrawing'
import { AnnotationData, type DrawingTool } from '@/types/annotations'
import { secondsToTimecode } from '@/lib/timecode'
import { logError } from '@/lib/logging'
import { filterCommentsForVideo } from '@/lib/video-comment-filter'

type CommentWithReplies = Comment & {
  replies?: Comment[]
}

interface VideoPlayerProps {
  videos: Video[]
  projectId: string
  projectStatus: ProjectStatus
  defaultQuality?: '720p' | '1080p' | '2160p' // Default quality from settings
  onApprove?: () => void // Optional approval callback
  authenticatedEmail?: string | null // Email of OTP-authenticated user
  authenticatedName?: string | null // Name of OTP-authenticated user
  projectTitle?: string
  projectDescription?: string
  clientName?: string
  isPasswordProtected?: boolean
  watermarkEnabled?: boolean
  isAdmin?: boolean // Admin users can see all versions (default: false for clients)
  isGuest?: boolean // Guest mode - limited view (videos only, no downloads)
  activeVideoName?: string // The video group name (for maintaining selection after reload)
  initialSeekTime?: number | null // Initial timestamp to seek to (from URL params)
  initialVideoIndex?: number // Initial video index to select (from URL params)
  followLatestVersion?: boolean // Follow a newly inserted latest version until the user explicitly selects one
  allowAssetDownload?: boolean // Allow clients to download assets
  clientCanApprove?: boolean // Allow clients to approve videos (false = admin only)
  shareToken?: string | null
  onDownloadToken?: (videoId: string) => Promise<string | null>
  hideDownloadButton?: boolean // Hide download button completely (for admin share view)
  comments?: CommentWithReplies[] // Comments for timeline markers
  timestampDisplayMode?: 'TIMECODE' | 'AUTO' // Timestamp display format (default: TIMECODE)
  onCommentFocus?: (commentId: string) => void // Callback when a timeline marker is clicked
  onVideoStateChange?: (state: {
    selectedVideo: any
    selectedVideoIndex: number
    isVideoApproved: boolean
    displayVideos: any[]
    displayLabel: string
  }) => void // Callback to expose video state for mobile layout
  usePreviewForApprovedPlayback?: boolean // Use preview for approved playback instead of original
  fillContainer?: boolean // Fill parent container height (for full-viewport layouts)
  playerSurfaceClassName?: string // Optional letterbox/workspace surface override
  playerSurfaceColor?: string // Optional exact CSS color for the rendered video letterbox
  playerFrameClassName?: string // Optional non-sizing frame treatment for the player surface
  controlsSurfaceClassName?: string // Optional playback controls surface override
  hideApprovalAction?: boolean
  allowComparison?: boolean
  onPreviousVideo?: () => void
  onNextVideo?: () => void
  hasPreviousVideo?: boolean
  hasNextVideo?: boolean
}

export default function VideoPlayer({
  videos,
  projectId,
  projectStatus: _projectStatus,
  defaultQuality = '720p',
  onApprove,
  projectTitle,
  projectDescription,
  clientName,
  isPasswordProtected,
  watermarkEnabled = true,
  isAdmin = false, // Default to false (client view)
  isGuest = false, // Default to false (full client view)
  activeVideoName,
  initialSeekTime = null,
  initialVideoIndex = 0,
  followLatestVersion = false,
  allowAssetDownload = true,
  clientCanApprove = true, // Default to true (clients can approve)
  shareToken = null,
  onDownloadToken,
  hideDownloadButton = false, // Default to false (show download button)
  comments = [], // Default to empty array
  timestampDisplayMode = 'TIMECODE', // Default to TIMECODE format
  onCommentFocus, // Callback when timeline marker is clicked
  onVideoStateChange, // Callback to expose video state for mobile layout
  usePreviewForApprovedPlayback = false, // Default to false (use original)
  fillContainer = false, // Default to false (standard aspect ratio)
  playerSurfaceClassName = 'bg-muted/50',
  playerSurfaceColor,
  playerFrameClassName = '',
  controlsSurfaceClassName = 'bg-background',
  authenticatedEmail = null,
  authenticatedName = null,
  hideApprovalAction = false,
  allowComparison = true,
  onPreviousVideo,
  onNextVideo,
  hasPreviousVideo = false,
  hasNextVideo = false,
}: VideoPlayerProps) {
  const t = useTranslations('videos')
  const tControls = useTranslations('controls')
  const tShare = useTranslations('share')
  // null means automatic selection. This lets a default viewer follow a newly
  // published latest version while preserving a version chosen by the user.
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string>('')
  const [videoCrossOrigin, setVideoCrossOrigin] = useState<'anonymous' | null>('anonymous')
  const [videoLoadFailed, setVideoLoadFailed] = useState(false)
  const [resolvedPlaybackQuality, setResolvedPlaybackQuality] = useState<'720p' | '1080p' | '2160p'>(defaultQuality)
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [currentTimeState, setCurrentTimeState] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isLooping, setIsLooping] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [pendingRangeStart, setPendingRangeStart] = useState<number | null>(null)
  const [pendingRangeEnd, setPendingRangeEnd] = useState<number | null>(null)
  const [isSelectingRange, setIsSelectingRange] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const videoWrapperRef = useRef<HTMLDivElement>(null)
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hasInitiallySeenRef = useRef(false) // Track if initial seek already happened
  const lastTimeUpdateRef = useRef(0) // Throttle time updates
  const previousVideoNameRef = useRef<string | null>(null)
  const currentTimeRef = useRef(0)

  useEffect(() => {
    const handleRangeState = (event: Event) => {
      const detail = (event as CustomEvent).detail || {}
      setIsSelectingRange(Boolean(detail.active))
      setPendingRangeStart(typeof detail.startTime === 'number' ? detail.startTime : null)
      setPendingRangeEnd(typeof detail.endTime === 'number' ? detail.endTime : null)
    }
    const handleRangeEnd = (event: Event) => {
      const detail = (event as CustomEvent).detail || {}
      setPendingRangeEnd(typeof detail.time === 'number' ? detail.time : null)
    }
    window.addEventListener('commentRangeStateChanged', handleRangeState)
    window.addEventListener('commentRangeEndChanged', handleRangeEnd)
    return () => {
      window.removeEventListener('commentRangeStateChanged', handleRangeState)
      window.removeEventListener('commentRangeEndChanged', handleRangeEnd)
    }
  }, [])
  const selectedVideoIdRef = useRef<string | null>(null)

  // Keep every ready version available. Approval only controls the current
  // version's actions; it must not make older versions impossible to review.
  const displayVideos = useMemo(() => videos, [videos])

  const explicitVideoIndex = selectedVideoId
    ? displayVideos.findIndex((video) => video.id === selectedVideoId)
    : -1
  const automaticVideoIndex = followLatestVersion ? 0 : initialVideoIndex
  const selectedVideoIndex = explicitVideoIndex >= 0
    ? explicitVideoIndex
    : Math.max(0, Math.min(automaticVideoIndex, displayVideos.length - 1))
  const selectedVideo = displayVideos[selectedVideoIndex]
  const selectedVideoComments = useMemo(
    () => filterCommentsForVideo(comments, selectedVideo?.id),
    [comments, selectedVideo?.id],
  )

  // Comparison mode state
  const [showComparison, setShowComparison] = useState(false)

  // Drawing mode state
  const [isDrawingMode, setIsDrawingMode] = useState(false)
  const [drawingTimecodeStart, setDrawingTimecodeStart] = useState<string>('00:00:00:00')
  const [drawingTimecodeEnd, setDrawingTimecodeEnd] = useState<string | null>(null)
  const [pendingAnnotation, setPendingAnnotation] = useState<{
    annotations: AnnotationData
    timecode: string
    timecodeEnd?: string | null
  } | null>(null)

  const annotationDrawing = useAnnotationDrawing()
  const getAnnotationData = annotationDrawing.getAnnotationData
  const resetAnnotationDrawing = annotationDrawing.reset
  const previousAnnotationVideoIdRef = useRef<string | null>(null)

  useEffect(() => {
    const currentVideoId = selectedVideo?.id ?? null
    const previousVideoId = previousAnnotationVideoIdRef.current

    if (previousVideoId && currentVideoId && previousVideoId !== currentVideoId) {
      setIsDrawingMode(false)
      setPendingAnnotation(null)
      resetAnnotationDrawing()
      window.dispatchEvent(new CustomEvent('annotationCleared'))
    }

    previousAnnotationVideoIdRef.current = currentVideoId
  }, [selectedVideo?.id, resetAnnotationDrawing])

  useEffect(() => {
    const handleEnterDrawing = (event: Event) => {
      const detail = (event as CustomEvent<{ tool?: DrawingTool; timecodeEnd?: string | null }>).detail
      const requestedTool = detail?.tool

      if (requestedTool) {
        annotationDrawing.setActiveTool(requestedTool)
      }

      if (isDrawingMode) return

      const fps = selectedVideo?.fps || 24
      const timecodeStart = secondsToTimecode(currentTimeRef.current, fps)
      setDrawingTimecodeStart(timecodeStart)
      setDrawingTimecodeEnd(detail?.timecodeEnd || null)
      setIsDrawingMode(true)
      setPendingAnnotation(null)

      annotationDrawing.reset()

      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause()
      }
    }

    window.addEventListener('enterDrawingMode', handleEnterDrawing)
    return () => {
      window.removeEventListener('enterDrawingMode', handleEnterDrawing)
    }
  }, [selectedVideo?.fps, isDrawingMode, annotationDrawing])

  const handleDrawingCancel = useCallback(() => {
    setIsDrawingMode(false)
    setPendingAnnotation(null)
    annotationDrawing.reset()
    window.dispatchEvent(new CustomEvent('annotationCleared'))
  }, [annotationDrawing])

  useEffect(() => {
    if (!isDrawingMode) return

    const annotations = getAnnotationData()
    setPendingAnnotation(annotations ? {
      annotations,
      timecode: drawingTimecodeStart,
      timecodeEnd: drawingTimecodeEnd,
    } : null)

    window.dispatchEvent(new CustomEvent('annotationDraftChanged', {
      detail: {
        annotations,
        timecodeStart: drawingTimecodeStart,
        timecodeEnd: drawingTimecodeEnd,
        videoId: selectedVideo?.id,
      },
    }))
  }, [
    isDrawingMode,
    annotationDrawing.shapes,
    getAnnotationData,
    drawingTimecodeStart,
    drawingTimecodeEnd,
    selectedVideo?.id,
  ])

  useEffect(() => {
    const handleGetAnnotationDraft = (event: Event) => {
      const callback = (event as CustomEvent).detail?.callback
      if (typeof callback !== 'function' || !isDrawingMode) return

      callback({
        annotations: getAnnotationData(),
        timecodeStart: drawingTimecodeStart,
        timecodeEnd: drawingTimecodeEnd,
        videoId: selectedVideo?.id ?? null,
      })
    }
    const handleAnnotationSubmitted = () => {
      if (!isDrawingMode) return
      setIsDrawingMode(false)
    }

    window.addEventListener('getAnnotationDraft', handleGetAnnotationDraft)
    window.addEventListener('annotationSubmitted', handleAnnotationSubmitted)
    return () => {
      window.removeEventListener('getAnnotationDraft', handleGetAnnotationDraft)
      window.removeEventListener('annotationSubmitted', handleAnnotationSubmitted)
    }
  }, [
    isDrawingMode,
    getAnnotationData,
    drawingTimecodeStart,
    drawingTimecodeEnd,
    selectedVideo?.id,
  ])

  useEffect(() => {
    const clear = () => setPendingAnnotation(null)
    window.addEventListener('commentPosted', clear)
    window.addEventListener('annotationCleared', clear)
    return () => {
      window.removeEventListener('commentPosted', clear)
      window.removeEventListener('annotationCleared', clear)
    }
  }, [])

  useEffect(() => {
    if (selectedVideo?.id) {
      window.dispatchEvent(new CustomEvent('videoChanged', {
        detail: { videoId: selectedVideo.id }
      }))
      window.dispatchEvent(new CustomEvent('reviewVersionChanged', {
        detail: { videoId: selectedVideo.id, versionLabel: selectedVideo.versionLabel }
      }))
    }
  }, [selectedVideo?.id])

  useEffect(() => {
    const selectVersion = (event: Event) => {
      const videoId = (event as CustomEvent).detail?.videoId
      const targetIndex = displayVideos.findIndex((video) => video.id === videoId)
      if (targetIndex >= 0) setSelectedVideoId(videoId)
    }
    const openComparison = () => {
      if (allowComparison && displayVideos.length >= 2) {
        videoRef.current?.pause()
        setIsPlaying(false)
        setShowComparison(true)
      }
    }
    window.addEventListener('selectReviewVersion', selectVersion)
    window.addEventListener('openReviewComparison', openComparison)
    return () => {
      window.removeEventListener('selectReviewVersion', selectVersion)
      window.removeEventListener('openReviewComparison', openComparison)
    }
  }, [allowComparison, displayVideos])

  useEffect(() => {
    selectedVideoIdRef.current = selectedVideo?.id ?? null
  }, [selectedVideo?.id])

  useEffect(() => {
    const video = videoRef.current
    video?.pause()
    if (video) video.currentTime = 0

    currentTimeRef.current = 0
    lastTimeUpdateRef.current = 0
    setCurrentTimeState(0)
    setVideoDuration(0)
    setIsPlaying(false)
    setPendingRangeStart(null)
    setPendingRangeEnd(null)
    setIsSelectingRange(false)

    window.dispatchEvent(new CustomEvent('videoPositionChanged', {
      detail: { time: 0, videoId: selectedVideo?.id ?? null },
    }))
  }, [activeVideoName, selectedVideo?.id])

  useEffect(() => {
    if (!activeVideoName) return
    if (previousVideoNameRef.current && previousVideoNameRef.current !== activeVideoName) {
      setSelectedVideoId(null)
      setVideoUrl('')
      currentTimeRef.current = 0
    }
    previousVideoNameRef.current = activeVideoName
  }, [activeVideoName])

  useEffect(() => {
    setSelectedVideoId(null)
  }, [followLatestVersion, initialVideoIndex])

  // Safety check: ensure selectedVideo exists before accessing properties
  const isVideoApproved = selectedVideo ? (selectedVideo as any).approved === true : false

  useEffect(() => {
    async function loadVideoUrl() {
      try {
        if (!selectedVideo) {
          return
        }

        let url: string | undefined
        let qualityUsed: '720p' | '1080p' | '2160p' = defaultQuality

        if (defaultQuality === '2160p') {
          // Prefer 2160p, fallback to 1080p then 720p
          if ((selectedVideo as any).streamUrl2160p) {
            url = (selectedVideo as any).streamUrl2160p
            qualityUsed = '2160p'
          } else if ((selectedVideo as any).streamUrl1080p) {
            url = (selectedVideo as any).streamUrl1080p
            qualityUsed = '1080p'
          } else if ((selectedVideo as any).streamUrl720p) {
            url = (selectedVideo as any).streamUrl720p
            qualityUsed = '720p'
          }
        } else if (defaultQuality === '1080p') {
          // Prefer 1080p, fallback to 720p
          if ((selectedVideo as any).streamUrl1080p) {
            url = (selectedVideo as any).streamUrl1080p
            qualityUsed = '1080p'
          } else if ((selectedVideo as any).streamUrl720p) {
            url = (selectedVideo as any).streamUrl720p
            qualityUsed = '720p'
          } else if ((selectedVideo as any).streamUrl2160p) {
            url = (selectedVideo as any).streamUrl2160p
            qualityUsed = '2160p'
          }
        } else {
          // Prefer 720p, fallback to 1080p then 2160p
          if ((selectedVideo as any).streamUrl720p) {
            url = (selectedVideo as any).streamUrl720p
            qualityUsed = '720p'
          } else if ((selectedVideo as any).streamUrl1080p) {
            url = (selectedVideo as any).streamUrl1080p
            qualityUsed = '1080p'
          } else if ((selectedVideo as any).streamUrl2160p) {
            url = (selectedVideo as any).streamUrl2160p
            qualityUsed = '2160p'
          }
        }

        if (url) {
          currentTimeRef.current = 0
          setResolvedPlaybackQuality(qualityUsed)
          setVideoCrossOrigin('anonymous')
          setVideoLoadFailed(false)
          setVideoUrl(url)
        }
      } catch (error) {
      }
    }

    loadVideoUrl()
  }, [selectedVideo, defaultQuality])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoUrl) return
    video.load()
  }, [videoCrossOrigin, videoUrl])

  useEffect(() => {
    const video = videoRef.current
    if (initialSeekTime !== null && video && videoUrl && !hasInitiallySeenRef.current) {
      const handleLoadedMetadata = () => {
        if (video && initialSeekTime !== null) {
          const duration = video.duration
          const seekTime = Math.min(initialSeekTime, duration)

          video.currentTime = seekTime
          currentTimeRef.current = seekTime
          // Don't auto-play - mobile browsers block this

          hasInitiallySeenRef.current = true
        }
      }

      if (video.readyState >= 1) {
        handleLoadedMetadata()
      } else {
        video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true })
      }

      return () => {
        video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      }
    }
  }, [initialSeekTime, videoUrl])


  useEffect(() => {
    const handleGetCurrentTime = (e: CustomEvent) => {
      if (e.detail.callback) {
        // Read the media element directly so sending a comment never uses the
        // throttled display value from the timeline.
        const exactTime = videoRef.current?.currentTime ?? currentTimeRef.current
        e.detail.callback(exactTime, selectedVideoIdRef.current)
      }
    }

    window.addEventListener('getCurrentTime' as any, handleGetCurrentTime as EventListener)
    return () => {
      window.removeEventListener('getCurrentTime' as any, handleGetCurrentTime as EventListener)
    }
  }, [])

  useEffect(() => {
    const handleGetSelectedVideoId = (e: CustomEvent) => {
      if (e.detail.callback) {
        e.detail.callback(selectedVideoIdRef.current)
      }
    }

    window.addEventListener('getSelectedVideoId' as any, handleGetSelectedVideoId as EventListener)
    return () => {
      window.removeEventListener('getSelectedVideoId' as any, handleGetSelectedVideoId as EventListener)
    }
  }, [])


  useEffect(() => {
    const handleSeekToTime = (e: CustomEvent) => {
      const { timestamp, videoId } = e.detail

      if (videoId && videoId !== selectedVideo?.id) {
        const targetVideoIndex = displayVideos.findIndex(v => v.id === videoId)
        if (targetVideoIndex !== -1) {
          setSelectedVideoId(videoId)
          setTimeout(() => {
            if (videoRef.current) {
              videoRef.current.pause()
              videoRef.current.currentTime = timestamp
              currentTimeRef.current = timestamp
              setCurrentTimeState(timestamp)
              videoRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          }, 500)
          return
        }
      }

      // Same video - just seek
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.currentTime = timestamp
        currentTimeRef.current = timestamp
        setCurrentTimeState(timestamp)
        videoRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }

    window.addEventListener('seekToTime' as any, handleSeekToTime as EventListener)
    return () => {
      window.removeEventListener('seekToTime' as any, handleSeekToTime as EventListener)
    }
  }, [selectedVideo?.id, displayVideos])

  useEffect(() => {
    const handlePauseForComment = () => {
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause()
      }
    }

    window.addEventListener('pauseVideoForComment', handlePauseForComment)
    return () => {
      window.removeEventListener('pauseVideoForComment', handlePauseForComment)
    }
  }, [])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed
    }
  }, [playbackSpeed])


  // Keyboard shortcuts: Ctrl+Space (play/pause), Ctrl+,/. (speed), Ctrl+/ (reset speed), Ctrl+J/L (frame step)
  useEffect(() => {
    const handleKeyboard = (e: KeyboardEvent) => {
      if (!videoRef.current) return

      const video = videoRef.current

      const target = e.target as HTMLElement | null
      const isEditableTarget = Boolean(
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      )

      // Space: Play/Pause from anywhere in the review screen
      if (e.code === 'Space' && !isEditableTarget) {
        e.preventDefault()
        e.stopPropagation()
        if (video.paused) {
          void video.play()
          setIsPlaying(true)
        } else {
          video.pause()
          setIsPlaying(false)
        }
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
        if (!selectedVideo?.fps) return

        if (!video.paused) {
          video.pause()
        }

        const frameDuration = 1 / selectedVideo.fps
        video.currentTime = Math.max(0, video.currentTime - frameDuration)
        currentTimeRef.current = video.currentTime // Update ref for comment timecode
        window.dispatchEvent(new CustomEvent('videoTimeUpdated', {
          detail: { time: currentTimeRef.current, videoId: selectedVideoIdRef.current }
        }))
        window.dispatchEvent(new CustomEvent('videoPositionChanged', {
          detail: { time: currentTimeRef.current, videoId: selectedVideoIdRef.current }
        }))
        return
      }

      // Ctrl+L: Go forward one frame
      if (e.ctrlKey && e.code === 'KeyL') {
        e.preventDefault()
        e.stopPropagation()
        if (!selectedVideo?.fps) return

        if (!video.paused) {
          video.pause()
        }

        const frameDuration = 1 / selectedVideo.fps
        const duration = Number.isFinite(video.duration) ? video.duration : undefined
        video.currentTime = duration
          ? Math.min(duration, video.currentTime + frameDuration)
          : video.currentTime + frameDuration
        currentTimeRef.current = video.currentTime // Update ref for comment timecode
        window.dispatchEvent(new CustomEvent('videoTimeUpdated', {
          detail: { time: currentTimeRef.current, videoId: selectedVideoIdRef.current }
        }))
        window.dispatchEvent(new CustomEvent('videoPositionChanged', {
          detail: { time: currentTimeRef.current, videoId: selectedVideoIdRef.current }
        }))
        return
      }
    }

    // Use capture phase to intercept events before they reach other elements
    window.addEventListener('keydown', handleKeyboard, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyboard, { capture: true })
    }
  }, [selectedVideo])

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const now = Date.now()
      // Throttle to update max every 200ms instead of 60 times per second
      if (now - lastTimeUpdateRef.current > 200) {
        currentTimeRef.current = videoRef.current.currentTime
        setCurrentTimeState(videoRef.current.currentTime)
        window.dispatchEvent(new CustomEvent('videoPositionChanged', {
          detail: { time: currentTimeRef.current, videoId: selectedVideoIdRef.current }
        }))
        lastTimeUpdateRef.current = now
      }
    }
  }

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setVideoDuration(videoRef.current.duration)
      setVolume(videoRef.current.volume)
      setIsMuted(videoRef.current.muted)
    }
  }

  const handleTimelineSeek = (timestamp: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = timestamp
      currentTimeRef.current = timestamp
      setCurrentTimeState(timestamp)
      window.dispatchEvent(new CustomEvent('videoPositionChanged', {
        detail: { time: timestamp, videoId: selectedVideoIdRef.current }
      }))
    }
  }

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play()
        setIsPlaying(true)
      } else {
        videoRef.current.pause()
        setIsPlaying(false)
      }
    }
  }

  const handleVolumeChange = (newVolume: number) => {
    if (videoRef.current) {
      videoRef.current.volume = newVolume
      setVolume(newVolume)
      if (newVolume > 0 && isMuted) {
        videoRef.current.muted = false
        setIsMuted(false)
      }
    }
  }

  const handleToggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted
      setIsMuted(videoRef.current.muted)
    }
  }

  const handleToggleLoop = () => {
    setIsLooping(prev => !prev)
  }

  const handleToggleFullscreen = () => {
    if (!containerRef.current || !videoRef.current) return

    // Mobile devices (especially iOS) need special handling
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    const video = videoRef.current as any // Type cast for webkit APIs
    
    if (!document.fullscreenElement) {
      if (isMobile && video.webkitEnterFullscreen) {
        try {
          video.webkitEnterFullscreen()
          setIsFullscreen(true)
        } catch (error) {
          logError('Failed to enter fullscreen:', error)
        }
      } else if (isMobile && video.requestFullscreen) {
        try {
          video.requestFullscreen()
          setIsFullscreen(true)
        } catch (error) {
          logError('Failed to enter fullscreen:', error)
        }
      } else if (containerRef.current.requestFullscreen) {
        try {
          containerRef.current.requestFullscreen()
          setIsFullscreen(true)
        } catch (error) {
          logError('Failed to enter fullscreen:', error)
        }
      }
    } else {
      try {
        document.exitFullscreen()
        setIsFullscreen(false)
      } catch (error) {
        logError('Failed to exit fullscreen:', error)
      }
    }
  }

  const handleFrameStep = (direction: 'forward' | 'backward') => {
    if (!videoRef.current || !selectedVideo?.fps) return

    if (!videoRef.current.paused) {
      videoRef.current.pause()
      setIsPlaying(false)
    }

    const frameDuration = 1 / selectedVideo.fps
    const newTime = direction === 'forward'
      ? Math.min(videoDuration, videoRef.current.currentTime + frameDuration)
      : Math.max(0, videoRef.current.currentTime - frameDuration)
    
    videoRef.current.currentTime = newTime
    currentTimeRef.current = newTime
    setCurrentTimeState(newTime)
    
    window.dispatchEvent(new CustomEvent('videoTimeUpdated', {
      detail: { time: currentTimeRef.current, videoId: selectedVideoIdRef.current }
    }))
    window.dispatchEvent(new CustomEvent('videoPositionChanged', {
      detail: { time: currentTimeRef.current, videoId: selectedVideoIdRef.current }
    }))
  }

  const resetControlsTimeout = useCallback(() => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current)
    }
    setShowControls(true)
  }, [])

  useEffect(() => {
    if (isPlaying) {
      resetControlsTimeout()
    } else {
      setShowControls(true)
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current)
      }
    }
  }, [isPlaying, resetControlsTimeout])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handlePlay = () => {
      setIsPlaying(true)
      resetControlsTimeout()
    }
    const handlePause = () => setIsPlaying(false)
    const handleVolumeChangeEvent = () => {
      setVolume(video.volume)
      setIsMuted(video.muted)
    }

    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('volumechange', handleVolumeChangeEvent)

    return () => {
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('volumechange', handleVolumeChangeEvent)
    }
  }, [resetControlsTimeout])

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      )
      setIsFullscreen(isCurrentlyFullscreen)
    }

    const video = videoRef.current
    if (video) {
      const handleWebkitBegin = () => setIsFullscreen(true)
      const handleWebkitEnd = () => setIsFullscreen(false)
      
      video.addEventListener('webkitbeginfullscreen', handleWebkitBegin)
      video.addEventListener('webkitendfullscreen', handleWebkitEnd)
      
      // Standard fullscreen events
      document.addEventListener('fullscreenchange', handleFullscreenChange)
      document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.addEventListener('mozfullscreenchange', handleFullscreenChange)
      document.addEventListener('MSFullscreenChange', handleFullscreenChange)
      
      return () => {
        video.removeEventListener('webkitbeginfullscreen', handleWebkitBegin)
        video.removeEventListener('webkitendfullscreen', handleWebkitEnd)
        document.removeEventListener('fullscreenchange', handleFullscreenChange)
        document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
        document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
        document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
      }
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current

    const handleInteraction = () => {
      resetControlsTimeout()
    }

    if (container) {
      container.addEventListener('mousemove', handleInteraction)
      container.addEventListener('touchstart', handleInteraction)
    }

    return () => {
      if (container) {
        container.removeEventListener('mousemove', handleInteraction)
        container.removeEventListener('touchstart', handleInteraction)
      }
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])



  // Expose video state to parent for mobile layout
  useEffect(() => {
    if (onVideoStateChange && selectedVideo) {
      onVideoStateChange({
        selectedVideo,
        selectedVideoIndex,
        isVideoApproved,
        displayVideos,
        displayLabel: isVideoApproved ? t('approvedVersion') : selectedVideo.versionLabel,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVideo?.id, selectedVideo?.reviewStatus, selectedVideoIndex, isVideoApproved])

  if (!selectedVideo || displayVideos.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        No videos available
      </div>
    )
  }

  const displayLabel = isVideoApproved ? t('approvedVersion') : selectedVideo.versionLabel

  const handleApprove = async () => {
    if (activeVideoName) {
      sessionStorage.setItem('approvedVideoName', activeVideoName)
    }
    if (onApprove) {
      await onApprove()
    }
  }

  return (
    <div className={`flex flex-col ${fillContainer ? 'min-h-0 lg:h-full' : 'space-y-4 max-h-full'}`}>
      {/* Version Selector - Show ABOVE video on mobile, BELOW on desktop */}
      {false && displayVideos.length > 1 && (
        <div data-tutorial="version-selector" className={`flex gap-2 overflow-x-auto py-2 px-2 flex-shrink-0 ${fillContainer ? '' : 'lg:order-2'}`}>
          {displayVideos.map((video, index) => {
            const videoApproved = (video as any).approved === true
            return (
              <Button
                key={video.id}
                onClick={() => setSelectedVideoId(video.id)}
                variant={selectedVideoIndex === index ? 'default' : 'outline'}
                size="sm"
                className="whitespace-nowrap relative"
              >
                {videoApproved && (
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-success" />
                )}
                {videoApproved ? t('approvedVersion') : video.versionLabel}
              </Button>
            )
          })}
          {displayVideos.length >= 2 && (
            <Button
              onClick={() => {
                // Pause current video before opening comparison
                if (videoRef.current && !videoRef.current.paused) {
                  videoRef.current.pause()
                  setIsPlaying(false)
                }
                setShowComparison(true)
              }}
              variant="outline"
              size="sm"
              className="whitespace-nowrap ml-auto"
            >
              <GitCompareArrows className="w-3.5 h-3.5 mr-1.5" />
              Compare
            </Button>
          )}
        </div>
      )}

      {/* Video Player Container */}
      <div
        ref={containerRef}
        className={`relative w-full ${
                  fillContainer ? 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col' : 'flex-shrink min-h-0 lg:order-1'
        } ${isPlaying && !showControls ? 'cursor-none' : ''}`}
      >
        {videoUrl ? (
          <>
            {/*
              Simple letterbox approach:
              - Container fills available space with 16:9 aspect ratio
              - Video uses object-contain to maintain its true aspect ratio
              - Background color matches theme for clean letterboxing
            */}
            <div
              ref={videoWrapperRef}
              className={`group relative mb-[76px] w-full max-h-[56vh] overflow-visible rounded-md aspect-video lg:aspect-auto ${playerSurfaceClassName} ${playerFrameClassName} ${
                fillContainer ? 'lg:max-h-none lg:min-h-0 lg:flex-1' : ''
              }`}
              style={playerSurfaceColor ? { backgroundColor: playerSurfaceColor } : undefined}
            >
              <video
                key={selectedVideo?.id}
                ref={videoRef}
                src={videoUrl}
                poster={(selectedVideo as any).thumbnailUrl || undefined}
                className={`h-full w-full object-contain ${playerSurfaceClassName} ${isDrawingMode ? 'pointer-events-none' : 'cursor-pointer'}`}
                style={playerSurfaceColor ? { backgroundColor: playerSurfaceColor } : undefined}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onContextMenu={!isAdmin ? (e) => e.preventDefault() : undefined}
                onClick={isDrawingMode ? undefined : handlePlayPause}
                crossOrigin={videoCrossOrigin || undefined}
                onError={() => {
                  if (videoCrossOrigin === 'anonymous') {
                    setVideoCrossOrigin(null)
                  } else {
                    setVideoLoadFailed(true)
                  }
                }}
                playsInline
                loop={isLooping}
                preload="metadata"
                // @ts-ignore - webkit attributes for iOS
                webkit-playsinline="true"
                x-webkit-airplay="allow"
              />

              {videoLoadFailed && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-4 text-center text-sm text-muted-foreground">
                  视频加载失败，请刷新页面或检查网络后重试。
                </div>
              )}

              {!isDrawingMode && (onPreviousVideo || onNextVideo) && (
                <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 flex -translate-y-1/2 items-center justify-between px-3 opacity-100 transition-opacity duration-150 sm:px-4 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onPreviousVideo?.()
                    }}
                    disabled={!hasPreviousVideo}
                    aria-label={tShare('previousVideo')}
                    title={tShare('previousVideo')}
                    className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow-lg transition-[background-color,transform] duration-150 hover:scale-105 hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/60 disabled:pointer-events-none disabled:opacity-25"
                  >
                    <ChevronLeft className="h-6 w-6" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onNextVideo?.()
                    }}
                    disabled={!hasNextVideo}
                    aria-label={tShare('nextVideo')}
                    title={tShare('nextVideo')}
                    className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow-lg transition-[background-color,transform] duration-150 hover:scale-105 hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/60 disabled:pointer-events-none disabled:opacity-25"
                  >
                    <ChevronRight className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>
              )}

                {/* Annotation Overlay (read-only, renders saved drawing annotations during playback) */}
                <AnnotationOverlay
                  comments={selectedVideoComments as any[]}
                  currentTime={currentTimeState}
                  videoFps={selectedVideo?.fps || 24}
                  containerRef={videoWrapperRef}
                  videoRef={videoRef}
                  hidden={isDrawingMode}
                  pendingAnnotation={pendingAnnotation}
                />

                {/* Drawing Mode: Interactive Canvas + Toolbar + Keyframe Bar */}
                {isDrawingMode && (
                  <>
                    <AnnotationCanvas
                      containerRef={videoWrapperRef}
                      videoRef={videoRef}
                      shapes={annotationDrawing.shapes}
                      activeShape={annotationDrawing.activeShape}
                      onStartShape={annotationDrawing.startShape}
                      onUpdateShape={annotationDrawing.updateShape}
                      onFinishShape={annotationDrawing.finishShape}
                    />
                    <AnnotationToolbar
                      placement="composer"
                      activeTool={annotationDrawing.activeTool}
                      activeColor={annotationDrawing.activeColor}
                      strokeWidth={annotationDrawing.strokeWidth}
                      opacity={annotationDrawing.opacity}
                      canUndo={annotationDrawing.undoStack.length > 0}
                      onColorChange={annotationDrawing.setActiveColor}
                      onToolChange={annotationDrawing.setActiveTool}
                      onStrokeWidthChange={annotationDrawing.setStrokeWidth}
                      onOpacityChange={annotationDrawing.setOpacity}
                      onUndo={annotationDrawing.undo}
                      onCancel={handleDrawingCancel}
                    />
                  </>
                )}

                {/* Mobile-only center playback overlay (frame back / play / frame forward) */}
                {!isDrawingMode && (
                  <div
                    className={`sm:hidden absolute inset-0 z-10 flex items-center justify-center gap-6 pointer-events-none transition-opacity duration-300 ${
                      showControls || !isPlaying ? 'opacity-100' : 'opacity-0'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleFrameStep('backward')}
                      className="pointer-events-auto flex items-center justify-center w-10 h-10 rounded-full bg-black/50 active:bg-black/70 touch-manipulation"
                      aria-label={tControls('previousFrame')}
                    >
                      <SkipBack className="w-5 h-5 text-white" />
                    </button>
                    <button
                      type="button"
                      onClick={handlePlayPause}
                      className="pointer-events-auto flex items-center justify-center w-12 h-12 rounded-full bg-black/50 active:bg-black/70 touch-manipulation"
                      aria-label={isPlaying ? tControls('pauseVideo') : tControls('playVideo')}
                    >
                      {isPlaying ? (
                        <Pause className="w-6 h-6 text-white fill-white" />
                      ) : (
                        <Play className="w-6 h-6 text-white fill-white" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFrameStep('forward')}
                      className="pointer-events-auto flex items-center justify-center w-10 h-10 rounded-full bg-black/50 active:bg-black/70 touch-manipulation"
                      aria-label={tControls('nextFrame')}
                    >
                      <SkipForward className="w-5 h-5 text-white" />
                    </button>
                  </div>
                )}

                {/* Custom Video Controls with Integrated Timeline */}
                <div
                  className="relative z-20"
                >
                  <CustomVideoControls
                    videoRef={videoRef as React.RefObject<HTMLVideoElement>}
                    previewVideoUrl={videoUrl}
                    videoDuration={videoDuration}
                    currentTime={currentTimeState}
                    isPlaying={isPlaying}
                    volume={volume}
                    isMuted={isMuted}
                    isFullscreen={isFullscreen}
                    onPlayPause={handlePlayPause}
                    onSeek={handleTimelineSeek}
                    onVolumeChange={handleVolumeChange}
                    onToggleMute={handleToggleMute}
                    onToggleFullscreen={handleToggleFullscreen}
                    onFrameStep={handleFrameStep}
                    isLooping={isLooping}
                    onToggleLoop={handleToggleLoop}
                    comments={selectedVideoComments}
                    videoFps={selectedVideo?.fps || 24}
                    videoId={selectedVideo?.id}
                    isAdmin={isAdmin}
                    timestampDisplayMode={timestampDisplayMode}
                    onMarkerClick={onCommentFocus}
                    pendingRangeStart={pendingRangeStart}
                    pendingRangeEnd={pendingRangeEnd}
                    isSelectingRange={isSelectingRange && pendingRangeStart !== null}
                    onRangeStartChange={(time) => {
                      setPendingRangeStart(time)
                      window.dispatchEvent(new CustomEvent('commentRangeStartChanged', {
                        detail: { time, videoId: selectedVideo?.id },
                      }))
                    }}
                    onRangeEndChange={(time) => {
                      setPendingRangeEnd(time)
                      window.dispatchEvent(new CustomEvent('commentRangeEndChanged', {
                        detail: { time, videoId: selectedVideo?.id },
                      }))
                    }}
                    surfaceClassName={controlsSurfaceClassName}
                  />
                </div>

                {/* Playback Speed Indicator - positioned inside video wrapper */}
                {playbackSpeed !== 1.0 && (
                  <div className="absolute top-4 right-4 bg-black/80 text-white px-3 py-1.5 rounded-md text-sm font-medium pointer-events-none z-20">
                    {playbackSpeed.toFixed(2)}x
                  </div>
                )}
            </div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-card-foreground">
            Loading video...
          </div>
        )}
      </div>

      {/* Video Comparison Modal */}
      {allowComparison && showComparison && displayVideos.length >= 2 && (
        <VideoComparison
          videoVersions={displayVideos}
          defaultQuality={defaultQuality}
          timestampDisplayMode={timestampDisplayMode}
          onClose={() => setShowComparison(false)}
        />
      )}

      {/* Video & Project Information */}
      <ProjectInfo
        selectedVideo={selectedVideo}
        displayLabel={displayLabel}
        isVideoApproved={isVideoApproved}
        projectId={projectId}
        projectTitle={projectTitle}
        projectDescription={projectDescription}
        clientName={clientName}
        isPasswordProtected={isPasswordProtected}
        watermarkEnabled={watermarkEnabled}
        defaultQuality={defaultQuality}
        onApprove={onApprove ? handleApprove : undefined}
        isAdmin={isAdmin}
        clientCanApprove={clientCanApprove}
        isGuest={isGuest}
        hideDownloadButton={hideDownloadButton}
        allowAssetDownload={allowAssetDownload}
        shareToken={shareToken}
        onDownloadToken={onDownloadToken}
        activeVideoName={activeVideoName}
        authenticatedEmail={authenticatedEmail}
        authenticatedName={authenticatedName}
        className="mt-2 border-t border-border/70 lg:order-3 xl:mt-0"
        usePreviewForApprovedPlayback={usePreviewForApprovedPlayback}
        playbackQuality={resolvedPlaybackQuality}
        hideApprovalAction={hideApprovalAction}
      />
    </div>
  )
}
