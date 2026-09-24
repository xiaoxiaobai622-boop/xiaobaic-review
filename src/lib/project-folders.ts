/**
 * Folder-tree rules shared by the API routes and the console, so "how deep is this
 * folder" and "would moving it create a loop" are decided one way in both places.
 * Everything works on the flat list the API returns ({ id, name, parentId }).
 */

export interface FolderNode {
  id: string
  name: string
  parentId: string | null
}

// Past this the indentation stops being readable, and one member could otherwise
// build a folder chain nobody else can get out of.
export const MAX_FOLDER_DEPTH = 5

// Carried on every card drag so the tree knows what it is being handed. The payload
// is a JSON array because a batch selection drags as a unit, like on a desktop.
export const PROJECT_DND_MIME = 'application/x-project-ids'

/** Ids from a drag payload; anything malformed reads as "nothing was dragged". */
export function parseProjectDragPayload(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function byId(folders: FolderNode[]): Map<string, FolderNode> {
  return new Map(folders.map(f => [f.id, f]))
}

/** 1 for a root folder, 2 for its child, and so on. Unknown ids read as depth 0. */
export function folderDepth(folders: FolderNode[], id: string): number {
  const index = byId(folders)
  let depth = 0
  const seen = new Set<string>()
  let current = index.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    depth++
    current = current.parentId ? index.get(current.parentId) : undefined
  }
  return depth
}

/** Deepest level reached by the given roots' subtrees (0 when the list is empty). */
export function subtreeDepth(folders: FolderNode[], rootIds: string[]): number {
  const childrenOf = new Map<string, string[]>()
  for (const f of folders) {
    if (!f.parentId) continue
    const siblings = childrenOf.get(f.parentId)
    if (siblings) siblings.push(f.id)
    else childrenOf.set(f.parentId, [f.id])
  }

  let deepest = 0
  const walk = (id: string, depth: number) => {
    deepest = Math.max(deepest, depth)
    for (const child of childrenOf.get(id) || []) walk(child, depth + 1)
  }
  for (const root of rootIds) walk(root, 1)
  return deepest
}

/** Every folder nested under `id`, `id` itself excluded. */
export function collectDescendantIds(folders: FolderNode[], id: string): string[] {
  const out: string[] = []
  let frontier = [id]
  const seen = new Set<string>([id])
  while (frontier.length) {
    const next: string[] = []
    for (const folder of folders) {
      if (!folder.parentId || !frontier.includes(folder.parentId) || seen.has(folder.id)) continue
      seen.add(folder.id)
      out.push(folder.id)
      next.push(folder.id)
    }
    frontier = next
  }
  return out
}

/** Moving `folderId` under `nextParentId` would loop if the target is itself or a descendant. */
export function wouldCreateCycle(folders: FolderNode[], folderId: string, nextParentId: string): boolean {
  if (folderId === nextParentId) return true
  return collectDescendantIds(folders, folderId).includes(nextParentId)
}

/** Root → … → self, for breadcrumbs and for "客户A / 2026春" labels. */
export function folderPath(folders: FolderNode[], id: string): FolderNode[] {
  const index = byId(folders)
  const path: FolderNode[] = []
  const seen = new Set<string>()
  let current = index.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId ? index.get(current.parentId) : undefined
  }
  return path
}

/** Depth-first display order: roots by name, each folder's children by name right after it. */
export function sortFoldersDepthFirst(folders: FolderNode[]): FolderNode[] {
  const out: FolderNode[] = []
  const childrenOf = (parentId: string | null) =>
    folders
      .filter(f => (f.parentId || null) === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  const walk = (parentId: string | null) => {
    for (const folder of childrenOf(parentId)) {
      out.push(folder)
      walk(folder.id)
    }
  }
  walk(null)
  // Orphans (a parent the list doesn't contain) still have to be reachable.
  for (const folder of folders) if (!out.includes(folder)) out.push(folder)
  return out
}

/** One entry per folder, in depth-first order, with how far it is indented. */
export function folderOptions(folders: FolderNode[]): { id: string; name: string; depth: number }[] {
  const ordered = sortFoldersDepthFirst(folders)
  return ordered.map(f => ({ id: f.id, name: f.name, depth: folderDepth(ordered, f.id) - 1 }))
}

/** id -> "客户A / 2026春", so a chip or menu entry never shows a bare name that could
 *  belong to any of the sibling folders sharing it. */
export function folderPathLabels(folders: FolderNode[], separator = ' / '): Map<string, string> {
  const labels = new Map<string, string>()
  // Depth-first order means a parent is always labelled before its children, and it
  // still yields a row for a folder whose parent is missing from the list.
  for (const folder of sortFoldersDepthFirst(folders)) {
    const prefix = folder.parentId ? labels.get(folder.parentId) : undefined
    labels.set(folder.id, prefix ? `${prefix}${separator}${folder.name}` : folder.name)
  }
  return labels
}
