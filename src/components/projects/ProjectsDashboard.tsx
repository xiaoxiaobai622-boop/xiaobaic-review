'use client'
/* eslint-disable @next/next/no-img-element -- 封面已由服务端转成 WebP，按 16:9 固定裁切，不需要 next/image 再优化 */

import { cardArtFor } from '@/lib/project-art'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { Video, MessageSquare, Pin, PinOff, Check, Archive, ArchiveRestore, Trash2, MoreHorizontal, AlertTriangle, Layers, CheckCircle2, FolderKanban, FolderInput, Plus, Calendar, Clock, Lock, Play, Settings2, ChevronLeft, ChevronRight } from 'lucide-react'
import { apiDelete, apiPatch } from '@/lib/api-client'
import { logError } from '@/lib/logging'
import { clientKeyFor, clientLabelFor, NO_CLIENT_KEY, type ProjectListItem } from '@/lib/projects-filter'
import { PROJECT_DND_MIME, folderOptions, folderPathLabels, type FolderNode } from '@/lib/project-folders'
import { isEditableContextTarget, contextMenuPoint as contextMenuPointFromEvent, elementContextPoint, type ContextMenuPoint } from '@/lib/context-menu'
import OverlayMenu from '@/components/OverlayMenu'
import ReviewPopup from '@/components/ReviewPopup'
import ProjectSettingsDialog from './ProjectSettingsDialog'

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

function formatCardUpdatedAt(value: string | Date, locale: string): string {
  const date = new Date(value)
  const now = new Date()
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((dayStart(now) - dayStart(date)) / 86400000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (locale.toLowerCase().startsWith('zh')) {
    if (days <= 0) return `今天 ${time}`
    if (days === 1) return `昨天 ${time}`
    if (days < 7) return `${days} 天前`
    if (days < 14) return '上周'
    const monthDay = `${date.getMonth() + 1} 月 ${date.getDate()} 日`
    return date.getFullYear() === now.getFullYear() ? monthDay : `${date.getFullYear()} 年 ${monthDay}`
  }
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (days <= 0) return `${relative.format(0, 'day')} ${time}`
  if (days === 1) return `${relative.format(-1, 'day')} ${time}`
  if (days < 7) return relative.format(-days, 'day')
  if (days < 14) return relative.format(-1, 'week')
  return new Intl.DateTimeFormat(locale, {
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function DuePill({ project, variant = 'default' }: { project: ProjectListItem; variant?: 'default' | 'cover' }) {
  const t = useTranslations('projects')
  const locale = useLocale()
  if (!project.dueDate) return null
  if (project.status !== 'IN_REVIEW') return null
  const diff = dueDaysFrom(project.dueDate)
  const label = diff < 0
    ? t('overdueDays', { days: -diff })
    : diff === 0
      ? t('dueToday')
      : diff === 1
        ? t('dueTomorrow')
        : t('dueOn', { date: new Date(project.dueDate).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' }) })
  if (variant === 'cover') {
    const tone = diff < 0 ? 'overdue' : diff <= 1 ? 'warn' : 'due'
    return (
      <span data-project-badge={tone}>
        <Calendar className="h-[14px] w-[14px]" aria-hidden />
        {label}
      </span>
    )
  }
  if (diff < 0) return <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${pillClass('hot')}`}>{label}</span>
  if (diff === 0 || diff === 1) return <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${pillClass('warn')}`}>{label}</span>
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${diff <= 7 ? pillClass('soon') : pillClass('calm')}`}>
      {label}
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
  options, currentFolderId, onSelect, hideHeader = false,
}: {
  options: { id: string; name: string; depth: number }[]
  currentFolderId?: string | null
  onSelect: (folderId: string | null) => void
  hideHeader?: boolean
}) {
  const t = useTranslations('projects')
  return (
    <>
      {!hideHeader && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
          <FolderInput className="w-3 h-3" />
          {t('folderMoveTo')}
        </div>
      )}
      {options.length === 0 && (
        <div className="px-2.5 py-1 text-[12px] text-muted-foreground">{t('folderNoFolders')}</div>
      )}
      <div className="max-h-52 overflow-y-auto scrollbar-hidden">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="menuitem"
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
            role="menuitem"
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
  hasUnread: boolean
  folderLabel: string | null
  folderOptions: { id: string; name: string; depth: number }[]
  dragging: boolean
  contextMenuPoint: ContextMenuPoint | null
  onToggleSelect: (id: string) => void
  onToggleMenu: (id: string | null) => void
  onOpenContextMenu: (project: ProjectListItem, point: ContextMenuPoint) => void
  onCloseContextMenu: () => void
  onTogglePin: (id: string) => void
  onSetStatus: (project: ProjectListItem, status: string) => void
  onMove: (project: ProjectListItem, folderId: string | null) => void
  onDragStart: (project: ProjectListItem, e: React.DragEvent) => void
  onDragEnd: () => void
  onDeleteRequest: (project: ProjectListItem) => void
  onOpenSettings: (project: ProjectListItem) => void
}

function ProjectCard({
  project, href, isAdmin, pinned, batchMode, selected, menuOpen,
  hasUnread, folderOptions, dragging, contextMenuPoint,
  onToggleSelect, onToggleMenu, onOpenContextMenu, onCloseContextMenu, onTogglePin, onSetStatus, onMove, onDragStart, onDragEnd, onDeleteRequest, onOpenSettings,
}: ProjectCardProps) {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const locale = useLocale()
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [folderMenuOpen, setFolderMenuOpen] = useState(false)
  const [folderMenuSide, setFolderMenuSide] = useState<'right' | 'left' | 'inline'>('right')
  const folderMenuId = `project-folder-menu-${project.id}`
  const folderCloseTimer = useRef<number | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const cardLinkRef = useRef<HTMLAnchorElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)

  const clearFolderClose = () => {
    if (folderCloseTimer.current !== null) {
      window.clearTimeout(folderCloseTimer.current)
      folderCloseTimer.current = null
    }
  }

  const scheduleFolderClose = () => {
    clearFolderClose()
    if (folderMenuSide === 'inline') return
    folderCloseTimer.current = window.setTimeout(() => {
      folderCloseTimer.current = null
      setFolderMenuOpen(false)
    }, 180)
  }

  useEffect(() => {
    if (!menuOpen && !contextMenuPoint) {
      clearFolderClose()
      setFolderMenuOpen(false)
    }
  }, [menuOpen, contextMenuPoint])

  useEffect(() => () => clearFolderClose(), [])

  const openFolderMenu = (element: HTMLElement) => {
    clearFolderClose()
    if (window.innerWidth <= 720) {
      setFolderMenuSide('inline')
    } else {
      const rect = element.getBoundingClientRect()
      const inset = parseFloat(getComputedStyle(element).getPropertyValue('--folder-panel-inset')) || 7
      setFolderMenuSide(rect.right + inset + 3 + 190 + 8 <= window.innerWidth ? 'right' : 'left')
    }
    setFolderMenuOpen(true)
  }

  const menuItems = (
    <>
      <button type="button" role="menuitem" className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] hover:bg-muted text-left" onClick={() => onTogglePin(project.id)}>
        {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        {pinned ? t('menuUnpin') : t('menuPin')}
      </button>
      <button type="button" role="menuitem" className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] hover:bg-muted text-left" onClick={() => onOpenSettings(project)}>
        <Settings2 className="w-3.5 h-3.5" />
        {t('projectSettings')}
      </button>
      <div
        className="relative mt-1 pt-1 border-t border-border"
        onMouseEnter={(event) => openFolderMenu(event.currentTarget)}
        onMouseLeave={(event) => {
          const related = event.relatedTarget as Node | null
          if (related && event.currentTarget.contains(related)) return
          scheduleFolderClose()
        }}
      >
        <button
          type="button"
          role="menuitem"
          data-menu-keep-open
          aria-haspopup="menu"
          aria-expanded={folderMenuOpen}
          aria-controls={folderMenuOpen ? folderMenuId : undefined}
          onClick={(event) => openFolderMenu(event.currentTarget)}
          onMouseEnter={clearFolderClose}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-left ${folderMenuOpen ? 'bg-muted' : 'hover:bg-muted'}`}
        >
          <FolderInput className="w-3.5 h-3.5" />
          {t('folderMoveTo')}
          {folderMenuOpen && folderMenuSide === 'left'
            ? <ChevronLeft className="ml-auto w-3.5 h-3.5 text-muted-foreground" aria-hidden />
            : <ChevronRight className={`ml-auto w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${folderMenuOpen && folderMenuSide === 'inline' ? 'rotate-90' : ''}`} aria-hidden />}
        </button>
        {folderMenuOpen && (
          <div
            id={folderMenuId}
            role="menu"
            aria-label={t('folderMoveTo')}
            className={
              folderMenuSide === 'inline'
                ? 'relative mt-0.5 w-full'
                : `absolute top-[4px] z-20 w-[190px] rounded-[8px] border border-border bg-popover p-1 ${folderMenuSide === 'right' ? 'left-full' : 'right-full'}`
            }
            style={folderMenuSide === 'inline' ? undefined : {
              marginLeft: folderMenuSide === 'right' ? 'calc(var(--folder-panel-inset, 7px) + 3px)' : undefined,
              marginRight: folderMenuSide === 'left' ? 'calc(var(--folder-panel-inset, 7px) + 3px)' : undefined,
            }}
            onMouseEnter={clearFolderClose}
            onMouseLeave={scheduleFolderClose}
          >
            <FolderPickList
              hideHeader
              options={folderOptions}
              currentFolderId={project.groupId || null}
              onSelect={(folderId) => onMove(project, folderId)}
            />
          </div>
        )}
      </div>
      {project.status !== 'APPROVED' && (
        <button type="button" role="menuitem" className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] hover:bg-muted text-left" onClick={() => onSetStatus(project, 'APPROVED')}>
          <Check className="w-3.5 h-3.5" />
          {t('menuApprove')}
        </button>
      )}
      {project.status === 'ARCHIVED' ? (
        <button type="button" role="menuitem" className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] hover:bg-muted text-left" onClick={() => onSetStatus(project, 'IN_REVIEW')}>
          <ArchiveRestore className="w-3.5 h-3.5" />
          {t('menuRestore')}
        </button>
      ) : (
        <button type="button" role="menuitem" className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] hover:bg-muted text-left" onClick={() => onSetStatus(project, 'ARCHIVED')}>
          <Archive className="w-3.5 h-3.5" />
          {t('menuArchive')}
        </button>
      )}
      <button type="button" role="menuitem" className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-destructive text-left" onClick={() => onDeleteRequest(project)}>
        <Trash2 className="w-3.5 h-3.5" />
        {tc('delete')}
      </button>
    </>
  )

  const handleContextMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const menu = contextMenuRef.current
    if (!menu) return
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]), button:not([disabled])')]
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLElement)
    let next = 0
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
    else if (event.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1
    else if (event.key === 'End') next = items.length - 1
    items[next]?.focus()
  }

  const openContextMenuAt = (event: React.MouseEvent | React.KeyboardEvent, fallback?: Element | null) => {
    const target = event.target as HTMLElement
    if (isEditableContextTarget(target)) return
    event.preventDefault()
    event.stopPropagation()
    const focusable = document.activeElement instanceof HTMLElement && cardRef.current?.contains(document.activeElement)
      ? document.activeElement
      : cardLinkRef.current
    const anchorEl = fallback ?? focusable ?? cardRef.current ?? (target instanceof Element ? target : null)
    const point = 'clientX' in event
      ? contextMenuPointFromEvent(event, anchorEl)
      : anchorEl ? elementContextPoint(anchorEl) : null
    if (point) onOpenContextMenu(project, point)
  }

  const art = cardArtFor(project)

  return (
    /* eslint-disable-next-line jsx-a11y/role-supports-aria-props -- option-b 的选中托盘按 aria-selected 着色 */
    <article
      ref={cardRef}
      data-project-card
      data-card-root
      data-card-context
      data-dragging={dragging ? 'true' : undefined}
      aria-selected={selected}
      onClick={(event) => {
        // The 6px tray rim sits outside the Link; a click there is still a card click.
        if (event.target !== event.currentTarget) return
        if (batchMode) onToggleSelect(project.id)
        else cardLinkRef.current?.click()
      }}
      onContextMenu={isAdmin ? (event) => openContextMenuAt(event, cardRef.current) : undefined}
      onKeyDown={isAdmin ? (event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
        openContextMenuAt(event)
      } : undefined}
      className="group/card"
    >
      <Link
        ref={cardLinkRef}
        href={href}
        aria-label={project.title}
        onClick={(e) => { if (batchMode) { e.preventDefault(); onToggleSelect(project.id) } }}
        draggable={isAdmin}
        onDragStart={(e) => onDragStart(project, e)}
        onDragEnd={onDragEnd}
        className="block"
      >
        <div data-project-cover>
          <div
            data-project-art
            aria-hidden="true"
            style={{ '--art-a': art.a, '--art-b': art.b } as CSSProperties}
          >
            <i className="art-l1" />
            <i className="art-l2" />
            <i className="art-l3" />
          </div>
          {project.coverImageUrl && (
            <img
              data-project-cover-image
              src={project.coverImageUrl}
              alt=""
              draggable={false}
              loading="lazy"
              className="absolute inset-0 z-[4] h-full w-full object-cover"
              onError={(event) => { event.currentTarget.style.display = 'none' }}
            />
          )}
          <div data-project-badges>
            {hasUnread && (
              <span className="inline-flex items-center" title="有新消息">
                <span className="sr-only">有新消息</span>
                <span className="h-2 w-2 rounded-full bg-destructive ring-2 ring-white/80" aria-hidden />
              </span>
            )}
            {pinned && (
              <span data-project-badge="pin" title={t('pinnedSection')} aria-label={t('pinnedSection')}>
                <Pin className="h-[14px] w-[14px]" aria-hidden />
              </span>
            )}
            <DuePill project={project} variant="cover" />
            {project.restricted && (
              <span data-project-badge="lock" title={t('restrictedProject')} aria-label={t('restrictedProject')}>
                <Lock className="h-[14px] w-[14px]" aria-hidden />
              </span>
            )}
          </div>
          <div data-project-cap>
            <h3 className="truncate text-[17px] font-bold leading-[1.3] text-white" title={project.title}>{project.title}</h3>
            <div className="truncate text-[13px] leading-[1.5] text-white/[0.82]">
              {clientLabelFor(project) || t('noClientAssigned')}
            </div>
          </div>
        </div>
        <div data-project-foot>
          <div className={`flex min-h-[30px] min-w-0 items-center gap-[14px] text-[12.5px] text-muted-foreground ${isAdmin && !batchMode ? 'pr-[34px]' : ''}`}>
            {project.videos.length > 0 && (
              <span className="inline-flex items-center gap-[5px]">
                <Video className="h-3.5 w-3.5" aria-hidden />{project.videos.length}
              </span>
            )}
            {project._count.comments > 0 && (
              <span className="inline-flex items-center gap-[5px]">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden />{project._count.comments}
              </span>
            )}
            <span className="inline-flex min-w-0 items-center gap-[5px]">
              <Clock className="h-3.5 w-3.5 flex-none" aria-hidden />
              <span className="truncate">{formatCardUpdatedAt(project.updatedAt, locale)}</span>
            </span>
          </div>
        </div>
        <span data-project-touch aria-hidden="true">
          <Play className="h-[14px] w-[14px]" />
          {t('enterReview')}
        </span>
      </Link>
      {isAdmin && batchMode && (
        <label
          data-project-check
          onClick={(event) => event.stopPropagation()}
          title={t('selectProject')}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(project.id)}
            onClick={(event) => event.stopPropagation()}
            aria-label={`${t('selectProject')} ${project.title}`}
          />
        </label>
      )}
      {isAdmin && !batchMode && (
        <>
          <button
            type="button"
            ref={menuTriggerRef}
            aria-label={t('projectActions')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-card-menu
            data-project-more
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleMenu(menuOpen ? null : project.id) }}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          <ReviewPopup
            id={`project-menu-${project.id}`}
            open={menuOpen}
            onOpenChange={(open) => onToggleMenu(open ? project.id : null)}
            anchor={menuTriggerRef}
            label={t('projectActions')}
            role="menu"
            side="bottom"
            align="end"
            width={230}
            overflowVisible
            flat
          >
            <div
              style={{ '--folder-panel-inset': '7px' } as CSSProperties}
              onClick={(event) => { if ((event.target as HTMLElement).closest('[role="menuitem"]:not([data-menu-keep-open])')) onToggleMenu(null) }}
            >
              {menuItems}
            </div>
          </ReviewPopup>
        </>
      )}
      {isAdmin && contextMenuPoint && (
        <OverlayMenu
          open
          onOpenChange={(open) => { if (!open) onCloseContextMenu() }}
          label={t('projectActions')}
          anchorPoint={contextMenuPoint}
          placement={{ side: 'bottom', align: 'start', gap: 6, pointer: true }}
          returnFocusRef={cardLinkRef}
          menuRef={contextMenuRef}
          className="shadow-none"
          onKeyDown={handleContextMenuKeyDown}
          onClick={(event) => { if ((event.target as HTMLElement).closest('[role="menuitem"]:not([data-menu-keep-open])')) onCloseContextMenu() }}
        >
          <div style={{ '--folder-panel-inset': '4.75px' } as CSSProperties}>
            {menuItems}
          </div>
        </OverlayMenu>
      )}
    </article>
  )
}

interface ProjectsDashboardProps {
  projects: ProjectListItem[]
  isAdmin: boolean
  folders: FolderNode[]
  /** The path chip is noise while you are already browsing inside that folder. */
  showFolderChip: boolean
  emptyMessage?: string
  folderBreadcrumb?: ReactNode
  onMoveProjects: (projectIds: string[], folderId: string | null) => Promise<void>
  onMutated: () => void
  onCreateProject?: () => void
  unreadProjectIds?: Set<string>
  cardSize: 'large' | 'compact'
}

export default function ProjectsDashboard({
  projects, isAdmin, folders, showFolderChip, emptyMessage, folderBreadcrumb, onMoveProjects, onMutated, onCreateProject, unreadProjectIds, cardSize,
}: ProjectsDashboardProps) {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const [groupBy, setGroupBy] = useState<GroupBy>(loadGroupBy)
  const [pinned, setPinned] = useState<Set<string>>(loadPinned)
  const [batchMode, setBatchMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [cardContextMenu, setCardContextMenu] = useState<{ id: string; point: ContextMenuPoint } | null>(null)
  const [emptyGridMenuPoint, setEmptyGridMenuPoint] = useState<ContextMenuPoint | null>(null)
  const [emptyGridMenuOpen, setEmptyGridMenuOpen] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [batchFolderMenu, setBatchFolderMenu] = useState(false)
  const batchFolderTriggerRef = useRef<HTMLButtonElement>(null)
  const batchBarRef = useRef<HTMLDivElement>(null)
  const [archOpen, setArchOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProjectListItem | null>(null)
  const [settingsProject, setSettingsProject] = useState<ProjectListItem | null>(null)
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
      if (el?.closest('[data-card-menu]') || el?.closest('[data-batch-menu]') || el?.closest('[data-review-popup]')) return
      setMenuOpen(null)
      setBatchFolderMenu(false)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [menuOpen, batchFolderMenu])

  useEffect(() => {
    if (!cardContextMenu) return
    if (!projects.some((p) => p.id === cardContextMenu.id)) setCardContextMenu(null)
  }, [projects, cardContextMenu])

  const closeEmptyGridMenu = () => {
    setEmptyGridMenuOpen(false)
    window.setTimeout(() => setEmptyGridMenuPoint(null), 160)
  }

  const openCardContextMenu = (project: ProjectListItem, point: ContextMenuPoint) => {
    setMenuOpen(null)
    setCardContextMenu({ id: project.id, point })
    // Right-clicking an unselected card selects it; an existing multi-selection stays intact.
    setSelected((prev) => (prev.has(project.id) ? prev : new Set([project.id])))
  }

  const toggleCardMenu = (id: string | null) => {
    setCardContextMenu(null)
    setMenuOpen(id)
  }

  // 项目主链接已下掉（2026-11-25 决策 1A）：卡片不再把任何角色送到公开地址。
  const projectHref = (project: ProjectListItem) => `/studio/projects/${project.id}`

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
    hasUnread: unreadProjectIds?.has(p.id) ?? false,
    folderLabel: p.groupId ? (folderLabelsById.get(p.groupId) ?? null) : null,
    folderOptions: folderOpts,
    dragging: draggingId === p.id,
    contextMenuPoint: cardContextMenu?.id === p.id ? cardContextMenu.point : null,
    onToggleSelect: toggleSelect,
    onToggleMenu: toggleCardMenu,
    onOpenContextMenu: openCardContextMenu,
    onCloseContextMenu: () => setCardContextMenu(null),
    onTogglePin: togglePin,
    onSetStatus: applyStatus,
    onMove: (project: ProjectListItem, folderId: string | null) => moveProjects([project.id], folderId),
    onDragStart: startDrag,
    onDragEnd: () => setDraggingId(null),
    onDeleteRequest: setDeleteTarget,
    onOpenSettings: setSettingsProject,
  })

  const gridClass = cardSize === 'compact'
    ? 'grid gap-x-[16px] gap-y-[20px] [grid-template-columns:repeat(auto-fill,minmax(236px,1fr))]'
    : 'grid gap-x-[20px] gap-y-[24px] [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]'
  const archivedSelected = [...selected].some((id) => projects.find((p) => p.id === id && p.status === 'ARCHIVED'))
  const createCard = isAdmin && onCreateProject && !batchMode ? (
    <button
      type="button"
      onClick={onCreateProject}
      data-project-new
      aria-label={t('newProject')}
    >
      <span className="new-plus" aria-hidden />
      <span className="new-face">
        <span className="new-circ">
          <span className="new-circ-bg" aria-hidden />
          <Plus className="new-circ-icon h-[22px] w-[22px]" aria-hidden />
        </span>
        <span>{t('newProject')}</span>
      </span>
      <span className="new-pad" aria-hidden />
    </button>
  ) : null

  if (projects.length === 0) {
    return (
      <div>
        {folderBreadcrumb && <div className="mb-3">{folderBreadcrumb}</div>}
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{emptyMessage || t('noMatchingProjects')}</p>
          </CardContent>
        </Card>
        {createCard && <div className={`${gridClass} mt-3`} data-project-grid={cardSize}>{createCard}</div>}
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={batchMode ? 'batch-on' : ''}
      onContextMenu={isAdmin && !batchMode && onCreateProject ? (event) => {
        const target = event.target as HTMLElement
        if (target.closest('[data-project-card], [data-card-menu], [data-review-popup], [role="menu"], button, a, input, textarea, select, [contenteditable="true"]')) return
        event.preventDefault()
        setEmptyGridMenuPoint({ x: event.clientX, y: event.clientY })
        setEmptyGridMenuOpen(true)
      } : undefined}
    >
      {/* Controls: group-by + batch toggle */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex min-w-0 items-center gap-2">
          {groups[0] ? (
            <>
              <span className="truncate text-[14.5px] font-bold">{groups[0].label}</span>
              <span className="shrink-0 rounded-full bg-secondary px-2 text-[12px] text-muted-foreground">{groups[0].list.length} {t('projectsCount')}</span>
            </>
          ) : folderBreadcrumb}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
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
      </div>

      {folderBreadcrumb && groups.length > 0 && (
        <div className="mb-3">{folderBreadcrumb}</div>
      )}

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
      {groups.map((g, index) => (
        <div key={g.key} className="mb-5">
          {index !== 0 && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[14.5px] font-bold">{g.label}</span>
              <span className="text-[12px] text-muted-foreground bg-secondary rounded-full px-2">{g.list.length} {t('projectsCount')}</span>
            </div>
          )}
          <div className={gridClass} data-project-grid={cardSize}>
            {g.list.map((p) => (
              <ProjectCard key={p.id} {...cardProps(p)} />
            ))}
            {index === groups.length - 1 && createCard}
          </div>
        </div>
      ))}

      {groups.length === 0 && createCard && (
        <div className={`${gridClass} mb-5`} data-project-grid={cardSize}>{createCard}</div>
      )}

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
            <div className={`${gridClass} pb-2 opacity-90`} data-project-grid={cardSize}>
              {archived.map((p) => (
                <ProjectCard key={p.id} {...cardProps(p)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Batch action bar */}
      {batchMode && (
        <div ref={batchBarRef} tabIndex={-1} className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-wrap items-center justify-center gap-2 sm:gap-3 max-w-[calc(100vw-2rem)] bg-foreground text-background rounded-2xl px-4 py-2.5 shadow-xl text-[13px] outline-none">
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
              ref={batchFolderTriggerRef}
              type="button"
              disabled={busy || !selected.size}
              onClick={() => setBatchFolderMenu((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={batchFolderMenu}
              aria-controls={batchFolderMenu ? 'batch-folder-menu' : undefined}
              className="px-3 py-1.5 rounded-lg bg-background/15 hover:bg-background/25 disabled:opacity-40 font-medium inline-flex items-center gap-1"
            >
              <FolderInput className="w-3.5 h-3.5" />
              {t('folderMoveTo')}
            </button>
            <ReviewPopup
              id="batch-folder-menu"
              open={batchFolderMenu}
              onOpenChange={setBatchFolderMenu}
              anchor={batchFolderTriggerRef}
              label={t('folderMoveTo')}
              role="menu"
              side="top"
              align="start"
              width={220}
              returnFocus={batchBarRef}
            >
              <FolderPickList
                options={folderOpts}
                onSelect={(folderId) => { setBatchFolderMenu(false); moveProjects([...selected], folderId, true) }}
              />
            </ReviewPopup>
          </div>
          <span className="w-px h-4 bg-background/30" aria-hidden />
          <button type="button" onClick={selectAllActive} className="px-3 py-1.5 rounded-lg text-background/70 hover:text-background">{t('selectAllProjects')}</button>
        </div>
      )}

      {emptyGridMenuPoint && (
        <OverlayMenu
          open={emptyGridMenuOpen}
          onOpenChange={(open) => { if (!open) closeEmptyGridMenu() }}
          label={t('newProject')}
          width={200}
          anchorPoint={emptyGridMenuPoint}
          className="rounded-[8px] p-1.5 shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeEmptyGridMenu()
              onCreateProject?.()
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <Plus className="h-4 w-4" />
            {t('newProject')}
          </button>
        </OverlayMenu>
      )}

      {settingsProject && (
        <ProjectSettingsDialog
          project={settingsProject}
          art={cardArtFor(settingsProject)}
          open
          onOpenChange={(open) => { if (!open) setSettingsProject(null) }}
          onSaved={() => { setSettingsProject(null); onMutated() }}
        />
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
