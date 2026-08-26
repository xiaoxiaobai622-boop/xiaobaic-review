'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import Link from 'next/link'
import AdminVideoManager from '@/components/AdminVideoManager'
import ProjectActions from '@/components/ProjectActions'
import ProjectUploadsBlock from '@/components/ProjectUploadsBlock'
import PhotoAlbumsBlock from '@/components/PhotoAlbumsBlock'
import RecycleBinBlock from '@/components/RecycleBinBlock'
import { ArrowLeft, Settings, ArrowUpDown, Video, FolderOpen, FolderUp, Images, Trash2, Copy, Check, ExternalLink, Upload, Grid2X2, List, Clock3, Layers3, X, RotateCcw, Loader2, TriangleAlert, Plus, Users, MoreVertical } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useTranslations } from 'next-intl'
import { logError } from '@/lib/logging'
import { cn } from '@/lib/utils'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useAuth } from '@/components/AuthProvider'

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

function formatFolderCreatedAt(createdAt?: string): string {
  if (!createdAt) return '--'
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return '--'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date).replace(/\//g, '-')
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

function countVideoComments(comments: any[], videoId: string): number {
  const countTree = (comment: any): number => 1 + (comment.replies || []).reduce(
    (total: number, reply: any) => total + countTree(reply),
    0
  )
  return comments
    .filter((comment: any) => comment.videoId === videoId)
    .reduce((total: number, comment: any) => total + countTree(comment), 0)
}

export default function ProjectPage() {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const id = params?.id as string

  const [project, setProject] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [shareUrl, setShareUrl] = useState('')
  const [sortMode, setSortMode] = useState<'status' | 'alphabetical'>('alphabetical')
  const [videoViewMode, setVideoViewMode] = useState<'list' | 'grid'>('grid')
  const [albumSortMode, setAlbumSortMode] = useState<'date' | 'alphabetical'>('date')
  const [activeWorkspace, setActiveWorkspace] = useState<'videos' | 'photos' | 'uploads' | 'trash'>('videos')
  const [photoCounts, setPhotoCounts] = useState<{ albums: number; photos: number } | null>(null)
  const [uploadsCount, setUploadsCount] = useState<number | null>(null)
  const [recycleBinCount, setRecycleBinCount] = useState<number | null>(null)
  const [recycleBinRefreshKey, setRecycleBinRefreshKey] = useState(0)
  const [collectionLinkCopied, setCollectionLinkCopied] = useState(false)
  const [uploadRequestKey, setUploadRequestKey] = useState(0)
  const [uploadRequestFiles, setUploadRequestFiles] = useState<File[] | undefined>(undefined)
  const [uploadRequestFolderId, setUploadRequestFolderId] = useState<string | null>(null)
  const folderUploadInputRef = useRef<HTMLInputElement>(null)
  const [selectedVideoGroupName, setSelectedVideoGroupName] = useState<string | null>(null)
  const [rollbackTarget, setRollbackTarget] = useState<any | null>(null)
  const [rollingBackVideoId, setRollingBackVideoId] = useState<string | null>(null)
  const [rollbackError, setRollbackError] = useState('')
  const [deletingVersionId, setDeletingVersionId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [projectFolders, setProjectFolders] = useState<Array<{ id: string; name: string; createdAt?: string; _count?: { videos: number } }>>([])
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null)
  const [folderDropTargetId, setFolderDropTargetId] = useState<string | null | undefined>(undefined)

  const handlePhotoCounts = useCallback((albumCount: number, photoCount: number) => {
    setPhotoCounts({ albums: albumCount, photos: photoCount })
  }, [])

  const handleUploadsCount = useCallback((count: number) => {
    setUploadsCount(count)
  }, [])

  // Restore workspace preferences across projects.
  useEffect(() => {
    const closeMenu = () => { setContextMenu(null); setFolderMenuId(null) }
    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [id])

  useEffect(() => {
    const requestedWorkspace = searchParams?.get('workspace')
    if (requestedWorkspace === 'videos' || requestedWorkspace === 'photos' || requestedWorkspace === 'uploads' || requestedWorkspace === 'trash') {
      setActiveWorkspace(requestedWorkspace)
      return
    }
    try {
      const savedVideoView = localStorage.getItem(VIDEO_VIEW_MODE_KEY)
      if (savedVideoView === 'list' || savedVideoView === 'grid') setVideoViewMode(savedVideoView)
      const savedWorkspace = localStorage.getItem(WORKSPACE_VIEW_KEY)
      if (savedWorkspace === 'videos' || savedWorkspace === 'photos' || savedWorkspace === 'uploads' || savedWorkspace === 'trash') {
        setActiveWorkspace(savedWorkspace)
      }
    } catch {}
  }, [searchParams])

  const changeVideoViewMode = (mode: 'list' | 'grid') => {
    setVideoViewMode(mode)
    try { localStorage.setItem(VIDEO_VIEW_MODE_KEY, mode) } catch {}
  }

  const changeWorkspace = (workspace: 'videos' | 'photos' | 'uploads' | 'trash') => {
    setActiveWorkspace(workspace)
    if (workspace === 'trash') setRecycleBinRefreshKey((value) => value + 1)
    if (workspace !== 'videos') setSelectedVideoGroupName(null)
    try { localStorage.setItem(WORKSPACE_VIEW_KEY, workspace) } catch {}
    const nextParams = new URLSearchParams(searchParams?.toString() || '')
    nextParams.set('workspace', workspace)
    router.replace(`/studio/projects/${id}?${nextParams.toString()}`, { scroll: false })
  }

  // Fetch project data function (extracted so it can be called on upload complete)
  const fetchProject = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/projects/${id}`)
      if (!response.ok) {
        if (response.status === 404) {
          router.push('/studio/projects')
          return
        }
        throw new Error('Failed to fetch project')
      }
      const data = await response.json()
      setProject(data)
      setProjectFolders(data.folders || [])
    } catch (error) {
      logError('Error fetching project:', error)
    } finally {
      setLoading(false)
    }
  }, [id, router])

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
  const projectToolbarButtonClassName = 'h-9 px-3 sm:min-w-[132px]'

  const workspaceVideos = project.videos.filter((video: any) =>
    !(video.status === 'PROCESSING' && video.sourceUpload?.id)
    && (activeFolderId ? video.folderId === activeFolderId : !video.folderId)
  )
  const videoGroupNames: string[] = Array.from(new Set(workspaceVideos.map((v: any) => v.name)))
  const selectedVideoGroup = selectedVideoGroupName
    ? {
        name: selectedVideoGroupName,
        videos: workspaceVideos
          .filter((video: any) => video.name === selectedVideoGroupName)
          .sort((a: any, b: any) => b.version - a.version),
      }
    : null
  const canRollbackVersion = Boolean(user && (
    user.role === 'ADMIN'
    || user.teamRole === 'OWNER'
    || user.teamRole === 'ADMIN'
    || project.createdById === user.id
  ))
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

  const openRollbackDialog = (video: any) => {
    setRollbackError('')
    setRollbackTarget(video)
  }

  const rollbackLatestVersion = async () => {
    if (!rollbackTarget || rollingBackVideoId) return
    setRollbackError('')
    setRollingBackVideoId(rollbackTarget.id)
    try {
      const response = await apiFetch(
        `/api/videos/${rollbackTarget.id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'rollback-to-collection' }),
        }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || t('rollbackVersionFailed'))

      setRollbackTarget(null)
      setSelectedVideoGroupName(null)
      await fetchProject()
      changeWorkspace('uploads')
    } catch (error) {
      setRollbackError(error instanceof Error ? error.message : t('rollbackVersionFailed'))
    } finally {
      setRollingBackVideoId(null)
    }
  }

  const createProjectFolder = async () => {
    const name = window.prompt('请输入文件夹名称')?.trim()
    if (!name) return
    const response = await apiFetch(`/api/projects/${id}/folders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      window.alert(data.error || '新建文件夹失败')
      return
    }
    const data = await response.json()
    setProjectFolders((folders) => [...folders, data.folder].sort((a, b) => a.name.localeCompare(b.name)))
  }

  const moveVideoToFolder = async (event: React.DragEvent, folderId: string | null) => {
    event.preventDefault()
    event.stopPropagation()
    setFolderDropTargetId(undefined)
    const droppedFiles = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv|wmv|flv)$/i.test(file.name))
    if (droppedFiles.length > 0) {
      if (project.status === 'APPROVED') return
      setUploadRequestFolderId(folderId)
      setUploadRequestFiles(droppedFiles)
      setUploadRequestKey((key) => key + 1)
      return
    }
    const videoId = event.dataTransfer.getData('application/x-vitransfer-video-id') || event.dataTransfer.getData('text/plain')
    if (!videoId) return
    const response = await apiFetch(`/api/videos/${videoId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId, moveGroup: true }) })
    if (!response.ok) {
      window.alert('移动视频失败')
      return
    }
    await fetchProject()
  }

  const openFolderUpload = () => folderUploadInputRef.current?.click()

  const handleFolderUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('video/'))
    event.target.value = ''
    if (!files.length) return
    setUploadRequestFolderId(null)
    setUploadRequestFiles(files)
    setUploadRequestKey((key) => key + 1)
  }

  const deleteProjectFolder = async (folderId: string) => {
    setFolderMenuId(null)
    const response = await apiFetch(`/api/projects/${id}/folders?folderId=${encodeURIComponent(folderId)}`, { method: 'DELETE' })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      window.alert(data.error || '删除文件夹失败')
      return
    }
    if (activeFolderId === folderId) setActiveFolderId(null)
    setProjectFolders((folders) => folders.filter((folder) => folder.id !== folderId))
  }

  const deleteVideoVersion = async (video: any) => {
    if (deletingVersionId) return
    if (!window.confirm(t('deleteVersionConfirm', { version: video.versionLabel || `v${video.version}` }))) return
    setDeletingVersionId(video.id)
    try {
      const response = await apiFetch(`/api/videos/${video.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || t('deleteVersionFailed'))
      }
      if (rollbackTarget?.id === video.id) setRollbackTarget(null)
      await fetchProject()
    } catch (error) {
      alert(error instanceof Error ? error.message : t('deleteVersionFailed'))
    } finally {
      setDeletingVersionId(null)
    }
  }

  return (
    <div className="flex-1 min-h-0 bg-background">
      <div className="w-full px-3 py-3 sm:px-4 lg:px-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Link href="/studio/projects">
            <Button variant="outline" size="default" className="justify-start px-3">
              <ArrowLeft className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">{t('backToProjects')}</span>
              <span className="sm:hidden">{tc('back')}</span>
            </Button>
          </Link>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">
              {t('materialSummary', { materials: videoGroupNames.length, versions: workspaceVideos.length })}
            </span>
            {project.allowReverseShare && collectionUrl && (
              <a href={collectionUrl} target="_blank" rel="noopener noreferrer">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  title={t('openCollectionLink')}
                  aria-label={t('openCollectionLink')}
                >
                  <ExternalLink className="h-4 w-4 -scale-x-100" />
                </Button>
              </a>
            )}
            <Button
              size="default"
              className={projectToolbarButtonClassName}
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
              <Button
                variant="outline"
                size="default"
                className={projectToolbarButtonClassName}
                onClick={copyCollectionLink}
                disabled={!collectionUrl}
              >
                {collectionLinkCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                {collectionLinkCopied ? tc('copied') : t('copyCollectionLink')}
              </Button>
            ) : (
              <Link href={`/studio/projects/${id}/settings`}>
                <Button variant="outline" size="default" className={projectToolbarButtonClassName}>
                  <FolderUp className="mr-2 h-4 w-4" />
                  {t('enableCollection')}
                </Button>
              </Link>
            )}
            <Link href={`/studio/projects/${id}/settings`}>
              <Button variant="outline" size="default" className={projectToolbarButtonClassName}>
                <Settings className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">{t('projectSettings')}</span>
              </Button>
            </Link>
          </div>
        </div>

        <div className="min-h-[calc(100dvh-var(--admin-header-height)-5rem)] border-y border-border lg:grid lg:grid-cols-[168px_minmax(0,1fr)_288px]">
          <nav className="flex gap-1 overflow-x-auto border-b border-border p-2 lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:py-4">
            {([
              { id: 'videos' as const, label: t('videos'), count: videoGroupNames.length, icon: Video },
              { id: 'photos' as const, label: t('photoAlbums'), count: photoCounts?.albums || 0, icon: Images },
              { id: 'uploads' as const, label: t('collection'), count: uploadsCount || 0, icon: FolderUp },
              { id: 'trash' as const, label: t('recycleBin'), count: recycleBinCount || 0, icon: Trash2 },
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

          <main id="review-workspace" className="relative min-w-0 p-3 sm:p-4" onContextMenu={(event) => { if ((event.target as HTMLElement).closest('button,a,input,img,video,[role="menu"],[data-video-card]')) return; event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY }) }}>
            {contextMenu && (
              <div className="fixed z-[100] w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl" style={{ left: Math.min(contextMenu.x, window.innerWidth - 220), top: Math.min(contextMenu.y, window.innerHeight - 260) }} onClick={(event) => event.stopPropagation()}>
                <button type="button" className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setContextMenu(null); setUploadRequestFiles(undefined); setUploadRequestFolderId(null); changeWorkspace('videos'); setUploadRequestKey((key) => key + 1) }}><Upload className="h-4 w-4" />上传文件</button>
                <button type="button" className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setContextMenu(null); changeWorkspace('videos'); openFolderUpload() }}><FolderUp className="h-4 w-4" />上传文件夹</button>
                <div className="my-1 border-t border-border" />
                <button type="button" className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setContextMenu(null); void createProjectFolder() }}><Plus className="h-4 w-4" />新建文件夹</button>
                <button type="button" className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setContextMenu(null); void fetchProject() }}><RotateCcw className="h-4 w-4" />刷新</button>
                <div className="my-1 border-t border-border" />
                <Link href={`/studio/projects/${id}/settings`} className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"><Settings className="h-4 w-4" />项目设置</Link>
                <Link href="/studio/team" className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"><Users className="h-4 w-4" />邀请成员</Link>
              </div>
            )}
            <section className={activeWorkspace === 'videos' ? undefined : 'hidden'}>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <h2 className="flex shrink-0 items-center gap-2 text-lg font-semibold">
                  <span className={iconBadgeClassName}><Video className={iconBadgeIconClassName} /></span>
                  {t('videos')}
                  <span className={countBadgeClassName}>{videoGroupNames.length}</span>
                </h2>
                <div id="video-selection-toolbar" className="flex min-w-0 flex-1 items-center justify-end empty:hidden" />
                <div className="flex shrink-0 items-center gap-1">
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
              {activeFolderId && (
                <button
                  type="button"
                  className={cn('mb-3 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent', folderDropTargetId === null ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border')}
                  onClick={() => setActiveFolderId(null)}
                  onDragEnter={(event) => { event.preventDefault(); setFolderDropTargetId(null) }}
                  onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setFolderDropTargetId(null) }}
                  onDragLeave={() => setFolderDropTargetId(undefined)}
                  onDrop={(event) => void moveVideoToFolder(event, null)}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />项目根目录
                </button>
              )}
              {!activeFolderId && projectFolders.length > 0 && (
                <div className="mb-4 grid content-start gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 280px))' }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }} onDrop={(event) => void moveVideoToFolder(event, null)}>
                  {projectFolders.map((folder) => {
                    const count = new Set(project.videos.filter((video: any) => video.folderId === folder.id).map((video: any) => video.name)).size
                    return (
                      <div
                        key={folder.id}
                        className={cn('group relative overflow-hidden rounded-md border bg-card transition-all', folderDropTargetId === folder.id ? 'border-primary ring-2 ring-primary/40 bg-primary/5' : folderMenuId === folder.id ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50 hover:shadow-sm')}
                        onDoubleClick={() => setActiveFolderId(folder.id)}
                        onDragEnter={(event) => { event.preventDefault(); setFolderDropTargetId(folder.id) }}
                        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setFolderDropTargetId(folder.id) }}
                        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFolderDropTargetId(undefined) }}
                        onDrop={(event) => void moveVideoToFolder(event, folder.id)}
                      >
                        <button type="button" className="block w-full text-left" onClick={() => setActiveFolderId(folder.id)}>
                          <div className="flex aspect-video items-center justify-center bg-muted/40">
                            <FolderOpen className="h-8 w-8 text-primary/70 transition-transform group-hover:scale-105" strokeWidth={1.5} />
                          </div>
                          <div className="flex items-start gap-1.5 border-t border-border px-2.5 py-2.5 pr-11">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium leading-5 text-foreground">{folder.name}</p>
                              <p className="mt-1 flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
                                <span className="tabular-nums">{formatFolderCreatedAt(folder.createdAt)}</span>
                                <span aria-hidden="true">·</span>
                                <span>{count} 个视频</span>
                              </p>
                            </div>
                          </div>
                        </button>
                        <button type="button" className="absolute bottom-2.5 right-2.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="文件夹操作" title="文件夹操作" onClick={(event) => { event.stopPropagation(); setFolderMenuId((current) => current === folder.id ? null : folder.id) }}>
                          <MoreVertical className="h-4 w-4" />
                        </button>
                        {folderMenuId === folder.id && (
                          <div className="absolute right-2 bottom-10 z-20 w-32 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg" onClick={(event) => event.stopPropagation()}>
                            <button type="button" className="flex w-full rounded-sm px-2.5 py-1.5 text-left text-xs hover:bg-accent" onClick={() => { setFolderMenuId(null); setActiveFolderId(folder.id) }}>打开</button>
                            <button type="button" className="flex w-full rounded-sm px-2.5 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10" onClick={() => void deleteProjectFolder(folder.id)}>删除</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              <input ref={folderUploadInputRef} type="file" multiple accept="video/*" className="hidden" onChange={handleFolderUpload} {...({ webkitdirectory: '', directory: '' } as any)} />
              <AdminVideoManager projectId={project.id} videos={workspaceVideos} projectStatus={project.status} restrictToLatestVersion={project.restrictCommentsToLatestVersion} onRefresh={fetchProject} sortMode={sortMode} viewMode={videoViewMode} maxRevisions={project.maxRevisions} enableRevisions={project.enableRevisions} comments={project.comments || []} shareUrl={shareUrl} uploadRequestKey={uploadRequestKey} uploadRequestFiles={uploadRequestFiles} uploadRequestFolderId={uploadRequestFolderId} timestampDisplayMode={project.timestampDisplay} selectionToolbarTargetId="video-selection-toolbar" onShowVideoInfo={(group) => setSelectedVideoGroupName(group.name)} />
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
                  <Link href={`/studio/projects/${id}/settings`}><Button variant="outline" size="sm" className="mt-4">{t('enableCollection')}</Button></Link>
                </div>
              )}
            </section>

            <section className={activeWorkspace === 'trash' ? undefined : 'hidden'}>
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                <span className={iconBadgeClassName}><Trash2 className={iconBadgeIconClassName} /></span>
                {t('recycleBin')}
                {recycleBinCount !== null && <span className={countBadgeClassName}>{recycleBinCount}</span>}
              </h2>
              <RecycleBinBlock key={recycleBinRefreshKey} projectId={project.id} onCountChange={setRecycleBinCount} />
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
                  {selectedVideoGroup.videos.map((video: any, videoIndex: number) => {
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
                    const isLatestVersion = videoIndex === 0

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
                        {isLatestVersion && selectedVideoGroup.videos.length > 1 && canRollbackVersion && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3 h-8 w-full border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => openRollbackDialog(video)}
                          >
                            <RotateCcw className="mr-2 h-3.5 w-3.5" />
                            {t('rollbackVersion')}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="mt-2 h-8 w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={deletingVersionId === video.id}
                          onClick={() => void deleteVideoVersion(video)}
                        >
                          {deletingVersionId === video.id ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-2 h-3.5 w-3.5" />}
                          {t('deleteVideoVersion')}
                        </Button>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            ) : (
              <ProjectActions project={project} videos={workspaceVideos} onRefresh={fetchProject} shareUrl={shareUrl} />
            )}
          </aside>
        </div>
      </div>

      <Dialog
        open={Boolean(rollbackTarget)}
        onOpenChange={(open) => {
          if (!open && !rollingBackVideoId) {
            setRollbackTarget(null)
            setRollbackError('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md" hideClose={Boolean(rollingBackVideoId)}>
          <DialogHeader>
            <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-md bg-destructive/10 text-destructive">
              <TriangleAlert className="h-5 w-5" />
            </div>
            <DialogTitle>{t('rollbackVersionTitle', { version: rollbackTarget?.versionLabel || '' })}</DialogTitle>
            <DialogDescription className="leading-6">
              {t('rollbackVersionDescription', {
                version: rollbackTarget?.versionLabel || '',
                previousVersion: selectedVideoGroup?.videos[1]?.versionLabel || '',
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm leading-6 text-foreground">
            {t('rollbackVersionCommentWarning', {
              count: rollbackTarget ? countVideoComments(project.comments || [], rollbackTarget.id) : 0,
            })}
          </div>

          {rollbackError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {rollbackError}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(rollingBackVideoId)}
              onClick={() => {
                setRollbackTarget(null)
                setRollbackError('')
              }}
            >
              {tc('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={Boolean(rollingBackVideoId)}
              onClick={rollbackLatestVersion}
            >
              {rollingBackVideoId
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <RotateCcw className="mr-2 h-4 w-4" />}
              {rollingBackVideoId ? t('rollingBackVersion') : t('confirmRollbackVersion')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
