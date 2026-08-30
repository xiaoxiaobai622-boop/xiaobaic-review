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

const MAX_TOKEN_FETCH_ATTEMPTS = 2
const TOKEN_FETCH_RETRY_BASE_MS = 120
const TOKEN_FETCH_RETRY_MAX_MS = 400

function canUserManageApproval(user: any, project: any) {
  if (!user || !project) return false
  if (project.createdById === user.id) return true

  return user.teams?.some((membership: any) =>
    membership.team?.id === project.teamId &&
    (membership.role === 'OWNER' || membership.role === 'ADMIN')
  ) === true
}

type TokenFetchTelemetryEvent = 'first-attempt-failure' | 'retry-success' | 'retry-failure'

export default function AdminSharePage() {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const id = params?.id as string

  // Parse URL parameters for video seeking (same as public share page)
  const urlTimestamp = searchParams?.get('t') ? parseFloat(searchParams.get('t')!) : null
  const urlVideoName = searchParams?.get('video') || null
  const urlVersion = searchParams?.get('version') ? parseInt(searchParams.get('version')!, 10) : null
  const urlFocusCommentId = searchParams?.get('comment') || null

  const [focusCommentId, setFocusCommentId] = useState<string | null>(urlFocusCommentId)
  const [project, setProject] = useState<any>(null)
  const [comments, setComments] = useState<any[]>([])
  const [_commentsLoading, setCommentsLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [_companyName, setCompanyName] = useState('Studio')
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
  // Stable per-project session id so tokens are reused across mounts
  // (server cache key is `video_token_cache:${sessionId}:${videoId}:${quality}`).
  const [sessionId] = useState<string>(() => `admin:${id}`)
  const sessionIdRef = useRef<string>(sessionId)
  const inFlightTokenRequestsRef = useRef<Map<string, Promise<string>>>(new Map())
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

  const fetchAdminVideoToken = useCallback(async (videoId: string, quality: string, sessionId: string) => {
    const response = await apiFetch(
      `/api/studio/video-token?videoId=${videoId}&projectId=${id}&quality=${quality}&sessionId=${sessionId}`,
      { cache: 'no-store' }
    )

    if (!response.ok) return ''
    const data = await response.json()
    return data.token || ''
  }, [id])

  const fetchAdminVideoTokenWithRetry = useCallback(async (videoId: string, quality: string, sessionId: string) => {
    const requestKey = `${sessionId}:${videoId}:${quality}`
    const inFlight = inFlightTokenRequestsRef.current.get(requestKey)
    if (inFlight) {
      return inFlight
    }

    const requestPromise = (async () => {
      for (let attempt = 1; attempt <= MAX_TOKEN_FETCH_ATTEMPTS; attempt += 1) {
        const tokenValue = await fetchAdminVideoToken(videoId, quality, sessionId)
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
      inFlightTokenRequestsRef.current.delete(requestKey)
    })

    inFlightTokenRequestsRef.current.set(requestKey, requestPromise)
    return requestPromise
  }, [
    emitTokenFetchTelemetry,
    fetchAdminVideoToken,
    waitForTokenRetry,
  ])

  // Fetch comments separately for security (same pattern as public share)
  const fetchComments = useCallback(async () => {
    if (!id) return

    setCommentsLoading(true)
    try {
      const response = await apiFetch(`/api/comments?projectId=${id}`, { cache: 'no-store' })
      if (response.ok) {
        const commentsData = await response.json()
        setComments(commentsData)
      }
    } catch (error) {
      // Failed to load comments
    } finally {
      setCommentsLoading(false)
    }
  }, [id])

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
      videosByName[name].sort((a: any, b: any) => {
        const versionA = parseInt(a.versionLabel.replace('v', ''), 10)
        const versionB = parseInt(b.versionLabel.replace('v', ''), 10)
        return versionB - versionA
      })
    })

    return {
      ...projectData,
      videosByName,
    }
  }

  const refreshProject = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/studio/projects/${id}`, { cache: 'no-store' })
      if (response.ok) {
        const projectData = await response.json()
        const transformed = transformProjectData(projectData)
        setProject(transformed)
      }
    } catch (error) {
      // Failed to refresh project
    }
  }, [id])

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }

    const init = async () => {
      setLoading(true)
      try {
        const [projectResponse, userResponse, settingsResponse] = await Promise.all([
          apiFetch(`/api/studio/projects/${id}`, { cache: 'no-store' }),
          apiFetch('/api/auth/user', { cache: 'no-store' }),
          apiFetch('/api/settings', { cache: 'no-store' }),
        ])

        if (projectResponse.ok) {
          const projectData = await projectResponse.json()
          const transformed = transformProjectData(projectData)
          setProject(transformed)

          if (userResponse.ok) {
            const userData = await userResponse.json()
            setAdminUser(userData.user)
          }

          if (settingsResponse.ok) {
            const settingsData = await settingsResponse.json()
            setDefaultQuality(settingsData.defaultQuality || '720p')
            setCompanyName(settingsData.companyName || 'Studio')
          }

          // Fetch comments
          await fetchComments()
        } else {
          console.error('Failed to load project')
        }
      } catch (error) {
        console.error('Error loading admin share data:', error)
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [id, fetchComments])

  useEffect(() => {
    if (!project) return

    const fetchThumbnails = async () => {
      setThumbnailsLoading(true)
      const newThumbnails = new Map<string, string>()

      try {
        await Promise.all(
          Object.keys(project.videosByName).map(async (videoName) => {
            const versions = project.videosByName[videoName]
            const latestReadyVideo = versions.find((v: any) => v.status === 'READY')

            if (latestReadyVideo?.thumbnailUrl) {
              const token = await fetchAdminVideoTokenWithRetry(
                latestReadyVideo.id,
                '720p',
                sessionIdRef.current
              )

              if (token) {
                const url = `${latestReadyVideo.thumbnailUrl}?token=${token}`
                newThumbnails.set(videoName, url)
              }
            }
          })
        )

        setThumbnailsByName(newThumbnails)
      } catch (error) {
        console.error('Error fetching thumbnails:', error)
      } finally {
        setThumbnailsLoading(false)
      }
    }

    fetchThumbnails()
  }, [project, fetchAdminVideoTokenWithRetry])

  useEffect(() => {
    if (!project || !urlVideoName) return

    const targetVersions = project.videosByName[urlVideoName]
    if (!targetVersions || targetVersions.length === 0) {
      setTokensLoading(false)
      return
    }

    const readyVersions = targetVersions.filter((v: any) => v.status === 'READY')
    if (readyVersions.length === 0) {
      setTokensLoading(false)
      return
    }

    let targetVideo: any
    if (urlVersion !== null) {
      targetVideo = readyVersions.find((v: any) => {
        const versionNumber = parseInt(v.versionLabel.replace('v', ''), 10)
        return versionNumber === urlVersion
      })
      if (!targetVideo) {
        targetVideo = readyVersions[0]
      }
    } else {
      targetVideo = readyVersions[0]
    }

    const initializeTargetVideo = async () => {
      setTokensLoading(true)
      try {
        const token720 = await fetchAdminVideoTokenWithRetry(
          targetVideo.id,
          '720p',
          sessionIdRef.current
        )
        const token1080 = await fetchAdminVideoTokenWithRetry(
          targetVideo.id,
          '1080p',
          sessionIdRef.current
        )
        const token2160 = await fetchAdminVideoTokenWithRetry(
          targetVideo.id,
          '2160p',
          sessionIdRef.current
        )

        if (token720 || token1080 || token2160) {
          const cacheKey = targetVideo.id
          tokenCacheRef.current.set(cacheKey, {
            '720p': token720,
            '1080p': token1080,
            '2160p': token2160,
          })
        }

        const targetVersionIndex = readyVersions.findIndex((v: any) => v.id === targetVideo.id)
        setInitialVideoIndex(targetVersionIndex >= 0 ? targetVersionIndex : 0)

        if (urlTimestamp !== null) {
          setInitialSeekTime(urlTimestamp)
        }

        setActiveVideoName(urlVideoName)
        setViewState('player')
      } catch (error) {
        console.error('Error initializing target video:', error)
      } finally {
        setTokensLoading(false)
      }
    }

    initializeTargetVideo()
  }, [
    project,
    urlVideoName,
    urlVersion,
    urlTimestamp,
    fetchAdminVideoTokenWithRetry,
  ])

  useEffect(() => {
    if (!project || !activeVideoName) return

    const versions = project.videosByName[activeVideoName]
    if (!versions) {
      setActiveVideos([])
      setActiveVideosRaw([])
      return
    }

    const readyVersions = versions.filter((v: any) => v.status === 'READY')
    setActiveVideosRaw(readyVersions)

    const enriched = readyVersions.map((video: any) => {
      const cacheKey = video.id
      const cachedTokens = tokenCacheRef.current.get(cacheKey)

      if (cachedTokens) {
        return {
          ...video,
          videoUrl720: cachedTokens['720p']
            ? `${video.videoUrl720}?token=${cachedTokens['720p']}`
            : video.videoUrl720,
          videoUrl1080: cachedTokens['1080p']
            ? `${video.videoUrl1080}?token=${cachedTokens['1080p']}`
            : video.videoUrl1080,
          videoUrl2160: cachedTokens['2160p']
            ? `${video.videoUrl2160}?token=${cachedTokens['2160p']}`
            : video.videoUrl2160,
          thumbnailUrl: cachedTokens['720p']
            ? `${video.thumbnailUrl}?token=${cachedTokens['720p']}`
            : video.thumbnailUrl,
        }
      }

      return video
    })

    setActiveVideos(enriched)
  }, [project, activeVideoName])

  const handleVideoSelect = useCallback(
    async (videoName: string) => {
      const versions = project?.videosByName[videoName]
      if (!versions) return

      const readyVersions = versions.filter((v: any) => v.status === 'READY')
      if (readyVersions.length === 0) return

      setActiveVideoName(videoName)
      setViewState('player')
      setInitialSeekTime(null)
      setInitialVideoIndex(0)

      const latestVideo = readyVersions[0]
      const cacheKey = latestVideo.id
      const existingTokens = tokenCacheRef.current.get(cacheKey)

      if (!existingTokens || !existingTokens['720p']) {
        const [token720, token1080, token2160] = await Promise.all([
          fetchAdminVideoTokenWithRetry(latestVideo.id, '720p', sessionIdRef.current),
          fetchAdminVideoTokenWithRetry(latestVideo.id, '1080p', sessionIdRef.current),
          fetchAdminVideoTokenWithRetry(latestVideo.id, '2160p', sessionIdRef.current),
        ])

        tokenCacheRef.current.set(cacheKey, {
          '720p': token720,
          '1080p': token1080,
          '2160p': token2160,
        })
      }
    },
    [project, fetchAdminVideoTokenWithRetry]
  )

  const handleGridVideoSelect = useCallback(
    (videoName: string, versionLabel?: string) => {
      const versions = project?.videosByName[videoName]
      if (!versions) return

      const readyVersions = versions.filter((v: any) => v.status === 'READY')
      if (readyVersions.length === 0) return

      let targetIndex = 0
      if (versionLabel) {
        const idx = readyVersions.findIndex((v: any) => v.versionLabel === versionLabel)
        if (idx >= 0) {
          targetIndex = idx
        }
      }

      setActiveVideoName(videoName)
      setViewState('player')
      setInitialSeekTime(null)
      setInitialVideoIndex(targetIndex)

      const targetVideo = readyVersions[targetIndex]
      if (!targetVideo) return

      const cacheKey = targetVideo.id
      const existingTokens = tokenCacheRef.current.get(cacheKey)

      if (!existingTokens || !existingTokens['720p']) {
        Promise.all([
          fetchAdminVideoTokenWithRetry(targetVideo.id, '720p', sessionIdRef.current),
          fetchAdminVideoTokenWithRetry(targetVideo.id, '1080p', sessionIdRef.current),
          fetchAdminVideoTokenWithRetry(targetVideo.id, '2160p', sessionIdRef.current),
        ]).then(([token720, token1080, token2160]) => {
          tokenCacheRef.current.set(cacheKey, {
            '720p': token720,
            '1080p': token1080,
            '2160p': token2160,
          })
        })
      }
    },
    [project, fetchAdminVideoTokenWithRetry]
  )

  const handleReturnToSource = useCallback(() => {
    router.push(`/studio/projects/${id}`)
  }, [router, id])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">{tc('loading')}</p>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">{t('projectNotFound')}</p>
      </div>
    )
  }

  const readyVideos = activeVideos.filter((v) => v.status === 'READY')
  const clientDisplayName = project.clientName || project.recipients?.[0]?.name || 'Client'

  const filteredComments = comments.filter((comment) => {
    if (!activeVideoState?.selectedVideo) return false
    return comment.videoId === activeVideoState.selectedVideo.id
  })

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
