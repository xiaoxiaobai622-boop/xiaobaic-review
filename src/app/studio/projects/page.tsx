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
import { Building2, FolderKanban, FolderTree, Plus, Eye, EyeOff, RefreshCw, Copy, Check, AlertCircle, ChevronRight } from 'lucide-react'
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
          ? '没有权限读取项目列表，请确认当前团队已激活'
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
    return (
      <div className="flex-1 min-h-0 bg-background flex items-center justify-center">
        <p className="text-muted-foreground">{t('loadingProjects')}</p>
      </div>
    )
  }

  const totalProjects = projects?.length ?? 0

  if (teamDisabled) {
    return (
      <div className="flex-1 min-h-0 bg-background">
        <div className="w-full px-3 py-3 sm:px-4 lg:px-5">
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
              <Building2 className="mx-auto h-10 w-10 text-amber-600" />
              <p className="mt-3 text-sm font-medium">团队已停用</p>
              <p className="mt-1 text-sm text-muted-foreground">团队数据仍然保留，启用后即可继续使用项目和视频。</p>
              <Button asChild variant="outline" className="mt-4">
                <Link href="/studio/team?tab=team">查看团队激活</Link>
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
        <div className="w-full px-3 py-3 sm:px-4 lg:px-5">
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
        <div className="w-full px-3 py-3 sm:px-4 lg:px-5">
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

  const folderTree = (
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
    />
  )

  return (
    <div className="flex-1 min-h-0 bg-background">
      <div className="w-full px-3 py-3 sm:px-4 lg:px-5">
        <div className="flex justify-between items-center gap-4 border-b border-border pb-3 mb-3">
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

        <div className="flex items-start gap-4">
          <aside className="hidden lg:block w-[236px] flex-shrink-0 sticky top-3 max-h-[calc(100vh-5rem)] overflow-y-auto scrollbar-hidden pb-4">
            {folderTree}
          </aside>

          <div className="flex-1 min-w-0">
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
