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

// Share-token endpoints frequently need only authorization and a handful of
// display settings. Loading every video/folder relation for those requests
// multiplies the cost of opening a review page (especially with thumbnails).
// Keep this select explicit so media/storage fields never enter the hot path.
const SHARE_PROJECT_METADATA_SELECT = {
  id: true,
  title: true,
  slug: true,
  status: true,
  companyName: true,
  sharePassword: true,
  authMode: true,
  guestMode: true,
  guestLatestOnly: true,
  guestShowPhotos: true,
  hideFeedback: true,
  allowAssetDownload: true,
  allowPhotoDownload: true,
  allowClientAssetUpload: true,
  allowReverseShare: true,
  clientCanApprove: true,
  restrictCommentsToLatestVersion: true,
  timestampDisplay: true,
  previewResolution: true,
  watermarkEnabled: true,
  usePreviewForApprovedPlayback: true,
} as const

export type ResolvedShareMetadata = {
  link: ResolvedShare['link']
  project: any | null
}

/** Resolve only link/project metadata; no videos or folders are loaded. */
export async function resolveShareMetadata(token: string): Promise<ResolvedShareMetadata> {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    select: {
      id: true, token: true, name: true, type: true, scopeType: true,
      scopeId: true, permissions: true, authMode: true, sharePassword: true,
      expiresAt: true, maxViews: true, viewCount: true, status: true,
      project: { select: SHARE_PROJECT_METADATA_SELECT },
    },
  })
  if (link) return { link, project: link.project }

  const project = await prisma.project.findUnique({
    where: { slug: token },
    select: SHARE_PROJECT_METADATA_SELECT,
  })
  return { link: null, project }
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

/**
 * Check one already-loaded video against a share scope without loading the
 * project's complete video relation. VIDEO scopes need one small lookup for
 * the scope target name; the other scope types are resolved from the video.
 */
export async function isVideoInShareScope(
  link: ResolvedShare['link'],
  projectId: string,
  video: { id: string; folderId?: string | null; name?: string },
): Promise<boolean> {
  if (!link || link.scopeType === 'PROJECT') return true
  if (link.scopeType === 'VIDEO_VERSION') return video.id === link.scopeId
  if (link.scopeType === 'FOLDER') return video.folderId === link.scopeId
  if (link.scopeType === 'VIDEO') {
    if (!link.scopeId || !video.name) return false
    const target = await prisma.video.findFirst({
      where: { id: link.scopeId, projectId, status: { not: 'ROLLED_BACK' } },
      select: { name: true },
    })
    return target?.name === video.name
  }
  return false
}

/** Load only IDs needed to filter comments for a scoped share link. */
export async function getShareScopeVideoIds(
  link: ResolvedShare['link'],
  projectId: string,
): Promise<Set<string> | null> {
  if (!link || link.scopeType === 'PROJECT') return null

  if (link.scopeType === 'VIDEO_VERSION') {
    const target = link.scopeId
      ? await prisma.video.findFirst({
          where: { id: link.scopeId, projectId, status: { not: 'ROLLED_BACK' } },
          select: { id: true },
        })
      : null
    return new Set(target ? [target.id] : [])
  }

  if (link.scopeType === 'FOLDER') {
    const videos = await prisma.video.findMany({
      where: { projectId, folderId: link.scopeId, status: { not: 'ROLLED_BACK' } },
      select: { id: true },
    })
    return new Set(videos.map((video) => video.id))
  }

  if (link.scopeType === 'VIDEO') {
    const target = link.scopeId
      ? await prisma.video.findFirst({
          where: { id: link.scopeId, projectId, status: { not: 'ROLLED_BACK' } },
          select: { name: true },
        })
      : null
    if (!target) return new Set()
    const videos = await prisma.video.findMany({
      where: { projectId, name: target.name, status: { not: 'ROLLED_BACK' } },
      select: { id: true },
    })
    return new Set(videos.map((video) => video.id))
  }

  return new Set()
}

export function linkPermissions(link: ResolvedShare['link'], project: any): string[] {
  if (!link) return ['view', 'comment', 'download']
  if (link.type === 'COLLECT') return link.permissions.includes('upload') ? ['upload'] : []
  return link.permissions.length > 0 ? link.permissions : ['view']
}
