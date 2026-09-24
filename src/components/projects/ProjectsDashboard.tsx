'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { Video, MessageSquare, Pin, PinOff, Link2, Check, Archive, ArchiveRestore, Trash2, MoreHorizontal, AlertTriangle, Layers, CheckCircle2, FolderKanban, FolderInput, FolderOpen } from 'lucide-react'
import { apiDelete, apiPatch } from '@/lib/api-client'
import { logError } from '@/lib/logging'
import { copyTextToClipboard } from '@/lib/clipboard'
import { formatDate } from '@/lib/utils'
import { clientKeyFor, clientLabelFor, NO_CLIENT_KEY, type ProjectListItem } from '@/lib/projects-filter'
import { PROJECT_DND_MIME, folderOptions, folderPathLabels, type FolderNode } from '@/lib/project-folders'

const GROUP_STORAGE_KEY = 'admin_projects_group'
const PINNED_STORAGE_KEY = 'admin_projects_pinned'

type GroupBy = 'status' | 'client'

const GROUP_BY_OPTIONS: GroupBy[] = ['status', 'client']

const STATUS_ORDER = ['IN_REVIEW', 'APPROVED', 'SHARE_ONLY', 'ARCHIVED'] as const

function loadGroupBy(): GroupBy {
  if (typeof window === 'undefined') return 'status'
  const stored = localStorage.getItem(GROUP_STORAGE_KEY)
  return GROUP_BY_OPTIONS.includes(stored as GroupBy) ? (stored as GroupBy) : 'status'
}

function loadPinned(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function dueDaysFrom(dueDate: string): number {
  const due = new Date(dueDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  return Math.round((dueDay.getTime() - today.getTime()) / 86400000)
}

const badgeClass: Record<string, string> = {
  APPROVED: 'bg-success-visible text-success',
  SHARE_ONLY: 'bg-info-visible text-info',
  IN_REVIEW: 'bg-primary-visible text-primary',
  ARCHIVED: 'bg-muted text-muted-foreground',
}

function pillClass(kind: 'hot' | 'warn' | 'soon' | 'calm'): string {
  if (kind === 'hot') return 'bg-destructive/10 text-destructive'
  if (kind === 'warn') return 'bg-warning-visible text-warning'
  if (kind === 'soon') return 'bg-primary-visible text-primary'
  return 'bg-muted text-muted-foreground'
}

function Progress({ approved, total }: { approved: number; total: number }) {
  const t = useTranslations('projects')
  const pct = total > 0 ? Math.round((approved / total) * 100) : 0
  return (
    <div className="flex items-center gap-2 mt-2.5">
      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden" aria-hidden>
        <div
          className={`h-full rounded-full ${pct === 100 ? 'bg-success' : 'bg-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] whitespace-nowrap tabular-nums text-muted-foreground">
        {t('progressApproved', { approved, total })}
      </span>
    </div>
  )
}

function DuePill({ project }: { project: ProjectListItem }) {
  const t = useTranslations('projects')
  const locale = useLocale()
  if (!project.dueDate) return null
  if (project.status !== 'IN_REVIEW') return null
  const diff = dueDaysFrom(project.dueDate)
  if (diff < 0) return <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${pillClass('hot')}`}>{t('overdueDays', { days: -diff })}</span>
  if (diff === 0) return <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${pillClass('warn')}`}>{t('dueToday')}</span>
  if (diff === 1) return <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${pillClass('warn')}`}>{t('dueTomorrow')}</span>
  const label = new Date(project.dueDate).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${diff <= 7 ? pillClass('soon') : pillClass('calm')}`}>
      {t('dueOn', { date: label })}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('projects')
  const labels: Record<string, string> = {
    IN_REVIEW: t('statusInReview'),
    APPROVED: t('statusApproved'),
    SHARE_ONLY: t('statusShareOnly'),
    ARCHIVED: t('statusArchived'),
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${badgeClass[status] || 'bg-muted text-muted-foreground'}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
      {labels[status] || status}
    </span>
  )
}

function ClientChip({ project }: { project: ProjectListItem }) {
  const t = useTranslations('projects')
  const label = clientLabelFor(project)
  if (!label) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground min-w-0">
      <span className="w-4 h-4 rounded-[5px] bg-primary/15 text-primary inline-flex items-center justify-center text-[10px] font-bold flex-shrink-0" aria-hidden>
        {label.slice(0, 1)}
      </span>
      <span className="truncate">{label}</span>
    </span>
  )
}

export function ProjectsStats({ projects }: { projects: ProjectListItem[] }) {
  const t = useTranslations('projects')
  const inReview = projects.filter((p) => p.status === 'IN_REVIEW')
  const approved = projects.filter((p) => p.status === 'APPROVED')
  const archived = projects.filter((p) => p.status === 'ARCHIVED')
  const urgent = inReview.filter((p) => p.dueDate && dueDaysFrom(p.dueDate) <= 7)
  const overdue = inReview.filter((p) => p.dueDate && dueDaysFrom(p.dueDate) < 0).length

  const stats = [
    { icon: Layers, className: 'bg-primary-visible text-primary', num: inReview.length, label: t('statusInReview'), sub: overdue > 0 ? t('overdueCount', { count: overdue }) : '' },
    { icon: CheckCircle2, className: 'bg-success-visible text-success', num: approved.length, label: t('statusApproved'), sub: '' },
    { icon: AlertTriangle, className: 'bg-warning-visible text-warning', num: urgent.length, label: t('statDueSoon'), sub: overdue > 0 ? t('overdueCount', { count: overdue }) : '' },
    { icon: FolderKanban, className: 'bg-muted text-muted-foreground', num: projects.length, label: t('statAll'), sub: t('containsArchived', { count: archived.length }) },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      {stats.map((s) => (
        <Card key={s.label} className="p-4 flex items-center gap-3">
          <span className={`w-9 h-9 rounded-[10px] inline-flex items-center justify-center flex-shrink-0 ${s.className}`}>
            <s.icon className="w-[18px] h-[18px]" />
          </span>
          <div className="min-w-0">
            <div className="text-xl font-bold leading-tight tabular-nums">{s.num}</div>
            <div className="text-[12px] text-muted-foreground truncate">{s.label}</div>
            {s.sub && <div className="text-[11px] text-destructive font-medium">{s.sub}</div>}
          </div>
        </Card>
      ))}
    </div>
  )
}

/**
 * "归入文件夹" list, indented the way the sidebar tree looks, so the entry that
 * reads 客户A / 2026春 cannot be mistaken for its sibling with the same name.
 * `currentFolderId` is omitted for batch actions, where the selection is filed in
 * several places at once and no single row could be ticked.
 */
function FolderPickList({
  options, currentFolderId, onSelect,
}: {
  options: { id: string; name: string; depth: number }[]
  currentFolderId?: string | null
  onSelect: (folderId: string | null) => void
}) {
  const t = useTranslations('projects')
  return (
    <>
      <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
        <FolderInput className="w-3 h-3" />
        {t('folderMoveTo')}
      </div>
      {options.length === 0 && (
        <div className="px-2.5 py-1 text-[12px] text-muted-foreground">{t('folderNoFolders')}</div>
      )}
      <div className="max-h-52 overflow-y-auto scrollbar-hidden">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] hover:bg-muted text-left"
            style={{ paddingLeft: 10 + option.depth * 14 }}
            onClick={() => onSelect(option.id)}
          >
            <span className="w-3.5 flex justify-center flex-shrink-0">
              {currentFolderId !== undefined && currentFolderId === option.id && <Check className="w-3.5 h-3.5 text-primary" />}
            </span>
            <span className="truncate">{option.name}</span>
          </button>
        ))}
        {options.length > 0 && (
          <button
            type="button"
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] hover:bg-muted text-left text-muted-foreground"
            onClick={() => onSelect(null)}
          >
            <span className="w-3.5 flex justify-center flex-shrink-0">
              {currentFolderId !== undefined && currentFolderId === null && <Check className="w-3.5 h-3.5 text-primary" />}
            </span>
            {t('folderUnfiled')}
          </button>
        )}
      </div>
    </>
  )
}

interface ProjectCardProps {
  project: ProjectListItem
  href: string
  isAdmin: boolean
  pinned: boolean
  batchMode: boolean
  selected: boolean
  menuOpen: boolean
  showClient: boolean
  showStatus: boolean
  showProgress: boolean
  showFolderChip: boolean
  folderLabel: string | null
  folderOptions: { id: string; name: string; depth: number }[]
  dragging: boolean
  onToggleSelect: (id: string) => void
  onToggleMenu: (id: string | null) => void
  onTogglePin: (id: string) => void
  onCopyLink: (project: ProjectListItem) => void
  onSetStatus: (project: ProjectListItem, status: string) => void
  onMove: (project: ProjectListItem, folderId: string | null) => void
  onDragStart: (project: ProjectListItem, e: React.DragEvent) => void
  onDragEnd: () => void
  onDeleteRequest: (project: ProjectListItem) => void
}

function ProjectCard({
  project, href, isAdmin, pinned, batchMode, selected, menuOpen, showClient, showStatus, showProgress,
  showFolderChip, folderLabel, folderOptions, dragging,
  onToggleSelect, onToggleMenu, onTogglePin, onCopyLink, onSetStatus, onMove, onDragStart, onDragEnd, onDeleteRequest,
}: ProjectCardProps) {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const approvedVideos = project.videos.filter((v) => v.reviewStatus === 'APPROVED').length

  return (
    <div
      data-card-root
      className={`relative rounded-xl border bg-card shadow-sm transition-[color,background-color,border-color,opacity,transform] duration-150 ${selected ? 'border-primary ring-2 ring-primary-visible' : 'border-border hover:border-primary/60'} ${dragging ? 'opacity-40 scale-[0.9]' : ''}`}
    >
      {isAdmin && batchMode && (
        <button
          type="button"
          aria-label={t('selectProject')}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSelect(project.id) }}
          className={`absolute -top-1.5 -left-1.5 z-10 w-5 h-5 rounded-full border flex items-center justify-center ${selected ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border text-transparent'}`}
        >
          <Check className="w-3 h-3" />
        </button>
      )}
      {isAdmin && !batchMode && (
        <>
          <button
            type="button"
            aria-label={t('projectActions')}
            data-card-menu
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleMenu(menuOpen ? null : project.id) }}
            className="absolute bottom-3 right-2 z-10 w-6 h-6 rounded-md text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus:opacity-100 group-hover/card:opacity-100 transition-opacity"
          >
            <MoreHorizontal className="w-4 h-4 mx-auto" />
          </button>
          {menuOpen && (
            <div
              data-card-menu
              className="absolute bottom-10 right-2 z-20 min-w-[190px] max-w-[280px] rounded-[10px] border border-border bg-popover p-1 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <button type="button" className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] hover:bg-muted text-left" onClick={() => onTogglePin(project.id)}>
                {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                {pinned ? t('menuUnpin') : t('menuPin')}
              </button>
              <button type="button" className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] hover:bg-muted text-left" onClick={() => onCopyLink(project)}>
                <Link2 className="w-3.5 h-3.5" />
                {t('menuCopyLink')}
              </button>
              <div className="mt-1 pt-1 border-t border-border">
                <FolderPickList
                  options={folderOptions}
                  currentFolderId={project.groupId || null}
                  onSelect={(folderId) => onMove(project, folderId)}
                />
              </div>
              {project.status !== 'APPROVED' && (
                <button type="button" className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] hover:bg-muted text-left" onClick={() => onSetStatus(project, 'APPROVED')}>
                  <Check className="w-3.5 h-3.5" />
                  {t('menuApprove')}
                </button>
              )}
              {project.status === 'ARCHIVED' ? (
                <button type="button" className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] hover:bg-muted text-left" onClick={() => onSetStatus(project, 'IN_REVIEW')}>
                  <ArchiveRestore className="w-3.5 h-3.5" />
                  {t('menuRestore')}
                </button>
              ) : (
                <button type="button" className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] hover:bg-muted text-left" onClick={() => onSetStatus(project, 'ARCHIVED')}>
                  <Archive className="w-3.5 h-3.5" />
                  {t('menuArchive')}
                </button>
              )}
              <button type="button" className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] hover:bg-muted text-destructive text-left" onClick={() => onDeleteRequest(project)}>
                <Trash2 className="w-3.5 h-3.5" />
                {tc('delete')}
              </button>
            </div>
          )}
        </>
      )}
      <Link
        href={href}
        onClick={(e) => { if (batchMode) { e.preventDefault(); onToggleSelect(project.id) } }}
        draggable={isAdmin}
        onDragStart={(e) => onDragStart(project, e)}
        onDragEnd={onDragEnd}
        className="block p-3.5"
      >
        <div className="flex items-center gap-2 min-h-[22px]">
          <span className="text-[11px] text-muted-foreground font-mono whitespace-nowrap">
            ID {project.projectCode}
          </span>
          {showClient && <span className="text-[12px] text-muted-foreground truncate">{clientLabelFor(project) || t('noClientAssigned')}</span>}
          {showStatus && (
            <span className="ml-auto flex items-center gap-1.5">
              {pinned && <Pin className="w-3 h-3 text-primary" />}
              <StatusBadge status={project.status} />
            </span>
          )}
        </div>
        <div className="font-semibold text-sm mt-0.5 truncate" title={project.title}>{project.title}</div>
        {showProgress && <Progress approved={approvedVideos} total={project.videos.length} />}
        {/* The ⋯ now sits at this row's right end, so the due pill keeps out of it. */}
        <div className={`flex items-center gap-3 mt-2 text-muted-foreground text-[12px] flex-wrap min-h-[20px] ${isAdmin && !batchMode ? 'pr-7' : ''}`}>
          <span className="inline-flex items-center gap-1"><Video className="w-3.5 h-3.5" />{project.videos.length}</span>
          <span className="inline-flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" />{project._count.comments}</span>
          {showFolderChip && folderLabel && (
            <span className="inline-flex items-center gap-1 min-w-0 max-w-[160px]" title={folderLabel}>
              <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
              <span className="truncate">{folderLabel}</span>
            </span>
          )}
          <span className="ml-auto">
            <DuePill project={project} />
          </span>
          {batchMode && <span className="text-[11px]">{formatDate(project.updatedAt)}</span>}
        </div>
      </Link>
    </div>
  )
}

interface ProjectsDashboardProps {
  projects: ProjectListItem[]
  isAdmin: boolean
  folders: FolderNode[]
  /** The path chip is noise while you are already browsing inside that folder. */
  showFolderChip: boolean
  emptyMessage?: string
  onMoveProjects: (projectIds: string[], folderId: string | null) => Promise<void>
  onMutated: () => void
}

export default function ProjectsDashboard({
  projects, isAdmin, folders, showFolderChip, emptyMessage, onMoveProjects, onMutated,
}: ProjectsDashboardProps) {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const [groupBy, setGroupBy] = useState<GroupBy>(loadGroupBy)
  const [pinned, setPinned] = useState<Set<string>>(loadPinned)
  const [batchMode, setBatchMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [batchFolderMenu, setBatchFolderMenu] = useState(false)
  const [archOpen, setArchOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProjectListItem | null>(null)
  const [actionError, setActionError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem(GROUP_STORAGE_KEY, groupBy)
  }, [groupBy])

  useEffect(() => {
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...pinned]))
  }, [pinned])

  // A project that leaves the grid — filed into another folder by the sidebar drop,
  // filtered away, deleted — has to leave the selection with it, or the batch bar keeps
  // acting on cards nobody can see.
  useEffect(() => {
    if (!selected.size) return
    const visible = new Set(projects.map((p) => p.id))
    const kept = [...selected].filter((id) => visible.has(id))
    if (kept.length !== selected.size) setSelected(new Set(kept))
  }, [projects, selected])

  // Close card menu on any outside click (menu trigger + popover manage their own state)
  useEffect(() => {
    if (!menuOpen && !batchFolderMenu) return
    const handler = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('[data-card-menu]') || el?.closest('[data-batch-menu]')) return
      setMenuOpen(null)
      setBatchFolderMenu(false)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [menuOpen, batchFolderMenu])

  const projectHref = (project: ProjectListItem) => isAdmin
    ? `/studio/projects/${project.id}`
    : `/share/${project.slug}`

  const active = useMemo(() => projects.filter((p) => p.status !== 'ARCHIVED'), [projects])
  const archived = useMemo(() => projects.filter((p) => p.status === 'ARCHIVED'), [projects])
  const urgent = useMemo(
    () => active
      .filter((p) => p.status === 'IN_REVIEW' && p.dueDate && dueDaysFrom(p.dueDate) <= 7)
      .sort((a, b) => dueDaysFrom(a.dueDate!) - dueDaysFrom(b.dueDate!)),
    [active]
  )
  const pinnedProjects = useMemo(() => active.filter((p) => pinned.has(p.id)), [active, pinned])

  const folderLabelsById = useMemo(() => folderPathLabels(folders), [folders])
  const folderOpts = useMemo(() => folderOptions(folders), [folders])

  const groups = useMemo(() => {
    const statusLabels: Record<string, string> = {
      IN_REVIEW: t('statusInReview'),
      APPROVED: t('statusApproved'),
      SHARE_ONLY: t('statusShareOnly'),
      ARCHIVED: t('statusArchived'),
    }
    const result: { key: string; label: string; list: ProjectListItem[] }[] = []
    if (groupBy === 'status') {
      for (const status of STATUS_ORDER) {
        if (status === 'ARCHIVED') continue
        const list = active.filter((p) => p.status === status)
        if (list.length) result.push({ key: status, label: statusLabels[status], list })
      }
    } else {
      const byClient = new Map<string, ProjectListItem[]>()
      for (const p of active) {
        const k = clientKeyFor(p)
        const arr = byClient.get(k) || []
        arr.push(p)
        byClient.set(k, arr)
      }
      const keys = [...byClient.keys()].sort((a, b) => {
        if (a === NO_CLIENT_KEY) return 1
        if (b === NO_CLIENT_KEY) return -1
        return byClient.get(b)!.length - byClient.get(a)!.length
      })
      for (const k of keys) {
        const list = byClient.get(k)!
        const label = k === NO_CLIENT_KEY ? t('noClientAssigned') : (clientLabelFor(list[0]) || k)
        result.push({ key: k, label, list })
      }
    }
    return result
  }, [groupBy, active, t])

  const togglePin = (id: string) => {
    setPinned((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setMenuOpen(null)
  }

  const handleCopyLink = async (project: ProjectListItem) => {
    setMenuOpen(null)
    if (await copyTextToClipboard(`${window.location.origin}/share/${project.slug}`)) {
      setCopiedId(project.id)
      setTimeout(() => setCopiedId(null), 1500)
    }
  }

  async function applyStatus(project: ProjectListItem, status: string) {
    setMenuOpen(null)
    setBusy(true)
    setActionError('')
    try {
      await apiPatch(`/api/projects/${project.id}`, { status })
      onMutated()
    } catch (err) {
      logError('Failed to update project status:', err)
      setActionError(err instanceof Error ? err.message : t('operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function moveProjects(projectIds: string[], folderId: string | null, isBatch = false) {
    setMenuOpen(null)
    setBatchFolderMenu(false)
    setBusy(true)
    setActionError('')
    try {
      await onMoveProjects(projectIds, folderId)
      if (isBatch) {
        setSelected(new Set())
        setBatchMode(false)
      }
    } catch (err) {
      logError('Failed to file project into folder:', err)
      setActionError(err instanceof Error ? err.message : t('operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  // The card is the drag source; the sidebar tree is the only drop target, so the
  // payload travels as JSON instead of relying on shared component state.
  //
  // The browser's default drag image is a full-size snapshot, so a pick-up looks like
  // a photocopy instead of something lifted off the grid. Handing setDragImage a
  // scaled clone is the fix; the snapshot is taken synchronously, so the clone can be
  // torn off the DOM on the next tick.
  function startDrag(project: ProjectListItem, e: React.DragEvent) {
    const ids = batchMode && selected.has(project.id) ? [...selected] : [project.id]
    const payload = JSON.stringify(ids)
    e.dataTransfer.clearData()
    e.dataTransfer.setData(PROJECT_DND_MIME, payload)
    e.dataTransfer.setData('text/plain', payload)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId(project.id)

    const card = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-card-root]')
    if (!card) return
    const rect = card.getBoundingClientRect()
    const ghost = card.cloneNode(true) as HTMLElement
    ghost.removeAttribute('data-card-root')
    ghost.style.cssText = `position:fixed;top:0;left:0;width:${rect.width}px;margin:0;`
      + 'transform:scale(0.85);transform-origin:top left;opacity:0.95;pointer-events:none;z-index:-1;'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(
      ghost,
      (e.clientX - rect.left) * 0.85,
      (e.clientY - rect.top) * 0.85,
    )
    window.setTimeout(() => ghost.remove(), 0)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setBusy(true)
    setActionError('')
    try {
      await apiDelete(`/api/projects/${deleteTarget.id}`)
      setPinned((prev) => {
        const next = new Set(prev)
        next.delete(deleteTarget.id)
        return next
      })
      setDeleteTarget(null)
      onMutated()
    } catch (err) {
      logError('Failed to delete project:', err)
      setActionError(err instanceof Error ? err.message : t('operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function runBatch(status: string) {
    setBusy(true)
    setActionError('')
    try {
      const ids = [...selected]
      await Promise.all(ids.map((id) => apiPatch(`/api/projects/${id}`, { status })))
      setSelected(new Set())
      setBatchMode(false)
      onMutated()
    } catch (err) {
      logError('Failed to batch update projects:', err)
      setActionError(err instanceof Error ? err.message : t('operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllActive = () => setSelected(new Set(active.map((p) => p.id)))

  const exitBatch = () => {
    setBatchMode(false)
    setSelected(new Set())
  }

  const groupByLabels: Record<GroupBy, string> = {
    status: t('groupByStatus'),
    client: t('groupByClient'),
  }

  const cardProps = (p: ProjectListItem) => ({
    project: p,
    href: projectHref(p),
    isAdmin,
    pinned: pinned.has(p.id),
    batchMode,
    selected: selected.has(p.id),
    menuOpen: menuOpen === p.id,
    showClient: groupBy !== 'client',
    showStatus: true,
    showProgress: true,
    showFolderChip,
    folderLabel: p.groupId ? (folderLabelsById.get(p.groupId) ?? null) : null,
    folderOptions: folderOpts,
    dragging: draggingId === p.id,
    onToggleSelect: toggleSelect,
    onToggleMenu: setMenuOpen,
    onTogglePin: togglePin,
    onCopyLink: handleCopyLink,
    onSetStatus: applyStatus,
    onMove: (project: ProjectListItem, folderId: string | null) => moveProjects([project.id], folderId),
    onDragStart: startDrag,
    onDragEnd: () => setDraggingId(null),
    onDeleteRequest: setDeleteTarget,
  })

  const gridClass = 'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]'
  const archivedSelected = [...selected].some((id) => projects.find((p) => p.id === id && p.status === 'ARCHIVED'))

  if (projects.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">{emptyMessage || t('noMatchingProjects')}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div ref={rootRef} className={batchMode ? 'batch-on' : ''}>
      {/* Controls: group-by + batch toggle */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex rounded-lg bg-secondary p-0.5 text-xs">
          {GROUP_BY_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setGroupBy(option)}
              className={`h-8 inline-flex items-center px-3 rounded-md font-medium transition-colors ${groupBy === option ? 'bg-card text-foreground shadow-sm font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {groupByLabels[option]}
            </button>
          ))}
        </div>
        {isAdmin && (
          batchMode ? (
            <Button size="sm" variant="ghost" onClick={exitBatch}>{tc('cancel')}</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setBatchMode(true)}>
              <Check className="w-3.5 h-3.5 mr-1" />
              {t('batchManage')}
            </Button>
          )
        )}
        {actionError && <span className="text-[12.5px] text-destructive">{actionError}</span>}
      </div>

      {/* Attention: overdue / due soon */}
      {urgent.length > 0 && !batchMode && (
        <Card className="mb-4 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-warning-visible/40">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <span className="text-[13.5px] font-semibold">{t('attentionTitle')}</span>
            <span className="px-2 py-0.5 rounded-full bg-warning-visible text-warning text-[12px] font-semibold">{urgent.length}</span>
          </div>
          <div className="divide-y">
            {urgent.map((p) => {
              const approvedVideos = p.videos.filter((v) => v.reviewStatus === 'APPROVED').length
              return (
                <Link key={p.id} href={projectHref(p)} className="flex items-center gap-3 px-4 py-2 hover:bg-accent/30 transition-colors text-sm">
                  <span className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">ID {p.projectCode}</span>
                    <span className="font-medium truncate">{p.title}</span>
                  </span>
                  <ClientChip project={p} />
                  <StatusBadge status={p.status} />
                  <span className="hidden sm:flex items-center gap-2 w-36">
                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden" aria-hidden>
                      <div className={`h-full rounded-full ${approvedVideos === p.videos.length ? 'bg-success' : 'bg-primary'}`} style={{ width: `${p.videos.length ? Math.round(approvedVideos / p.videos.length * 100) : 0}%` }} />
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{t('progressApproved', { approved: approvedVideos, total: p.videos.length })}</span>
                  </span>
                  <DuePill project={p} />
                </Link>
              )
            })}
          </div>
        </Card>
      )}

      {/* Pinned */}
      {pinnedProjects.length > 0 && !batchMode && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Pin className="w-3.5 h-3.5 text-primary" />
            <span className="text-[14.5px] font-bold">{t('pinnedSection')}</span>
            <span className="text-[12px] text-muted-foreground bg-secondary rounded-full px-2">{pinnedProjects.length}</span>
          </div>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
            {pinnedProjects.map((p) => (
              <Link key={p.id} href={projectHref(p)} className="flex items-center gap-3 rounded-xl border border-border border-l-[3px] border-l-primary bg-card shadow-sm p-3 hover:border-primary transition-colors">
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-[13.5px] truncate">{p.title}</span>
                  <span className="block text-[12px] text-muted-foreground mt-0.5">
                    {t('progressApproved', { approved: p.videos.filter((v) => v.reviewStatus === 'APPROVED').length, total: p.videos.length })}
                    {' · '}{p._count.comments} {t('commentsPlural')}
                  </span>
                </span>
                <StatusBadge status={p.status} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Grouped sections */}
      {groups.map((g) => (
        <div key={g.key} className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[14.5px] font-bold">{g.label}</span>
            <span className="text-[12px] text-muted-foreground bg-secondary rounded-full px-2">{g.list.length} {t('projectsCount')}</span>
          </div>
          <div className={gridClass}>
            {g.list.map((p) => (
              <div key={p.id} className="group/card">
                <ProjectCard {...cardProps(p)} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Archived (collapsed) */}
      {archived.length > 0 && (
        <div className="border-t border-dashed border-border mt-2 pt-1">
          <button
            type="button"
            onClick={() => setArchOpen(!archOpen)}
            className="w-full flex items-center gap-2 px-0.5 py-2.5 text-[13.5px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={archOpen}
          >
            <span className="text-[11px]">{archOpen ? '▾' : '▸'}</span>
            <Archive className="w-3.5 h-3.5" />
            {t('archivedSection')}
            <span className="text-[12px] bg-secondary rounded-full px-2 font-normal">{archived.length}</span>
            <span className="ml-auto text-[12px] font-normal">{archOpen ? t('clickToCollapse') : t('clickToExpand')}</span>
          </button>
          {archOpen && (
            <div className={`${gridClass} pb-2 opacity-90`}>
              {archived.map((p) => (
                <div key={p.id} className="group/card">
                  <ProjectCard {...cardProps(p)} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Copied hint */}
      {copiedId && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-foreground text-background text-[13px] px-4 py-2 rounded-full shadow-lg">
          {t('linkCopied')}
        </div>
      )}

      {/* Batch action bar */}
      {batchMode && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-wrap items-center justify-center gap-2 sm:gap-3 max-w-[calc(100vw-2rem)] bg-foreground text-background rounded-2xl px-4 py-2.5 shadow-xl text-[13px]">
          <span className="font-bold text-[14px] tabular-nums">{selected.size}</span>
          <span>{t('selectedCount')}</span>
          <span className="w-px h-4 bg-background/30" aria-hidden />
          <button type="button" disabled={busy || !selected.size} onClick={() => runBatch('APPROVED')} className="px-3 py-1.5 rounded-lg bg-background/15 hover:bg-background/25 disabled:opacity-40 font-medium">{t('batchApprove')}</button>
          <button type="button" disabled={busy || !selected.size} onClick={() => runBatch('ARCHIVED')} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 font-semibold">{t('batchArchive')}</button>
          {archivedSelected && (
            <button type="button" disabled={busy || !selected.size} onClick={() => runBatch('IN_REVIEW')} className="px-3 py-1.5 rounded-lg bg-background/15 hover:bg-background/25 disabled:opacity-40 font-medium">{t('menuRestore')}</button>
          )}
          <div className="relative" data-batch-menu>
            <button
              type="button"
              disabled={busy || !selected.size}
              onClick={() => setBatchFolderMenu((open) => !open)}
              aria-expanded={batchFolderMenu}
              className="px-3 py-1.5 rounded-lg bg-background/15 hover:bg-background/25 disabled:opacity-40 font-medium inline-flex items-center gap-1"
            >
              <FolderInput className="w-3.5 h-3.5" />
              {t('folderMoveTo')}
            </button>
            {batchFolderMenu && (
              <div className="absolute bottom-full left-0 mb-2 w-[220px] rounded-[10px] border border-border bg-popover text-foreground p-1 shadow-lg">
                <FolderPickList
                  options={folderOpts}
                  onSelect={(folderId) => moveProjects([...selected], folderId, true)}
                />
              </div>
            )}
          </div>
          <span className="w-px h-4 bg-background/30" aria-hidden />
          <button type="button" onClick={selectAllActive} className="px-3 py-1.5 rounded-lg text-background/70 hover:text-background">{t('selectAllProjects')}</button>
        </div>
      )}

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('deleteConfirmBody', { title: deleteTarget?.title || '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={busy}>{tc('cancel')}</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>{tc('delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
