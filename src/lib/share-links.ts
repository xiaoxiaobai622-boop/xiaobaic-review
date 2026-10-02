import { prisma } from '@/lib/db'
import { allocateShareToken } from '@/lib/share-tokens'

export const SHARE_LINK_STATUSES = ['ACTIVE', 'REVOKED', 'EXPIRED'] as const

export const PROJECT_MASTER_LINK_NAME = '项目主链接'

/**
 * A share address is the bare code at the root of the domain
 * (`https://vidx.cn/<token>`) so it can be read off a screen and typed on a
 * phone — the project's own address included. The older
 * `/share/<teamKey>/<shareSlug>` shape keeps resolving for links already sent.
 */
export function formatShareLinkUrl(token: string, baseUrl: string): string {
  return `${baseUrl}/${encodeURIComponent(token)}`
}

/**
 * The session a visitor on an unauthenticated (`authMode = NONE`) link gets.
 * It carries the address they came in through because one project can publish
 * several open links at once: keyed by project alone, the second link's visit
 * was swallowed by the first one's dedupe key, and killing sessions on a revoke
 * would have hit every other link from the same IP.
 */
export function noneAccessSessionId(projectId: string, linkToken: string, ipAddress: string): string {
  return `none:${projectId}:${linkToken}:${ipAddress}`
}

type ShareLinkRecord = {
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
  masterOfProjectId: string | null
}

/** The columns every policy is built from; kept in one place so a new policy
 *  field cannot be selected in one query and missing in another. */
const SHARE_LINK_POLICY_FIELDS = {
  id: true, token: true, name: true, type: true, scopeType: true,
  scopeId: true, permissions: true, authMode: true, sharePassword: true,
  expiresAt: true, maxViews: true, viewCount: true, status: true,
  masterOfProjectId: true,
} as const

/**
 * The rules a request is judged by. They come from a `ShareLink` row, except for
 * the project's legacy `/share/<teamKey>/<shareSlug>` address, which has no row
 * and is synthesised from the project. The project's master link does have a row
 * (`masterOfProjectId`), so it gets expiry, revocation and access records like
 * any other link while its comment/download rules still come from the project.
 */
export type SharePolicy = ShareLinkRecord & { isProjectMaster: boolean }

/** Fields `isShareLinkActive` needs; both a link row and a policy satisfy it. */
type ShareValidity = Pick<ShareLinkRecord, 'status' | 'expiresAt' | 'maxViews' | 'viewCount'>

type ShareScope = Pick<ShareLinkRecord, 'scopeType' | 'scopeId'>

// Share-token endpoints frequently need only authorization and a handful of
// display settings. Loading every video/folder relation for those requests
// multiplies the cost of opening a review page (especially with thumbnails).
// Keep this select explicit so media/storage fields never enter the hot path.
const SHARE_PROJECT_METADATA_SELECT = {
  id: true,
  teamId: true,
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
  link: ShareLinkRecord | null
  project: any | null
  policy: SharePolicy | null
}

/**
 * A project address without a row must not therefore escape the per-link guards:
 * the project's own settings become the policy. Archiving is the owner's kill
 * switch, and `hideFeedback`/`allowAssetDownload` are what retire comment/download
 * instead of granting them unconditionally. Also the source of the permissions a
 * master row inherits.
 */
export function projectMasterPolicy(project: any): SharePolicy {
  return {
    id: '',
    token: project.slug,
    name: 'project-master',
    type: 'REVIEW',
    scopeType: 'PROJECT',
    scopeId: null,
    masterOfProjectId: null,
    permissions: [
      'view',
      ...(project.hideFeedback ? [] : ['comment']),
      ...(project.allowAssetDownload ? ['download'] : []),
    ],
    authMode: project.authMode ?? 'PASSWORD',
    sharePassword: project.sharePassword ?? null,
    expiresAt: null,
    maxViews: null,
    viewCount: 0,
    status: project.status === 'ARCHIVED' ? 'REVOKED' : 'ACTIVE',
    isProjectMaster: true,
  }
}

function toPolicy(link: ShareLinkRecord, project: any | null): SharePolicy {
  // Archiving a project is the owner's kill switch for everything it exposes, so
  // an explicit link must not keep working after the project is archived.
  const status = project?.status === 'ARCHIVED' ? 'REVOKED' : link.status
  if (!link.masterOfProjectId || !project) return { ...link, isProjectMaster: false, status }
  // The master row owns the address, the expiry and the access records. Who may
  // comment or download is still set on the project's settings page, so those
  // rules keep coming from the project instead of drifting into the row.
  const master = projectMasterPolicy(project)
  return {
    ...link,
    permissions: master.permissions,
    authMode: master.authMode,
    sharePassword: master.sharePassword,
    status,
    isProjectMaster: true,
  }
}

/** Resolve only link/project metadata; no videos or folders are loaded. */
export async function resolveShareMetadata(token: string): Promise<ResolvedShareMetadata> {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    select: { ...SHARE_LINK_POLICY_FIELDS, project: { select: SHARE_PROJECT_METADATA_SELECT } },
  })
  if (link) return { link, project: link.project, policy: toPolicy(link, link.project) }

  const project = await prisma.project.findUnique({
    where: { slug: token },
    select: SHARE_PROJECT_METADATA_SELECT,
  })
  return { link: null, project, policy: project ? projectMasterPolicy(project) : null }
}

/**
 * Every project has one master link row, created the first time something needs
 * its address rather than in a migration: the container runs `prisma migrate
 * deploy` on boot, so a backfill that trips over an existing token would stop the
 * app from starting. The address is allocated, never derived from the title.
 */
export async function ensureProjectMasterLink(projectId: string): Promise<ShareLinkRecord | null> {
  const existing = await prisma.shareLink.findUnique({
    where: { masterOfProjectId: projectId },
    select: SHARE_LINK_POLICY_FIELDS,
  })
  if (existing) return existing

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: SHARE_PROJECT_METADATA_SELECT,
  })
  if (!project) return null

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const master = projectMasterPolicy(project)
      return await prisma.shareLink.create({
        data: {
          projectId,
          masterOfProjectId: projectId,
          token: await allocateShareToken(prisma),
          name: PROJECT_MASTER_LINK_NAME,
          type: master.type,
          scopeType: master.scopeType,
          permissions: master.permissions,
          authMode: master.authMode,
          sharePassword: master.sharePassword,
        },
        select: SHARE_LINK_POLICY_FIELDS,
      })
    } catch (error) {
      // Two notifications for the same project can race here; the loser reads the
      // row the winner created instead of minting a second address.
      if ((error as { code?: string })?.code !== 'P2002') throw error
      const row = await prisma.shareLink.findUnique({
        where: { masterOfProjectId: projectId },
        select: SHARE_LINK_POLICY_FIELDS,
      })
      if (row) return row
    }
  }
  return null
}

/**
 * Pull the project's current address out of circulation and hand it a new one.
 * The old code stops matching any row, so a leaked address is dead from the
 * moment this returns, without touching the videos it exposes.
 */
export async function rotateProjectMasterToken(projectId: string): Promise<ShareLinkRecord | null> {
  const master = await ensureProjectMasterLink(projectId)
  if (!master) return null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.shareLink.update({
        where: { id: master.id },
        data: { token: await allocateShareToken(prisma) },
        select: SHARE_LINK_POLICY_FIELDS,
      })
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2002') throw error
    }
  }
  return null
}

/**
 * Read-only addresses for a page of projects, so list views can link straight to
 * the short URL. A project nobody has opened yet simply has no row and is missing
 * from the map: loading a list must not mint share rows.
 */
export async function masterTokensByProject(projectIds: string[]): Promise<Map<string, string>> {
  if (projectIds.length === 0) return new Map()
  const rows = await prisma.shareLink.findMany({
    where: { masterOfProjectId: { in: projectIds } },
    select: { masterOfProjectId: true, token: true },
  })
  return new Map(rows.map(row => [row.masterOfProjectId as string, row.token]))
}

export function isShareLinkActive(link: ShareValidity | null): boolean {
  if (!link || link.status !== 'ACTIVE') return false
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return false
  if (link.maxViews !== null && link.viewCount >= link.maxViews) return false
  return true
}

/**
 * Count one view for a link that is still inside its own limits, and hand back
 * the new total. `null` means the link itself refused: revoked, expired, or out
 * of views. An optimistic `viewCount` match that lost is not a refusal — someone
 * else already counted that view — so re-read and try again, bounded. Two visitors
 * racing for the last remaining view still split one win and one 410, because the
 * loser re-checks the limits before it increments.
 */
export async function incrementShareLinkView(linkId: string): Promise<number | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await prisma.shareLink.findUnique({ where: { id: linkId }, select: { status: true, expiresAt: true, maxViews: true, viewCount: true } })
    if (!current || !isShareLinkActive(current)) return null
    const result = await prisma.shareLink.updateMany({
      where: { id: linkId, status: 'ACTIVE', viewCount: current.viewCount },
      data: { viewCount: { increment: 1 } },
    })
    if (result.count > 0) return current.viewCount + 1
  }
  return null
}

export function scopeVideoIds(link: ShareScope | null, videos: Array<{ id: string; folderId: string | null; name: string; version: number }>): Set<string> | null {
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
  link: ShareScope | null,
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
  link: ShareScope | null,
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

export function linkPermissions(policy: SharePolicy | null): string[] {
  if (!policy) return ['view']
  if (policy.type === 'COLLECT') return policy.permissions.includes('upload') ? ['upload'] : []
  return policy.permissions.length > 0 ? policy.permissions : ['view']
}

/**
 * The one writer of the stored `permissions` array. A link is judged by what is
 * in that column, so it must never end up empty: an empty array means a URL that
 * opens and can do nothing, which reads as a broken share rather than as a
 * deliberate setting. Both create and update fall back to the link type's
 * defaults so neither path can produce that state.
 */
export function sanitizeSharePermissions(value: unknown, type: string): string[] {
  const allowed = type === 'COLLECT' ? ['upload'] : ['view', 'comment', 'download', 'approve']
  const cleaned = Array.from(new Set(
    (Array.isArray(value) ? value : []).map(String).filter(item => allowed.includes(item)),
  ))
  return cleaned.length ? cleaned : type === 'COLLECT' ? ['upload'] : ['view', 'comment']
}
