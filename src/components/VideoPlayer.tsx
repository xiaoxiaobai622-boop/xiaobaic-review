'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Video, ProjectStatus, Comment } from '@prisma/client'
import { Button } from './ui/button'
import { CheckCircle2, ChevronLeft, ChevronRight, GitCompareArrows, LoaderCircle, Play, Pause, SkipBack, SkipForward } from 'lucide-react'
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
import { useHlsSource } from '@/hooks/useHlsSource'
import { useStorageProvider } from '@/components/StorageConfigProvider'

type CommentWithReplies = Comment & {
  replies?: Comment[]
}

type PendingSeek = {
  time: number
  resume: boolean
}

type PlaybackQuality = '720p' | '1080p' | '2160p'

interface PlaybackSource {
  videoId: string | null
  url: string
  hlsUrl: string
  quality: PlaybackQuality
}

function resolvePlaybackSource(
  video: {
    id?: string
    streamUrl720p?: string | null
    streamUrl1080p?: string | null
    streamUrl2160p?: string | null
    hlsUrl720p?: string | null
  } | null,
  defaultQuality: PlaybackQuality,
  supportsHls: boolean,
): PlaybackSource {
  if (!video) {
    return { videoId: null, url: '', hlsUrl: '', quality: defaultQuality }
  }

  let url = ''
  let quality: PlaybackQuality = defaultQuality

  if (defaultQuality === '2160p') {
    if (video.streamUrl2160p) {
      url = video.streamUrl2160p
      quality = '2160p'
    } else if (video.streamUrl1080p) {
      url = video.streamUrl1080p
      quality = '1080p'
    } else {
      url = video.streamUrl720p || ''
      quality = '720p'
    }
  } else if (defaultQuality === '1080p') {
    if (video.streamUrl1080p) {
      url = video.streamUrl1080p
      quality = '1080p'
    } else if (video.streamUrl720p) {
      url = video.streamUrl720p
      quality = '720p'
    } else {
      url = video.streamUrl2160p || ''
      quality = '2160p'
    }
  } else if (video.streamUrl720p) {
    url = video.streamUrl720p
    quality = '720p'
  } else if (video.streamUrl1080p) {
    url = video.streamUrl1080p
    quality = '1080p'
  } else {
    url = video.streamUrl2160p || ''
    quality = '2160p'
  }

  const hlsUrl = supportsHls ? (video.hlsUrl720p || '') : ''
  if (hlsUrl) quality = '720p'

  return { videoId: video.id || null, url, hlsUrl, quality }
}

const POSITION_EVENT_INTERVAL_MS = 200
const BUFFER_TAIL_TOLERANCE_SECONDS = 0.15
const MEDIA_END_EPSILON_SECONDS = 0.15

function isTimeBuffered(video: HTMLVideoElement, time: number): boolean {
  const duration = getFiniteDuration(video)
  const isAtMediaEnd = duration !== null && time >= duration - 0.05

  for (let index = 0; index < video.buffered.length; index += 1) {
    const start = video.buffered.start(index)
    const end = video.buffered.end(index)
    const rangeLength = Math.max(0, end - start)
    const tailTolerance = Math.min(BUFFER_TAIL_TOLERANCE_SECONDS, Math.max(0.02, rangeLength / 4))
    // A timestamp at the exact end of a range can still stall while the next
    // HLS fragment is fetched. Leave a small tail unless the target is the
    // actual end of the media.
    if (
      time >= start &&
      (time < end - tailTolerance || (isAtMediaEnd && end >= (duration ?? 0) - 0.05))
    ) {
      return true
    }
  }
  return false
}

function getFiniteDuration(video: HTMLVideoElement): number | null {
  return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null
}

function clampMediaTime(video: HTMLVideoElement, time: number): number {
  if (!Number.isFinite(time)) return 0

  const duration = getFiniteDuration(video)
  return duration === null
    ? Math.max(0, time)
    : Math.min(duration, Math.max(0, time))
}

function getPendingSeekTarget(video: HTMLVideoElement, pendingSeek: PendingSeek): number {
  // The duration may become known after a seek was requested. Normalize the
  // target here so a URL timestamp beyond the media end cannot keep the seek
  // pending forever or make the playhead jump back to an old buffer.
  return clampMediaTime(video, pendingSeek.time)
}

function hasReachedPendingSeek(
  video: HTMLVideoElement,
  pendingSeek: PendingSeek,
  requireBuffered = true,
): boolean {
  const target = getPendingSeekTarget(video, pendingSeek)
  return Math.abs(video.currentTime - target) <= 0.5 &&
    (!requireBuffered || isTimeBuffered(video, target))
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
  const storageProvider = useStorageProvider()
  const supportsHls = storageProvider === 's3'
  // null means automatic selection. This lets a default viewer follow a newly
  // published latest version while preserving a version chosen by the user.
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [sourceVideoId, setSourceVideoId] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string>('')
  const [hlsUrl, setHlsUrl] = useState<string>('')
  const [videoCrossOrigin, setVideoCrossOrigin] = useState<'anonymous' | null>('anonymous')
  const [videoLoadFailed, setVideoLoadFailed] = useState(false)
  const [resolvedPlaybackQuality, setResolvedPlaybackQuality] = useState<'720p' | '1080p' | '2160p'>(defaultQuality)
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [currentTimeState, setCurrentTimeState] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isBuffering, setIsBuffering] = useState(false)
  const [isSeeking, setIsSeeking] = useState(false)
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
  const lastTimeUpdateRef = useRef(0) // Throttle cross-component position events
  const previousVideoNameRef = useRef<string | null>(null)
  const currentTimeRef = useRef(0)
  const playIntentRef = useRef(false)
  const playRequestRef = useRef<Promise<void> | null>(null)
  const playRequestIdRef = useRef(0)
  const pendingSeekRef = useRef<PendingSeek | null>(null)

  // Keep the UI responsive while a media element is waiting for its first
  // segment. The media events below remain the source of truth once playback
  // actually starts or stops.
  const requestPlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    playIntentRef.current = true
    setIsBuffering(video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA)

    const duration = getFiniteDuration(video)
    const isAtMediaEnd = duration !== null && video.currentTime >= duration - MEDIA_END_EPSILON_SECONDS
    const hasExplicitSeekTarget = pendingSeekRef.current !== null

    if ((video.ended || isAtMediaEnd) && !hasExplicitSeekTarget) {
      video.currentTime = 0
      currentTimeRef.current = 0
      lastTimeUpdateRef.current = 0
      setCurrentTimeState(0)
      pendingSeekRef.current = null
    }

    if (!video.paused && !video.ended) {
      setIsPlaying(true)
      return
    }

    if (playRequestRef.current) return

    const requestId = playRequestIdRef.current + 1
    playRequestIdRef.current = requestId
    let playPromise: Promise<void> | undefined
    try {
      playPromise = video.play()
    } catch (error) {
      // A synchronous play() failure leaves no playback request to settle and
      // therefore cannot emit a later pause event that clears this intent.
      // Clear it here so the next button/Space press starts a fresh request.
      playIntentRef.current = false
      setIsPlaying(false)
      setIsBuffering(false)
      logError('[PLAYER] Unable to start playback:', error)
      return
    }

    // Older browsers can return undefined. When a Promise is returned, always
    // consume its rejection so a failed seek does not leave an unhandled error
    // and a stale "playing" state in the controls.
    if (!playPromise) {
      setIsPlaying(true)
      return
    }

    setIsPlaying(true)
    const trackedPromise = playPromise
      .catch((error: unknown) => {
        if (video !== videoRef.current || requestId !== playRequestIdRef.current || !playIntentRef.current) return

        const errorName = (error as { name?: string } | null)?.name
        if (errorName !== 'AbortError') {
          logError('[PLAYER] Playback request was rejected:', error)
        }

        // Permission and codec errors will not be fixed by waiting for more
        // media. Preserve the intent for transient network/source-reset
        // failures so `canplay` can resume after HLS finishes loading. The
        // toggle handler checks the actual pending Promise, so a later click or
        // Space press can still issue a fresh request after this one settles.
        if (errorName === 'NotAllowedError' || errorName === 'NotSupportedError') {
          playIntentRef.current = false
        }
        setIsPlaying(false)
        setIsBuffering(errorName !== 'NotAllowedError' && errorName !== 'NotSupportedError')
      })
      .finally(() => {
        if (playRequestRef.current === trackedPromise && requestId === playRequestIdRef.current) {
          playRequestRef.current = null
        }
      })

    playRequestRef.current = trackedPromise
  }, [])

  const pausePlayback = useCallback(() => {
    playIntentRef.current = false
    pendingSeekRef.current = null
    playRequestIdRef.current += 1
    const video = videoRef.current
    // Calling pause even when `paused` is already true aborts a pending
    // play() promise in browsers that keep it unresolved while buffering.
    if (video) video.pause()
    playRequestRef.current = null
    setIsPlaying(false)
    setIsBuffering(false)
    setIsSeeking(false)
  }, [])

  const togglePlayback = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    // A media element can remain `paused` while an HLS fragment is being
    // fetched. A live play() promise identifies a request that a second click
    // should cancel; after a rejected request, retry instead of treating the
    // stale intent as an already-playing state.
    const hasPendingPlayRequest = playRequestRef.current !== null
    if (hasPendingPlayRequest || (!video.paused && !video.ended)) {
      pausePlayback()
    } else {
      requestPlay()
    }
  }, [pausePlayback, requestPlay])

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
  const selectedVideoData = selectedVideo as any
  const selectedVideoIdValue = selectedVideoData?.id ?? null
  const selectedStreamUrl720p = selectedVideoData?.streamUrl720p || ''
  const selectedStreamUrl1080p = selectedVideoData?.streamUrl1080p || ''
  const selectedStreamUrl2160p = selectedVideoData?.streamUrl2160p || ''
  const selectedHlsUrl720p = selectedVideoData?.hlsUrl720p || ''
  const sourceMatchesSelectedVideo = sourceVideoId === (selectedVideo?.id ?? null)
  const activeVideoUrl = sourceMatchesSelectedVideo ? videoUrl : ''
  const activeHlsUrl = supportsHls && sourceMatchesSelectedVideo ? hlsUrl : ''
  const playbackSource = useMemo(() => {
    return resolvePlaybackSource(
      selectedVideoIdValue ? {
        id: selectedVideoIdValue || undefined,
        streamUrl720p: selectedStreamUrl720p,
        streamUrl1080p: selectedStreamUrl1080p,
        streamUrl2160p: selectedStreamUrl2160p,
        hlsUrl720p: selectedHlsUrl720p,
      } : null,
      defaultQuality,
      supportsHls,
    )
  }, [
    defaultQuality,
    selectedVideoIdValue,
    selectedStreamUrl720p,
    selectedStreamUrl1080p,
    selectedStreamUrl2160p,
    selectedHlsUrl720p,
    supportsHls,
  ])
  const selectedVideoComments = useMemo(
    () => filterCommentsForVideo(comments, selectedVideo?.id),
    [comments, selectedVideo?.id],
  )

  const handlePlaybackError = useCallback(() => {
    playIntentRef.current = false
    pendingSeekRef.current = null
    setIsPlaying(false)
    setIsBuffering(false)
    setIsSeeking(false)
    if (videoCrossOrigin === 'anonymous') {
      setVideoCrossOrigin(null)
    } else {
      setVideoLoadFailed(true)
    }
  }, [videoCrossOrigin])

  const { isUsingHls } = useHlsSource({
    videoRef,
    hlsUrl: activeHlsUrl,
    fallbackUrl: activeVideoUrl,
    enabled: Boolean(activeHlsUrl || activeVideoUrl),
    attachmentKey: `${selectedVideo?.id ?? 'none'}:${videoCrossOrigin ?? 'no-cors'}`,
    playIntentRef,
    onPlaybackError: handlePlaybackError,
  })

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

      pausePlayback()
    }

    window.addEventListener('enterDrawingMode', handleEnterDrawing)
    return () => {
      window.removeEventListener('enterDrawingMode', handleEnterDrawing)
    }
  }, [selectedVideo?.fps, isDrawingMode, annotationDrawing, pausePlayback])

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
  }, [selectedVideo?.id, selectedVideo?.versionLabel])

  useEffect(() => {
    const selectVersion = (event: Event) => {
      const videoId = (event as CustomEvent).detail?.videoId
      const targetIndex = displayVideos.findIndex((video) => video.id === videoId)
      if (targetIndex >= 0) setSelectedVideoId(videoId)
    }
    const openComparison = () => {
      if (allowComparison && displayVideos.length >= 2) {
        pausePlayback()
        setShowComparison(true)
      }
    }
    window.addEventListener('selectReviewVersion', selectVersion)
    window.addEventListener('openReviewComparison', openComparison)
    return () => {
      window.removeEventListener('selectReviewVersion', selectVersion)
      window.removeEventListener('openReviewComparison', openComparison)
    }
  }, [allowComparison, displayVideos, pausePlayback])

  useEffect(() => {
    selectedVideoIdRef.current = selectedVideo?.id ?? null
  }, [selectedVideo?.id])

  useEffect(() => {
    const video = videoRef.current
    pausePlayback()
    if (video) video.currentTime = 0

    currentTimeRef.current = 0
    lastTimeUpdateRef.current = 0
    setCurrentTimeState(0)
    setVideoDuration(0)
    setIsPlaying(false)
    setIsBuffering(false)
    setIsSeeking(false)
    setPendingRangeStart(null)
    setPendingRangeEnd(null)
    setIsSelectingRange(false)

    window.dispatchEvent(new CustomEvent('videoPositionChanged', {
      detail: { time: 0, videoId: selectedVideo?.id ?? null },
    }))
  }, [activeVideoName, selectedVideo?.id, pausePlayback])

  useEffect(() => {
    if (!activeVideoName) return
    if (previousVideoNameRef.current && previousVideoNameRef.current !== activeVideoName) {
      pausePlayback()
      setSelectedVideoId(null)
      setSourceVideoId(null)
      setVideoUrl('')
      setHlsUrl('')
      currentTimeRef.current = 0
    }
    previousVideoNameRef.current = activeVideoName
  }, [activeVideoName, pausePlayback])

  useEffect(() => {
    setSelectedVideoId(null)
  }, [followLatestVersion, initialVideoIndex])

  // URL timestamps apply to the newly selected video as well. Reset the
  // one-shot guard when the review item changes, while preserving the current
  // position across a same-video HLS/MP4 source fallback.
  useEffect(() => {
    hasInitiallySeenRef.current = false
  }, [activeVideoName, selectedVideo?.id])

  // Safety check: ensure selectedVideo exists before accessing properties
  const isVideoApproved = selectedVideo ? (selectedVideo as any).approved === true : false

  useEffect(() => {
    currentTimeRef.current = 0
    setResolvedPlaybackQuality(playbackSource.quality)
    setVideoCrossOrigin('anonymous')
    setVideoLoadFailed(false)
    setVideoUrl(playbackSource.url)
    setHlsUrl(playbackSource.hlsUrl)
    setSourceVideoId(playbackSource.videoId)
  }, [playbackSource])

  const handleTimelineSeek = useCallback((timestamp: number, resume = false) => {
    const video = videoRef.current
    if (!video || !Number.isFinite(timestamp)) return

    const target = clampMediaTime(video, timestamp)
    const shouldResume = resume === true

    if (shouldResume) {
      playIntentRef.current = true
    } else {
      pausePlayback()
    }

    pendingSeekRef.current = { time: target, resume: shouldResume }
    setIsSeeking(true)
    setIsBuffering(!isTimeBuffered(video, target))

    try {
      video.currentTime = target
    } catch (error) {
      pendingSeekRef.current = null
      setIsSeeking(false)
      setIsBuffering(false)
      logError('[PLAYER] Unable to seek video:', error)
      return
    }

    currentTimeRef.current = target
    setCurrentTimeState(target)
    lastTimeUpdateRef.current = 0
    window.dispatchEvent(new CustomEvent('videoSeekRequested', {
      detail: { time: target, videoId: selectedVideoIdRef.current },
    }))
    window.dispatchEvent(new CustomEvent('videoPositionChanged', {
      detail: { time: target, videoId: selectedVideoIdRef.current }
    }))

    // Calling play immediately also kicks off native HLS loading. If the
    // target is not buffered yet, the media events retry once data arrives.
    if (shouldResume) requestPlay()
  }, [pausePlayback, requestPlay])

  useEffect(() => {
    const video = videoRef.current
    if (initialSeekTime !== null && video && (activeHlsUrl || activeVideoUrl) && !hasInitiallySeenRef.current) {
      const handleLoadedMetadata = () => {
        if (video && initialSeekTime !== null) {
          const duration = video.duration
          const seekTime = Number.isFinite(duration) && duration > 0
            ? Math.min(Math.max(0, initialSeekTime), duration)
            : Math.max(0, initialSeekTime)

          handleTimelineSeek(seekTime, false)
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
  }, [activeHlsUrl, activeVideoUrl, initialSeekTime, handleTimelineSeek])


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
    let seekTimer: ReturnType<typeof setTimeout> | null = null

    const handleSeekToTime = (e: CustomEvent) => {
      const { timestamp, videoId } = e.detail

      if (videoId && videoId !== selectedVideo?.id) {
        const targetVideoIndex = displayVideos.findIndex(v => v.id === videoId)
        if (targetVideoIndex !== -1) {
          setSelectedVideoId(videoId)
          if (seekTimer !== null) clearTimeout(seekTimer)
          seekTimer = setTimeout(() => {
            if (videoRef.current) {
              handleTimelineSeek(timestamp, false)
              videoRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          }, 500)
          return
        }
      }

      // Same video - just seek
      if (videoRef.current) {
        handleTimelineSeek(timestamp, false)
        videoRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }

    window.addEventListener('seekToTime' as any, handleSeekToTime as EventListener)
    return () => {
      if (seekTimer !== null) clearTimeout(seekTimer)
      window.removeEventListener('seekToTime' as any, handleSeekToTime as EventListener)
    }
  }, [selectedVideo?.id, displayVideos, handleTimelineSeek])

  useEffect(() => {
    const handlePauseForComment = () => {
      pausePlayback()
    }

    window.addEventListener('pauseVideoForComment', handlePauseForComment)
    return () => {
      window.removeEventListener('pauseVideoForComment', handlePauseForComment)
    }
  }, [pausePlayback])

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
        togglePlayback()
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

        const frameDuration = 1 / selectedVideo.fps
        const newTime = Math.max(0, video.currentTime - frameDuration)
        handleTimelineSeek(newTime, false)
        window.dispatchEvent(new CustomEvent('videoTimeUpdated', {
          detail: { time: currentTimeRef.current, videoId: selectedVideoIdRef.current }
        }))
        return
      }

      // Ctrl+L: Go forward one frame
      if (e.ctrlKey && e.code === 'KeyL') {
        e.preventDefault()
        e.stopPropagation()
        if (!selectedVideo?.fps) return

        const frameDuration = 1 / selectedVideo.fps
        const duration = Number.isFinite(video.duration) ? video.duration : undefined
        const newTime = duration
          ? Math.min(duration, video.currentTime + frameDuration)
          : video.currentTime + frameDuration
        handleTimelineSeek(newTime, false)
        window.dispatchEvent(new CustomEvent('videoTimeUpdated', {
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
  }, [selectedVideo, togglePlayback, handleTimelineSeek])

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    const time = clampMediaTime(video, video.currentTime)
    const pendingSeek = pendingSeekRef.current

    // A source can emit one more timeupdate for its previous buffer after a
    // seek. Keep the requested position visible until the new range is ready.
    if (pendingSeek) {
      const pendingTarget = getPendingSeekTarget(video, pendingSeek)
      if (Math.abs(time - pendingTarget) > 0.5) return
    }

    currentTimeRef.current = time
    const now = Date.now()
    if (now - lastTimeUpdateRef.current < POSITION_EVENT_INTERVAL_MS) return

    window.dispatchEvent(new CustomEvent('videoPositionChanged', {
      detail: { time, videoId: selectedVideoIdRef.current }
    }))
    lastTimeUpdateRef.current = now

    if (pendingSeek && hasReachedPendingSeek(video, pendingSeek)) {
      pendingSeekRef.current = null
      setIsSeeking(false)
      setIsBuffering(false)
    }
  }, [])

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      const video = videoRef.current
      const duration = getFiniteDuration(video)
      if (duration !== null) setVideoDuration(duration)
      setVolume(video.volume)
      setIsMuted(video.muted)
    }
  }, [])

  const handleDurationChange = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const duration = getFiniteDuration(video)
    if (duration !== null) {
      setVideoDuration((currentDuration) => currentDuration === duration ? currentDuration : duration)
    }
  }, [])

  const handlePlayPause = useCallback(() => {
    togglePlayback()
  }, [togglePlayback])

  const handleVolumeChange = useCallback((newVolume: number) => {
    if (videoRef.current) {
      videoRef.current.volume = newVolume
      setVolume(newVolume)
      if (newVolume > 0 && isMuted) {
        videoRef.current.muted = false
        setIsMuted(false)
      }
    }
  }, [isMuted])

  const handleToggleMute = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted
      setIsMuted(videoRef.current.muted)
    }
  }, [])

  const handleToggleLoop = useCallback(() => {
    setIsLooping(prev => !prev)
  }, [])

  const handleToggleFullscreen = useCallback(() => {
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
  }, [])

  const handleFrameStep = useCallback((direction: 'forward' | 'backward') => {
    if (!videoRef.current || !selectedVideo?.fps) return

    const frameDuration = 1 / selectedVideo.fps
    const newTime = direction === 'forward'
      ? Math.min(videoDuration, videoRef.current.currentTime + frameDuration)
      : Math.max(0, videoRef.current.currentTime - frameDuration)

    handleTimelineSeek(newTime, false)
    
    window.dispatchEvent(new CustomEvent('videoTimeUpdated', {
      detail: { time: currentTimeRef.current, videoId: selectedVideoIdRef.current }
    }))
    window.dispatchEvent(new CustomEvent('videoPositionChanged', {
      detail: { time: currentTimeRef.current, videoId: selectedVideoIdRef.current }
    }))
  }, [handleTimelineSeek, selectedVideo?.fps, videoDuration])

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
      if (!playIntentRef.current) {
        if (!video.paused) video.pause()
        return
      }
      setIsPlaying(true)
      resetControlsTimeout()
    }
    const handlePlaying = () => {
      if (!playIntentRef.current) {
        if (!video.paused) video.pause()
        setIsPlaying(false)
        return
      }
      setIsPlaying(true)
      setIsBuffering(false)
      const pendingSeek = pendingSeekRef.current
      if (!pendingSeek) {
        setIsSeeking(false)
      } else {
        const reachedTarget = hasReachedPendingSeek(video, pendingSeek)
        if (reachedTarget) {
          pendingSeekRef.current = null
          setIsSeeking(false)
          setIsBuffering(false)
        } else {
          // `playing` may fire for the old buffer before the requested HLS
          // fragment has been appended. Keep the seek intent alive.
          setIsBuffering(true)
          setIsSeeking(true)
          if (!pendingSeek.resume && !video.paused) video.pause()
          try {
            const pendingTarget = getPendingSeekTarget(video, pendingSeek)
            if (Math.abs(video.currentTime - pendingTarget) > 0.05) {
              video.currentTime = pendingTarget
            }
          } catch {
            // The next media event will retry the target position.
          }
        }
      }
      resetControlsTimeout()
    }
    const handlePause = () => {
      setIsPlaying(false)
      if (Number.isFinite(video.currentTime)) {
        const pendingSeek = pendingSeekRef.current
        const actualTime = clampMediaTime(video, video.currentTime)
        // A pause emitted during a source reset can still expose the previous
        // buffer. Keep the requested position visible until the new source
        // confirms it rather than writing the stale value into the controls.
        currentTimeRef.current = pendingSeek
          ? getPendingSeekTarget(video, pendingSeek)
          : actualTime
        setCurrentTimeState(currentTimeRef.current)
      }
      // A source swap (for example HLS -> MP4 fallback) can emit `pause`
      // while the user still intends to play. Explicit pausePlayback() clears
      // the intent before calling pause(), so preserve it here when present.
    }
    const handleWaiting = () => {
      if (playIntentRef.current || !video.paused) {
        setIsBuffering(true)
      }
    }
    const handleStalled = () => {
      if (playIntentRef.current || !video.paused) {
        setIsBuffering(true)
      }
    }
    const handleSeeking = () => {
      setIsSeeking(true)
      if (playIntentRef.current || !video.paused) {
        setIsBuffering(true)
      }
    }
    const handleSeeked = () => {
      const pendingSeek = pendingSeekRef.current
      if (!pendingSeek) {
        setIsSeeking(false)
        return
      }

      // HLS can dispatch `seeked` before the target fragment is appended. Let
      // `canplay` retry rather than clearing the user's play intent here.
      const reachedTarget = hasReachedPendingSeek(video, pendingSeek)
      if (reachedTarget) {
        pendingSeekRef.current = null
        setIsSeeking(false)
        setIsBuffering(false)
        if (pendingSeek.resume && video.paused && playIntentRef.current) requestPlay()
      } else {
        // `seeked` only means the media element accepted the timestamp. HLS
        // may still be fetching the corresponding fragment, so keep the
        // pending intent and ask the element to remain at the target.
        setIsSeeking(true)
        setIsBuffering(true)
        try {
          const pendingTarget = getPendingSeekTarget(video, pendingSeek)
          if (Math.abs(video.currentTime - pendingTarget) > 0.05) {
            video.currentTime = pendingTarget
          }
        } catch {
          // A later canplay/seeking event will retry the position.
        }
      }
    }
    const handleCanPlay = () => {
      const pendingSeek = pendingSeekRef.current
      if (pendingSeek) {
        const pendingTarget = getPendingSeekTarget(video, pendingSeek)
        const reachedTarget = Math.abs(video.currentTime - pendingTarget) <= 0.5
        const targetBuffered = reachedTarget && isTimeBuffered(video, pendingTarget)

        // `canplay` can describe an older buffered range while a seek is still
        // being applied. Starting playback here would resume from that old
        // range and leave the requested HLS fragment waiting indefinitely.
        if (!reachedTarget) {
          setIsSeeking(true)
          setIsBuffering(true)
          try {
            if (Math.abs(video.currentTime - pendingTarget) > 0.05) {
              video.currentTime = pendingTarget
            }
          } catch {
            // The media element will retry the seek on its next metadata/event.
          }
          return
        }

        if (!targetBuffered) {
          setIsSeeking(true)
          setIsBuffering(true)
          return
        }

        if (pendingSeek.resume && playIntentRef.current && video.paused) {
          requestPlay()
          return
        }

        pendingSeekRef.current = null
        setIsSeeking(false)
        setIsBuffering(false)
        return
      }
      if (playIntentRef.current && video.paused && !playRequestRef.current) {
        // A transient play() rejection leaves the media paused but no request
        // in flight. Retry when the browser reports that data is available.
        requestPlay()
        return
      }
      if (!video.paused) setIsBuffering(false)
    }
    const handleEnded = () => {
      playIntentRef.current = false
      pendingSeekRef.current = null
      setIsPlaying(false)
      setIsBuffering(false)
      setIsSeeking(false)
      currentTimeRef.current = getFiniteDuration(video) ?? currentTimeRef.current
      setCurrentTimeState(currentTimeRef.current)
    }
    const handleVolumeChangeEvent = () => {
      setVolume(video.volume)
      setIsMuted(video.muted)
    }

    video.addEventListener('play', handlePlay)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('pause', handlePause)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('stalled', handleStalled)
    video.addEventListener('seeking', handleSeeking)
    video.addEventListener('seeked', handleSeeked)
    video.addEventListener('canplay', handleCanPlay)
    video.addEventListener('canplaythrough', handleCanPlay)
    video.addEventListener('durationchange', handleLoadedMetadata)
    video.addEventListener('ended', handleEnded)
    video.addEventListener('volumechange', handleVolumeChangeEvent)

    return () => {
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('stalled', handleStalled)
      video.removeEventListener('seeking', handleSeeking)
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('canplay', handleCanPlay)
      video.removeEventListener('canplaythrough', handleCanPlay)
      video.removeEventListener('durationchange', handleLoadedMetadata)
      video.removeEventListener('ended', handleEnded)
      video.removeEventListener('volumechange', handleVolumeChangeEvent)
    }
  }, [handleLoadedMetadata, requestPlay, resetControlsTimeout, selectedVideo?.id])

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
    const controlsTimeout = controlsTimeoutRef.current

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
      if (controlsTimeout) {
        clearTimeout(controlsTimeout)
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

  const handleRangeStartChange = useCallback((time: number) => {
    setPendingRangeStart(time)
    window.dispatchEvent(new CustomEvent('commentRangeStartChanged', {
      detail: { time, videoId: selectedVideo?.id },
    }))
  }, [selectedVideo?.id])

  const handleRangeEndChange = useCallback((time: number) => {
    setPendingRangeEnd(time)
    window.dispatchEvent(new CustomEvent('commentRangeEndChanged', {
      detail: { time, videoId: selectedVideo?.id },
    }))
  }, [selectedVideo?.id])

  const handleApprove = useCallback(async () => {
    if (activeVideoName) {
      sessionStorage.setItem('approvedVideoName', activeVideoName)
    }
    if (onApprove) {
      await onApprove()
    }
  }, [activeVideoName, onApprove])

  if (!selectedVideo || displayVideos.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        No videos available
      </div>
    )
  }

  const displayLabel = isVideoApproved ? t('approvedVersion') : selectedVideo.versionLabel

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
        aria-busy={isBuffering}
        className={`relative w-full ${
                  fillContainer ? 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col' : 'flex-shrink min-h-0 lg:order-1'
        } ${isPlaying && !showControls ? 'cursor-none' : ''}`}
      >
        {activeHlsUrl || activeVideoUrl ? (
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
                className={`h-full w-full object-contain ${playerSurfaceClassName} ${isDrawingMode ? 'pointer-events-none' : 'cursor-pointer'}`}
                style={playerSurfaceColor ? { backgroundColor: playerSurfaceColor } : undefined}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onDurationChange={handleDurationChange}
                onContextMenu={!isAdmin ? (e) => e.preventDefault() : undefined}
                onClick={isDrawingMode ? undefined : handlePlayPause}
                crossOrigin={videoCrossOrigin || undefined}
                playsInline
                loop={isLooping}
                preload="metadata"
                // @ts-ignore - webkit attributes for iOS
                webkit-playsinline="true"
                x-webkit-airplay="allow"
              />

              {isBuffering && !videoLoadFailed && (
                <div
                  className="pointer-events-none absolute inset-0 z-[15] flex items-center justify-center"
                  role="status"
                  aria-live="polite"
                >
                  <span className="inline-flex items-center justify-center rounded-full bg-black/55 p-3 text-white shadow-lg">
                    <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" />
                    <span className="sr-only">{t('loadingVideo')}</span>
                  </span>
                </div>
              )}

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
                  videoKey={selectedVideo?.id}
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
                    previewVideoUrl={isUsingHls ? null : activeVideoUrl}
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
                    onRangeStartChange={handleRangeStartChange}
                    onRangeEndChange={handleRangeEndChange}
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
          comments={comments}
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
