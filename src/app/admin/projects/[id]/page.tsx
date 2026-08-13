'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import AdminVideoManager from '@/components/AdminVideoManager'
import ProjectActions from '@/components/ProjectActions'
import ProjectUploadsBlock from '@/components/ProjectUploadsBlock'
import PhotoAlbumsBlock from '@/components/PhotoAlbumsBlock'
import { ArrowLeft, Settings, ArrowUpDown, Video, FolderUp, Images, Copy, Check, ExternalLink, Upload, Grid2X2, List, Clock3, Layers3, X } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useTranslations } from 'next-intl'
import { logError } from '@/lib/logging'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/AuthProvider'
import { copyTextToClipboard } from '@/lib/clipboard'

// Force dynamic rendering (no static pre-rendering)
export const dynamic = 'force-dynamic'

const VIDEO_VIEW_MODE_KEY = 'vitransfer-admin-video-view-mode'
const WORKSPACE_VIEW_KEY = 'vitransfer-admin-project-workspace'

function formatFileSize(value: string | number | null | undefined): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const size = bytes / Math.pow(1024, unitIndex)
  return `${size >= 100 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(2)} ${units[unitIndex]}`
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y > 0) {
    const remainder = x % y
    x = y
    y = remainder
  }
  return x || 1
}

function formatAspectRatio(width: number | null | undefined, height: number | null | undefined): string {
  if (!width || !height || width <= 0 || height <= 0) return '-'
  const ratio = width / height
  const commonRatios = [
    { label: '1:1', value: 1 },
    { label: '4:3', value: 4 / 3 },
    { label: '3:4', value: 3 / 4 },
    { label: '16:9', value: 16 / 9 },
    { label: '9:16', value: 9 / 16 },
    { label: '21:9', value: 21 / 9 },
    { label: '9:21', value: 9 / 21 },
  ]
  const commonRatio = commonRatios.find((candidate) =>
    Math.abs(ratio - candidate.value) / candidate.value <= 0.03
  )
  if (commonRatio) return commonRatio.label

  const divisor = greatestCommonDivisor(width, height)
  return `${Math.round(width) / divisor}:${Math.round(height) / divisor}`
}

function getFileExtension(fileName: string | null | undefined): string {
  const extension = fileName?.split('.').pop()
  return extension && extension !== fileName ? extension.toUpperCase() : '-'
}

function isImageFile(fileType: string | null | undefined, fileName: string | null | undefined): boolean {
  if (fileType?.toLowerCase().startsWith('image/')) return true
  return /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|avif)$/i.test(fileName || '')
}

export default function ProjectPage() {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const params = useParams()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const id = params?.id as string

  const [project, setProject] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [shareUrl, setShareUrl] = useState('')
  const [sortMode, setSortMode] = useState<'status' | 'alphabetical'>('alphabetical')
  const [videoViewMode, setVideoViewMode] = useState<'list' | 'grid'>('list')
  const [albumSortMode, setAlbumSortMode] = useState<'date' | 'alphabetical'>('date')
  const [activeWorkspace, setActiveWorkspace] = useState<'videos' | 'photos' | 'uploads'>('videos')
  const [photoCounts, setPhotoCounts] = useState<{ albums: number; photos: number } | null>(null)
  const [uploadsCount, setUploadsCount] = useState<number | null>(null)
  const [collectionLinkCopied, setCollectionLinkCopied] = useState(false)
  const [uploadRequestKey, setUploadRequestKey] = useState(0)
  const [selectedVideoGroupName, setSelectedVideoGroupName] = useState<string | null>(null)

  const handlePhotoCounts = useCallback((albumCount: number, photoCount: number) => {
    setPhotoCounts({ albums: albumCount, photos: photoCount })
  }, [])

  const handleUploadsCount = useCallback((count: number) => {
    setUploadsCount(count)
  }, [])

  // Restore workspace preferences across projects.
  useEffect(() => {
    try {
      const savedVideoView = localStorage.getItem(VIDEO_VIEW_MODE_KEY)
      if (savedVideoView === 'list' || savedVideoView === 'grid') setVideoViewMode(savedVideoView)
      const savedWorkspace = localStorage.getItem(WORKSPACE_VIEW_KEY)
      if (savedWorkspace === 'videos' || savedWorkspace === 'photos' || savedWorkspace === 'uploads') {
        setActiveWorkspace(savedWorkspace)
      }
    } catch {}
  }, [])

  const changeVideoViewMode = (mode: 'list' | 'grid') => {
    setVideoViewMode(mode)
    try { localStorage.setItem(VIDEO_VIEW_MODE_KEY, mode) } catch {}
  }

  const changeWorkspace = (workspace: 'videos' | 'photos' | 'uploads') => {
    setActiveWorkspace(workspace)
    if (workspace !== 'videos') setSelectedVideoGroupName(null)
    try { localStorage.setItem(WORKSPACE_VIEW_KEY, workspace) } catch {}
  }

  // Fetch project data function (extracted so it can be called on upload complete)
  const fetchProject = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/projects/${id}`)
      if (!response.ok) {
        if (response.status === 404) {
          router.push('/admin/projects')
          return
        }
        throw new Error('Failed to fetch project')
      }
      const data = await response.json()
      if (!authLoading && user?.role !== 'ADMIN' && data.slug) {
        router.replace(`/share/${data.slug}`)
        return
      }
      setProject(data)
    } catch (error) {
      logError('Error fetching project:', error)
    } finally {
      setLoading(false)
    }
  }, [authLoading, id, router, user?.role])

  // Fetch project data on mount
  useEffect(() => {
    fetchProject()
  }, [fetchProject])

  // Listen for immediate updates (approval changes, comment deletes/posts, etc.)
  useEffect(() => {
    const handleUpdate = () => fetchProject()

    const handleCommentPosted = (e: Event) => {
      const customEvent = e as CustomEvent
      if (customEvent.detail?.comments) {
        setProject((prev: any) => prev ? { ...prev, comments: customEvent.detail.comments } : prev)
      } else {
        fetchProject()
      }
    }

    window.addEventListener('videoApprovalChanged', handleUpdate)
    window.addEventListener('commentDeleted', handleUpdate)
    window.addEventListener('commentPosted', handleCommentPosted as EventListener)

    return () => {
      window.removeEventListener('videoApprovalChanged', handleUpdate)
      window.removeEventListener('commentDeleted', handleUpdate)
      window.removeEventListener('commentPosted', handleCommentPosted as EventListener)
    }
  }, [fetchProject])

  // Auto-refresh when videos are processing to show real-time progress
  // Centralized polling to prevent duplicate network requests
  useEffect(() => {
    if (!project?.videos) return

    // Check if any videos are currently processing
    const hasProcessingVideos = project.videos.some(
      (video: any) => video.status === 'PROCESSING' || video.status === 'UPLOADING'
    )

    if (hasProcessingVideos) {
      // Poll every 5 seconds while videos are processing (reduced from 3s to reduce load)
      const interval = setInterval(() => {
        fetchProject()
      }, 5000)

      return () => clearInterval(interval)
    }
  }, [project?.videos, fetchProject])

  // Fetch share URL
  useEffect(() => {
    async function fetchShareUrl() {
      if (!project?.slug) return

      // Make collection/review links available immediately. The API response may
      // replace this with the configured public domain when it arrives.
      setShareUrl(`${window.location.origin}/share/${project.slug}`)
      try {
        const response = await apiFetch(`/api/share/url?slug=${project.slug}`)
        if (response.ok) {
          const data = await response.json()
          if (data.shareUrl) setShareUrl(data.shareUrl)
        }
      } catch (error) {
        logError('Error fetching share URL:', error)
      }
    }

    fetchShareUrl()
  }, [project?.slug])


  if (loading) {
    return (
      <div className="flex-1 min-h-0 bg-background flex items-center justify-center">
        <p className="text-muted-foreground">{tc('loading')}</p>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex-1 min-h-0 bg-background flex items-center justify-center">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{t('projectNotFound')}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Filter comments to only show comments for active videos
  const iconBadgeClassName = 'rounded-md p-1.5 flex-shrink-0 bg-foreground/5 dark:bg-foreground/10'
  const iconBadgeIconClassName = 'w-4 h-4 text-primary'
  const countBadgeClassName = 'text-sm font-normal text-muted-foreground'

  const videoGroupNames: string[] = Array.from(new Set(project.videos.map((v: any) => v.name)))
  const selectedVideoGroup = selectedVideoGroupName
    ? {
        name: selectedVideoGroupName,
        videos: project.videos
          .filter((video: any) => video.name === selectedVideoGroupName)
          .sort((a: any, b: any) => b.version - a.version),
      }
    : null
  const collectionUrl = shareUrl ? `${shareUrl}${shareUrl.includes('?') ? '&' : '?'}mode=collect` : ''

  const copyCollectionLink = async () => {
    if (!collectionUrl) return
    if (await copyTextToClipboard(collectionUrl)) {
      setCollectionLinkCopied(true)
      window.setTimeout(() => setCollectionLinkCopied(false), 2000)
    } else {
      alert(tc('errorTryAgain'))
    }
  }

  return (
    <div className="flex-1 min-h-0 bg-background">
      <div className="w-full px-3 py-3 sm:px-4 lg:px-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Link href="/admin/projects">
            <Button variant="outline" size="default" className="justify-start px-3">
              <ArrowLeft className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">{t('backToProjects')}</span>
              <span className="sm:hidden">{tc('back')}</span>
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Link href={`/admin/projects/${id}/settings`}>
              <Button variant="outline" size="default">
                <Settings className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">{t('projectSettings')}</span>
              </Button>
            </Link>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 border-y border-border py-2.5">
          <Button size="sm" onClick={() => changeWorkspace('videos')}>
            <Video className="mr-2 h-4 w-4" />
            {t('reviewWorkspace')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={project.status === 'APPROVED'}
            onClick={() => {
              changeWorkspace('videos')
              setUploadRequestKey(current => current + 1)
            }}
          >
            <Upload className="mr-2 h-4 w-4" />
            {t('uploadVideos')}
          </Button>
          {project.allowReverseShare ? (
            <>
              <Button variant="outline" size="sm" onClick={copyCollectionLink} disabled={!collectionUrl}>
                {collectionLinkCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                {collectionLinkCopied ? tc('copied') : t('copyCollectionLink')}
              </Button>
              {collectionUrl && (
                <a href={collectionUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost" size="icon" title={t('openCollectionLink')}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </a>
              )}
            </>
          ) : (
            <Link href={`/admin/projects/${id}/settings`}>
              <Button variant="outline" size="sm">
                <FolderUp className="mr-2 h-4 w-4" />
                {t('enableCollection')}
              </Button>
            </Link>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {t('materialSummary', { materials: videoGroupNames.length, versions: project.videos.length })}
          </span>
        </div>

        <div className="min-h-[calc(100dvh-var(--admin-header-height)-8rem)] border-y border-border lg:grid lg:grid-cols-[168px_minmax(0,1fr)_288px]">
          <nav className="flex gap-1 overflow-x-auto border-b border-border p-2 lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:py-4">
            {([
              { id: 'videos' as const, label: t('videos'), count: videoGroupNames.length, icon: Video },
              { id: 'photos' as const, label: t('photoAlbums'), count: photoCounts?.albums || 0, icon: Images },
              { id: 'uploads' as const, label: t('collection'), count: uploadsCount || 0, icon: FolderUp },
            ]).map((item) => {
              const Icon = item.icon
              const active = activeWorkspace === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => changeWorkspace(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-w-max items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors lg:w-full',
                    active
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4 text-primary" />
                  <span>{item.label}</span>
                  {item.count > 0 && <span className="ml-auto tabular-nums text-xs text-muted-foreground">{item.count}</span>}
                </button>
              )
            })}
          </nav>

          <main id="review-workspace" className="min-w-0 p-3 sm:p-4">
            <section className={activeWorkspace === 'videos' ? undefined : 'hidden'}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <span className={iconBadgeClassName}><Video className={iconBadgeIconClassName} /></span>
                  {t('videos')}
                  <span className={countBadgeClassName}>{videoGroupNames.length}</span>
                </h2>
                <div className="flex items-center gap-1">
                  <div className="flex items-center rounded-md border border-border bg-muted/30 p-0.5">
                    <Button variant={videoViewMode === 'list' ? 'secondary' : 'ghost'} size="icon" onClick={() => changeVideoViewMode('list')} className="h-7 w-7" title={t('listView')} aria-label={t('listView')}>
                      <List className="h-4 w-4" />
                    </Button>
                    <Button variant={videoViewMode === 'grid' ? 'secondary' : 'ghost'} size="icon" onClick={() => changeVideoViewMode('grid')} className="h-7 w-7" title={t('gridView')} aria-label={t('gridView')}>
                      <Grid2X2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setSortMode(current => current === 'status' ? 'alphabetical' : 'status')} className="h-8 w-8 text-muted-foreground hover:text-foreground" title={sortMode === 'status' ? t('sortAlphabetically') : t('sortByStatus')}>
                    <ArrowUpDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <AdminVideoManager projectId={project.id} videos={project.videos} projectStatus={project.status} restrictToLatestVersion={project.restrictCommentsToLatestVersion} onRefresh={fetchProject} sortMode={sortMode} viewMode={videoViewMode} maxRevisions={project.maxRevisions} enableRevisions={project.enableRevisions} comments={project.comments || []} shareUrl={shareUrl} uploadRequestKey={uploadRequestKey} onShowVideoInfo={(group) => setSelectedVideoGroupName(group.name)} />
            </section>

            <section className={activeWorkspace === 'photos' ? undefined : 'hidden'}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <span className={iconBadgeClassName}><Images className={iconBadgeIconClassName} /></span>
                  {t('photoAlbums')}
                  {photoCounts !== null && <span className={countBadgeClassName}>{photoCounts.albums}</span>}
                </h2>
                <Button variant="ghost" size="icon" onClick={() => setAlbumSortMode(current => current === 'date' ? 'alphabetical' : 'date')} className="h-8 w-8 text-muted-foreground hover:text-foreground" title={albumSortMode === 'date' ? t('sortAlphabetically') : t('sortByDate')}>
                  <ArrowUpDown className="h-4 w-4" />
                </Button>
              </div>
              <PhotoAlbumsBlock projectId={project.id} sortMode={albumSortMode} onCountsChange={handlePhotoCounts} />
            </section>

            <section id="collection-inbox" className={activeWorkspace === 'uploads' ? 'scroll-mt-4' : 'hidden'}>
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                <span className={iconBadgeClassName}><FolderUp className={iconBadgeIconClassName} /></span>
                {t('collection')}
                {uploadsCount !== null && <span className={countBadgeClassName}>{uploadsCount}</span>}
              </h2>
              {project.allowReverseShare ? (
                <ProjectUploadsBlock projectId={project.id} onCountChange={handleUploadsCount} videoNames={videoGroupNames} onPromoted={fetchProject} />
              ) : (
                <div className="rounded-md border border-dashed border-border px-4 py-8 text-center">
                  <FolderUp className="mx-auto h-7 w-7 text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium">{t('collectionDisabledTitle')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t('collectionDisabledDescription')}</p>
                  <Link href={`/admin/projects/${id}/settings`}><Button variant="outline" size="sm" className="mt-4">{t('enableCollection')}</Button></Link>
                </div>
              )}
            </section>
          </main>

          <aside className="border-t border-border p-3 lg:border-l lg:border-t-0 lg:p-3">
            {selectedVideoGroup ? (
              <Card className="overflow-hidden">
                <div className="border-b border-border px-4 py-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="rounded-md bg-primary/10 p-1.5 text-primary">
                      <Layers3 className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold">{selectedVideoGroup.name}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t('versionCount', { count: selectedVideoGroup.videos.length })}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setSelectedVideoGroupName(null)} title={tc('close')} aria-label={tc('close')}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <CardContent className="space-y-2 p-3">
                  {selectedVideoGroup.videos.map((video: any) => {
                    const statusLabel = video.approved
                      ? t('videoStatusApproved')
                      : ({
                          READY: t('videoStatusReady'),
                          PROCESSING: t('videoStatusProcessing'),
                          UPLOADING: t('videoStatusUploading'),
                          ERROR: t('videoStatusError'),
                        } as Record<string, string>)[video.status] || video.status
                    const uploadedAt = video.createdAt
                      ? new Intl.DateTimeFormat('zh-CN', {
                          timeZone: 'Asia/Shanghai',
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        }).format(new Date(video.createdAt))
                      : '-'
                    const isImage = isImageFile(video.fileType, video.originalFileName)
                    const details = [
                      formatFileSize(video.originalFileSize),
                      isImage ? t('imageMediaType') : t('videoMediaType'),
                      video.fps ? `${Number(video.fps).toFixed(2)} fps` : null,
                      formatAspectRatio(video.width, video.height),
                    ].filter((value) => value && value !== '-').join(' · ')
                    const uploader = video.uploadedByName || t('legacyAdminUploader')

                    return (
                      <div key={video.id} className="rounded-md border border-border bg-muted/20 px-3 py-3">
                        <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-border/70 pb-2">
                          <span className="font-mono text-sm font-semibold text-primary">{video.versionLabel || `v${video.version}`}</span>
                          <span className="rounded bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">{statusLabel}</span>
                        </div>
                        <dl className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-2 gap-y-2 text-xs leading-5">
                          <dt className="text-muted-foreground">{t('versionInfoVersion')}</dt>
                          <dd className="font-mono font-medium">{video.versionLabel || `v${video.version}`}</dd>
                          <dt className="text-muted-foreground">{t('versionInfoName')}</dt>
                          <dd className="break-all font-medium" title={video.originalFileName}>{video.originalFileName || '-'}</dd>
                          <dt className="text-muted-foreground">{t('versionInfoType')}</dt>
                          <dd className="font-medium">{getFileExtension(video.originalFileName)}</dd>
                          <dt className="text-muted-foreground">{t('versionInfoDetails')}</dt>
                          <dd className="break-words text-foreground">{details || '-'}</dd>
                          <dt className="text-muted-foreground">{t('versionInfoUploader')}</dt>
                          <dd className="break-all font-medium">{uploader}</dd>
                          <dt className="flex items-center gap-1 text-muted-foreground"><Clock3 className="h-3 w-3 shrink-0" />{t('versionInfoUploadedAt')}</dt>
                          <dd className="tabular-nums text-foreground">{uploadedAt}</dd>
                        </dl>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            ) : (
              <ProjectActions project={project} videos={project.videos} onRefresh={fetchProject} shareUrl={shareUrl} />
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
