import { buildReviewPath } from '@/lib/deep-link'

export function hourBucket(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00'
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}`
}

export function actorKey(
  userId?: string | null,
  email?: string | null,
  fallback?: string | null,
): string {
  return userId || email?.trim().toLowerCase() || fallback?.trim() || 'unknown'
}

export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function excerpt(value: string, max = 180): string {
  const text = stripHtml(value)
  return text.length > max ? `${text.slice(0, max)}...` : text
}

export function formatFileList(files: string[], max = 3): string {
  const unique = Array.from(new Set(files.filter(Boolean)))
  if (unique.length === 0) return ''
  const shown = unique.slice(0, max).join('、')
  return unique.length > max ? `${shown} 等 ${unique.length} 个文件` : shown
}

export function projectFilesLink(projectId: string): string {
  return `/studio/projects/${projectId}`
}

export function commentReviewLink(params: {
  projectId: string
  videoName?: string | null
  version?: number | null
  timecode?: string | null
  fps?: number | null
  commentId?: string | null
}): string {
  return buildReviewPath({
    projectId: params.projectId,
    videoName: params.videoName ?? undefined,
    version: params.version ?? undefined,
    timecode: params.timecode ?? undefined,
    fps: params.fps ?? undefined,
    commentId: params.commentId ?? undefined,
  })
}

export function versionLabelOf(version: number, label?: string | null): string {
  return label?.trim() || `v${version}`
}
