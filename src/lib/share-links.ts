import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { allocateShareToken } from '@/lib/share-tokens'
import { beijingDayKey } from '@/lib/announcements/time'

export const SHARE_LINK_STATUSES = ['ACTIVE', 'REVOKED', 'EXPIRED'] as const

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
 * The rules a request is judged by. Every share address must be an explicit
 * `ShareLink` row; the old project-slug and master-link addresses no longer
 * resolve (2026-11-25 决策 1A).
 */
export type SharePolicy = ShareLinkRecord

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

function toPolicy(link: ShareLinkRecord, project: any | null): SharePolicy {
  // Archiving a project is the owner's kill switch for everything it exposes, so
  // an explicit link must not keep working after the project is archived.
  const status = project?.status === 'ARCHIVED' ? 'REVOKED' : link.status
  return { ...link, status }
}

/** Resolve only link/project metadata; no videos or folders are loaded. */
export async function resolveShareMetadata(token: string): Promise<ResolvedShareMetadata> {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    select: { ...SHARE_LINK_POLICY_FIELDS, project: { select: SHARE_PROJECT_METADATA_SELECT } },
  })
  // Legacy master rows may still exist in the database; they are no longer an
  // address. Refuse them here so every share endpoint rejects them centrally.
  if (!link || link.masterOfProjectId) return { link: null, project: null, policy: null }
  return { link, project: link.project, policy: toPolicy(link, link.project) }
}

/**
 * The code is good to hand off only while the address it names is still live:
 * the root page's validity rule, shared by the mini-program handoff page and
 * its two APIs so a revoked link cannot keep minting new entry points.
 */
export async function resolveActiveShareLink(token: string) {
  const resolved = await resolveShareMetadata(token)
  if (
    !resolved.link ||
    !resolved.project ||
    resolved.project.status === 'ARCHIVED' ||
    !isShareLinkActive(resolved.policy)
  ) {
    return null
  }
  return { ...resolved, link: resolved.link, project: resolved.project }
}

export type HandoffShare = {
  token: string
  projectTitle: string
  protectedShare: boolean
  ownerName: string
  ownerAvatarUrl: string
  shareDate: string
  /** Public master links only: up to three real cover frames for the handoff card. */
  coverVideoIds: string[]
}

/**
 * The mobile handoff page and the mini-program APIs need the link's validity
 * plus who shared it. The sharer is the project's creator — a team is a
 * workspace, not a person, so its name/avatar must not stand in for the sender.
 */
export async function resolveHandoffShare(token: string): Promise<HandoffShare | null> {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    select: {
      token: true,
      projectId: true,
      status: true,
      expiresAt: true,
      maxViews: true,
      viewCount: true,
      authMode: true,
      masterOfProjectId: true,
      scopeType: true,
      createdAt: true,
      project: {
        select: {
          title: true,
          status: true,
          authMode: true,
          createdBy: { select: { name: true, avatarUrl: true } },
        },
      },
    },
  })

  if (
    !link ||
    link.masterOfProjectId ||
    !link.project ||
    link.project.status === 'ARCHIVED' ||
    !isShareLinkActive(link)
  ) {
    return null
  }

  const authMode = link.authMode
  const protectedShare = authMode !== 'NONE'

  // Covers come from the whole project, so only a public whole-project link may
  // show them; scoped or password links keep the generic card.
  const covers =
    !protectedShare && link.scopeType === 'PROJECT'
      ? await prisma.video.findMany({
          where: { projectId: link.projectId, status: 'READY', thumbnailPath: { not: null } },
          orderBy: [{ updatedAt: 'desc' }, { version: 'desc' }],
          take: 3,
          select: { id: true },
        })
      : []

  return {
    token: link.token,
    projectTitle: link.project.title,
    protectedShare,
    ownerName: link.project.createdBy?.name?.trim() || '',
    ownerAvatarUrl: link.project.createdBy?.avatarUrl?.trim() || '',
    shareDate: beijingDayKey(link.createdAt),
    coverVideoIds: covers.map((video) => video.id),
  }
}

/**
 * The address a notification may carry: an explicit whole-project review link
 * the owner created and can see in 分享记录. There is no auto-created master
 * address any more, so a project without such a link has no public URL to send.
 */
export async function getProjectExplicitShareLink(projectId: string): Promise<ShareLinkRecord | null> {
  const rows = await prisma.shareLink.findMany({
    where: {
      projectId,
      masterOfProjectId: null,
      type: 'REVIEW',
      scopeType: 'PROJECT',
      status: 'ACTIVE',
    },
    orderBy: { createdAt: 'desc' },
    select: SHARE_LINK_POLICY_FIELDS,
  })
  return rows.find((row) => isShareLinkActive(row)) ?? null
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

function digest(value: string): string {
  return crypto.createHash('sha256').update(value).digest('base64url').slice(0, 22)
}

/**
 * A viewer bearer is only valid while the policy it was minted under is. The
 * hash covers everything that can change what the token may do, so editing a
 * link's permissions retires its existing bearers immediately; renaming it or
 * changing a display-only field does not.
 */
export function sharePolicyFingerprint(
  policy: SharePolicy | null,
  project: { allowReverseShare?: boolean | null } | null,
): string | null {
  if (!policy) return null
  return digest(JSON.stringify({
    type: policy.type,
    scopeType: policy.scopeType,
    scopeId: policy.scopeId,
    permissions: policy.permissions.toSorted(),
    authMode: policy.authMode,
    sharePassword: policy.sharePassword ?? null,
    expiresAt: policy.expiresAt ? new Date(policy.expiresAt).getTime() : null,
    status: policy.status,
    allowReverseShare: Boolean(project?.allowReverseShare),
  }))
}

/** Credential-bound part of the policy: a renewal must not outlive a password or auth-mode change. */
export function shareAuthFingerprint(policy: SharePolicy | null): string | null {
  if (!policy) return null
  return digest(`${policy.authMode}:${policy.sharePassword ?? ''}`)
}

/**
 * The single upload-capability rule. The visitor payload and the POST route
 * both read this, so the upload entry can never advertise an action the route
 * refuses. The project's flag remains the kill switch; an explicit link must
 * additionally be a COLLECT link that carries the upload permission.
 */
export function shareAllowsUploads(
  policy: SharePolicy | null,
  project: { allowReverseShare?: boolean | null; status?: string | null } | null,
): boolean {
  if (!policy || !project) return false
  if (project.status === 'ARCHIVED') return false
  if (!project.allowReverseShare) return false
  return policy.type === 'COLLECT' && policy.permissions.includes('upload')
}

/** Photos are project-level content: only a whole-project review/delivery link
 *  carries them. Folder/video/version links and collect links must not expose
 *  the project's photo albums alongside their scoped videos. */
export function shareAllowsProjectPhotos(policy: SharePolicy | null): boolean {
  if (!policy) return true
  return policy.type !== 'COLLECT' && policy.scopeType === 'PROJECT'
}

/** No share token means an admin session; otherwise judge the link's scope. */
export async function shareTokenAllowsProjectPhotos(token: string | null | undefined): Promise<boolean> {
  if (!token) return true
  return shareAllowsProjectPhotos((await resolveShareMetadata(token)).policy)
}

/**
 * The one writer of the stored `permissions` array. A link is judged by what is
 * in that column, so it must never end up empty: an empty array means a URL that
 * opens and can do nothing, which reads as a broken share rather than as a
 * deliberate setting. Both create and update fall back to the link type's
 * defaults so neither path can produce that state.
 */
export function sanitizeSharePermissions(value: unknown, type: string): string[] {
  const allowed = type === 'COLLECT' ? ['upload'] : ['view', 'comment', 'download', 'approve', 'attach']
  const cleaned = Array.from(new Set(
    (Array.isArray(value) ? value : []).map(String).filter(item => allowed.includes(item)),
  ))
  return cleaned.length ? cleaned : type === 'COLLECT' ? ['upload'] : ['view', 'comment']
}
