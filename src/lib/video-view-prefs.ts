export type VideoCardSize = 'sm' | 'md' | 'lg'
export type VideoThumbAspect = '16:9' | '4:3' | '1:1'
export type VideoTitleLines = 1 | 2
export type VideoSortField = 'updated' | 'name' | 'status' | 'comments'
export type VideoSortDir = 'asc' | 'desc'

export interface VideoDisplayPrefs {
  size: VideoCardSize
  aspect: VideoThumbAspect
  showInfo: boolean
  titleLines: VideoTitleLines
}

export interface VideoSortPrefs {
  field: VideoSortField
  dir: VideoSortDir
}

export const VIDEO_DISPLAY_STORAGE_KEY = 'vitransfer-admin-video-display'
export const VIDEO_SORT_STORAGE_KEY = 'vitransfer-admin-video-sort'

export const DEFAULT_VIDEO_DISPLAY: VideoDisplayPrefs = {
  size: 'lg',
  aspect: '16:9',
  showInfo: true,
  titleLines: 1,
}

export const DEFAULT_VIDEO_SORT: VideoSortPrefs = {
  field: 'updated',
  dir: 'desc',
}

export const VIDEO_GRID_TEMPLATE: Record<VideoCardSize, string> = {
  sm: 'repeat(auto-fill, minmax(150px, 1fr))',
  md: 'repeat(auto-fill, minmax(190px, 1fr))',
  lg: 'repeat(auto-fill, minmax(240px, 1fr))',
}

export const VIDEO_CARD_MAX_WIDTH: Record<VideoCardSize, string> = {
  sm: '180px',
  md: '220px',
  lg: '280px',
}

export const VIDEO_THUMB_ASPECT_CLASS: Record<VideoThumbAspect, string> = {
  '16:9': 'aspect-video',
  '4:3': 'aspect-[4/3]',
  '1:1': 'aspect-square',
}

function readJson<T>(key: string): Partial<T> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as Partial<T> : null
  } catch {
    return null
  }
}

export function loadVideoDisplayPrefs(): VideoDisplayPrefs {
  const stored = readJson<VideoDisplayPrefs>(VIDEO_DISPLAY_STORAGE_KEY)
  if (!stored) return DEFAULT_VIDEO_DISPLAY
  // The page saves prefs on mount, so the old untouched default would otherwise
  // keep existing sessions on the small preset. Only migrate that exact snapshot.
  if (stored.size === 'sm' && stored.aspect === '16:9' && stored.showInfo === true && stored.titleLines === 1) {
    return DEFAULT_VIDEO_DISPLAY
  }
  return {
    size: stored.size === 'sm' || stored.size === 'md' || stored.size === 'lg' ? stored.size : DEFAULT_VIDEO_DISPLAY.size,
    aspect: stored.aspect === '16:9' || stored.aspect === '4:3' || stored.aspect === '1:1' ? stored.aspect : DEFAULT_VIDEO_DISPLAY.aspect,
    showInfo: typeof stored.showInfo === 'boolean' ? stored.showInfo : DEFAULT_VIDEO_DISPLAY.showInfo,
    titleLines: stored.titleLines === 2 ? 2 : 1,
  }
}

export function saveVideoDisplayPrefs(value: VideoDisplayPrefs) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(VIDEO_DISPLAY_STORAGE_KEY, JSON.stringify(value))
  } catch {}
}

export function loadVideoSortPrefs(): VideoSortPrefs {
  const stored = readJson<VideoSortPrefs>(VIDEO_SORT_STORAGE_KEY)
  if (!stored) return DEFAULT_VIDEO_SORT
  const field: VideoSortField =
    stored.field === 'name' || stored.field === 'status' || stored.field === 'comments'
      ? stored.field
      : 'updated'
  return { field, dir: stored.dir === 'asc' ? 'asc' : 'desc' }
}

export function saveVideoSortPrefs(value: VideoSortPrefs) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(VIDEO_SORT_STORAGE_KEY, JSON.stringify(value))
  } catch {}
}
