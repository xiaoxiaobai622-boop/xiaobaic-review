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

    return {
      ...projectData,
      videosByName,
    }
  }

  const fetchProject = useCallback(async () => {
    if (!id) return

    setLoading(true)
    try {
      const response = await apiFetch(`/api/projects/${id}/share-admin`, { cache: 'no-store' })
      if (response.ok) {
        const data = await response.json()
        setProject(transformProjectData(data.project))
        setAdminUser(data.adminUser)
        setCompanyName(data.companyName || 'Studio')
      }
    } catch (error) {
      // Failed to load project
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchProject()
    fetchComments()
  }, [fetchProject, fetchComments])

  const refreshProject = useCallback(() => {
    fetchProject()
    fetchComments()
  }, [fetchProject, fetchComments])

  const clientDisplayName = searchParams?.get('client') ?? undefined

  const handleReturnToSource = () => {
    const from = searchParams?.get('from')
    if (from === 'analytics') {
      router.push(`/studio/projects/${id}/analytics`)
    } else {
      router.push(`/studio/projects/${id}`)
    }
  }

  const handleVideoSelect = useCallback((videoName: string) => {
    setActiveVideoName(videoName)
    setViewState('player')
    setInitialSeekTime(null)
    setInitialVideoIndex(0)
    setFocusCommentId(null)

    const params = new URLSearchParams(searchParams?.toString() || '')
    params.set('video', videoName)
    params.delete('version')
    params.delete('t')
    params.delete('comment')
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [pathname, router, searchParams])

  const handleGridVideoSelect = useCallback((videoName: string) => {
    handleVideoSelect(videoName)
  }, [handleVideoSelect])

  useEffect(() => {
    if (!project || !urlVideoName) return

    const matchedVersions = project.videosByName[urlVideoName] || []
    if (matchedVersions.length === 0) {
      setTokensLoading(false)
      return
    }

    const targetVideo = urlVersion !== null
      ? matchedVersions.find((v: any) => v.version === urlVersion)
      : matchedVersions.reduce((latest: any, current: any) =>
          new Date(current.uploadedAt) > new Date(latest.uploadedAt) ? current : latest
        )

    if (!targetVideo) {
      setTokensLoading(false)
      return
    }

    const qualities: Array<'720p' | '1080p' | '2160p'> = ['720p', '1080p', '2160p']
    const sessionId = sessionIdRef.current

    Promise.all(
      qualities.map((q) =>
        fetchAdminVideoTokenWithRetry(targetVideo.id, q, sessionId).then((token) => ({ quality: q, token }))
      )
    ).then((results) => {
      const cache = tokenCacheRef.current
      results.forEach(({ quality, token }) => {
        if (token) {
          cache.set(`${targetVideo.id}:${quality}`, token)
        }
      })

      setActiveVideoName(urlVideoName)
      setActiveVideos(matchedVersions)
      setActiveVideosRaw(matchedVersions)
      setViewState('player')

      if (urlTimestamp !== null) {
        setInitialSeekTime(urlTimestamp)
      }

      const targetIndex = matchedVersions.findIndex((v: any) => v.id === targetVideo.id)
      if (targetIndex >= 0) {
        setInitialVideoIndex(targetIndex)
      }

      setTokensLoading(false)
    })
  }, [project, urlVideoName, urlVersion, urlTimestamp, fetchAdminVideoTokenWithRetry])

  useEffect(() => {
    if (!project) return
    const videoNames = Object.keys(project.videosByName)
    if (videoNames.length === 0) return

    const tasks = videoNames.map((name) => {
      const versions = project.videosByName[name]
      const latestVideo = versions.reduce((latest: any, current: any) =>
        new Date(current.uploadedAt) > new Date(latest.uploadedAt) ? current : latest
      )
      return { name, videoId: latestVideo.id }
    })

    Promise.all(
      tasks.map(async ({ name, videoId }) => {
        try {
          const response = await apiFetch(`/api/studio/thumbnail?videoId=${videoId}&projectId=${id}`, {
            cache: 'default',
          })
          if (response.ok) {
            const data = await response.json()
            return { name, url: data.thumbnailUrl }
          }
        } catch {
          // ignore
        }
        return { name, url: null }
      })
    ).then((results) => {
      const map = new Map<string, string>()
      results.forEach(({ name, url }) => {
        if (url) map.set(name, url)
      })
      setThumbnailsByName(map)
      setThumbnailsLoading(false)
    })
  }, [project, id])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-lg">{t('loading')}</div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <h2 className="text-xl font-semibold mb-2">{t('projectNotFound')}</h2>
            <p className="text-muted-foreground mb-4">{t('projectNotFoundDescription')}</p>
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

  const readyVideos = Object.values(project.videosByName).flat().filter((v: any) => v.status === 'READY')
  const filteredComments = comments.filter((c) => {
    const videoExists = readyVideos.some((v: any) => v.id === c.videoId)
    return videoExists
  })()

  const showCommentPanel = !project.hideFeedback
  const canManageApproval = canUserManageApproval(adminUser, project)
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

  if (viewState === 'grid') {
    return (
      <div className="fixed inset-0 bg-background flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-background/95 backdrop-blur-sm z-20 flex-shrink-0">
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
          <VideoReviewStatusSelect
            projectId={project.id}
            video={activeVideoState?.selectedVideo || null}
            onUpdated={refreshProject}
            className="h-8"
          />
        ) : undefined}
        trailingAction={<ReviewLoginActions compact />}
      />
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
