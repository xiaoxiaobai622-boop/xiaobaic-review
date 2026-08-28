import { prisma } from '@/lib/db'

export const SHARE_LINK_STATUSES = ['ACTIVE', 'REVOKED', 'EXPIRED'] as const

export type ResolvedShare = {
  link: {
    id: string
    token: string
    name: string
    type: string
    scopeType: string
    scopeId: string | null
    permissions: string[]
    authMode: string
    sharePassword: string | null
    expiresAt: Date | null
    maxViews: number | null
    viewCount: number
    status: string
  } | null
  project: any | null
}

/** Resolve a new independent link first, then fall back to the legacy slug. */
export async function resolveShare(token: string): Promise<ResolvedShare> {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    select: {
      id: true, token: true, name: true, type: true, scopeType: true,
      scopeId: true, permissions: true, authMode: true, sharePassword: true,
      expiresAt: true, maxViews: true, viewCount: true, status: true,
      project: {
        include: {
          videos: { where: { status: { not: 'ROLLED_BACK' } }, orderBy: { version: 'desc' } },
          folders: { orderBy: { name: 'asc' } },
        },
      },
    },
  })
  if (link) return { link, project: link.project }

  const project = await prisma.project.findUnique({
    where: { slug: token },
    include: {
      videos: { where: { status: { not: 'ROLLED_BACK' } }, orderBy: { version: 'desc' } },
      folders: { orderBy: { name: 'asc' } },
    },
  })
  return { link: null, project }
}

export function isShareLinkActive(link: ResolvedShare['link']): boolean {
  if (!link || link.status !== 'ACTIVE') return false
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return false
  if (link.maxViews !== null && link.viewCount >= link.maxViews) return false
  return true
}

export async function incrementShareLinkView(linkId: string): Promise<boolean> {
  const current = await prisma.shareLink.findUnique({ where: { id: linkId }, select: { status: true, expiresAt: true, maxViews: true, viewCount: true } })
  if (!current || current.status !== 'ACTIVE' || (current.expiresAt && current.expiresAt.getTime() <= Date.now())) return false
  if (current.maxViews !== null && current.viewCount >= current.maxViews) return false
  const result = await prisma.shareLink.updateMany({
    where: { id: linkId, status: 'ACTIVE', viewCount: current.viewCount },
    data: { viewCount: { increment: 1 } },
  })
  return result.count > 0
}

export function scopeVideoIds(link: ResolvedShare['link'], videos: Array<{ id: string; folderId: string | null; name: string; version: number }>): Set<string> | null {
  if (!link || link.scopeType === 'PROJECT') return null
  if (link.scopeType === 'VIDEO_VERSION') {
    return new Set(videos.filter(video => video.id === link.scopeId).map(video => video.id))
  }
  if (link.scopeType === 'VIDEO') {
    const target = videos.find(video => video.id === link.scopeId)
    return new Set(target ? videos.filter(video => video.name === target.name).map(video => video.id) : [])
  }
  if (link.scopeType === 'FOLDER') {
    return new Set(videos.filter(video => video.folderId === link.scopeId).map(video => video.id))
  }
  return new Set()
}

export function linkPermissions(link: ResolvedShare['link'], project: any): string[] {
  if (!link) return ['view', 'comment', 'download']
  if (link.type === 'COLLECT') return link.permissions.includes('upload') ? ['upload'] : []
  return link.permissions.length > 0 ? link.permissions : ['view']
}
