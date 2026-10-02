'use client'

import { useEffect, useState, useCallback, useMemo, useRef, type ElementType } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import Link from 'next/link'
import AdminVideoManager from '@/components/AdminVideoManager'
import ProjectActions from '@/components/ProjectActions'
import PanelToggleButton from '@/components/PanelToggleButton'
import VideoPlayer from '@/components/VideoPlayer'
import CommentSection from '@/components/CommentSection'
import ProjectUploadsBlock from '@/components/ProjectUploadsBlock'
import PhotoAlbumsBlock from '@/components/PhotoAlbumsBlock'
import RecycleBinBlock from '@/components/RecycleBinBlock'
import ShareLinksPanel from '@/components/ShareLinksPanel'
import CreateShareDialog, { type SharePreset, type ShareTarget } from '@/components/CreateShareDialog'
import { ArrowLeft, Settings, ArrowUpDown, Video, FolderUp, Images, Trash2, Check, ExternalLink, Upload, Grid2X2, List, Clock3, Layers3, X, RotateCcw, Loader2, TriangleAlert, Plus, Users, MoreVertical, Link2, Share2, Download, Package, Pencil, ChevronRight, ChevronDown, MessageSquare, PackageCheck, PanelRight, MonitorPlay } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useTranslations } from 'next-intl'
import { logError } from '@/lib/logging'
import { cn } from '@/lib/utils'
import { copyTextToClipboard } from '@/lib/clipboard'
import { isVideoCandidate, VIDEO_INPUT_ACCEPT } from '@/lib/video-file-signature'
import { getLatestVideo } from '@/lib/video-comment-counts'
import { useAuth } from '@/components/AuthProvider'
import FolderInteraction from '@/components/ui/folder-interaction'
import { appAlert, appConfirm, appPrompt } from '@/components/AppDialogProvider'

// Force dynamic rendering (no static pre-rendering)
export const dynamic = 'force-dynamic'

const VIDEO_VIEW_MODE_KEY = 'vitransfer-admin-video-view-mode'
const WORKSPACE_VIEW_KEY = 'vitransfer-admin-project-workspace'
const SIDEBAR_COLLAPSED_KEY = 'vitransfer-admin-project-sidebar-collapsed'
const INFO_AREA_COLLAPSED_KEY = 'vitransfer-admin-project-info-collapsed'
const REVIEW_PANE_KEY = 'vitransfer-admin-project-review-pane'
const REVIEW_COMMENTS_PANE_KEY = 'vitransfer-admin-project-review-comments-pane'
// 服务端令牌按会话缓存，客户端只挡住「每 5 秒轮询都重签一遍」；真过期交给播放器的 onStreamAuthExpired 重签。
const REVIEW_STREAM_TTL_MS = 10 * 60 * 1000

const CONTEXT_MENU_ITEM_CLASS_NAME = 'flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent'
const MENU_SEPARATOR_CLASS_NAME = 'my-1 border-t border-border'

// 页内审阅的宽屏列模板（基础两列是「项目侧栏 + 素材网格」，打开面板后按对标追加等高竖栏：
// 素材网格 | 播放器 | 批注，并排、各自滚动，整行仍铺满视口高度）。
// 三条可变列走 CSS 变量（--shell-grid / --shell-player / --shell-comments），拖动分离器时只改变量，
// 模板结构本身不动 —— Tailwind 只扫源码，运行时拼出来的 class 扫不到，但变量值是内联 style，不受影响。
// 余量归谁：素材网格是唯一那条弹性列（1fr），播放器和批注栏一律按 px 定宽（拖过 = 拖出来的值，
// 没拖过 = 窗口三等分）。关掉任一块面板腾出来的空间只会被素材网格吸收，另一块面板一寸都不涨 ——
// 早先是「行尾那条弹性列」吸收，关掉批注时播放器从 440 涨到 575，等于继承了兄弟的地盘，他否掉了。
// · 播放器下限 440px：实测播控条本身要 404px，再加左右内边距，440 以下开始裁字。
// · 网格下限 248px：让卡片不被压的理论值是 262（线上卡 230 + 这一列 main 的 p-4 左右 32px），
//   但 lg 那一档整行只有 984 可用，262 会溢出 12px。取 248 让最窄那档装得下，
//   代价只有窗口窄到 1024 且真把网格压到底时，卡片比线上窄 14px。
// · 批注下限 240px：对标那条信息栏约 360px。
// · 并排从 lg（1024）起：288 + 248 + 2 + 440 = 978，装得进 1024 减掉容器左右留白的 984。
// · 批注那条要 288 + 248 + 2 + 440 + 2 + 240 = 1220，lg 那 984 装不下，所以它从 xl（1280，容器 1240）
//   才收成第四列；1024–1279 期间它横跨整行压在播放器下面（面板自己带 lg:col-span-4 / xl:col-span-1 换形）。
// · 只开批注不开播放器时，行里根本没有播放器那一列，模板直接是「侧栏 | 网格 | 2 | 批注」，
//   从 lg 就并排：288 + 248 + 2 + 240 = 778，比播放器那一档还宽松。
// · 未拖之前的默认：不是一律三等分，而是按他浏览器里拖到手感对了的那一屏定的固定份额 ——
//   在「100% - 侧栏 - 两枚把手」这条 room 里，播放器拿 36%、批注拿 20%，素材网格拿剩下的 44%。
//   份额只乘 room，与「开着几块」无关，所以关一块面板不许改变留下来的那一块（同上一条）。
//   出处：他 2560 宽那一屏的窗口截图实测三列 = 网格 556 : 播放器 454 : 批注 246（截图像素，
//   比例与缩放无关）→ 0.443 / 0.361 / 0.196，取整成 0.44 / 0.36 / 0.20。
// · 实测（一次性几何探针 + dev 编译出的真 CSS，1024/1280/1484/1920/2560 五档 × 未拖 / 拖到 560+280 两套变量）：
//   任何一档都不许出现正的溢出，素材网格恒 ≥248，且关掉任一块面板另一块的宽度和都开着时一致。
// · 窄于 lg 没有并排余量，两块面板通栏压在素材网格下面。
const SHELL_TRACK_MIN = { grid: 248, player: 440, comments: 240 } as const
// 未拖之前各拿 room 的几成（见上条出处）。窗口窄到份额低于下限时，下限优先。
const SHELL_PANE_SHARE = { player: 0.36, comments: 0.2 } as const
const SHELL_COL_WIDTHS_KEY = 'vitransfer-admin-project-shell-cols'

// 类名必须整串字面量写死：Tailwind 只扫源码，运行时拼出来的 class 扫不到（实测 `${'6px'}` 一插值，
// 那两条模板就直接从 CSS 里消失）。
const SHELL_GRID_COLS = {
  withSidebar: {
    plain: 'lg:grid-cols-[288px_var(--shell-grid)]',
    player: 'lg:grid-cols-[288px_var(--shell-grid)_2px_var(--shell-player)]',
    comments: 'lg:grid-cols-[288px_var(--shell-grid)_2px_var(--shell-comments)]',
    both: 'lg:grid-cols-[288px_var(--shell-grid)_2px_var(--shell-player)] xl:grid-cols-[288px_var(--shell-grid)_2px_var(--shell-player)_2px_var(--shell-comments)]',
  },
  collapsed: {
    plain: 'lg:grid-cols-[var(--shell-grid)]',
    player: 'lg:grid-cols-[var(--shell-grid)_2px_var(--shell-player)]',
    comments: 'lg:grid-cols-[var(--shell-grid)_2px_var(--shell-comments)]',
    both: 'lg:grid-cols-[var(--shell-grid)_2px_var(--shell-player)] xl:grid-cols-[var(--shell-grid)_2px_var(--shell-player)_2px_var(--shell-comments)]',
  },
} as const

// 面板定宽的钳位：下限永远优先（窗口窄到真装不下时宁可拖不动，也不许把面板压到下限以下）。
function clampPaneWidth(px: number, minPx: number, maxPx: number): number {
  return Math.round(Math.min(Math.max(px, minPx), Math.max(minPx, maxPx)))
}

// 对标的「分离器」：每枚管它右边那一块面板的宽度（左边那枚管播放器，只开批注时管批注栏；
// 右边那枚管播放器与批注栏之间的边界），素材网格永远是吸收余量的那一条，所以整行始终铺满、不会溢出。
// value 是这一列当前的 px 定宽，未拖之前没有定值，就不报 aria-valuenow。
// 双击/方向键 Home 复位成默认宽度（和 Frame.io 一样没有把手外观，靠 hover 变主色提示可拖）。
function ShellColumnSeparator({ label, value, onDrag, onReset, className }: {
  label: string
  value: number | null
  onDrag: (deltaPx: number) => void
  onReset: () => void
  className: string
}) {
  const anchorRef = useRef<number | null>(null)
  const release = (event: React.PointerEvent<HTMLDivElement>) => {
    anchorRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    document.documentElement.style.cursor = ''
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value ?? undefined}
      tabIndex={0}
      className={`group relative hidden cursor-col-resize touch-none focus-visible:outline-none ${className}`}
      onPointerDown={(event) => {
        event.preventDefault()
        anchorRef.current = event.clientX
        event.currentTarget.setPointerCapture(event.pointerId)
        document.documentElement.style.cursor = 'col-resize'
      }}
      onPointerMove={(event) => {
        if (anchorRef.current === null) return
        onDrag(event.clientX - anchorRef.current)
        anchorRef.current = event.clientX
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') onDrag(-16)
        else if (event.key === 'ArrowRight') onDrag(16)
        else if (event.key === 'Home') onReset()
        else return
        event.preventDefault()
      }}
    >
      {/* 静止时这一轨什么都不画：2px 轨道让画布（--background）透出来，两侧的白色栏面之间就是
          对标实测的那条缝（next.frame.io 三处边界都是 2 CSS px 的 #ECEDF4）。hover／键盘聚焦时才在
          缝正中亮起主色，作为「这里可拖」的提示。轨道只有 2px 太窄抓不住，所以垫一枚透明的
          加宽层把命中区撑到 6px（左右各溢出 2px），拖动的手感和改窄之前一样。 */}
      <span aria-hidden className="absolute inset-y-0 -left-[2px] -right-[2px]" />
      <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-transparent transition-colors group-hover:bg-primary group-focus-visible:bg-primary" />
      <span className="absolute inset-y-0 left-1/2 w-full -translate-x-1/2 bg-primary/15 opacity-0 group-focus-visible:opacity-100" />
    </div>
  )
}


const COMMON_ASPECT_RATIOS = [
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '21:9', value: 21 / 9 },
  { label: '9:21', value: 9 / 21 },
]

function triggerBrowserDownload(url: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = ''
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

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
  const commonRatio = COMMON_ASPECT_RATIOS.find((candidate) =>
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
  // The 版本信息 panel reuses the video-version strings, which live in `videos`.
  const tv = useTranslations('videos')
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const id = params?.id as string

  useEffect(() => {
    document.documentElement.classList.add('project-workspace-scroll-lock')
    return () => document.documentElement.classList.remove('project-workspace-scroll-lock')
  }, [])

  const [project, setProject] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [shareUrl, setShareUrl] = useState('')
  const [sortMode, setSortMode] = useState<'status' | 'alphabetical'>('alphabetical')
  const [videoViewMode, setVideoViewMode] = useState<'list' | 'grid'>('grid')
  const [albumSortMode, setAlbumSortMode] = useState<'date' | 'alphabetical'>('date')
  const [activeWorkspace, setActiveWorkspace] = useState<'videos' | 'photos' | 'uploads' | 'shares' | 'trash'>('videos')
  const [photoCounts, setPhotoCounts] = useState<{ albums: number; photos: number } | null>(null)
  const [uploadsCount, setUploadsCount] = useState<number | null>(null)
  const [recycleBinCount, setRecycleBinCount] = useState<number | null>(null)
  const [sharesCount, setSharesCount] = useState<number | null>(null)
  const [recycleBinRefreshKey, setRecycleBinRefreshKey] = useState(0)
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0)
  const [workspaceRefreshing, setWorkspaceRefreshing] = useState(false)
  const [uploadRequestKey, setUploadRequestKey] = useState(0)
  const [uploadRequestFiles, setUploadRequestFiles] = useState<File[] | undefined>(undefined)
  const [uploadRequestFolderId, setUploadRequestFolderId] = useState<string | null>(null)
  const folderUploadInputRef = useRef<HTMLInputElement>(null)
  const [selectedVideoGroupName, setSelectedVideoGroupName] = useState<string | null>(null)
  // 项目信息区宽屏收进左侧项目侧栏，窄屏仍走右列，所以只需要一个折叠开关。
  const [projectInfoOpen, setProjectInfoOpen] = useState(true)
  // 右上角那对面板开关：整块项目侧栏、侧栏下半的信息区（项目信息 / 版本信息）。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [infoAreaCollapsed, setInfoAreaCollapsed] = useState(false)
  // 页内播放器面板：显隐是一个开关，播放令牌在这个页里现签（审片页的取令牌管线在它自己的页面里，不搬过来）。
  const [reviewPaneVisible, setReviewPaneVisible] = useState(false)
  const [reviewCommentsVisible, setReviewCommentsVisible] = useState(false)
  // 两块面板各自的 px 定宽（null = 未拖过，用窗口三等分算）。素材网格不存：它永远是吸收余量的弹性列。
  const [shellCols, setShellCols] = useState<{ player: number | null; comments: number | null }>({ player: null, comments: null })
  const shellGridRef = useRef<HTMLDivElement | null>(null)
  const [reviewStreams, setReviewStreams] = useState<any[]>([])
  const [reviewStreamStatus, setReviewStreamStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [reviewStreamAttempt, setReviewStreamAttempt] = useState(0)
  const reviewTokenCacheRef = useRef(new Map<string, { token: string; mintedAt: number }>())
  const reviewStreamSignatureRef = useRef('')
  const [rollbackTarget, setRollbackTarget] = useState<any | null>(null)
  const [rollingBackVideoId, setRollingBackVideoId] = useState<string | null>(null)
  const [rollbackError, setRollbackError] = useState('')
  const [deletingVersionId, setDeletingVersionId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [projectFolders, setProjectFolders] = useState<Array<{ id: string; name: string; createdAt?: string; _count?: { videos: number } }>>([])
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  const [folderMenu, setFolderMenu] = useState<{ id: string; left: number; top: number } | null>(null)
  const [folderShareMenuId, setFolderShareMenuId] = useState<string | null>(null)
  const [shareDialog, setShareDialog] = useState<{ preset: SharePreset; target: ShareTarget } | null>(null)
  const [copiedFolderId, setCopiedFolderId] = useState<string | null>(null)
  const [folderDropTargetId, setFolderDropTargetId] = useState<string | null | undefined>(undefined)
  const [folderCoverUrls, setFolderCoverUrls] = useState<Record<string, string[]>>({})

  const handlePhotoCounts = useCallback((albumCount: number, photoCount: number) => {
    setPhotoCounts({ albums: albumCount, photos: photoCount })
  }, [])

  const handleUploadsCount = useCallback((count: number) => {
    setUploadsCount(count)
  }, [])

  useEffect(() => {
    const closeMenu = () => { setContextMenu(null); setFolderMenu(null); setFolderShareMenuId(null) }
    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [id])

  // Restore workspace preferences across projects.
  useEffect(() => {
    const requestedWorkspace = searchParams?.get('workspace')
    if (requestedWorkspace === 'videos' || requestedWorkspace === 'photos' || requestedWorkspace === 'uploads' || requestedWorkspace === 'shares' || requestedWorkspace === 'trash') {
      setActiveWorkspace(requestedWorkspace)
      return
    }
    try {
      const savedVideoView = localStorage.getItem(VIDEO_VIEW_MODE_KEY)
      if (savedVideoView === 'list' || savedVideoView === 'grid') setVideoViewMode(savedVideoView)
      const savedWorkspace = localStorage.getItem(WORKSPACE_VIEW_KEY)
      if (savedWorkspace === 'videos' || savedWorkspace === 'photos' || savedWorkspace === 'uploads' || savedWorkspace === 'shares' || savedWorkspace === 'trash') {
        setActiveWorkspace(savedWorkspace)
      }
      setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')
      setInfoAreaCollapsed(localStorage.getItem(INFO_AREA_COLLAPSED_KEY) === '1')
      setReviewPaneVisible(localStorage.getItem(REVIEW_PANE_KEY) === '1')
      setReviewCommentsVisible(localStorage.getItem(REVIEW_COMMENTS_PANE_KEY) === '1')
      const savedShellCols = JSON.parse(localStorage.getItem(SHELL_COL_WIDTHS_KEY) || 'null')
      // 旧格式里存的 grid 直接忽略：素材网格不再冻宽。
      setShellCols({
        player: Number.isFinite(savedShellCols?.player) ? savedShellCols.player : null,
        comments: Number.isFinite(savedShellCols?.comments) ? savedShellCols.comments : null,
      })
    } catch {}
  }, [searchParams])

  // Navigating between projects reuses this component, so a folder left open in
  // the previous project filtered the new project down to an empty grid.
  useEffect(() => {
    setActiveFolderId(null)
  }, [id])

  useEffect(() => {
    const requestedFolder = searchParams?.get('folder')
    if (requestedFolder && projectFolders.some((folder) => folder.id === requestedFolder)) {
      setActiveFolderId(requestedFolder)
    }
  }, [projectFolders, searchParams])

  const changeVideoViewMode = (mode: 'list' | 'grid') => {
    setVideoViewMode(mode)
    try { localStorage.setItem(VIDEO_VIEW_MODE_KEY, mode) } catch {}
  }

  const changeWorkspace = (workspace: 'videos' | 'photos' | 'uploads' | 'shares' | 'trash') => {
    setActiveWorkspace(workspace)
    if (workspace === 'trash') setRecycleBinRefreshKey((value) => value + 1)
    if (workspace !== 'videos') setSelectedVideoGroupName(null)
    try { localStorage.setItem(WORKSPACE_VIEW_KEY, workspace) } catch {}
    const nextParams = new URLSearchParams(searchParams?.toString() || '')
    nextParams.set('workspace', workspace)
    router.replace(`/studio/projects/${id}?${nextParams.toString()}`, { scroll: false })
  }

  const toggleReviewPane = () => {
    const next = !reviewPaneVisible
    setReviewPaneVisible(next)
    try { localStorage.setItem(REVIEW_PANE_KEY, next ? '1' : '0') } catch {}
  }

  const toggleReviewCommentsPane = () => {
    const next = !reviewCommentsVisible
    setReviewCommentsVisible(next)
    try { localStorage.setItem(REVIEW_COMMENTS_PANE_KEY, next ? '1' : '0') } catch {}
  }

  // 版本信息住在侧栏下半区，所以两块面板被收起时点卡片上的「版本信息」会没有反馈：选中素材就把它们拉回来。
  const showVersionInfo = (videoGroup: { name: string; videos: any[] }) => {
    setSelectedVideoGroupName(videoGroup.name)
    if (sidebarCollapsed) {
      setSidebarCollapsed(false)
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '0') } catch {}
    }
    if (infoAreaCollapsed) {
      setInfoAreaCollapsed(false)
      try { localStorage.setItem(INFO_AREA_COLLAPSED_KEY, '0') } catch {}
    }
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

  // Each workspace block owns its own list fetch, so a refresh remounts them all —
  // otherwise the nav counts and the visible list keep whatever was loaded on mount.
  async function refreshWorkspace() {
    setWorkspaceRefreshing(true)
    try {
      await fetchProject()
      setWorkspaceRefreshKey((key) => key + 1)
    } finally {
      setWorkspaceRefreshing(false)
    }
  }

  // Polling and comment events hand back a fresh `project` object, so the cover
  // effect keys off the folder/video identity it actually renders. Without this
  // every poll re-mints every cover.
  const folderCoverSignatureRef = useRef('')

  useEffect(() => {
    if (!project?.folders?.length || !project?.videos?.length) {
      setFolderCoverUrls({})
      folderCoverSignatureRef.current = ''
      return
    }

    const folders = project.folders as Array<{ id: string }>
    const videos = project.videos as any[]
    const signature = folders
      .map(folder => `${folder.id}=${videos
        .filter(video => video.folderId === folder.id && video.thumbnailPath)
        .map(video => `${video.name}@${video.version}`)
        .join(',')}`)
      .join('|')
    if (signature === folderCoverSignatureRef.current) return
    folderCoverSignatureRef.current = signature

    let cancelled = false
    const loadFolderCovers = async () => {
      const coverGroups = await Promise.all(folders.map(async folder => {
        const latestByName = new Map<string, any>()
        for (const video of videos) {
          if (video.folderId !== folder.id || !video.thumbnailPath) continue
          const current = latestByName.get(video.name)
          if (!current || Number(video.version || 0) > Number(current.version || 0)) latestByName.set(video.name, video)
        }
        const candidates = [...latestByName.values()].slice(0, 3)
        const urls = await Promise.all(candidates.map(async (video) => {
          try {
            const query = new URLSearchParams({ videoId: video.id, projectId: String(id), quality: 'thumbnail' })
            const response = await apiFetch(`/api/studio/video-token?${query.toString()}`, { cache: 'no-store' })
            if (!response.ok) return null
            const data = await response.json()
            return data.token ? `/api/content/${data.token}` : null
          } catch {
            return null
          }
        }))
        return { folderId: folder.id, urls: urls.filter(Boolean) as string[] }
      }))

      if (cancelled) return
      setFolderCoverUrls(Object.fromEntries(coverGroups.map(group => [group.folderId, group.urls])))
    }
    void loadFolderCovers()
    return () => { cancelled = true }
  }, [id, project?.folders, project?.videos])

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

  // 窄栏搜索面板点到本项目某条素材时走这里：素材的选中态住在本页，事件总线是仓库现成的写法。
  // 行为和点素材卡一致（changeWorkspace / showVersionInfo），只是多切一次文件夹——
  // 素材可能不在当前文件夹里，不切过去选中了也筛不出来、面板是空的。
  useEffect(() => {
    const handleOpenAsset = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; folderId?: string | null }>).detail
      if (!detail?.name) return
      setActiveWorkspace('videos')
      try { localStorage.setItem(WORKSPACE_VIEW_KEY, 'videos') } catch {}
      const params = new URLSearchParams(window.location.search)
      params.set('workspace', 'videos')
      router.replace(`/studio/projects/${id}?${params.toString()}`, { scroll: false })
      setActiveFolderId(detail.folderId ?? null)
      setSelectedVideoGroupName(detail.name)
      if (sidebarCollapsed) {
        setSidebarCollapsed(false)
        try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '0') } catch {}
      }
      if (infoAreaCollapsed) {
        setInfoAreaCollapsed(false)
        try { localStorage.setItem(INFO_AREA_COLLAPSED_KEY, '0') } catch {}
      }
      setReviewPaneVisible(true)
      try { localStorage.setItem(REVIEW_PANE_KEY, '1') } catch {}
    }
    window.addEventListener('railOpenAsset', handleOpenAsset as EventListener)
    return () => window.removeEventListener('railOpenAsset', handleOpenAsset as EventListener)
  }, [id, router, sidebarCollapsed, infoAreaCollapsed])

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
      if (!id) return

      try {
        const response = await apiFetch(`/api/share/url?projectId=${id}`)
        if (response.ok) {
          const data = await response.json()
          if (data.shareUrl) setShareUrl(data.shareUrl)
        }
      } catch (error) {
        logError('Error fetching share URL:', error)
      }
    }

    fetchShareUrl()
  }, [id])


  // The video grid and its effects key off these arrays, so their identities
  // have to survive unrelated re-renders (a poll replaces `project` with a new
  // object on every tick).
  const workspaceVideos = useMemo(() => {
    const videos = (project?.videos as any[] | undefined) || []
    return videos.filter((video: any) =>
      !(video.status === 'PROCESSING' && video.sourceUpload?.id)
      && (activeFolderId ? video.folderId === activeFolderId : !video.folderId)
    )
  }, [project?.videos, activeFolderId])

  const videoGroupNames = useMemo(
    () => Array.from(new Set(workspaceVideos.map((v: any) => v.name))) as string[],
    [workspaceVideos]
  )

  // 播放器只吃选中素材的 READY 版本：一次点卡签一份，不铺满整项目（令牌有分钟级有效期，也有签发配额）。
  const reviewVersions = useMemo(() => {
    if (!selectedVideoGroupName) return [] as any[]
    return workspaceVideos
      .filter((video: any) => video.name === selectedVideoGroupName && video.status === 'READY')
      .sort((a: any, b: any) => b.version - a.version)
  }, [workspaceVideos, selectedVideoGroupName])

  // 重签发要认得出是哪一条流死了，但回调本身得保持稳定，所以版本表另存一份 ref。
  const reviewVersionsRef = useRef<any[]>([])
  useEffect(() => {
    reviewVersionsRef.current = reviewVersions
  }, [reviewVersions])

  const mintReviewToken = useCallback(async (videoId: string, quality: '720p' | 'hls', force = false): Promise<string> => {
    const cacheKey = `${videoId}:${quality}`
    const cached = reviewTokenCacheRef.current.get(cacheKey)
    if (!force && cached && Date.now() - cached.mintedAt < REVIEW_STREAM_TTL_MS) return cached.token

    const query = new URLSearchParams({ videoId, projectId: String(id), quality })
    const response = await apiFetch(`/api/studio/video-token?${query.toString()}`, { cache: 'no-store' })
    if (!response.ok) throw new Error('Failed to mint playback token')
    const data = await response.json()
    if (!data.token) throw new Error('Missing playback token')
    reviewTokenCacheRef.current.set(cacheKey, { token: data.token, mintedAt: Date.now() })
    return data.token as string
  }, [id])

  const reviewPaneMounted = reviewPaneVisible && activeWorkspace === 'videos'
  // 批注这条竖栏自己成立，不需要播放器陪着。但评论要挂在带帧号的时间码上，所以仍然要求
  // 当前工作区真的有素材（照片/上传/分享/回收站里没有可批的线程），且项目开着「接受反馈」。
  const reviewCommentsMounted = reviewCommentsVisible && activeWorkspace === 'videos' && !project?.hideFeedback

  // 宽屏列模板：四档状态各一套，见文件头 SHELL_GRID_COLS 的注释。
  const shellGridCols = (sidebarCollapsed ? SHELL_GRID_COLS.collapsed : SHELL_GRID_COLS.withSidebar)[
    reviewCommentsMounted ? (reviewPaneMounted ? 'both' : 'comments') : reviewPaneMounted ? 'player' : 'plain'
  ]

  // 面板列宽是定宽：拖过 = 拖出来的 px，没拖过 = room 的固定份额（见文件头「未拖之前的默认」那条）。
  // 拖动第一次动手时先读真实渲染出来的列宽当基准 —— 未拖之前那个值只有浏览器算得出来。
  const measureShellPanes = useCallback(() => {
    const el = shellGridRef.current
    if (!el) return null
    const tracks = getComputedStyle(el).gridTemplateColumns.split(' ').map((value) => parseFloat(value))
    const gridIdx = sidebarCollapsed ? 0 : 1
    // 轨道顺序：[288 侧栏] 网格 2 [播放器 2 [批注]]。读不到那一枚 = 它不在这一行里
    //（1024–1279 期间批注横跨整行压在播放器下面），记 null 让调用方按「不在这一行」处理。
    const at = (index: number) => (Number.isFinite(tracks[index]) ? tracks[index] : null)
    if (!reviewPaneMounted) return { player: null, comments: at(gridIdx + 2) }
    return { player: at(gridIdx + 2), comments: reviewCommentsMounted ? at(gridIdx + 4) : null }
  }, [sidebarCollapsed, reviewPaneMounted, reviewCommentsMounted])

  // 整行里被占死的量：项目侧栏 288（折叠时 0）+ 两枚把手各 2px（＝栏面之间那条缝的宽度）。
  // 把手固定按两枚算，即便 1024–1279 那一档只有一枚把手真进了这一行：宁可少给 2px，也不让面板宽度跟着「开几块」变。
  const shellFixedPx = (sidebarCollapsed ? 0 : 288) + 4
  // 两块面板加起来最多能占多少：整行减掉被占死的量和素材网格的下限。
  const shellPanesRoomPx = useCallback(
    () => (shellGridRef.current?.clientWidth ?? 0) - shellFixedPx - SHELL_TRACK_MIN.grid,
    [shellFixedPx],
  )
  // 一块面板的列宽：拖过就是拖出来的 px，没拖过按 room 的固定份额；两者都再顶一条「不许把另外两列
  // 挤穿各自下限」的线（素材网格 248 + 另一块面板的下限）。这条顶线也让拖出来的宽度在窗口变窄后
  // 自动收着，不必监听 resize。
  const shellPaneWidth = (minPx: number, otherMinPx: number, share: number, px: number | null) => (
    `minmax(${minPx}px,min(${px === null ? `calc((100% - ${shellFixedPx}px) * ${share})` : `${px}px`},calc(100% - ${shellFixedPx + SHELL_TRACK_MIN.grid + otherMinPx}px)))`
  )

  // 左边那枚改它右边那块面板的宽度（开着播放器就是播放器，只开批注时是批注栏）：向右拖面板变窄，
  // 让出来的量归素材网格；这条边界碰不到批注栏，所以关掉批注时播放器的宽度一动不动。
  const dragGridEdge = useCallback((deltaPx: number) => {
    const base = measureShellPanes()
    if (!base) return
    if (reviewPaneMounted) {
      // 批注栏在同一行里时（xl），它那一列现有的宽度得先给扣掉，否则素材网格会被顶穿下限。
      const commentsPx = base.comments ?? 0
      setShellCols((prev) => {
        // 基准优先取真实渲染值：顶线生效时存的那个值已经比画面上的宽。
        const start = base.player ?? prev.player
        if (start === null) return prev
        return { ...prev, player: clampPaneWidth(start - deltaPx, SHELL_TRACK_MIN.player, shellPanesRoomPx() - commentsPx) }
      })
      return
    }
    setShellCols((prev) => {
      const start = base.comments ?? prev.comments
      if (start === null) return prev
      return { ...prev, comments: clampPaneWidth(start - deltaPx, SHELL_TRACK_MIN.comments, shellPanesRoomPx()) }
    })
  }, [measureShellPanes, reviewPaneMounted, shellPanesRoomPx])

  // 右边那枚只在播放器和批注栏之间来回搬量，两边各留自己的下限，素材网格完全不参与。
  const dragPlayerEdge = useCallback((deltaPx: number) => {
    const base = measureShellPanes()
    if (!base) return
    const playerStart = base.player
    const commentsStart = base.comments
    if (playerStart === null || commentsStart === null) return
    setShellCols(() => {
      const player = clampPaneWidth(playerStart + deltaPx, SHELL_TRACK_MIN.player, shellPanesRoomPx() - SHELL_TRACK_MIN.comments)
      return { player, comments: clampPaneWidth(commentsStart - (player - playerStart), SHELL_TRACK_MIN.comments, shellPanesRoomPx() - SHELL_TRACK_MIN.player) }
    })
  }, [measureShellPanes, shellPanesRoomPx])

  const resetShellCols = useCallback(() => setShellCols({ player: null, comments: null }), [])

  const shellTrackVars = {
    // 整行唯一那条弹性列：所有余量都归它，所以关掉任一块面板只有素材网格变宽。
    '--shell-grid': `minmax(${SHELL_TRACK_MIN.grid}px,1fr)`,
    '--shell-player': shellPaneWidth(SHELL_TRACK_MIN.player, SHELL_TRACK_MIN.comments, SHELL_PANE_SHARE.player, shellCols.player),
    '--shell-comments': shellPaneWidth(SHELL_TRACK_MIN.comments, SHELL_TRACK_MIN.player, SHELL_PANE_SHARE.comments, shellCols.comments),
  } as React.CSSProperties

  useEffect(() => {
    try {
      if (shellCols.player !== null || shellCols.comments !== null) {
        localStorage.setItem(SHELL_COL_WIDTHS_KEY, JSON.stringify(shellCols))
      } else {
        localStorage.removeItem(SHELL_COL_WIDTHS_KEY)
      }
    } catch {}
  }, [shellCols])

  useEffect(() => {
    // 批注栏可以单独开着：评论要挂在带帧号的时间码上，没有播放器也得有这一份版本令牌才能取到流地址。
    if (!(reviewPaneMounted || reviewCommentsMounted) || reviewVersions.length === 0) {
      setReviewStreams([])
      setReviewStreamStatus('idle')
      return
    }
    // 轮询每 5 秒换掉整个 project 对象，所以按版本身份判断要不要重签，而不是按数组身份。
    const signature = `${selectedVideoGroupName}|${reviewVersions.map((video: any) => `${video.id}@${video.version}`).join('')}|${reviewStreamAttempt}`
    if (signature === reviewStreamSignatureRef.current) return
    reviewStreamSignatureRef.current = signature

    let cancelled = false
    setReviewStreamStatus('loading')
    void (async () => {
      const settled = await Promise.allSettled(reviewVersions.map(async (video: any) => {
        const progressive = await mintReviewToken(video.id, '720p')
        const hls = video.hlsPath ? await mintReviewToken(video.id, 'hls').catch(() => '') : ''
        return {
          ...video,
          streamUrl720p: `/api/content/${progressive}`,
          hlsUrl720p: hls ? `/api/content/${hls}` : '',
        }
      }))
      if (cancelled) return
      const minted = settled.filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled').map(result => result.value)
      setReviewStreams(minted)
      setReviewStreamStatus(minted.length > 0 ? 'ready' : 'failed')
    })()

    return () => { cancelled = true }
  }, [mintReviewToken, reviewPaneMounted, reviewCommentsMounted, reviewStreamAttempt, reviewVersions, selectedVideoGroupName])

  // 空闲过了令牌有效期时，播放器把这一条交回来：删掉本地缓存重签，成功就换上新的 URL 让它自己重载。
  const recoverReviewStream = useCallback(async (videoId: string) => {
    const video = reviewVersionsRef.current.find((item: any) => item.id === videoId)
    if (!video) return false
    reviewTokenCacheRef.current.delete(`${videoId}:720p`)
    reviewTokenCacheRef.current.delete(`${videoId}:hls`)
    try {
      const progressive = await mintReviewToken(videoId, '720p', true)
      const hls = video.hlsPath ? await mintReviewToken(videoId, 'hls', true).catch(() => '') : ''
      setReviewStreams((current) => current.map((item: any) => item.id === videoId ? {
        ...item,
        streamUrl720p: `/api/content/${progressive}`,
        hlsUrl720p: hls ? `/api/content/${hls}` : '',
      } : item))
      return true
    } catch {
      return false
    }
  }, [mintReviewToken])


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

  const iconBadgeClassName = 'rounded-md p-1.5 flex-shrink-0 bg-foreground/5 dark:bg-foreground/10'
  const iconBadgeIconClassName = 'w-4 h-4 text-primary'
  const countBadgeClassName = 'text-sm font-normal text-muted-foreground'
  const projectToolbarButtonClassName = 'h-9 px-3 sm:min-w-[132px]'
  const versionStatusLabels: Record<string, string> = {
    READY: t('videoStatusReady'),
    PROCESSING: t('videoStatusProcessing'),
    UPLOADING: t('videoStatusUploading'),
    ERROR: t('videoStatusError'),
  }

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

  const copyFolderShareLink = async (folderId: string) => {
    setFolderMenu(null)
    if (!shareUrl) {
      appAlert(tc('errorTryAgain'))
      return
    }
    const separator = shareUrl.includes('?') ? '&' : '?'
    const copied = await copyTextToClipboard(`${shareUrl}${separator}folder=${encodeURIComponent(folderId)}`)
    if (!copied) {
      appAlert(tc('errorTryAgain'))
      return
    }
    setCopiedFolderId(folderId)
    window.setTimeout(() => setCopiedFolderId((current) => current === folderId ? null : current), 1600)
  }

  const openFolderInNewTab = (folderId: string) => {
    setFolderMenu(null)
    window.open(`/studio/projects/${id}?workspace=videos&folder=${encodeURIComponent(folderId)}`, '_blank', 'noopener,noreferrer')
  }

  const openObjectShare = (preset: SharePreset, target: ShareTarget) => {
    setFolderMenu(null)
    setFolderShareMenuId(null)
    setShareDialog({ preset, target })
  }

  // 项目信息里那条「分享审阅链接」开的是同一枚弹窗，只是范围整条换成项目本身
  const shareWholeProjectReview = () =>
    openObjectShare('REVIEW', { scopeType: 'PROJECT', scopeId: project.id, name: project.title })

  const downloadFolderOriginals = async (folderId: string) => {
    setFolderMenu(null)
    const folderVideos = project.videos.filter((video: any) => video.folderId === folderId)
    const versionsByName: Record<string, any[]> = {}
    for (const video of folderVideos) (versionsByName[video.name] ||= []).push(video)
    const latestVideos = Object.values(versionsByName).map((versions) => getLatestVideo(versions))
    if (latestVideos.length === 0) {
      appAlert('文件夹中没有可下载的视频')
      return
    }
    for (const video of latestVideos) {
      const response = await apiFetch(`/api/videos/${video.id}/download-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.url) {
        appAlert(data.error || '生成下载链接失败')
        return
      }
      triggerBrowserDownload(data.url)
      await new Promise((resolve) => window.setTimeout(resolve, 180))
    }
  }

  const downloadFolderZip = async (folderId: string) => {
    setFolderMenu(null)
    const response = await apiFetch(`/api/projects/${id}/folders/download-zip-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.url) {
      appAlert(data.error || '生成打包下载链接失败')
      return
    }
    triggerBrowserDownload(data.url)
  }

  const renameProjectFolder = async (folder: { id: string; name: string }) => {
    setFolderMenu(null)
    const name = (await appPrompt({
      title: '重命名文件夹',
      message: '输入新的文件夹名称。',
      inputLabel: '文件夹名称',
      defaultValue: folder.name,
      required: true,
      maxLength: 120,
      confirmLabel: '保存',
    }))?.trim()
    if (!name || name === folder.name) return
    const response = await apiFetch(`/api/projects/${id}/folders`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId: folder.id, name }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      appAlert(data.error || '重命名文件夹失败')
      return
    }
    setProjectFolders((folders) => folders
      .map((item) => item.id === folder.id ? { ...item, name: data.folder.name } : item)
      .sort((a, b) => a.name.localeCompare(b.name)))
  }

  const createProjectFolder = async () => {
    const name = (await appPrompt({
      title: '新建文件夹',
      message: '创建后可以把项目中的视频拖入文件夹。',
      inputLabel: '文件夹名称',
      placeholder: '例如：第一版素材',
      required: true,
      maxLength: 120,
      confirmLabel: '创建',
    }))?.trim()
    if (!name) return
    const response = await apiFetch(`/api/projects/${id}/folders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      appAlert(data.error || '新建文件夹失败')
      return
    }
    const data = await response.json()
    setProjectFolders((folders) => [...folders, data.folder].sort((a, b) => a.name.localeCompare(b.name)))
  }

  const moveVideoToFolder = async (event: React.DragEvent, folderId: string | null) => {
    event.preventDefault()
    event.stopPropagation()
    setFolderDropTargetId(undefined)
    const droppedFiles = Array.from(event.dataTransfer.files || []).filter(isVideoCandidate)
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
      appAlert('移动视频失败')
      return
    }
    await fetchProject()
  }

  const openFolderUpload = () => folderUploadInputRef.current?.click()

  const handleFolderUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter(isVideoCandidate)
    event.target.value = ''
    if (!files.length) return
    setUploadRequestFolderId(null)
    setUploadRequestFiles(files)
    setUploadRequestKey((key) => key + 1)
  }

  const deleteProjectFolder = async (folderId: string) => {
    const folder = projectFolders.find((item) => item.id === folderId)
    setFolderMenu(null)
    if (!await appConfirm({
      title: '放入回收站',
      message: `确定将“${folder?.name || '该文件夹'}”及其中的视频放入回收站吗？内容将在 7 天后永久删除。`,
      confirmLabel: '放入回收站',
      tone: 'destructive',
    })) return
    const response = await apiFetch(`/api/projects/${id}/folders?folderId=${encodeURIComponent(folderId)}`, { method: 'DELETE' })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      appAlert(data.error || '放入回收站失败')
      return
    }
    if (activeFolderId === folderId) setActiveFolderId(null)
    await fetchProject()
  }

  const deleteVideoVersion = async (video: any) => {
    if (deletingVersionId) return
    if (!await appConfirm(tv('deleteVersionConfirm', { version: video.versionLabel || `v${video.version}` }))) return
    setDeletingVersionId(video.id)
    try {
      const response = await apiFetch(`/api/videos/${video.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || tv('deleteVersionFailed'))
      }
      if (rollbackTarget?.id === video.id) setRollbackTarget(null)
      await fetchProject()
    } catch (error) {
      appAlert(error instanceof Error ? error.message : tv('deleteVersionFailed'))
    } finally {
      setDeletingVersionId(null)
    }
  }

  // 版本信息面板：宽屏坐在左侧项目侧栏的下半区并顶替项目信息（bare，不带白底卡片壳），
  // 窄屏仍走右列的卡片。两处共用同一份结构，只换外壳与内边距。
  const renderVersionInspector = (bare: boolean) => {
    if (!selectedVideoGroup) return null
    const Shell: ElementType = bare ? 'div' : Card
    const ShellBody: ElementType = bare ? 'div' : CardContent
    return (
      <Shell className={bare ? undefined : 'overflow-hidden'}>
        <div className={bare ? 'border-b border-border pb-2.5' : 'border-b border-border px-4 py-4'}>
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
        <ShellBody className={bare ? 'space-y-2 pt-2.5' : 'space-y-2 p-3'}>
          {selectedVideoGroup.videos.map((video: any, videoIndex: number) => {
            const statusLabel = video.approved
              ? t('videoStatusApproved')
              : versionStatusLabels[video.status] || video.status
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
            const uploader = video.uploadedByName
              || (video.uploadedBy === 'client' ? t('unknownUploader') : t('legacyAdminUploader'))
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
                  {tv('deleteVideoVersion')}
                </Button>
              </div>
            )
          })}
        </ShellBody>
      </Shell>
    )
  }

  // 页内播放器：素材卡点一下就在本页播，不跳走。审批仍走版本信息区和卡片菜单（这里 hideApprovalAction，
  // 和审片页传的一样——ProjectInfo 那枚审批按钮是 fixed 定位，浮在面板外会盖住工作区）。
  const renderReviewPane = () => {
    const hasVersions = reviewVersions.length > 0
    const isPlayingStream = hasVersions && reviewStreamStatus !== 'failed' && reviewStreams.length > 0
    const placeholder = (icon: React.ReactNode, message: string) => (
      <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 text-center">
        {icon}
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    )
    return (
      <div className="flex min-w-0 flex-col overflow-hidden rounded-[8px] border-t border-border bg-popover lg:h-full lg:min-h-0 lg:border-t-0">
        {/* 对标「资产查看器」：栏内不放标题条，播放器贴左沿（它自己是 16:9 撑满宽度），右侧留 8px 给滚动条。
            fillContainer 让画面框吃掉整栏（下方仍留播控条那 68px，见下面 playerFrameClassName 的注释），
            于是播控条落在栏底，而不是像以前那样垂在视频下面、底下一截死高。 */}
        <div className="scrollbar-hidden flex min-h-0 flex-1 flex-col overflow-y-auto pr-2">
          {isPlayingStream ? (
            <div className="flex min-h-0 w-full flex-1 flex-col">
              {reviewStreamStatus === 'loading' && (
                <div className="mb-2 flex items-center gap-2 pl-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('reviewPaneLoading')}
                </div>
              )}
              <VideoPlayer
                videos={reviewStreams}
                fillContainer={true}
                projectId={project.id}
                projectStatus={project.status}
                projectTitle={project.title}
                projectDescription={project.description}
                watermarkEnabled={project.watermarkEnabled}
                activeVideoName={selectedVideoGroup?.name}
                isAdmin={canRollbackVersion}
                allowComparison={canRollbackVersion}
                allowAssetDownload={project.allowAssetDownload}
                hideDownloadButton={true}
                hideApprovalAction={true}
                onStreamAuthExpired={recoverReviewStream}
                comments={project.hideFeedback ? [] : (project.comments || [])}
                timestampDisplayMode={project.timestampDisplay}
                playerSurfaceClassName="bg-popover"
                playerSurfaceColor="hsl(var(--popover))"
                controlsSurfaceClassName="bg-popover"
                // 这两个 ! 是整套里唯一能贴标的口子，都来自 VideoPlayer 为「整屏布局」写死的值：
                // · 56vh 上限在整屏页让画面比屏幕还高，在这里正相反 —— 440px 宽的竖栏里 16:9 只有 248px 高，
                //   上限根本用不到，留着只会让人以为画面被裁了。
                // · mb-[76px] 不是死高，是接播控条的：那条 bar 是 `absolute left-0 right-0 top-full`，永远长在画面框
                //   底沿的**外面**，画面框吃掉整栏时它会掉到栏底以下被 overflow 裁掉（=他看到的「播控条没了」）。
                //   真组件实测（2560 窗口，把画面框宽从 360px 扫到 2176px）bar 恒为 68px、不随宽度换行：
                //   留 76 → 底下空 8px；留 68 → bar 底沿与栏底严丝合缝（gap 0）；留 60 → 又被裁掉 8px。
                playerFrameClassName="!max-h-none !mb-[68px]"
              />
            </div>
          ) : (
            <div className="my-auto flex w-full flex-col px-3 pb-3">
              {!selectedVideoGroup ? placeholder(<Video className="h-7 w-7 text-muted-foreground" />, t('reviewPanePickAsset'))
                : !hasVersions ? placeholder(<Clock3 className="h-7 w-7 text-muted-foreground" />, t('reviewPaneNoPlayable'))
                : reviewStreamStatus === 'failed' ? (
                  <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-md border border-dashed border-destructive/30 bg-destructive/5 px-4 text-center">
                    <TriangleAlert className="h-7 w-7 text-destructive" />
                    <p className="text-sm text-muted-foreground">{t('reviewPaneFailed')}</p>
                    <Button variant="outline" size="sm" onClick={() => setReviewStreamAttempt(current => current + 1)}>
                      <RotateCcw className="mr-2 h-3.5 w-3.5" />
                      {t('reviewPaneRetry')}
                    </Button>
                  </div>
                ) : (
                  <div className="aspect-video animate-pulse rounded-md bg-muted/60" />
                )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // 对标 Frame.io 的「资产详细信息」栏。评论线程不用新写一套：CommentSection 和播放器
  // 之间靠 window 上的 videoChanged / seekToTime 等事件对话，和审片页是同一条链路。
  const renderReviewCommentsPane = (isOnlyPane: boolean) => (
    <div className={cn(
      'flex h-[420px] min-w-0 flex-col overflow-hidden rounded-[8px] border-t border-border bg-popover xl:col-span-1 xl:h-full xl:min-h-0 xl:border-t-0',
      // 1024–1279 只放得下「网格 | 播放器」两条竖栏，批注这条横跨整行压在播放器下面；到 xl 才收回第四列。
      // 宽屏这一列的左边不画边框：那条 2px 轨道是分离器占的，静止时透出画布当缝（再画一条会和缝叠成重线）。
      // 播放器整个关着时行里只有「网格 | 批注」两条，批注就坐在把手右边那一格：从 lg 起就是等高竖栏，
      // 不再通栏压下去（那套 h-[420px] / col-span 换形只服务「播放器开着但窗口不够宽」的情况）。
      isOnlyPane ? 'lg:col-span-1 lg:h-full lg:min-h-0 lg:border-t-0' : sidebarCollapsed ? 'lg:col-span-3' : 'lg:col-span-4'
    )}>
      <div className="min-h-0 flex-1">
        <CommentSection
          projectId={project.id}
          comments={project.comments || []}
          clientName={project.title}
          isApproved={project.status === 'APPROVED'}
          restrictToLatestVersion={project.restrictCommentsToLatestVersion}
          videos={reviewStreams}
          isAdminView={true}
          adminUser={user}
          timestampDisplayMode={project.timestampDisplay}
          showShortcutsButton={false}
          showInfoButton={false}
          showCategoryPicker={false}
          sendInsideComposer={true}
        />
      </div>
      {/* CommentSection 把编辑器 portal 到这个锚点：没有锚点就没有输入框。 */}
      <div id="review-comment-composer" className="shrink-0 border-t border-border px-3 py-2" />
    </div>
  )

  return (
    <div className="flex-1 min-h-0 bg-background lg:h-[calc(100dvh-var(--admin-header-height))] lg:overflow-hidden">
      <div className="w-full px-3 py-3 sm:px-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:pl-0 lg:pr-[2px] lg:pt-0 lg:pb-[2px]">
        {/* 对标 next.frame.io 的三层：画布 #ECEDF4 / 栏面 #FFFFFF / 卡面 #F2F3F6。
            实测它这三层的明度差是 19 阶和 13 阶，而我们的 --card 压在 --background 上只有 6 阶，
            所以只画一条 2px 描边时四个区域根本分不开 —— 缺的是中间那层白色栏面（--popover），
            不是描边。下面每个区域都坐到 --popover 上，区域之间让画布透出来当缝。
            四周边距也照它：顶 0（他那条白色顶栏上方只剩 1px 画布）、右 2px、底 2px（实测他窗口右沿
            css x 2545-2546、底沿 y 1245-1246 都是画布），圆角统一 8px（他栏面四角实测 R≈8：
            左栏顶角从 x69/y59 收到 x63/y65，右列底角从 x2544/y1239 收到 x2539/y1244）。 */}
        <div className="mb-[2px] flex flex-wrap items-center justify-between gap-3 rounded-[8px] bg-popover px-3 py-2">
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
            {!project.allowReverseShare && (
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
            {/* 面板开关：页内播放器、页内批注。亮着 = 这块还显示。 */}
            <div className="flex items-center gap-1">
              <PanelToggleButton icon={MonitorPlay} label={t('panelReviewPlayer')} active={reviewPaneVisible} onToggle={toggleReviewPane} />
              {!project.hideFeedback && (
                <PanelToggleButton icon={PanelRight} label={t('panelReviewComments')} active={reviewCommentsVisible} onToggle={toggleReviewCommentsPane} />
              )}
            </div>
          </div>
        </div>

        <div ref={shellGridRef} className={cn(
          'min-h-[calc(100dvh-var(--admin-header-height)-5rem)] lg:min-h-0 lg:flex-1 lg:grid',
          // 侧栏取 288px 是为了让项目信息/版本信息的内容宽度和它原来占右列时一模一样，不因搬家而重排。
          shellGridCols
        )} style={shellTrackVars} >
          {/* 宽屏上下分栏：上半工作区入口、下半信息区（项目信息，选中素材时被版本信息顶替），各自独立滚动。
              下半占 6 成：它的内容量远大于上半，等高会让下半一直滚、上半空掉大半。 */}
          <aside className={cn(
            'flex min-w-0 flex-col lg:mr-[2px] lg:grid lg:min-h-0',
            infoAreaCollapsed ? 'lg:grid-rows-1' : 'lg:grid-rows-[2fr_3fr]',
            sidebarCollapsed && 'hidden'
          )}>
            <nav className="scrollbar-hidden flex gap-1 overflow-x-auto rounded-[8px] bg-popover p-2 lg:flex-col lg:overflow-y-auto lg:py-4">
              {([
                { id: 'videos' as const, label: t('videos'), count: videoGroupNames.length, icon: Video },
                { id: 'photos' as const, label: t('photoAlbums'), count: photoCounts?.albums || 0, icon: Images },
                { id: 'uploads' as const, label: t('collection'), count: uploadsCount || 0, icon: FolderUp },
                { id: 'shares' as const, label: t('shareWorkspace'), count: sharesCount || 0, icon: Share2 },
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

            {/* 侧栏下半区（信息区）：自己一枚白色栏面，和上半区之间隔 2px 画布当缝；
                内容左边缘与上半区的工作区入口对齐（px-2 + px-3）。选中素材时版本信息顶替项目信息。
                窄屏这块不显示，项目信息与版本信息仍走主内容下方那列。 */}
            {!infoAreaCollapsed && (
              <section className="scrollbar-hidden hidden rounded-[8px] bg-popover px-2 lg:mt-[2px] lg:block lg:min-h-0 lg:overflow-y-auto" aria-label={selectedVideoGroup ? tv('versionInfo') : t('projectInfoSection')}>
                {selectedVideoGroup ? renderVersionInspector(true) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setProjectInfoOpen((value) => !value)}
                      aria-expanded={projectInfoOpen}
                      aria-controls="project-info-panel"
                      className="flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {projectInfoOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                      <span className="truncate">{t('projectInfoSection')}</span>
                    </button>
                    {projectInfoOpen && (
                      <div id="project-info-panel" className="px-3 pb-3 pt-1">
                        <ProjectActions project={project} videos={workspaceVideos} onRefresh={fetchProject} bare onShareReview={shareWholeProjectReview} />
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
          </aside>

          <main id="review-workspace" className="scrollbar-hidden relative min-w-0 overscroll-contain bg-popover p-3 sm:p-4 lg:min-h-0 lg:overflow-y-auto lg:rounded-[8px]" onContextMenu={(event) => { if ((event.target as HTMLElement).closest('button,a,input,img,video,[role="menu"],[data-video-card]')) return; event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY }) }}>
            {contextMenu && (
              <div className="fixed z-[100] w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl" style={{ left: Math.min(contextMenu.x, window.innerWidth - 220), top: Math.min(contextMenu.y, window.innerHeight - 260) }} onClick={(event) => event.stopPropagation()}>
                <button type="button" className={CONTEXT_MENU_ITEM_CLASS_NAME} onClick={() => { setContextMenu(null); setUploadRequestFiles(undefined); setUploadRequestFolderId(null); changeWorkspace('videos'); setUploadRequestKey((key) => key + 1) }}><Upload className="h-4 w-4" />上传文件</button>
                <button type="button" className={CONTEXT_MENU_ITEM_CLASS_NAME} onClick={() => { setContextMenu(null); changeWorkspace('videos'); openFolderUpload() }}><FolderUp className="h-4 w-4" />上传文件夹</button>
                <div className={MENU_SEPARATOR_CLASS_NAME} />
                <button type="button" className={CONTEXT_MENU_ITEM_CLASS_NAME} onClick={() => { setContextMenu(null); void createProjectFolder() }}><Plus className="h-4 w-4" />新建文件夹</button>
                <button type="button" disabled={workspaceRefreshing} className={cn(CONTEXT_MENU_ITEM_CLASS_NAME, 'disabled:opacity-60')} onClick={() => { void refreshWorkspace() }}>{workspaceRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}{workspaceRefreshing ? '刷新中…' : '刷新'}</button>
                <div className={MENU_SEPARATOR_CLASS_NAME} />
                <Link href={`/studio/projects/${id}/settings`} className={CONTEXT_MENU_ITEM_CLASS_NAME}><Settings className="h-4 w-4" />项目设置</Link>
                <Link href="/studio/team" className={CONTEXT_MENU_ITEM_CLASS_NAME}><Users className="h-4 w-4" />邀请成员</Link>
              </div>
            )}
            <section className={activeWorkspace === 'videos' ? undefined : 'hidden'}>
              {/* 页内播放器与批注栏不在这块里：它们是和素材网格并排的独立竖栏，见 </main> 之后。 */}
              <div>
              {/* 工具栏吸顶：main 才是滚动容器，负边距让它铺满滚动区、内边距补回原来的留白。
                  底色必须是实色，半透明会让下方滚过的卡片透出字影；z 要压过卡片左上角的勾选圈（z-20），
                  又低于卡片菜单那批 fixed z-[50]/z-[70]。
                  上面那圈负边距只管左右：main 的 padding-top 在吸顶条之上、仍在溢出裁剪区内，滚下来时
                  卡片会从这条 16px 的带子里露出来（实测他截图：卡片顶边 css y70 = main 顶边，吸顶条顶边
                  y85 = main 内容区顶边，中间 15px 全是滚过去的缩略图）。所以再垫一条等高伪元素往上盖。
                  -top-4/h-4 用 rem 而不是字面量 px：它必须永远等于 main 的 sm:p-4，紧凑档把 root 降到
                  15px 时两者一起变 15px，不会盖不全或多盖。 */}
              <div className="sticky top-0 z-30 -mx-3 mb-4 flex flex-wrap items-center gap-2 bg-popover px-3 py-2 before:pointer-events-none before:absolute before:inset-x-0 before:-top-4 before:h-4 before:bg-popover before:content-[''] sm:-mx-4 sm:px-4">
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
                <div className="mb-4 grid content-start gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }} onDrop={(event) => void moveVideoToFolder(event, null)}>
                  {projectFolders.map((folder) => {
                    const count = new Set(project.videos.filter((video: any) => video.folderId === folder.id).map((video: any) => video.name)).size
                    return (
                      <div
                        key={folder.id}
                        className={cn('group relative overflow-hidden bg-card transition-[filter]', folderDropTargetId === folder.id ? 'drop-shadow-sm' : 'hover:drop-shadow-sm')}
                        style={{ clipPath: 'polygon(0 4%, 1% 2%, 3% 0.5%, 5% 0, 27% 0, 29% 0.5%, 31% 2%, 39% 7.5%, 41% 8.5%, 96% 8.5%, 98% 9.5%, 99.5% 11.5%, 100% 14%, 100% 96%, 99.5% 98%, 98% 99.5%, 96% 100%, 4% 100%, 2% 99.5%, 0.5% 98%, 0 96%)' }}
                        onDoubleClick={() => setActiveFolderId(folder.id)}
                        onDragEnter={(event) => { event.preventDefault(); setFolderDropTargetId(folder.id) }}
                        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setFolderDropTargetId(folder.id) }}
                        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFolderDropTargetId(undefined) }}
                        onDrop={(event) => void moveVideoToFolder(event, folder.id)}
                      >
                        <div role="button" tabIndex={0} className="block w-full text-left focus-visible:outline-none" onClick={() => setActiveFolderId(folder.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveFolderId(folder.id) } }}>
                          <div className="flex aspect-video items-center justify-center overflow-hidden bg-muted/40">
                            <FolderInteraction coverUrls={folderCoverUrls[folder.id] || []} itemCount={count} />
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
                        </div>
                        <button type="button" className="absolute bottom-2.5 right-2.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="文件夹操作" title="文件夹操作" aria-haspopup="menu" aria-expanded={folderMenu?.id === folder.id} onClick={(event) => {
                          event.stopPropagation()
                          const rect = event.currentTarget.getBoundingClientRect()
                          const menuWidth = 208
                          const menuHeight = 294
                          const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8))
                          const top = rect.bottom + menuHeight <= window.innerHeight - 8
                            ? rect.bottom + 6
                            : Math.max(8, rect.top - menuHeight - 6)
                          setFolderShareMenuId(null)
                          setFolderMenu((current) => current?.id === folder.id ? null : { id: folder.id, left, top })
                        }}>
                          <MoreVertical className="h-4 w-4" />
                        </button>
                        <svg className={cn('pointer-events-none absolute inset-0 z-30 h-full w-full transition-colors group-focus-within:text-primary', folderDropTargetId === folder.id || folderMenu?.id === folder.id ? 'text-primary' : 'text-border group-hover:text-primary/60')} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                          <path d="M0.5 8 V5 Q0.5 0.5 5 0.5 H27 Q29 0.5 31 2 L39 7.5 Q40.5 8.5 43 8.5 H96 Q99.5 8.5 99.5 12 V96 Q99.5 99.5 96 99.5 H4 Q0.5 99.5 0.5 96 Z" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                        </svg>
                      </div>
                    )
                  })}
                </div>
              )}
              {folderMenu && typeof document !== 'undefined' && (() => {
                const folder = projectFolders.find((item) => item.id === folderMenu.id)
                if (!folder) return null
                const menuItemClass = 'flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                return createPortal(
                  <>
                    <button type="button" className="fixed inset-0 z-[80] cursor-default" aria-label={tc('close')} onClick={() => { setFolderMenu(null); setFolderShareMenuId(null) }} />
                    <div role="menu" aria-label={`${folder.name} 文件夹操作`} className="fixed z-[90] w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl" style={{ left: folderMenu.left, top: folderMenu.top }} onClick={(event) => event.stopPropagation()}>
                      <div className="relative" onMouseEnter={() => setFolderShareMenuId(folder.id)} onMouseLeave={() => setFolderShareMenuId(null)}>
                        <button type="button" role="menuitem" className={menuItemClass} onClick={(event) => { event.stopPropagation(); setFolderShareMenuId(folder.id) }} aria-haspopup="menu" aria-expanded={folderShareMenuId === folder.id}>
                          <Share2 className="h-4 w-4" /><span className="flex-1">分享</span><ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </button>
                        {folderShareMenuId === folder.id && <div role="menu" aria-label={`${folder.name} 分享类型`} className="absolute left-full top-0 z-[100] -ml-px w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl">
                          <button type="button" role="menuitem" className={menuItemClass} onClick={() => openObjectShare('REVIEW', { scopeType: 'FOLDER', scopeId: folder.id, name: folder.name })}><MessageSquare className="h-4 w-4" />审阅分享</button>
                          <button type="button" role="menuitem" className={menuItemClass} onClick={() => openObjectShare('DELIVERY', { scopeType: 'FOLDER', scopeId: folder.id, name: folder.name })}><PackageCheck className="h-4 w-4" />交付分享</button>
                        </div>}
                      </div>
                      <button type="button" role="menuitem" className={menuItemClass} onClick={() => openFolderInNewTab(folder.id)}>
                        <ExternalLink className="h-4 w-4" />新标签页打开
                      </button>
                      <button type="button" role="menuitem" className={menuItemClass} onClick={() => void copyFolderShareLink(folder.id)}>
                        {copiedFolderId === folder.id ? <Check className="h-4 w-4 text-success" /> : <Link2 className="h-4 w-4" />}
                        {copiedFolderId === folder.id ? tc('copied') : '复制文件链接'}
                      </button>
                      <div className={MENU_SEPARATOR_CLASS_NAME} />
                      <button type="button" role="menuitem" className={menuItemClass} onClick={() => void downloadFolderZip(folder.id)}>
                        <Package className="h-4 w-4" />打包下载
                      </button>
                      <button type="button" role="menuitem" className={menuItemClass} onClick={() => void downloadFolderOriginals(folder.id)}>
                        <Download className="h-4 w-4" />下载原文件
                      </button>
                      <button type="button" role="menuitem" className={menuItemClass} onClick={() => void renameProjectFolder(folder)}>
                        <Pencil className="h-4 w-4" />重命名
                      </button>
                      <div className={MENU_SEPARATOR_CLASS_NAME} />
                      <button type="button" role="menuitem" className={cn(menuItemClass, 'text-destructive hover:bg-destructive/10')} onClick={() => void deleteProjectFolder(folder.id)}>
                        <Trash2 className="h-4 w-4" />放入回收站
                      </button>
                    </div>
                  </>,
                  document.body
                )
              })()}
              <input ref={folderUploadInputRef} type="file" multiple accept={VIDEO_INPUT_ACCEPT} className="hidden" onChange={handleFolderUpload} {...({ webkitdirectory: '', directory: '' } as any)} />
              <AdminVideoManager projectId={project.id} videos={workspaceVideos} projectStatus={project.status} restrictToLatestVersion={project.restrictCommentsToLatestVersion} onRefresh={fetchProject} sortMode={sortMode} viewMode={videoViewMode} maxRevisions={project.maxRevisions} enableRevisions={project.enableRevisions} comments={project.comments || []} uploadRequestKey={uploadRequestKey} uploadRequestFiles={uploadRequestFiles} uploadRequestFolderId={uploadRequestFolderId} timestampDisplayMode={project.timestampDisplay} selectionToolbarTargetId="video-selection-toolbar" onShowVideoInfo={showVersionInfo} onOpenInPlayerPane={reviewPaneMounted ? showVersionInfo : undefined} onCreateShare={(preset, target) => openObjectShare(preset, target)} />
                </div>
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
              <PhotoAlbumsBlock key={`albums-${workspaceRefreshKey}`} projectId={project.id} sortMode={albumSortMode} onCountsChange={handlePhotoCounts} />
            </section>

            <section id="collection-inbox" className={activeWorkspace === 'uploads' ? 'scroll-mt-4' : 'hidden'}>
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                <span className={iconBadgeClassName}><FolderUp className={iconBadgeIconClassName} /></span>
                {t('collection')}
                {uploadsCount !== null && <span className={countBadgeClassName}>{uploadsCount}</span>}
              </h2>
              {project.allowReverseShare ? (
                <ProjectUploadsBlock key={`uploads-${workspaceRefreshKey}`} projectId={project.id} onCountChange={handleUploadsCount} videoNames={videoGroupNames} onPromoted={fetchProject} />
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
              <RecycleBinBlock key={`${recycleBinRefreshKey}-${workspaceRefreshKey}`} projectId={project.id} onCountChange={setRecycleBinCount} onRestored={fetchProject} />
            </section>

            <section className={activeWorkspace === 'shares' ? undefined : 'hidden'}>
              <div className="mb-4">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <span className={iconBadgeClassName}><Share2 className={iconBadgeIconClassName} /></span>
                  {t('shareWorkspace')}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">管理项目、文件夹、视频和收录链接</p>
              </div>
              <ShareLinksPanel key={`shares-${workspaceRefreshKey}`} project={project} onCountChange={setSharesCount} />
            </section>
          </main>

          {/* 页内审阅的两块面板：和素材网格同级的网格子项，宽屏时是并排的等高竖栏
              （对标的「资产查看器 | 资产详细信息」就是这个形状）；窄屏没有并排余量，退化成网格下方通栏，
              所以面板的划开边框从 border-l 换成 border-t。列模板见 SHELL_GRID_COLS，
              每条边界一枚可拖分离器（对标「分离器」）：宽屏时边界那条 2px 轨道空着不画，
              让画布透出来当两块白色栏面之间的缝，hover／聚焦才亮一条 2px 主色提示可拖。播放器关着时只剩左边那一枚。 */}
          {(reviewPaneMounted || reviewCommentsMounted) && (
            <ShellColumnSeparator
              label={t('shellResizeGrid')}
              value={reviewPaneMounted ? shellCols.player : shellCols.comments}
              onDrag={dragGridEdge}
              onReset={resetShellCols}
              className="lg:flex"
            />
          )}
          {reviewPaneMounted && renderReviewPane()}
          {reviewCommentsMounted && reviewPaneMounted && (
            <ShellColumnSeparator
              label={t('shellResizePlayer')}
              value={shellCols.player}
              onDrag={dragPlayerEdge}
              onReset={resetShellCols}
              className="lg:hidden xl:flex"
            />
          )}
          {reviewCommentsMounted && renderReviewCommentsPane(!reviewPaneMounted)}

          {/* 宽屏不再占右列：版本信息已搬进左侧项目侧栏的下半区，这块只服务窄屏。 */}
          <aside className="scrollbar-hidden border-t border-border p-3 lg:hidden">
            {selectedVideoGroup ? renderVersionInspector(false) : (
              <ProjectActions project={project} videos={workspaceVideos} onRefresh={fetchProject} onShareReview={shareWholeProjectReview} />
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
      <CreateShareDialog projectId={project.id} open={Boolean(shareDialog)} preset={shareDialog?.preset || 'REVIEW'} target={shareDialog?.target || null} onOpenChange={(open) => { if (!open) setShareDialog(null) }} onCreated={() => window.dispatchEvent(new Event('shareLinksChanged'))} />
    </div>
  )
}
