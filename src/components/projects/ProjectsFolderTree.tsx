'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import {
  ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, Home,
  MoreHorizontal, MoveRight, Pencil, Trash2, X, Check,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  MAX_FOLDER_DEPTH, PROJECT_DND_MIME, collectDescendantIds, folderDepth, folderPath,
  parseProjectDragPayload, sortFoldersDepthFirst, subtreeDepth, wouldCreateCycle,
  type FolderNode,
} from '@/lib/project-folders'
import { NO_GROUP_KEY } from '@/lib/projects-filter'

const COLLAPSED_STORAGE_KEY = 'admin_projects_folder_collapsed'
const ROOT_KEY = ''
/** Anchoring constants for the portalled folder menu; the height is generous so a
 *  wrapped translation still flips the menu above the trigger instead of off-screen. */
const MENU_WIDTH = 160
const MENU_HEIGHT = 210

function loadCollapsed(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

type Editor =
  | { mode: 'create'; parentId: string | null }
  | { mode: 'rename'; id: string }

interface ProjectsFolderTreeProps {
  folders: FolderNode[]
  /** Direct contents per folder id, plus NO_GROUP_KEY for 未归类. */
  counts: Map<string, number>
  total: number
  /** null = 全部项目, NO_GROUP_KEY = 未归类, anything else = that folder. */
  openFolderId: string | null
  isAdmin: boolean
  onOpen: (folderId: string | null) => void
  onCreate: (name: string, parentId: string | null) => Promise<void>
  onRename: (id: string, name: string) => Promise<void>
  onMoveFolder: (id: string, parentId: string | null) => Promise<void>
  onDeleteFolder: (id: string) => Promise<void>
  onDropProjects: (projectIds: string[], folderId: string | null) => Promise<void>
}

export default function ProjectsFolderTree({
  folders, counts, total, openFolderId, isAdmin,
  onOpen, onCreate, onRename, onMoveFolder, onDeleteFolder, onDropProjects,
}: ProjectsFolderTreeProps) {
  const t = useTranslations('projects')
  const tc = useTranslations('common')

  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [draft, setDraft] = useState('')
  const [editorError, setEditorError] = useState('')
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<{ id: string; left: number; top: number } | null>(null)
  const [moveFolder, setMoveFolder] = useState<FolderNode | null>(null)
  const [moveParent, setMoveParent] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FolderNode | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const editorRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsed]))
  }, [collapsed])

  // The open folder's branch has to stay visible. Collapse state survives reloads, so
  // without this a deep link can leave the tree with no row for the folder you are in.
  useEffect(() => {
    if (!openFolderId || openFolderId === NO_GROUP_KEY) return
    const branch = folderPath(folders, openFolderId).map((f) => f.id)
    if (!branch.length) return
    setCollapsed((prev) => {
      const kept = [...prev].filter((id) => !branch.includes(id))
      return kept.length === prev.size ? prev : new Set(kept)
    })
  }, [openFolderId, folders])

  useEffect(() => {
    if (editor) editorRef.current?.focus()
  }, [editor])

  // The sidebar scrolls, so an absolutely-positioned popover would be clipped by
  // it: the menu is portalled to <body> and anchored to the viewport instead.
  const toggleMenu = (folderId: string, trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect()
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
    const top = rect.bottom + MENU_HEIGHT <= window.innerHeight - 8
      ? rect.bottom + 6
      : Math.max(8, rect.top - MENU_HEIGHT - 6)
    setMenu((current) => (current?.id === folderId ? null : { id: folderId, left, top }))
  }

  const childrenByParent = useMemo(() => {
    const map = new Map<string, FolderNode[]>()
    for (const folder of folders) {
      const key = folder.parentId || ROOT_KEY
      const siblings = map.get(key)
      if (siblings) siblings.push(folder)
      else map.set(key, [folder])
    }
    for (const siblings of map.values()) {
      siblings.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    }
    return map
  }, [folders])

  const orderedFolders = useMemo(() => sortFoldersDepthFirst(folders), [folders])

  // Rows follow the tree with collapsed branches left out, and the inline editor
  // takes the spot where the new or renamed folder will appear.
  const rows = useMemo(() => {
    const out: ({ kind: 'folder'; folder: FolderNode; depth: number } | { kind: 'editor'; parentId: string | null; depth: number })[] = []
    if (editor?.mode === 'create' && !editor.parentId) out.push({ kind: 'editor', parentId: null, depth: 0 })
    const walk = (parentId: string | null, depth: number) => {
      for (const folder of childrenByParent.get(parentId || ROOT_KEY) || []) {
        if (editor?.mode === 'rename' && editor.id === folder.id) {
          out.push({ kind: 'editor', parentId, depth })
        } else {
          out.push({ kind: 'folder', folder, depth })
        }
        if (editor?.mode === 'create' && (editor.parentId || null) === folder.id) {
          out.push({ kind: 'editor', parentId: folder.id, depth: depth + 1 })
        }
        if (!collapsed.has(folder.id)) walk(folder.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [childrenByParent, collapsed, editor])

  // A new child is one level below its parent, so the parent has to have room left.
  const canNestInto = (folder: FolderNode) => folderDepth(orderedFolders, folder.id) < MAX_FOLDER_DEPTH

  const deleteScope = deleteTarget
    ? (() => {
      const doomed = [deleteTarget.id, ...collectDescendantIds(folders, deleteTarget.id)]
      return {
        subfolders: doomed.length - 1,
        projects: doomed.reduce((n, id) => n + (counts.get(id) ?? 0), 0),
      }
    })()
    : null

  // Where a folder may be moved to: never into itself or under itself, and never
  // deeper than the cap once its own subtree comes along for the ride.
  const moveOptions = useMemo(() => {
    if (!moveFolder) return []
    const carried = subtreeDepth(folders, [moveFolder.id])
    return orderedFolders
      .filter(f => !wouldCreateCycle(folders, moveFolder.id, f.id))
      .filter(f => folderDepth(orderedFolders, f.id) + carried <= MAX_FOLDER_DEPTH)
  }, [moveFolder, folders, orderedFolders])

  const closeEditor = () => {
    setEditor(null)
    setDraft('')
    setEditorError('')
  }

  const submitEditor = async () => {
    const name = draft.trim()
    if (!name) {
      setEditorError(t('folderNameRequired'))
      return
    }
    setBusy(true)
    setEditorError('')
    try {
      if (editor?.mode === 'create') await onCreate(name, editor.parentId)
      else if (editor?.mode === 'rename') await onRename(editor.id, name)
      closeEditor()
    } catch (err) {
      // Stay in the editor: the server's reason ("已有同名文件夹") is what makes
      // the name fixable without guessing.
      setEditorError(err instanceof Error ? err.message : t('operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  function renderEditor(parentId: string | null, depth: number) {
    const isRename = editor?.mode === 'rename'
    return (
      <li key={isRename ? `rename-${editor.id}` : `create-${parentId || ROOT_KEY}`} className="py-0.5">
        <form
          className="flex items-center gap-1"
          style={{ marginLeft: indentOf(depth) }}
          onSubmit={(e) => { e.preventDefault(); void submitEditor() }}
        >
          <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden />
          <Input
            ref={editorRef}
            value={draft}
            maxLength={60}
            placeholder={t('folderNamePlaceholder')}
            aria-label={isRename ? t('folderRename') : t('folderNew')}
            onChange={(e) => { setDraft(e.target.value); setEditorError('') }}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); closeEditor() } }}
            className="h-8 text-sm px-2"
          />
          <button type="submit" disabled={busy} aria-label={tc('save')} className="text-muted-foreground hover:text-foreground disabled:opacity-40">
            <Check className="w-4 h-4" />
          </button>
          <button type="button" onClick={closeEditor} aria-label={tc('cancel')} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </form>
        {editorError && <p className="text-xs text-destructive mt-0.5" style={{ marginLeft: indentOf(depth) + 20 }}>{editorError}</p>}
      </li>
    )
  }

  // Hovering a collapsed folder with a drag opens it after a beat, the way a desktop
  // file manager does, so a subfolder buried in a closed branch is reachable in one
  // gesture instead of needing a second trip.
  const [hoverToExpand, setHoverToExpand] = useState<string | null>(null)

  useEffect(() => {
    if (!hoverToExpand) return
    const folderId = hoverToExpand
    const timer = window.setTimeout(() => {
      setCollapsed((prev) => {
        if (!prev.has(folderId)) return prev
        const next = new Set(prev)
        next.delete(folderId)
        return next
      })
      setHoverToExpand(null)
    }, 650)
    return () => window.clearTimeout(timer)
  }, [hoverToExpand])

  const dropHandlers = (key: string, folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!isAdmin || !e.dataTransfer.types.includes(PROJECT_DND_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const closedBranch = folderId && collapsed.has(folderId) && (childrenByParent.get(folderId)?.length ?? 0) > 0
      setHoverToExpand(closedBranch ? folderId : null)
      if (dropKey !== key) setDropKey(key)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setHoverToExpand(null)
      if (dropKey === key) setDropKey(null)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setHoverToExpand(null)
      setDropKey(null)
      const ids = parseProjectDragPayload(e.dataTransfer.getData(PROJECT_DND_MIME))
      if (!ids.length) return
      setActionError('')
      setBusy(true)
      void onDropProjects(ids, folderId)
        .catch((err) => setActionError(err instanceof Error ? err.message : t('operationFailed')))
        .finally(() => setBusy(false))
    },
  })

  const rowClass = (active: boolean, isDropTarget: boolean) => [
    'group/row w-full flex items-center gap-1 pr-1.5 h-9 rounded-lg text-sm transition-colors',
    active ? 'bg-primary-visible text-foreground border-2 border-primary-visible font-semibold' : 'hover:bg-accent/60 border-2 border-transparent text-foreground',
    isDropTarget ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : '',
  ].join(' ')

  return (
    <nav aria-label={t('folder')} className="min-w-0">
      <div className="flex items-center gap-1.5 px-1 pb-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('folder')}</span>
        {isAdmin && (
          <button
            type="button"
            onClick={() => { setEditor({ mode: 'create', parentId: null }); setDraft(''); setEditorError('') }}
            aria-label={t('folderNew')}
            title={t('folderNew')}
            className="ml-auto w-7 h-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring inline-flex items-center justify-center"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
        )}
      </div>

      <ul className="space-y-0.5">
        <li>
          <button type="button" onClick={() => onOpen(null)} className={rowClass(openFolderId === null, false)}>
            <Home className="w-4 h-4 flex-shrink-0 ml-1.5" aria-hidden />
            <span className="flex-1 min-w-0 truncate text-left">{t('statAll')}</span>
            <CountBadge value={total} onActive={openFolderId === null} />
          </button>
        </li>

        {rows.length === 0 && (
          <li className="px-2 py-2 text-[13px] text-muted-foreground">{t('folderNoFolders')}</li>
        )}

        {rows.map((row) => {
          if (row.kind === 'editor') return renderEditor(row.parentId, row.depth)
          const { folder, depth } = row
          const kids = childrenByParent.get(folder.id) || []
          const isCollapsed = collapsed.has(folder.id)
          const count = counts.get(folder.id) ?? 0
          const active = openFolderId === folder.id
          return (
            <li key={folder.id} className="py-0.5">
              <div className={rowClass(active, dropKey === folder.id)} style={{ paddingLeft: indentOf(depth) }} {...dropHandlers(folder.id, folder.id)}>
                {kids.length > 0 ? (
                  <button
                    type="button"
                    aria-label={isCollapsed ? t('folderExpand') : t('folderCollapse')}
                    aria-expanded={!isCollapsed}
                    onClick={() => {
                      setCollapsed((prev) => {
                        const next = new Set(prev)
                        if (next.has(folder.id)) next.delete(folder.id)
                        else next.add(folder.id)
                        return next
                      })
                    }}
                    className="w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-foreground flex-shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                ) : (
                  <span className="w-4 flex-shrink-0" aria-hidden />
                )}
                <button type="button" onClick={() => onOpen(folder.id)} className="flex-1 min-w-0 flex items-center gap-1.5 text-left h-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {active ? <FolderOpen className="w-4 h-4 flex-shrink-0" aria-hidden /> : <Folder className="w-4 h-4 flex-shrink-0" aria-hidden />}
                  <span className="truncate">{folder.name}</span>
                  <CountBadge value={count} className="ml-auto" onActive={active} />
                </button>
                {isAdmin && (
                  <div className="flex-shrink-0">
                    <button
                      type="button"
                      aria-label={t('folderActions')}
                      aria-haspopup="menu"
                      aria-expanded={menu?.id === folder.id}
                      onClick={(e) => toggleMenu(folder.id, e.currentTarget)}
                      className="w-6 h-6 rounded text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center justify-center opacity-0 focus:opacity-100 group-hover/row:opacity-100 transition-opacity"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </li>
          )
        })}

        <li className="py-0.5">
          <div className={rowClass(openFolderId === NO_GROUP_KEY, dropKey === NO_GROUP_KEY)} style={{ paddingLeft: indentOf(0) }} {...dropHandlers(NO_GROUP_KEY, null)}>
            <span className="w-4 flex-shrink-0" aria-hidden />
            <button type="button" onClick={() => onOpen(NO_GROUP_KEY)} className="flex-1 min-w-0 flex items-center gap-1.5 text-left h-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Folder className="w-4 h-4 flex-shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{t('folderUnfiled')}</span>
              <CountBadge value={counts.get(NO_GROUP_KEY) ?? 0} className="ml-auto" onActive={openFolderId === NO_GROUP_KEY} />
            </button>
            {isAdmin && <div className="w-6 flex-shrink-0" aria-hidden />}
          </div>
        </li>
      </ul>

      {menu && typeof document !== 'undefined' && (() => {
        const folder = folders.find((item) => item.id === menu.id)
        if (!folder) return null
        return createPortal(
          <>
            <button type="button" className="fixed inset-0 z-[80] cursor-default" aria-label={tc('close')} onClick={() => setMenu(null)} />
            <div role="menu" aria-label={`${folder.name} ${t('folderActions')}`} className="fixed z-[90] rounded-[10px] border border-border bg-popover p-1 shadow-lg" style={{ left: menu.left, top: menu.top, width: MENU_WIDTH }}>
              <MenuButton
                label={t('folderNewSub')}
                icon={FolderPlus}
                disabled={!canNestInto(folder)}
                hint={canNestInto(folder) ? undefined : t('folderTooDeep')}
                onClick={() => { setMenu(null); setEditor({ mode: 'create', parentId: folder.id }); setDraft(''); setEditorError('') }}
              />
              <MenuButton
                label={t('folderRename')}
                icon={Pencil}
                onClick={() => { setMenu(null); setEditor({ mode: 'rename', id: folder.id }); setDraft(folder.name); setEditorError('') }}
              />
              <MenuButton
                label={t('folderMoveFolder')}
                icon={MoveRight}
                onClick={() => { setMenu(null); setMoveFolder(folder); setMoveParent(folder.parentId || null) }}
              />
              <div className="mt-1 pt-1 border-t border-border">
                <MenuButton
                  label={t('folderDelete')}
                  icon={Trash2}
                  danger
                  onClick={() => { setMenu(null); setDeleteTarget(folder) }}
                />
              </div>
            </div>
          </>,
          document.body,
        )
      })()}

      {actionError && <p className="mt-2 px-1 text-xs text-destructive break-words">{actionError}</p>}

      {/* Move a folder elsewhere in the tree */}
      <Dialog open={!!moveFolder} onOpenChange={(open) => !open && setMoveFolder(null)}>
        <DialogContent className="sm:max-w-sm p-4 sm:p-5">
          <DialogHeader>
            <DialogTitle className="text-[16px]">{t('folderMoveFolderTitle', { name: moveFolder?.name || '' })}</DialogTitle>
            <DialogDescription>{t('folderMoveFolderHint')}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[45vh] overflow-y-auto -mx-1">
            <button type="button" onClick={() => setMoveParent(null)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] hover:bg-muted text-left">
              <Check className={`w-3.5 h-3.5 flex-shrink-0 ${moveParent === null ? 'text-primary' : 'opacity-0'}`} aria-hidden />
              <Home className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
              {t('folderTopLevel')}
            </button>
            {moveOptions.map((folder) => {
              const depth = folderDepth(orderedFolders, folder.id) - 1
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setMoveParent(folder.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] hover:bg-muted text-left"
                  style={{ paddingLeft: 8 + depth * 14 }}
                >
                  <Check className={`w-3.5 h-3.5 flex-shrink-0 ${moveParent === folder.id ? 'text-primary' : 'opacity-0'}`} aria-hidden />
                  <Folder className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
                  <span className="truncate">{folder.name}</span>
                </button>
              )
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setMoveFolder(null)}>{tc('cancel')}</Button>
            <Button
              disabled={busy || moveParent === (moveFolder?.parentId || null)}
              onClick={async () => {
                if (!moveFolder) return
                setBusy(true)
                try {
                  await onMoveFolder(moveFolder.id, moveParent)
                  setMoveFolder(null)
                } catch (err) {
                  setActionError(err instanceof Error ? err.message : t('operationFailed'))
                  setMoveFolder(null)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {t('folderMoveFolder')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete: subfolders go with it, projects stay and fall back to 未归类 */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm p-4 sm:p-5">
          <DialogHeader>
            <DialogTitle className="text-[16px]">{t('folderDeleteTitle')}</DialogTitle>
            <DialogDescription>
              {deleteScope && deleteScope.subfolders > 0
                ? t('folderDeleteBodyNested', { name: deleteTarget?.name || '', subfolders: deleteScope.subfolders, count: deleteScope.projects })
                : t('folderDeleteBody', { name: deleteTarget?.name || '', count: deleteScope?.projects ?? 0 })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDeleteTarget(null)}>{tc('cancel')}</Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!deleteTarget) return
                setBusy(true)
                // Collapse state lives in localStorage, so the ids going out of
                // existence with this folder have to be dropped from it here — nothing
                // else will ever look them up again.
                const doomed = new Set([deleteTarget.id, ...collectDescendantIds(folders, deleteTarget.id)])
                setCollapsed((prev) => {
                  const kept = [...prev].filter((id) => !doomed.has(id))
                  return kept.length === prev.size ? prev : new Set(kept)
                })
                try {
                  await onDeleteFolder(deleteTarget.id)
                  setDeleteTarget(null)
                } catch (err) {
                  setActionError(err instanceof Error ? err.message : t('operationFailed'))
                  setDeleteTarget(null)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {tc('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  )
}

/** Folders nest 14px per level; the chevron column is inside that offset. */
function indentOf(depth: number): number {
  return 6 + depth * 16
}

function CountBadge({ value, className, onActive }: { value: number; className?: string; onActive?: boolean }) {
  return (
    <span className={`text-xs tabular-nums ${onActive ? 'text-foreground' : value === 0 ? 'text-muted-foreground/60' : 'text-muted-foreground'} ${className || ''}`}>
      {value}
    </span>
  )
}

function MenuButton({
  label, icon: Icon, onClick, disabled, danger, hint,
}: {
  label: string
  icon: typeof Folder
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  hint?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? hint : undefined}
      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-left disabled:opacity-40 ${danger ? 'hover:bg-muted text-destructive' : 'hover:bg-muted'}`}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      {label}
    </button>
  )
}
