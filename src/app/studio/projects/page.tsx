'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { Building2, FolderKanban, FolderTree, Plus, Eye, EyeOff, RefreshCw, Copy, Check, AlertCircle, ChevronRight, PanelLeftOpen, Home, Folder, FolderOpen, FolderPlus } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import ProjectsList from '@/components/ProjectsList'
import ProjectsToolbar from '@/components/projects/ProjectsToolbar'
import ProjectsFilterChips from '@/components/projects/ProjectsFilterChips'
import ProjectsSavedViews, { type SavedView } from '@/components/projects/ProjectsSavedViews'
import ProjectsSearchBar from '@/components/projects/ProjectsSearchBar'
import ProjectsDashboard, { ProjectsStats } from '@/components/projects/ProjectsDashboard'
import ProjectsFolderTree from '@/components/projects/ProjectsFolderTree'
import { apiFetch, apiPatch, apiPost, apiDelete } from '@/lib/api-client'
import { logError } from '@/lib/logging'
import { useTranslations } from 'next-intl'
import { SharePasswordRequirements } from '@/components/SharePasswordRequirements'
import { ClientSelector } from '@/components/ClientSelector'
import { generateSharePasscode } from '@/lib/password-utils'
import type { ViewMode } from '@/components/ViewModeToggle'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getActiveTeamId } from '@/lib/team-store'
import { folderPath, type FolderNode } from '@/lib/project-folders'
import {
  applyProjectsQuery,
  clientLabelFor,
  clientKeyFor,
  countProjectsByGroup,
  deserializeFilterState,
  emptyFilterState,
  filterStateFromParams,
  filterStateToParams,
  getDistinctClients,
  getDistinctYears,
  isFilterActive,
  serializeFilterState,
  scopeProjectsToFolder,
  NO_GROUP_KEY,
  type ProjectListItem,
  type ProjectsFilterState,
  type SerializedFilterState,
} from '@/lib/projects-filter'

const FILTERS_STORAGE_KEY = 'admin_projects_filters'
const VIEW_MODE_STORAGE_KEY = 'admin_projects_view'
const FOLDER_RAIL_STORAGE_KEY = 'admin_projects_folder_rail_collapsed'

function loadInitialFilters(searchParams: URLSearchParams): ProjectsFilterState {
  // URL params take precedence so shareable URLs work
  const fromUrl = filterStateFromParams(searchParams)
  if (isFilterActive(fromUrl) || searchParams.has('sort')) return fromUrl

  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(FILTERS_STORAGE_KEY)
    if (stored) {
      try {
        return deserializeFilterState(JSON.parse(stored) as SerializedFilterState)
      } catch {
        // fall through
      }
    }
  }
  return emptyFilterState()
}

function loadInitialViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'grid'
  const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
  if (stored === 'grid' || stored === 'table') return stored
  if (stored === 'list') return 'table'
  return 'grid'
}

export default function AdminPage() {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const router = useRouter()
  const { user } = useAuth()
  const pathname = usePathname()
  const activeTeamId = getActiveTeamId()
  const activeTeam = user?.teams?.find((item) => item.team.id === activeTeamId) || user?.teams?.[0]
  const teamDisabled = activeTeam?.team.status === 'DISABLED'

  const [projects, setProjects] = useState<ProjectListItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [filters, setFilters] = useState<ProjectsFilterState>(() =>
    loadInitialFilters(new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''))
  )
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [foldersLoaded, setFoldersLoaded] = useState(false)
  const [openFolderId, setOpenFolderId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('folder') : null
  )
  const [folderDrawer, setFolderDrawer] = useState(false)
  // 跨会话记忆：树自己的折叠集合就存在 localStorage 里，侧栏收缩是同一层的偏好，不该刷新就忘。
  const [folderRailCollapsed, setFolderRailCollapsed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(FOLDER_RAIL_STORAGE_KEY) === '1'
  )
  const [folderCreateRequest, setFolderCreateRequest] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>(loadInitialViewMode)

  // New Project Modal state
  const [showNewProjectModal, setShowNewProjectModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [isShareOnly, setIsShareOnly] = useState(false)
  const [passwordProtected, setPasswordProtected] = useState(false)
  const [sharePassword, setSharePassword] = useState('')
  const [showPassword, setShowPassword] = useState(true)
  const [copied, setCopied] = useState(false)
  const authMode = 'PASSWORD' as const
  const [projectTitle, setProjectTitle] = useState('')
  const [projectDescription, setProjectDescription] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [clientCompanyId, setClientCompanyId] = useState<string | null>(null)
  const [recipientName, setRecipientName] = useState('')
  const [formError, setFormError] = useState('')
  // Load saved views from API
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch('/api/studio/saved-views')
        if (!res.ok || cancelled) return
        const data = await res.json()
        setSavedViews(data.views || [])
      } catch {
        // non-fatal: dashboard works without saved views
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Load project folders from API
  const loadFolders = async () => {
    try {
      const res = await apiFetch('/api/studio/project-groups')
      if (!res.ok) return
      const data = await res.json()
      setFolders(data.groups || [])
      setFoldersLoaded(true)
    } catch {
      // non-fatal: the grid works without folders, they just stay unfiled
    }
  }

  useEffect(() => {
    void loadFolders()
  }, [])

  // A folder id can outlive its folder (a link opened after it was deleted), and an
  // unknown folder would read as "this folder is empty" with no way back out.
  useEffect(() => {
    if (!foldersLoaded || !openFolderId || openFolderId === NO_GROUP_KEY) return
    if (!folders.some((f) => f.id === openFolderId)) setOpenFolderId(null)
  }, [foldersLoaded, openFolderId, folders])

  // Persist filters to localStorage and sync to URL
  useEffect(() => {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(serializeFilterState(filters)))
    if (!pathname) return
    const params = filterStateToParams(filters)
    // Which folder is open is navigation, not a filter, so it never lands in a saved view.
    if (openFolderId) params.set('folder', openFolderId)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [filters, openFolderId, pathname, router])

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode)
  }, [viewMode])

  useEffect(() => {
    localStorage.setItem(FOLDER_RAIL_STORAGE_KEY, folderRailCollapsed ? '1' : '0')
  }, [folderRailCollapsed])

  // 窄栏搜索面板的关键字沿仓库已有的 window 事件总线送进来，只改 filters.q，
  // 网格自己的筛选逻辑一行不动（同 commentPosted 的用法）。
  useEffect(() => {
    const handleRailSearch = (event: Event) => {
      const detail = (event as CustomEvent<{ q?: string }>).detail
      if (typeof detail?.q !== 'string') return
      setFilters((prev) => (prev.q === detail.q ? prev : { ...prev, q: detail.q as string }))
    }
    window.addEventListener('railSearchQuery', handleRailSearch as EventListener)
    return () => window.removeEventListener('railSearchQuery', handleRailSearch as EventListener)
  }, [])

  const loadProjects = async () => {
    try {
      const projectsRes = await apiFetch('/api/projects')

      if (projectsRes.ok) {
        const data = await projectsRes.json()
        setProjects(data.projects || data || [])
        setLoadError('')
      } else {
        // A failed request must not render as "no projects yet", which reads as
        // if the team's data had disappeared.
        setProjects([])
        setLoadError(projectsRes.status === 403
          ? '没有权限读取项目列表，请确认你已加入当前团队'
          : `项目列表加载失败（HTTP ${projectsRes.status}）`)
      }
    } catch {
      setProjects([])
      setLoadError('项目列表加载失败，请检查网络后重试')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProjects()
  }, [])

  // Options and badges are derived from everything the caller can see under the
  // current filters, then the grid keeps only the open folder's direct contents — so
  // a folder's badge always equals what clicking it brings up.
  const { clientOptions, yearOptions, visibleProjects, filteredProjects, clientLabels, folderCounts } = useMemo(() => {
    const list = projects || []
    const labels: Record<string, string> = {}
    for (const p of list) {
      const k = clientKeyFor(p)
      const l = clientLabelFor(p)
      if (l) labels[k] = l
    }
    const visible = applyProjectsQuery(list, filters)
    return {
      clientOptions: getDistinctClients(list),
      yearOptions: getDistinctYears(list),
      visibleProjects: visible,
      filteredProjects: scopeProjectsToFolder(visible, openFolderId),
      clientLabels: labels,
      folderCounts: countProjectsByGroup(visible),
    }
  }, [projects, filters, openFolderId])

  const breadcrumbs = useMemo(() => {
    if (!openFolderId) return []
    if (openFolderId === NO_GROUP_KEY) {
      return [{ id: NO_GROUP_KEY, name: t('folderUnfiled'), parentId: null }]
    }
    return folderPath(folders, openFolderId)
  }, [openFolderId, folders, t])

  // Saved view handlers — persist to DB
  const handleSaveView = async (name: string) => {
    try {
      const view = await apiPost('/api/studio/saved-views', {
        name,
        state: serializeFilterState(filters),
      })
      setSavedViews(prev => [...prev, view.view])
    } catch (err) {
      logError('Failed to save view:', err)
    }
  }

  const handleSelectView = (view: SavedView | null) => {
    if (!view) {
      setFilters(emptyFilterState())
      return
    }
    setFilters(deserializeFilterState(view.state))
  }

  const handleDeleteView = async (id: string) => {
    // Optimistic remove; on failure, refetch to restore truth
    setSavedViews(prev => prev.filter(v => v.id !== id))
    try {
      const res = await apiFetch(`/api/studio/saved-views/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('delete failed')
    } catch (err) {
      logError('Failed to delete view:', err)
      try {
        const res = await apiFetch('/api/studio/saved-views')
        if (res.ok) {
          const data = await res.json()
          setSavedViews(data.views || [])
        }
      } catch {
        // give up; user can refresh
      }
    }
  }

  const handleClearAll = () => setFilters(emptyFilterState())

  const openFolder = (folderId: string | null) => {
    setOpenFolderId(folderId)
    setFolderDrawer(false)
  }

  // Folder handlers let errors throw: ProjectsFolderTree keeps the editor open and
  // shows the server's reason inline, which is what makes a duplicate name fixable.
  const handleCreateFolder = async (name: string, parentId: string | null) => {
    await apiPost('/api/studio/project-groups', { name, parentId })
    await loadFolders()
  }

  const handleRenameFolder = async (id: string, name: string) => {
    await apiPatch(`/api/studio/project-groups/${id}`, { name })
    await loadFolders()
  }

  const handleMoveFolder = async (id: string, parentId: string | null) => {
    await apiPatch(`/api/studio/project-groups/${id}`, { parentId })
    await loadFolders()
  }

  const handleDeleteFolder = async (id: string) => {
    await apiDelete(`/api/studio/project-groups/${id}`)
    await loadFolders()
    // Whatever was inside the folder (and its subfolders) falls back to "未归类"
    // server-side, so the counts have to be re-read rather than patched locally.
    await loadProjects()
  }

  // One PATCH per project, the way batch status changes already work. Every write is
  // attempted before reporting, and the list is re-read either way, so a half-done
  // move never leaves the sidebar counts lying about where the projects are.
  const handleMoveProjects = async (projectIds: string[], folderId: string | null) => {
    // A project already filed where it is being dropped has nothing to write: sending
    // the PATCH anyway reloads the grid to show the same thing.
    const toMove = projectIds.filter((id) => {
      const current = (projects ?? []).find((p) => p.id === id)
      return !current || (current.groupId || null) !== folderId
    })
    if (!toMove.length) return
    const results = await Promise.allSettled(
      toMove.map((id) => apiPatch(`/api/projects/${id}`, { groupId: folderId }))
    )
    await loadProjects()
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
    }
  }

  // Password helpers
  function handleGeneratePassword() {
    setSharePassword(generateSharePasscode())
    setCopied(false)
  }

  async function handleCopyPassword() {
    if (await copyTextToClipboard(sharePassword)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  function openNewProjectModal() {
    setProjectTitle('')
    setProjectDescription('')
    setCompanyName('')
    setClientCompanyId(null)
    setRecipientName('')
    setIsShareOnly(false)
    setPasswordProtected(false)
    setSharePassword('')
    setShowPassword(true)
    setCopied(false)
    setFormError('')
    setShowNewProjectModal(true)
  }

  async function handleCreateProject() {
    if (!projectTitle.trim()) {
      setFormError(t('titleRequired2'))
      return
    }

    if (passwordProtected && !sharePassword.trim()) {
      setFormError(t('passwordRequired'))
      return
    }

    setCreating(true)
    setFormError('')

    try {
      const data: Record<string, unknown> = {
        title: projectTitle,
        authMode: passwordProtected ? authMode : 'NONE',
        isShareOnly: isShareOnly,
      }

      if (projectDescription) data.description = projectDescription
      if (companyName) data.companyName = companyName
      if (clientCompanyId) data.clientCompanyId = clientCompanyId
      if (recipientName) data.recipientName = recipientName
      data.recipientEmail = null

      if (passwordProtected && sharePassword) {
        data.sharePassword = sharePassword
      }

      const project = await apiPost('/api/projects', data)
      setShowNewProjectModal(false)
      router.push(`/studio/projects/${project.id}`)
    } catch (error) {
      if (error instanceof Error) {
        setFormError(error.message || t('failedToCreateProject'))
      } else {
        setFormError(t('failedToCreateProject'))
      }
    } finally {
      setCreating(false)
    }
  }

  function renderNewProjectModal() {
    return (
      <Dialog open={showNewProjectModal} onOpenChange={setShowNewProjectModal}>
        <DialogContent className="sm:max-w-lg max-h-[calc(100dvh-3rem)] sm:max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderKanban className="w-5 h-5 text-primary" />
              {t('createNew')}
            </DialogTitle>
            <DialogDescription>
              {t('createDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 py-4 -mx-4 px-4 sm:-mx-6 sm:px-6">
            {formError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                <span className="text-sm text-destructive">{formError}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="projectTitle">{t('titleRequired')}</Label>
              <Input
                id="projectTitle"
                placeholder={t('titlePlaceholder')}
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                autoComplete="off"
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="projectDescription">{t('descriptionOptional')}</Label>
              <Textarea
                id="projectDescription"
                placeholder={t('descriptionPlaceholder')}
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
                rows={2}
              />
            </div>

            <ClientSelector
              companyName={companyName}
              onCompanyChange={(name, id) => {
                setCompanyName(name)
                setClientCompanyId(id)
              }}
              recipientName={recipientName}
              onRecipientNameChange={setRecipientName}
              recipientEmail=""
              onRecipientEmailChange={() => {}}
              hideEmail
              disabled={creating}
            />

            <div className="space-y-4 border rounded-lg p-4 bg-primary-visible border-2 border-primary-visible">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <Label htmlFor="passwordProtected" className="text-sm font-semibold">
                    {t('requireAuth')}
                  </Label>
                  <p className={`text-xs ${passwordProtected ? 'text-muted-foreground' : 'font-medium text-foreground'}`}>
                    {passwordProtected ? t('requireAuthDescription') : t('noAuthWarning')}
                  </p>
                </div>
                <input
                  id="passwordProtected"
                  type="checkbox"
                  checked={passwordProtected}
                  onChange={(e) => {
                    const next = e.target.checked
                    setPasswordProtected(next)
                    if (next && !sharePassword.trim()) setSharePassword(generateSharePasscode())
                  }}
                  className="h-5 w-5 rounded border-border text-primary focus:ring-primary mt-1"
                />
              </div>

              {passwordProtected && (
                <div className="space-y-3 pt-2 border-t">
                  <div className="space-y-2">
                    <Label>{t('authMethod')}</Label>
                    <p className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
                      {t('passwordOnly')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('passwordDescription')}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sharePassword">{t('sharePassword')}</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1 min-w-0">
                        <Input
                          id="sharePassword"
                          value={sharePassword}
                          onChange={(e) => setSharePassword(e.target.value)}
                          type={showPassword ? 'text' : 'password'}
                          className="pr-10 font-mono text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handleGeneratePassword}
                        title={t('generatePassword')}
                        className="flex-shrink-0"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handleCopyPassword}
                        title={t('copyPassword')}
                        className="flex-shrink-0"
                      >
                        {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                    {sharePassword && (
                      <SharePasswordRequirements password={sharePassword} />
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t('savePasswordWarning')}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center space-x-2">
                <input
                  id="isShareOnly"
                  type="checkbox"
                  checked={isShareOnly}
                  onChange={(e) => setIsShareOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <Label htmlFor="isShareOnly" className="font-normal cursor-pointer">
                  {t('shareOnly')}
                </Label>
              </div>
              <p className="text-xs text-muted-foreground ml-6">
                {t('shareOnlyDescription')}
              </p>
            </div>

            <p className="text-xs text-muted-foreground border-t pt-3">
              {t('additionalOptions')}
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={creating}>{tc('cancel')}</Button>
            </DialogClose>
            <Button onClick={handleCreateProject} disabled={creating}>
              <Plus className="w-4 h-4 mr-2" />
              {creating ? tc('creating') : t('createProject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  if (loading) {
    // 骨架按真页面的 DOM 形状逐层占位（页头带 / 236px 侧栏 / 工具栏行 / 四张统计卡 / 项目卡网格），
    // 卡内每根占位条用真卡同款字号与行高，不写死整卡高度——猜数字反而会跳版式。
    return (
      <div className="flex-1 min-h-0 bg-background lg:h-[calc(100dvh-var(--admin-header-height))] lg:overflow-hidden">
        <div className="w-full px-3 py-3 sm:px-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:pl-0 lg:pr-[2px] lg:pt-0 lg:pb-[2px]" aria-busy="true">
          <p className="sr-only">{t('loadingProjects')}</p>
          <div className="flex items-center justify-between gap-4 border-b border-border pb-3 mb-3 lg:shrink-0 lg:mb-[2px] lg:rounded-[8px] lg:border-b-0 lg:bg-popover lg:px-4 lg:py-3">
            {/* 页头/按钮/工具栏三段的尺寸都按真元素的实际行高：h1 是 text-2xl(32px)、说明是 text-sm(20px)、Button default 是 h-10。 */}
            <div className="space-y-1">
              <div className="h-8 w-44 animate-pulse rounded-md bg-muted" />
              <div className="h-5 w-64 animate-pulse rounded-md bg-muted/70" />
            </div>
            <div className="h-10 w-24 animate-pulse rounded-md bg-muted" />
          </div>

          <div className="flex items-start gap-4 lg:min-h-0 lg:flex-1 lg:items-stretch lg:gap-[2px]">
            {/* 侧栏骨架跟着已存的收缩态走，否则刷新一次就先看到 236px 再缩成 56px。 */}
            <div className={`scrollbar-hidden hidden h-full min-h-0 flex-shrink-0 flex-col gap-1.5 overflow-y-auto px-2 pb-4 lg:flex lg:rounded-[8px] lg:bg-popover ${folderRailCollapsed ? 'w-14 items-center' : 'w-[236px]'}`}>
              {[0, 1, 2, 3, 4].map((key) => (
                <div key={key} className={`h-9 animate-pulse rounded-lg bg-muted/70 ${folderRailCollapsed ? 'w-9' : 'w-full'}`} />
              ))}
            </div>

            <div className="scrollbar-hidden min-w-0 flex-1 lg:min-h-0 lg:overflow-y-auto lg:rounded-[8px] lg:bg-popover lg:px-4 lg:py-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="h-8 w-24 animate-pulse rounded-md bg-muted/70" />
                <div className="h-8 w-20 animate-pulse rounded-md bg-muted/70" />
                <div className="h-8 w-20 animate-pulse rounded-md bg-muted/70" />
                <div className="ml-auto h-8 w-56 animate-pulse rounded-md bg-muted/70" />
              </div>

              {/* 统计卡：外壳与内层结构和 ProjectsStats 一致（p-4 / gap-3 / w-9 h-9 rounded-[10px]），
                  数字与标签之间真代码没有额外间距，所以占位条用各自行高（20px 粗体 tight=25、12px=16）。 */}
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[0, 1, 2, 3].map((key) => (
                  <div key={key} className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-4 shadow-elevation-md">
                    <div className="h-9 w-9 flex-shrink-0 animate-pulse rounded-[10px] bg-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="h-[25px] w-8 animate-pulse rounded bg-muted" />
                      <div className="h-4 w-16 animate-pulse rounded bg-muted/70" />
                    </div>
                  </div>
                ))}
              </div>

              {/* 项目卡：外壳圆角/阴影与 ProjectCard 一致（rounded-xl shadow-sm border-border），
                  内部四行按真结构补齐（ID 行 min-h-22 / 标题 text-sm / 进度条 mt-2.5 / 计数行 mt-2 min-h-20）。 */}
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
                {[0, 1, 2, 3, 4, 5].map((key) => (
                  <div key={key} className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
                    <div className="flex min-h-[22px] items-center gap-2">
                      <div className="h-[14px] w-12 animate-pulse rounded bg-muted" />
                      <div className="ml-auto h-[20px] w-14 animate-pulse rounded-full bg-muted/70" />
                    </div>
                    <div className="mt-0.5 h-[20px] w-3/4 animate-pulse rounded bg-muted" />
                    <div className="mt-2.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-muted" />
                      <div className="h-[16px] w-10 animate-pulse rounded bg-muted/70" />
                    </div>
                    <div className="mt-2 h-[20px] w-1/2 animate-pulse rounded bg-muted/70" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const totalProjects = projects?.length ?? 0

  if (teamDisabled) {
    return (
      <div className="flex-1 min-h-0 bg-background">
        <div className="w-full px-3 py-3 sm:px-4 lg:pl-0 lg:pr-5">
          <div className="flex justify-between items-center gap-4 mb-4 sm:mb-6">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
                <FolderKanban className="w-7 h-7 sm:w-8 sm:h-8" />
                {t('dashboard')}
              </h1>
              <p className="text-muted-foreground mt-1 text-sm sm:text-base">{t('dashboardDescription')}</p>
            </div>
          </div>
          <Card>
            <div className="py-12 text-center">
              <Building2 className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">团队已停用</p>
              <p className="mt-1 text-sm text-muted-foreground">团队数据仍然保留，启用后即可继续使用项目和视频。</p>
              <Button asChild variant="outline" className="mt-4">
                <Link href="/studio/team?tab=team">查看团队信息</Link>
              </Button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  if (loadError && totalProjects === 0) {
    return (
      <div className="flex-1 min-h-0 bg-background">
        <div className="w-full px-3 py-3 sm:px-4 lg:pl-0 lg:pr-5">
          <div className="mb-4 sm:mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <FolderKanban className="w-7 h-7 sm:w-8 sm:h-8" />
              {t('dashboard')}
            </h1>
          </div>
          <Card>
            <div className="py-12 text-center" role="alert">
              <p className="text-sm font-medium text-destructive">{loadError}</p>
              <p className="mt-1 text-sm text-muted-foreground">项目数据仍在服务器上，恢复连接后重试即可。</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setLoading(true)
                  void loadProjects()
                }}
              >
                重试
              </Button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  if (totalProjects === 0 && user?.role === 'ADMIN') {
    return (
      <div className="flex-1 min-h-0 bg-background">
        <div className="w-full px-3 py-3 sm:px-4 lg:pl-0 lg:pr-5">
          <div className="flex justify-between items-center gap-4 mb-4 sm:mb-6">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
                <FolderKanban className="w-7 h-7 sm:w-8 sm:h-8" />
                {t('dashboard')}
              </h1>
              <p className="text-muted-foreground mt-1 text-sm sm:text-base">{t('dashboardDescription')}</p>
            </div>
            <Button variant="default" size="default" onClick={openNewProjectModal}>
              <Plus className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">{t('newProject')}</span>
            </Button>
          </div>
          <Card>
            <div className="py-12 text-center">
              <p className="text-muted-foreground mb-4">{t('noProjectsYet')}</p>
              <Button variant="default" size="default" onClick={openNewProjectModal}>
                <Plus className="w-4 h-4 mr-2" />
                {t('createFirst')}
              </Button>
            </div>
          </Card>
        </div>
        {renderNewProjectModal()}
      </div>
    )
  }

  const isAdmin = user?.role === 'ADMIN'

  // Only an untouched, genuinely empty folder gets the drag-here guidance; an empty
  // result from the filters is a different problem and keeps the generic copy.
  const folderEmptyMessage =
    openFolderId && openFolderId !== NO_GROUP_KEY && !isFilterActive(filters)
      ? t('folderEmpty')
      : undefined

  // 收缩列里的「新建文件夹」只能向树要它那个行内编辑器：展开 + 递增请求键。
  const requestFolderCreate = () => {
    setFolderRailCollapsed(false)
    setFolderCreateRequest((key) => key + 1)
  }

  const renderFolderTree = (withCollapseRail: boolean) => (
    <ProjectsFolderTree
      folders={folders}
      counts={folderCounts}
      total={visibleProjects.length}
      openFolderId={openFolderId}
      isAdmin={isAdmin}
      onOpen={openFolder}
      onCreate={handleCreateFolder}
      onRename={handleRenameFolder}
      onMoveFolder={handleMoveFolder}
      onDeleteFolder={handleDeleteFolder}
      onDropProjects={handleMoveProjects}
      createRequestKey={folderCreateRequest}
      onCollapseRail={withCollapseRail ? () => setFolderRailCollapsed(true) : undefined}
    />
  )

  const folderTree = renderFolderTree(false)

  return (
    <div className="flex-1 min-h-0 bg-background lg:h-[calc(100dvh-var(--admin-header-height))] lg:overflow-hidden">
      <div className="w-full px-3 py-3 sm:px-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:pl-0 lg:pr-[2px] lg:pt-0 lg:pb-[2px]">
        <div className="flex justify-between items-center gap-4 border-b border-border pb-3 mb-3 lg:shrink-0 lg:mb-[2px] lg:rounded-[8px] lg:border-b-0 lg:bg-popover lg:px-4 lg:py-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
              <FolderKanban className="w-6 h-6" />
              {t('dashboard')}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm sm:text-base">{t('dashboardDescription')}</p>
          </div>
          {isAdmin && <Button variant="default" size="default" onClick={openNewProjectModal}>
            <Plus className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">{t('newProject')}</span>
          </Button>}
        </div>

        <div className="flex items-start gap-4 lg:min-h-0 lg:flex-1 lg:items-stretch lg:gap-[2px]">
          <aside className={`scrollbar-hidden hidden h-full min-h-0 flex-shrink-0 overflow-y-auto px-2 pb-4 lg:block lg:rounded-[8px] lg:bg-popover ${folderRailCollapsed ? 'w-14' : 'w-[236px]'}`}>
            {/* 收缩时树只隐藏、不卸载：行内编辑器与折叠集合都活在组件里，
                卸载再挂就等于给「新建文件夹」写第二套实现。 */}
            <div className={folderRailCollapsed ? 'hidden' : undefined}>{renderFolderTree(true)}</div>
            {folderRailCollapsed && (
              <nav aria-label={t('folder')} className="flex flex-col items-center gap-1">
                {/* 展开键沿用标题行的尺寸与位置，切换时下面的图标列不会整体下沉。 */}
                <div className="flex w-full justify-end px-1 pb-1.5">
                  <FolderRailButton compact label={t('folderRailExpand')} onClick={() => setFolderRailCollapsed(false)}>
                    <PanelLeftOpen className="w-4 h-4" />
                  </FolderRailButton>
                </div>
                <FolderRailButton label={`${t('statAll')} · ${visibleProjects.length}`} active={openFolderId === null} onClick={() => openFolder(null)}>
                  <Home className="w-[18px] h-[18px]" />
                </FolderRailButton>
                {folders.filter((folder) => !folder.parentId).map((folder) => (
                  <FolderRailButton
                    key={folder.id}
                    label={`${folder.name} · ${folderCounts.get(folder.id) ?? 0}`}
                    active={openFolderId === folder.id}
                    onClick={() => openFolder(folder.id)}
                  >
                    {openFolderId === folder.id ? <FolderOpen className="w-[18px] h-[18px]" /> : <Folder className="w-[18px] h-[18px]" />}
                  </FolderRailButton>
                ))}
                <FolderRailButton
                  label={`${t('folderUnfiled')} · ${folderCounts.get(NO_GROUP_KEY) ?? 0}`}
                  active={openFolderId === NO_GROUP_KEY}
                  onClick={() => openFolder(NO_GROUP_KEY)}
                >
                  <Folder className="w-[18px] h-[18px]" />
                </FolderRailButton>
                {/* 新建/重命名/移动/删除只在展开态有位置；收缩列至少要留住建站入口。 */}
                {isAdmin && (
                  <>
                    <span className="my-1 h-px w-7 bg-border" aria-hidden />
                    <FolderRailButton label={t('folderNew')} onClick={requestFolderCreate}>
                      <FolderPlus className="w-[18px] h-[18px]" />
                    </FolderRailButton>
                  </>
                )}
              </nav>
            )}
          </aside>

          <div className="scrollbar-hidden min-w-0 flex-1 lg:min-h-0 lg:overflow-y-auto lg:rounded-[8px] lg:bg-popover lg:px-4 lg:py-4">
            {/* On desktop this row only holds the breadcrumb, so it must not reserve
                height while no folder is open. On mobile it holds the folder trigger. */}
            <div className={`flex items-center gap-2 flex-wrap mb-2 ${openFolderId ? 'min-h-[32px]' : 'lg:hidden'}`}>
              <Button variant="outline" size="sm" className="lg:hidden px-2.5 text-[12.5px]" onClick={() => setFolderDrawer(true)}>
                <FolderTree className="w-3.5 h-3.5 mr-1" />
                {breadcrumbs[breadcrumbs.length - 1]?.name || t('folder')}
              </Button>

              {openFolderId && (
                // Under lg the drawer button above already says which folder this is,
                // and the tree it opens is the way back up — the full path would just
                // repeat it on a screen two crumbs wide.
                <nav aria-label={t('folder')} className="hidden lg:flex items-center gap-1 text-[13px] min-w-0">
                  <button
                    type="button"
                    onClick={() => openFolder(null)}
                    className="text-muted-foreground hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('statAll')}
                  </button>
                  {breadcrumbs.map((folder, i) => (
                    <span key={folder.id} className="flex items-center gap-1 min-w-0">
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" aria-hidden />
                      {i === breadcrumbs.length - 1 ? (
                        <span className="font-semibold truncate max-w-[200px]" title={folder.name}>{folder.name}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openFolder(folder.id)}
                          title={folder.name}
                          className="text-muted-foreground hover:text-foreground truncate max-w-[140px] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {folder.name}
                        </button>
                      )}
                    </span>
                  ))}
                </nav>
              )}
            </div>

            {/* One toolbar row: saved views and filters on the left, search docked to the right end. */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <ProjectsSavedViews
                views={savedViews}
                filters={filters}
                onSelect={handleSelectView}
                onSave={handleSaveView}
                onDelete={handleDeleteView}
              />

              <ProjectsToolbar
                filters={filters}
                onChange={setFilters}
                clientOptions={clientOptions}
                yearOptions={yearOptions}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
              />

              <ProjectsSearchBar
                value={filters.q}
                onChange={(q) => setFilters({ ...filters, q })}
              />
            </div>

            <ProjectsFilterChips
              filters={filters}
              onChange={setFilters}
              clientLabels={clientLabels}
              onClearAll={handleClearAll}
            />

            <ProjectsStats projects={filteredProjects} />

            {viewMode === 'grid' ? (
              <ProjectsDashboard
                projects={filteredProjects}
                isAdmin={isAdmin}
                folders={folders}
                showFolderChip={openFolderId === null}
                emptyMessage={folderEmptyMessage}
                onMoveProjects={handleMoveProjects}
                onMutated={() => void loadProjects()}
              />
            ) : (
              <ProjectsList
                projects={filteredProjects}
                viewMode={viewMode}
                folders={folders}
                showFolderColumn={openFolderId === null}
                emptyMessage={folderEmptyMessage}
              />
            )}
          </div>
        </div>
      </div>

      <Dialog open={folderDrawer} onOpenChange={setFolderDrawer}>
        <DialogContent className="lg:hidden max-w-xs p-4">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{t('folder')}</DialogTitle>
          </DialogHeader>
          {folderTree}
        </DialogContent>
      </Dialog>

      {renderNewProjectModal()}
    </div>
  )
}

/** 收缩后的文件夹侧栏只剩图标，tooltip、aria-label 和 focus 环三样都不能省。 */
function FolderRailButton({ label, active, compact, onClick, children }: { label: string; active?: boolean; compact?: boolean; onClick: () => void; children: React.ReactNode }) {
  if (compact) {
    // 标题行那一枚要和树自带的「新建」同尺寸同观感，所以走同一套类。
    return (
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        className="inline-flex w-7 h-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? 'true' : undefined}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? 'border-primary-visible bg-primary-visible text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
