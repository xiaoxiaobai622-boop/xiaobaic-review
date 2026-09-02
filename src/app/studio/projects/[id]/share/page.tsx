'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import VideoPlayer from '@/components/VideoPlayer'
import CommentSection from '@/components/CommentSection'
import ThumbnailGrid from '@/components/ThumbnailGrid'
import ThumbnailReel from '@/components/ThumbnailReel'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import ThemeToggle from '@/components/ThemeToggle'
import LanguageToggle from '@/components/LanguageToggle'
import ReviewLoginActions from '@/components/ReviewLoginActions'
import SharePhotoSection from '@/components/SharePhotoSection'
import ShareViewToggle, { loadShareViewMode, type ShareViewMode } from '@/components/ShareViewToggle'
import { useTranslations } from 'next-intl'
import VideoReviewStatusSelect from '@/components/VideoReviewStatusSelect'
import { FeishuPushButton } from '@/components/FeishuPushButton'
import { useStorageProvider } from '@/components/StorageConfigProvider'

const MAX_TOKEN_FETCH_ATTEMPTS = 2
const TOKEN_FETCH_RETRY_BASE_MS = 120
const TOKEN_FETCH_RETRY_MAX_MS = 400
const COMMENT_REFRESH_INTERVAL_MS = 30_000

// Approval/review status changes do not change the media source. Keep them
// out of this signature so a status action can update the shell without
// throwing away valid playback tokens and remounting the player.
function getVideoSourceEntries(projectData: any): Map<string, string> {
  const videos = Array.isArray(projectData?.videos) ? projectData.videos : []
  return new Map(videos.map((video: any) => [
    video.id,
    JSON.stringify([
      video.version,
      video.status,
      video.originalStoragePath || '',
      video.hlsPath || '',
      video.preview720Path || '',
      video.preview1080Path || '',
      video.preview2160Path || '',
      video.cleanPreview720Path || '',
      video.cleanPreview1080Path || '',
      video.cleanPreview2160Path || '',
    ]),
  ]))
}

function getVideoThumbnailEntries(projectData: any): Map<string, string> {
  const videos = Array.isArray(projectData?.videos) ? projectData.videos : []
  return new Map(videos.map((video: any) => [video.id, video.thumbnailPath || '']))
}

function getVideoSourceSignature(projectData: any): string {
  return JSON.stringify([...getVideoSourceEntries(projectData).entries()].sort(([a], [b]) => a.localeCompare(b)))
}

function getVideoIdentitySignature(videos: any): string {
  return (Array.isArray(videos) ? videos : [])
    .map((video: any) => `${video.id}:${video.version}`)
    .join('|')
}

function getChangedVideoIds(
  previous: Map<string, string>,
  next: Map<string, string>,
): Set<string> {
  const changed = new Set<string>()
  const ids = new Set([...previous.keys(), ...next.keys()])
  for (const id of ids) {
    if (previous.get(id) !== next.get(id)) changed.add(id)
  }
  return changed
}

function canUserManageApproval(user: any, project: any) {
  if (!user || !project) return false
  if (project.createdById === user.id) return true

  return user.teams?.some((membership: any) =>
    membership.team?.id === project.teamId &&
    (membership.role === 'OWNER' || membership.role === 'ADMIN')
  ) === true
}

type TokenFetchTelemetryEvent = 'first-attempt-failure' | 'retry-success' | 'retry-failure'

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      await mapper(items[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, () => worker())
  )
}

export default function AdminSharePage() {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const id = params?.id as string
  const storageProvider = useStorageProvider()
  const supportsHls = storageProvider === 's3'
  // Keep the query used for an authorization redirect from making the
  // heavyweight project request rerun whenever the selected video changes.
  const initialQueryRef = useRef<string | null>(null)
  if (initialQueryRef.current === null) {
    initialQueryRef.current = searchParams?.toString() || ''
  }

  // Parse URL parameters for video seeking (same as public share page)
  const urlTimestamp = searchParams?.get('t') ? parseFloat(searchParams.get('t')!) : null
  const urlVideoName = searchParams?.get('video') || null
  const urlVersion = searchParams?.get('version') ? parseInt(searchParams.get('version')!, 10) : null
  const urlFocusCommentId = searchParams?.get('comment') || null

  const [focusCommentId, setFocusCommentId] = useState<string | null>(urlFocusCommentId)
  const [project, setProject] = useState<any>(null)
  const [comments, setComments] = useState<any[]>([])
  const [_commentsLoading, setCommentsLoading] = useState(false)
  const commentsRequestRef = useRef<Promise<void> | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ShareViewMode>('grid')
  const [albumCount, setAlbumCount] = useState(0)

  useEffect(() => { setViewMode(loadShareViewMode()) }, [])
  const [defaultQuality, setDefaultQuality] = useState<'720p' | '1080p' | '2160p'>('720p')
  const [activeVideoName, setActiveVideoName] = useState<string>('')
  const [activeVideos, setActiveVideos] = useState<any[]>([])
  const [activeVideosRaw, setActiveVideosRaw] = useState<any[]>([])
  const [activeVideoState, setActiveVideoState] = useState<{
    selectedVideo: any
    isVideoApproved: boolean
  } | null>(null)
  const [tokensLoading, setTokensLoading] = useState(() => Boolean(urlVideoName))
  const [initialSeekTime, setInitialSeekTime] = useState<number | null>(null)
  const [initialVideoIndex, setInitialVideoIndex] = useState<number>(0)
  const [adminUser, setAdminUser] = useState<any>(null)
  const [hideComments, setHideComments] = useState(false)
  const [viewState, setViewState] = useState<'grid' | 'player'>('grid')
  const [thumbnailsByName, setThumbnailsByName] = useState<Map<string, string>>(new Map())
  const [thumbnailsLoading, setThumbnailsLoading] = useState(true)
  const tokenCacheRef = useRef<Map<string, any>>(new Map())
  const thumbnailUrlsRef = useRef<Map<string, string>>(new Map())
  // Stable per-project session id so tokens are reused across mounts
  // (server cache key is `video_token_cache:${sessionId}:${videoId}:${quality}`).
  const [sessionId] = useState<string>(() => `admin:${id}`)
  const sessionIdRef = useRef<string>(sessionId)
  const inFlightTokenRequestsRef = useRef<Map<string, { promise: Promise<string>; signal?: AbortSignal }>>(new Map())
  const tokenFetchTelemetryRef = useRef({
    firstAttemptFailures: 0,
    retrySuccesses: 0,
    retryFailures: 0,
  })

  const emitTokenFetchTelemetry = useCallback((
    event: TokenFetchTelemetryEvent,
    meta: { videoId: string; quality: string; attempts: number }
  ) => {
    const counters = tokenFetchTelemetryRef.current
    if (event === 'first-attempt-failure') counters.firstAttemptFailures += 1
    if (event === 'retry-success') counters.retrySuccesses += 1
    if (event === 'retry-failure') counters.retryFailures += 1

    const detail = {
      event,
      ...meta,
      counters: { ...counters },
      timestamp: Date.now(),
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('adminShareTokenFetchTelemetry', { detail }))
    }

    if (process.env.NODE_ENV !== 'production') {
      console.debug('admin-share-token-fetch', detail)
    }
  }, [])

  const waitForTokenRetry = useCallback(async (attempt: number) => {
    const exponentialDelay = Math.min(
      TOKEN_FETCH_RETRY_MAX_MS,
      TOKEN_FETCH_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1))
    )
    const jitterMs = Math.floor(Math.random() * 40)
    await new Promise((resolve) => setTimeout(resolve, exponentialDelay + jitterMs))
  }, [])

  const fetchAdminVideoToken = useCallback(async (
    videoId: string,
    quality: string,
    sessionId: string,
    signal?: AbortSignal,
  ) => {
    const response = await apiFetch(
      `/api/studio/video-token?videoId=${videoId}&projectId=${id}&quality=${quality}&sessionId=${sessionId}`,
      { cache: 'no-store', signal }
    )

    if (!response.ok) return ''
    const data = await response.json()
    return data.token || ''
  }, [id])

  const fetchAdminVideoTokenWithRetry = useCallback(async (
    videoId: string,
    quality: string,
    sessionId: string,
    signal?: AbortSignal,
  ) => {
    const requestKey = `${sessionId}:${videoId}:${quality}`
    const inFlight = inFlightTokenRequestsRef.current.get(requestKey)
    if (inFlight && !inFlight.signal?.aborted) return inFlight.promise
    if (inFlight) inFlightTokenRequestsRef.current.delete(requestKey)

    const requestPromise = (async () => {
      for (let attempt = 1; attempt <= MAX_TOKEN_FETCH_ATTEMPTS; attempt += 1) {
        if (signal?.aborted) return ''
        const tokenValue = await fetchAdminVideoToken(videoId, quality, sessionId, signal)
        if (tokenValue) {
          if (attempt > 1) {
            emitTokenFetchTelemetry('retry-success', { videoId, quality, attempts: attempt })
          }
          return tokenValue
        }

        if (attempt === 1) {
          emitTokenFetchTelemetry('first-attempt-failure', { videoId, quality, attempts: attempt })
          await waitForTokenRetry(attempt)
        }
      }

      emitTokenFetchTelemetry('retry-failure', {
        videoId,
        quality,
        attempts: MAX_TOKEN_FETCH_ATTEMPTS,
      })
      return ''
    })().finally(() => {
      if (inFlightTokenRequestsRef.current.get(requestKey)?.promise === requestPromise) {
        inFlightTokenRequestsRef.current.delete(requestKey)
      }
    })

    inFlightTokenRequestsRef.current.set(requestKey, { promise: requestPromise, signal })
    return requestPromise
  }, [
    emitTokenFetchTelemetry,
    fetchAdminVideoToken,
    waitForTokenRetry,
  ])

  // Fetch comments separately for security (same pattern as public share)
  const fetchComments = useCallback(async () => {
    if (!id) return

    if (commentsRequestRef.current) return commentsRequestRef.current

    const request = (async () => {
      setCommentsLoading(true)
      try {
        const response = await apiFetch(`/api/comments?projectId=${id}`, { cache: 'no-store' })
        if (response.ok) {
          const commentsData = await response.json()
          if (Array.isArray(commentsData)) setComments(commentsData)
        }
      } catch {
        // Keep showing the last known comments when a refresh fails.
      } finally {
        setCommentsLoading(false)
      }
    })()

    commentsRequestRef.current = request
    try {
      await request
    } finally {
      if (commentsRequestRef.current === request) commentsRequestRef.current = null
    }
  }, [id])

  // The initial project response already contains a sanitized comment tree.
  // Keep the review shell current at a low rate when another reviewer changes
  // comments, without coupling refreshes to the currently selected video.
  useEffect(() => {
    if (!project || project.hideFeedback) return

    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void fetchComments()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshIfVisible()
    }
    const interval = window.setInterval(refreshIfVisible, COMMENT_REFRESH_INTERVAL_MS)

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', refreshIfVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', refreshIfVisible)
    }
  }, [fetchComments, project])

  // Listen for comment updates emitted by the composer. The page owns all
  // network refreshes; CommentSection only receives the updated prop tree.
  useEffect(() => {
    const belongsToProject = (event: CustomEvent) => {
      const eventProjectId = event.detail?.projectId
      return !eventProjectId || eventProjectId === id
    }

    const handleCommentPosted = (e: CustomEvent) => {
      if (!belongsToProject(e)) return
      if (Array.isArray(e.detail?.comments)) {
        setComments(e.detail.comments)
      } else {
        void fetchComments()
      }
    }

    const handleCommentDeleted = (e: CustomEvent) => {
      if (belongsToProject(e)) void fetchComments()
    }

    window.addEventListener('commentPosted', handleCommentPosted as EventListener)
    window.addEventListener('commentDeleted', handleCommentDeleted as EventListener)

    return () => {
      window.removeEventListener('commentPosted', handleCommentPosted as EventListener)
      window.removeEventListener('commentDeleted', handleCommentDeleted as EventListener)
    }
  }, [fetchComments, id])

  const transformProjectData = (projectData: any) => {
    const videosByName = projectData.videos.reduce((acc: any, video: any) => {
      const name = video.name
      if (!acc[name]) {
        acc[name] = []
      }
      acc[name].push(video)
      return acc
    }, {})

    // Sort versions within each video name (newest first)
    Object.keys(videosByName).forEach(name => {
      videosByName[name].sort((a: any, b: any) => b.version - a.version)
    })

    return {
      ...projectData,
      videosByName
    }
  }

  const refreshProject = useCallback(async () => {
    const response = await apiFetch(`/api/projects/${id}?includeComments=false`, { cache: 'no-store' })
    if (!response.ok) return
    const projectData = transformProjectData(await response.json())
    const previousSources = getVideoSourceEntries(project)
    const nextSources = getVideoSourceEntries(projectData)
    const sourceChanged = getVideoSourceSignature(project) !== getVideoSourceSignature(projectData)
    const changedSourceIds = sourceChanged ? getChangedVideoIds(previousSources, nextSources) : new Set<string>()
    const previousThumbnails = getVideoThumbnailEntries(project)
    const nextThumbnails = getVideoThumbnailEntries(projectData)
    const changedThumbnailIds = getChangedVideoIds(previousThumbnails, nextThumbnails)

    if (sourceChanged || changedThumbnailIds.size > 0) {

      // Preserve tokens for unchanged videos, especially the one currently
      // playing. Only invalidate entries whose source disappeared/changed.
      for (const [cacheKey, tokenizedVideo] of tokenCacheRef.current.entries()) {
        const videoId = tokenizedVideo?.id
        if (!videoId || changedSourceIds.has(videoId) || !nextSources.has(videoId)) {
          tokenCacheRef.current.delete(cacheKey)
        }
      }

      for (const videoId of new Set([...changedSourceIds, ...changedThumbnailIds])) {
        thumbnailUrlsRef.current.delete(videoId)
      }
    }
    setProject(projectData)
    if (activeVideoName && projectData.videosByName[activeVideoName]) {
      const nextVideos = projectData.videosByName[activeVideoName]
      const currentIds = getVideoIdentitySignature(activeVideosRaw)
      const nextIds = getVideoIdentitySignature(nextVideos)

      // Keep the existing tokenized objects when only approval/review metadata
      // changed. This prevents the media element from being torn down after a
      // status click; a real source/catalog change still re-runs tokenization.
      if (sourceChanged || currentIds !== nextIds) {
        setActiveVideosRaw(nextVideos)
      }

      if (currentIds === nextIds) {
        setActiveVideos((currentVideos) => currentVideos.map((video: any) => {
          const nextVideo = nextVideos.find((candidate: any) => candidate.id === video.id)
          if (!nextVideo) return video
          return {
            ...video,
            ...nextVideo,
            // Project metadata carries empty token fields. Preserve the
            // already-issued URLs so status updates never reset the source.
            streamUrl720p: video.streamUrl720p || nextVideo.streamUrl720p || '',
            streamUrl1080p: video.streamUrl1080p || nextVideo.streamUrl1080p || '',
            streamUrl2160p: video.streamUrl2160p || nextVideo.streamUrl2160p || '',
            hlsUrl720p: supportsHls ? (video.hlsUrl720p || nextVideo.hlsUrl720p || '') : '',
            thumbnailUrl: video.thumbnailUrl || nextVideo.thumbnailUrl || null,
          }
        }))
      }
    }
  }, [activeVideoName, activeVideosRaw, id, project, supportsHls])

  const fetchTokensForVideos = useCallback(async (
    videos: any[],
    concurrency = 2,
    signal?: AbortSignal,
  ) => {
    const sessionId = sessionIdRef.current
    const tokenizedById = new Map<string, any>()

    await mapWithConcurrency(videos, concurrency, async (video: any) => {
      if (signal?.aborted) return
      // Non-ready assets cannot be played. Avoid spending one or more token
      // requests on them while retaining the raw record for the status UI.
      if (video.status !== 'READY') {
        tokenizedById.set(video.id, video)
        return
      }

      const cacheKey = `${sessionId}:${video.id}:${defaultQuality}`
      const cached = tokenCacheRef.current.get(cacheKey)
      // In S3 mode HLS is the primary playback path. Do not reuse a partial
      // MP4-only result from a transient HLS token failure, otherwise the
      // player can silently remain on the progressive fallback for the rest
      // of the session.
      if (cached && (!supportsHls || cached.hlsUrl720p)) {
        tokenizedById.set(video.id, cached)
        return
      }
      if (cached) tokenCacheRef.current.delete(cacheKey)

      try {
        const qualityOrder: Array<'720p' | '1080p' | '2160p'> = defaultQuality === '2160p'
          ? ['2160p', '1080p', '720p']
          : defaultQuality === '1080p'
            ? ['1080p', '720p', '2160p']
            : ['720p', '1080p', '2160p']
        const streamTokens: Record<'720p' | '1080p' | '2160p', string> = {
          '720p': '',
          '1080p': '',
          '2160p': '',
        }

        // HLS and the preferred progressive rendition are independent. Start
        // both together, then probe lower renditions only when needed.
        const hasHls = Boolean(video.hlsPath)
        const hasProgressivePlayback = !hasHls || Boolean(
          video.preview2160Path ||
          video.preview1080Path ||
          video.preview720Path ||
          video.cleanPreview2160Path ||
          video.cleanPreview1080Path ||
          video.cleanPreview720Path,
        )
        const [tokenHls, preferredToken] = await Promise.all([
          supportsHls && hasHls ? fetchAdminVideoTokenWithRetry(video.id, 'hls', sessionId, signal) : Promise.resolve(''),
          hasProgressivePlayback
            ? fetchAdminVideoTokenWithRetry(video.id, qualityOrder[0], sessionId, signal)
            : Promise.resolve(''),
        ])
        if (signal?.aborted) return
        streamTokens[qualityOrder[0]] = preferredToken

        if (!preferredToken && hasProgressivePlayback) {
          for (const quality of qualityOrder.slice(1)) {
            if (signal?.aborted) return
            const streamToken = await fetchAdminVideoTokenWithRetry(video.id, quality, sessionId, signal)
            streamTokens[quality] = streamToken
            if (streamToken) break
          }
        }

        const tokenized = {
          ...video,
          streamUrl720p: streamTokens['720p'] ? `/api/content/${streamTokens['720p']}` : '',
          hlsUrl720p: tokenHls ? `/api/content/${tokenHls}` : '',
          streamUrl1080p: streamTokens['1080p'] ? `/api/content/${streamTokens['1080p']}` : '',
          streamUrl2160p: streamTokens['2160p'] ? `/api/content/${streamTokens['2160p']}` : '',
          // Downloads and thumbnails are requested independently when the
          // corresponding UI needs them; they should not delay playback.
          downloadUrl: null,
          thumbnailUrl: null,
        }

        const hasCacheablePlayback = supportsHls
          ? Boolean(tokenized.hlsUrl720p)
          : Boolean(tokenized.streamUrl720p || tokenized.streamUrl1080p || tokenized.streamUrl2160p)
        if (hasCacheablePlayback) {
          tokenCacheRef.current.set(cacheKey, tokenized)
        }
        tokenizedById.set(video.id, tokenized)
      } catch (error) {
        tokenizedById.set(video.id, video)
      }
    })

    return videos.map((video: any) => tokenizedById.get(video.id) || video)
  }, [defaultQuality, fetchAdminVideoTokenWithRetry, supportsHls])

  // Load project data, settings, and admin user
  useEffect(() => {
    let isMounted = true

    async function loadProject() {
      let redirectingMember = false
      if (!id) {
        setLoading(false)
        return
      }
      try {
        // Fetch only data needed to authorize and render the review page.
        const [projectResponse, userResponse] = await Promise.all([
          apiFetch(`/api/projects/${id}?includeComments=false`, { cache: 'no-store' }),
          apiFetch('/api/auth/session', { cache: 'no-store' }),
        ])

        if (!isMounted) return

        if (projectResponse.ok) {
          const projectData = await projectResponse.json()

          if (userResponse.ok) {
            const userData = await userResponse.json()
            if (!canUserManageApproval(userData.user, projectData) && projectData.slug) {
              redirectingMember = true
              const query = initialQueryRef.current
              router.replace(`/share/${projectData.slug}${query ? `?${query}` : ''}`)
              return
            }
            setAdminUser(userData.user)
          }

          if (isMounted) {
            const transformedData = transformProjectData(projectData)
            setProject(transformedData)

            // Use the project's configured preview quality for playback.
            setDefaultQuality(projectData.previewResolution || '720p')
            // The project response contains video/project metadata only.
            // Load the comment tree separately so a large
            // history cannot delay the project/video shell.
            setComments([])
            if (!projectData.hideFeedback) void fetchComments()
          }
        }
      } catch (error) {
        // Silent fail
      } finally {
        if (isMounted && !redirectingMember) {
          setLoading(false)
        }
      }
    }

    loadProject()

    return () => {
      isMounted = false
    }
  }, [fetchComments, id, router])

  // Set active video when project loads, handling URL parameters
  useEffect(() => {
    if (project?.videosByName) {
      const videoNames = Object.keys(project.videosByName)
      if (videoNames.length === 0) return

      if (!activeVideoName) {
        let videoNameToUse: string | null = null

        if (urlVideoName && project.videosByName[urlVideoName]) {
          videoNameToUse = urlVideoName
        } else {
          const savedVideoName = sessionStorage.getItem('approvedVideoName')
          if (savedVideoName) {
            sessionStorage.removeItem('approvedVideoName')
            if (project.videosByName[savedVideoName]) {
              videoNameToUse = savedVideoName
            }
          }
        }

        if (!videoNameToUse) {
          const sortedVideoNames = videoNames.sort((nameA, nameB) => {
            const hasApprovedA = project.videosByName[nameA].some((v: any) => v.approved)
            const hasApprovedB = project.videosByName[nameB].some((v: any) => v.approved)

            if (hasApprovedA !== hasApprovedB) {
              return hasApprovedA ? 1 : -1
            }
            return 0
          })
          videoNameToUse = sortedVideoNames[0]
        }

        setActiveVideoName(videoNameToUse)

        const videos = project.videosByName[videoNameToUse]
        setActiveVideosRaw(videos)

        if (urlVersion !== null && videos) {
          const targetIndex = videos.findIndex((v: any) => v.version === urlVersion)
          setInitialVideoIndex(targetIndex >= 0 ? targetIndex : 0)
        }

        if (urlTimestamp !== null) {
          setInitialSeekTime(urlTimestamp)
        }
      } else {
        const videos = project.videosByName[activeVideoName]
        if (videos) {
          // Refreshes often replace the project object while leaving the
          // version catalog unchanged. Preserve the raw array identity in
          // that case so token hydration and the media element stay alive.
          if (getVideoIdentitySignature(activeVideosRaw) !== getVideoIdentitySignature(videos)) {
            setActiveVideosRaw(videos)
          }
          if (urlVersion !== null) {
            const targetIndex = videos.findIndex((v: any) => v.version === urlVersion)
            setInitialVideoIndex(targetIndex >= 0 ? targetIndex : 0)
          } else {
            setInitialVideoIndex(0)
          }
        }
      }
    }
  }, [project, activeVideoName, activeVideosRaw, urlVideoName, urlVersion, urlTimestamp])

  // Tokenize active videos lazily
  useEffect(() => {
    let isMounted = true
    const controller = new AbortController()

    async function loadTokens() {
      if (viewState !== 'player') {
        setActiveVideos([])
        setTokensLoading(false)
        return
      }
      if (!activeVideosRaw || activeVideosRaw.length === 0) {
        setTokensLoading(false)
        return
      }
      setTokensLoading(true)

      // Put the requested version first. It is the only version needed for
      // the first paint; the remaining versions can be hydrated in the
      // background without creating a request burst.
      const priorityIndex = Math.max(0, Math.min(initialVideoIndex, activeVideosRaw.length - 1))
      const priorityVideo = activeVideosRaw[priorityIndex]
      const remainingVideos = activeVideosRaw.filter((_, index) => index !== priorityIndex)
      const priorityTokenized = await fetchTokensForVideos([priorityVideo], 1, controller.signal)

      if (!isMounted || controller.signal.aborted) return
      const initialVideos = activeVideosRaw.map((video: any) => (
        video.id === priorityVideo.id ? priorityTokenized[0] : video
      ))
      setActiveVideos(initialVideos)
      setTokensLoading(false)

      if (remainingVideos.length === 0) return

      // Let the selected video's first media request settle before opening a
      // burst of background token requests for older versions.
      await new Promise((resolve) => window.setTimeout(resolve, 500))
      if (!isMounted || controller.signal.aborted) return
      const remainingTokenized = await fetchTokensForVideos(remainingVideos, 2, controller.signal)
      if (!isMounted || controller.signal.aborted) return
      const hydratedById = new Map(remainingTokenized.map((video: any) => [video.id, video]))
      setActiveVideos((currentVideos) => currentVideos.map((video: any) => hydratedById.get(video.id) || video))
    }

    loadTokens().catch(() => {
      // Aborted token requests are expected when a viewer clicks through videos quickly.
    })

    return () => {
      isMounted = false
      controller.abort()
    }
  }, [activeVideosRaw, fetchTokensForVideos, initialVideoIndex, viewState])

  // Fetch thumbnails independently from playback tokens. A small concurrency
  // limit and progressive state updates keep the grid responsive while the
  // remaining groups continue loading in the background.
  useEffect(() => {
    let isMounted = true
    const sessionId = sessionIdRef.current

    async function fetchThumbnails() {
      if (!project?.videosByName || !id) {
        if (isMounted) setThumbnailsLoading(false)
        return
      }

      const groups = Object.entries(project.videosByName as Record<string, any[]>)
        .sort(([nameA], [nameB]) => {
          if (nameA === activeVideoName) return -1
          if (nameB === activeVideoName) return 1
          return nameA.localeCompare(nameB, undefined, { numeric: true })
        })
      const newThumbnails = new Map<string, string>()
      let pendingGroups = 0

      for (const [name, videos] of groups) {
        const videoWithThumb = videos.find((v: any) => v.thumbnailPath)
        if (!videoWithThumb) continue
        const cachedUrl = thumbnailUrlsRef.current.get(videoWithThumb.id)
        if (cachedUrl) {
          newThumbnails.set(name, cachedUrl)
        } else {
          pendingGroups += 1
        }
      }

      if (isMounted) {
        setThumbnailsByName(new Map(newThumbnails))
        setThumbnailsLoading(pendingGroups > 0)
      }

      try {
        const thumbnailConcurrency = viewState === 'player' ? 2 : 4
        await mapWithConcurrency(groups, thumbnailConcurrency, async ([name, videos]) => {
          const videoWithThumb = videos.find((v: any) => v.thumbnailPath)
          if (!videoWithThumb || thumbnailUrlsRef.current.has(videoWithThumb.id)) return

          const thumbToken = await fetchAdminVideoTokenWithRetry(videoWithThumb.id, 'thumbnail', sessionId)
          if (!thumbToken || !isMounted) return

          const thumbnailUrl = `/api/content/${thumbToken}`
          thumbnailUrlsRef.current.set(videoWithThumb.id, thumbnailUrl)
          newThumbnails.set(name, thumbnailUrl)
          setThumbnailsByName(new Map(newThumbnails))
        })
      } catch (error) {
        // Failed to load thumbnails
      } finally {
        if (isMounted) {
          setThumbnailsLoading(false)
        }
      }
    }

    fetchThumbnails()

    return () => {
      isMounted = false
    }
  }, [project?.videosByName, id, activeVideoName, fetchAdminVideoTokenWithRetry, viewState])

  // The thumbnail request is intentionally independent from playback token
  // generation. Merge it into already-tokenized versions once it arrives so a
  // late poster load never forces the player to remount.
  useEffect(() => {
    const thumbnailUrl = thumbnailsByName.get(activeVideoName)
    if (!thumbnailUrl || activeVideos.length === 0) return

    setActiveVideos((currentVideos) => {
      let changed = false
      const nextVideos = currentVideos.map((video: any) => {
        if (video.thumbnailUrl === thumbnailUrl) return video
        changed = true
        return { ...video, thumbnailUrl }
      })
      return changed ? nextVideos : currentVideos
    })
  }, [activeVideoName, activeVideos, thumbnailsByName])

  // Determine initial view state based on URL params (same behavior as public share)
  useEffect(() => {
    if (!project?.videosByName) return

    if (urlVideoName && project.videosByName[urlVideoName]) {
      setViewState('player')
      return
    }

    setViewState('grid')
  }, [project?.videosByName, urlVideoName])

  const navigateToVideo = useCallback((videoName: string, historyMode: 'push' | 'replace') => {
    setActiveVideoName(videoName)
    setActiveVideosRaw(project.videosByName[videoName])
    // Remove the old source before the next token arrives. This makes rapid
    // navigation latest-wins instead of allowing stale HLS errors to update
    // the newly selected video's player state.
    setActiveVideos([])
    setTokensLoading(true)
    setInitialVideoIndex(0)
    setActiveVideoState(null)
    setViewState('player')

    const params = new URLSearchParams(searchParams?.toString() || '')
    params.set('video', videoName)
    params.delete('version')
    params.delete('t')
    params.delete('comment')
    router[historyMode](`${pathname}?${params.toString()}`, { scroll: false })
  }, [project?.videosByName, searchParams, pathname, router])

  // Reel switches stay in the current history entry; opening from the grid
  // keeps the grid as the single return destination.
  const handleVideoSelect = useCallback((videoName: string) => {
    navigateToVideo(videoName, 'replace')
  }, [navigateToVideo])

  const handleGridVideoSelect = useCallback((videoName: string) => {
    navigateToVideo(videoName, 'push')
  }, [navigateToVideo])

  const projectUrl = `/studio/projects/${id}`

  const handleReturnToSource = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }

    router.push(projectUrl)
  }, [projectUrl, router])

  // Show loading state
  if (loading) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center">
        <p className="text-muted-foreground">{tc('loading')}</p>
      </div>
    )
  }

  // Show project not found
  if (!project) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center p-4">
        <Card className="bg-card">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">{t('projectNotFound')}</p>
            <Link href="/studio/projects">
              <Button>
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t('backToProjects')}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Filter to READY videos
  let readyVideos = activeVideos.filter((v: any) => v.status === 'READY')

  const activeVideoIds = new Set(activeVideos.map((v: any) => v.id))
  const filteredComments = comments.filter((comment: any) => {
    return !comment.videoId || activeVideoIds.has(comment.videoId)
  })

  const clientDisplayName = (() => {
    const primaryRecipient = project.recipients?.find((r: any) => r.isPrimary) || project.recipients?.[0]
    return project.companyName || primaryRecipient?.name || primaryRecipient?.email || t('client')
  })()

  const showCommentPanel = !project.hideFeedback
  const canManageApproval = canUserManageApproval(adminUser, project)
  const isAdmin = adminUser?.role === 'ADMIN' || adminUser?.role === 'SUPER_ADMIN'
  const orderedVideoNames = Object.keys(project.videosByName).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  )
  const activeVideoPosition = orderedVideoNames.indexOf(activeVideoName)
  const previousVideoName = activeVideoPosition > 0
    ? orderedVideoNames[activeVideoPosition - 1]
    : null
  const nextVideoName = activeVideoPosition >= 0 && activeVideoPosition < orderedVideoNames.length - 1
    ? orderedVideoNames[activeVideoPosition + 1]
    : null

  // Show thumbnail grid when in grid view (same as public share layout)
  if (viewState === 'grid') {
    return (
      <div className="fixed inset-0 bg-background flex flex-col overflow-hidden">
        {/* Grid view toolbar */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-background/95 backdrop-blur-sm z-20 flex-shrink-0">
          {/* Left: back to project */}
          {canManageApproval && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={handleReturnToSource}
              title={tc('back')}
              aria-label={tc('back')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}

          {/* Right: view toggle + theme */}
          <div className="flex items-center gap-2 ml-auto">
            <ShareViewToggle viewMode={viewMode} onChange={setViewMode} />
            <LanguageToggle />
            <ThemeToggle />
            <ReviewLoginActions compact />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
            <ThumbnailGrid
              videosByName={project.videosByName}
              thumbnailsByName={thumbnailsByName}
              thumbnailsLoading={thumbnailsLoading}
              onVideoSelect={handleGridVideoSelect}
              projectTitle={project.title}
              projectDescription={project.description}
              clientName={clientDisplayName}
              viewMode={viewMode}
              albumCount={albumCount}
            />
            <SharePhotoSection
              projectId={id}
              allowPhotoDownload={project.allowPhotoDownload ?? true}
              viewMode={viewMode}
              onAlbumCount={setAlbumCount}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen lg:fixed lg:inset-0 bg-background flex flex-col lg:overflow-hidden">
      {/* Thumbnail Reel - always visible, collapsible */}
      <ThumbnailReel
        videosByName={project.videosByName}
        thumbnailsByName={thumbnailsByName}
        activeVideoName={activeVideoName}
        onVideoSelect={handleVideoSelect}
        onBackToGrid={handleReturnToSource}
        showBackButton={true}
        backButtonLabel={tc('back')}
        showLanguageToggle={true}
        showComparisonAction={canManageApproval}
        showCommentToggle={!project.hideFeedback}
        isCommentPanelVisible={!hideComments}
        onToggleCommentPanel={() => setHideComments(!hideComments)}
        beforeToolbarAction={canManageApproval ? (
          <div className="flex items-center gap-2">
            <VideoReviewStatusSelect
              projectId={project.id}
              video={activeVideoState?.selectedVideo || null}
              onUpdated={refreshProject}
              className="h-8"
            />
            {activeVideoState?.selectedVideo && isAdmin && (
              <FeishuPushButton
                projectId={project.id}
                videoId={activeVideoState.selectedVideo.id}
                size="sm"
              />
            )}
          </div>
        ) : undefined}
        trailingAction={<ReviewLoginActions compact />}
      />
      {/* Main Content Area - scrollable on mobile, fixed on desktop (xl breakpoint for better vertical video support) */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 sm:p-3 lg:flex-row lg:gap-0 lg:p-0">
        {readyVideos.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-4">
            <Card className="bg-card">
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  {tokensLoading ? t('loadingVideo') : t('noVideosReadyForReview')}
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            {/* Video Player - natural height on mobile, fills space on desktop */}
            <div className={`flex min-w-0 flex-col rounded-[6px] bg-muted/80 lg:h-full lg:min-h-0 lg:flex-1 lg:p-3 lg:pb-[11.5px] ${showCommentPanel ? 'lg:flex-[2] 2xl:flex-[2.5]' : ''}`}>
              <VideoPlayer
                videos={readyVideos}
                projectId={project.id}
                projectStatus={project.status}
                defaultQuality={defaultQuality}
                projectTitle={project.title}
                projectDescription={project.description}
                clientName={project.clientName}
                isPasswordProtected={!!project.sharePassword}
                watermarkEnabled={project.watermarkEnabled}
                activeVideoName={activeVideoName}
                initialSeekTime={initialSeekTime}
                initialVideoIndex={initialVideoIndex}
                followLatestVersion={urlVersion === null}
                isAdmin={canManageApproval}
                isGuest={false}
                allowAssetDownload={project.allowAssetDownload}
                shareToken={null}
                onApprove={canManageApproval ? refreshProject : undefined}
                onVideoStateChange={setActiveVideoState}
                hideDownloadButton={true}
                hideApprovalAction={true}
                allowComparison={canManageApproval}
                onPreviousVideo={previousVideoName ? () => handleVideoSelect(previousVideoName) : undefined}
                onNextVideo={nextVideoName ? () => handleVideoSelect(nextVideoName) : undefined}
                hasPreviousVideo={Boolean(previousVideoName)}
                hasNextVideo={Boolean(nextVideoName)}
                comments={!project.hideFeedback ? filteredComments : []}
                timestampDisplayMode="AUTO"
                onCommentFocus={(commentId) => setFocusCommentId(commentId)}
                fillContainer={true}
                playerSurfaceClassName="bg-card"
                playerSurfaceColor="hsl(var(--card))"
                playerFrameClassName="ring-1 ring-inset ring-border/70"
                controlsSurfaceClassName="bg-card"
              />
              <div id="review-comment-composer" className="lg:mt-auto" />
            </div>

            {/* Comments Section - max one screen height on mobile, side panel on desktop */}
            {showCommentPanel && (
              <div className="flex max-h-[calc(100vh-56px)] flex-col overflow-hidden bg-card lg:max-h-full lg:w-[360px] lg:flex-none">
                <div aria-hidden="true" className="hidden h-3 shrink-0 bg-muted/80 lg:block" />
                <CommentSection
                  projectId={project.id}
                  projectSlug={project.slug}
                  comments={filteredComments}
                  focusCommentId={focusCommentId}
                  clientName={clientDisplayName}
                  clientEmail={project.recipients?.[0]?.email}
                  isApproved={project.status === 'APPROVED'}
                  restrictToLatestVersion={project.restrictCommentsToLatestVersion}
                  videos={readyVideos}
                  isAdminView={true}
                  smtpConfigured={project.smtpConfigured}
                  isPasswordProtected={!!project.sharePassword}
                  adminUser={adminUser}
                  recipients={project.recipients || []}
                  shareToken={null}
                  showShortcutsButton={true}
                  timestampDisplayMode="AUTO"
                  mobileCollapsible={true}
                  initialMobileCollapsed={true}
                  onToggleVisibility={() => setHideComments(!hideComments)}
                  showToggleButton={false}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
