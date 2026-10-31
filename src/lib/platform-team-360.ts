import { prisma } from './db'
import { BETA_QUOTA, getTeamQuota, getTeamStorageBreakdown, getTeamStorageSummaries, getTeamUsage, isUnlimitedQuota } from './platform-access'
import { formatShareLinkUrl } from './share-links'
import { maskPhone } from './phone-field'

const GB = 1024 * 1024 * 1024
const DAY_MS = 24 * 60 * 60 * 1000
const CN_OFFSET_MS = 8 * 60 * 60 * 1000
const STALE_TEAM_DAYS = 30

export type PlatformTeamSort = 'storageUsage' | 'lastActive' | 'createdAt' | 'status'
export type SortOrder = 'asc' | 'desc'
export type RiskTone = 'danger' | 'warning' | 'muted'
export type LastActiveSource = 'member' | 'content' | 'client'

export interface Risk { key: string; label: string; tone: RiskTone }
export interface LastActiveValue { at: string | null; source: LastActiveSource | 'heartbeat' | null }
export interface StorageSummaryView {
  liveBytes: number
  recycleBinBytes: number
  totalBytes: number
  bySource: { video: number; asset: number; upload: number; photo: number }
}
export interface StorageProjectView { projectId: string; title: string; liveBytes: number; recycleBinBytes: number; totalBytes: number }
export interface LinkView {
  id: string
  projectId: string
  projectTitle: string
  name: string
  type: string
  scopeType: string
  scopeId: string | null
  permissions: string[]
  authMode: string
  expiresAt: string | null
  maxViews: number | null
  viewCount: number
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED'
  isMaster: boolean
  maskedToken: string
  createdAt: string
}
export interface LinkSummary {
  total: number
  master: number
  independent: number
  active: number
  expired: number
  revoked: number
  noExpiryIndependent: number
  byType: Record<string, number>
  byScope: Record<string, number>
}
export interface TeamQuotaView {
  maxMembers: number
  maxProjects: number
  maxVideos: number
  maxStorageGB: number
  recorded: boolean
  source: string
}
export interface TeamUsageView { members: number; projects: number; videos: number }
export interface TeamSummary {
  id: string
  name: string
  slug: string
  shareKey: string
  status: string
  createdAt: string
  subscriptionPlan: string
  subscriptionStartedAt: string
  subscriptionExpiresAt: string | null
  createdBy: { id: string; name: string | null; email: string }
}
export interface TeamListRow {
  id: string
  name: string
  slug: string
  shareKey: string
  status: string
  createdAt: string
  subscriptionPlan: string
  subscriptionStartedAt: string
  subscriptionExpiresAt: string | null
  createdBy: { id: string; name: string | null; email: string }
  owners: Array<{ user: { id: string; name: string | null; email: string } }>
  /** Kept for the existing platform dashboard; both values are ACTIVE-only. */
  _count: { members: number; projects: number }
  usage: TeamUsageView
  quota: TeamQuotaView
  storage: StorageSummaryView
  links: LinkSummary
  pendingInvites: number
  membersNeverActive: number
  lastActive: LastActiveValue
  risk: Risk[]
  storagePercent: number | null
  memberPercent: number | null
}
export interface TeamOverview {
  team: TeamListRow
  quota: TeamQuotaView
  usage: TeamUsageView
  storage: StorageSummaryView & { byProject: StorageProjectView[] }
  links: LinkSummary
  pendingInvites: number
  membersNeverActive: number
  lastActive: { team: LastActiveValue; member: LastActiveValue; client: LastActiveValue }
  risk: Risk[]
  dataQuality: DataQuality
}
export interface TeamProjectRow {
  id: string
  projectCode: string
  title: string
  status: string
  createdAt: string
  updatedAt: string
  videos: number
  storage: { liveBytes: number; recycleBinBytes: number; totalBytes: number }
  lastActive: LastActiveValue
  links: LinkView[]
}
export interface TeamProjectsPage {
  page: number
  pageSize: number
  total: number
  projects: TeamProjectRow[]
  dataQuality: DataQuality
}
export interface TeamMemberRow {
  id: string
  userId: string
  name: string | null
  email: string
  phoneMasked: string | null
  role: string
  status: string
  joinedAt: string
  lastActive: LastActiveValue
}
export interface PendingInviteRow {
  id: string
  email: string | null
  phoneMasked: string | null
  role: string
  status: 'PENDING' | 'EXPIRED' | 'REVOKED' | 'ACCEPTED'
  expiresAt: string
  createdAt: string
}
export interface TeamMembersPage {
  members: TeamMemberRow[]
  pendingInvites: PendingInviteRow[]
  disabledCount: number
  membersNeverActive: number
  quota: TeamQuotaView
  dataQuality: DataQuality
}
export interface ActivityBucket {
  day: string
  newVideos: number
  uploadBytes: number
  comments: number
  visits: number
  shareSessions: number
  activeMembers: number | null
}
export interface TeamActivityPage {
  days: number
  buckets: ActivityBucket[]
  collected: { activeMembers: boolean; heartbeatSince: string | null }
  notes: string[]
}
export interface DataQuality {
  projectsIncludeArchived: boolean
  videosExcludeRecycleBin: boolean
  storageIncludesRecycleBin: boolean
  storageNote: string
  activityNote: string
}

const DATA_QUALITY: DataQuality = {
  projectsIncludeArchived: true,
  videosExcludeRecycleBin: true,
  storageIncludesRecycleBin: true,
  storageNote: '按路径去重，回收站仍占桶且计入配额；转码切片、HLS 分片、封面和缩略图不计入，对象存储实际占用更高。',
  activityNote: '内容/客户活跃来自现有事件，标“自上线起”；成员后台心跳自采集上线起，历史不伪造。',
}

type UsageRow = { teamId: string; members: number; projects: number; videos: number }
type TeamActivityRow = { teamId: string; memberAt: Date | null; contentAt: Date | null; clientAt: Date | null }
type MemberActivityRow = { teamId: string; userId: string; heartbeatAt: Date | null; contentAt: Date | null }
type ProjectActivityRow = { projectId: string; contentAt: Date | null; clientAt: Date | null }
type LinkRow = {
  id: string
  projectId: string
  token: string
  name: string
  type: string
  scopeType: string
  scopeId: string | null
  permissions: string[]
  authMode: string
  expiresAt: Date | null
  maxViews: number | null
  viewCount: number
  status: string
  masterOfProjectId: string | null
  createdAt: Date
  project: { teamId: string; status: string; title: string }
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function utcWallClock(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

function cnDayStart(now: Date): number {
  const shifted = new Date(now.getTime() + CN_OFFSET_MS)
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - CN_OFFSET_MS
}

function cnDayLabel(ms: number): string {
  return new Date(ms + CN_OFFSET_MS).toISOString().slice(0, 10)
}

function latest(...values: Array<Date | null | undefined>): Date | null {
  let result: Date | null = null
  for (const value of values) {
    if (value && (!result || value.getTime() > result.getTime())) result = value
  }
  return result
}

function maskToken(token: string): string {
  if (token.length <= 8) return '••••••'
  return `${token.slice(0, 3)}…${token.slice(-4)}`
}

function effectiveLinkStatus(link: Pick<LinkRow, 'status' | 'expiresAt' | 'maxViews' | 'viewCount'>, projectStatus: string, now = new Date()): LinkView['status'] {
  if (projectStatus === 'ARCHIVED') return 'REVOKED'
  if (link.status !== 'ACTIVE') return 'REVOKED'
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return 'EXPIRED'
  if (link.maxViews !== null && link.viewCount >= link.maxViews) return 'EXPIRED'
  return 'ACTIVE'
}

function quotaView(row: { maxMembers: number; maxProjects: number; maxVideos: number; maxStorageGB: number; source?: string } | null | undefined): TeamQuotaView {
  if (!row) return { ...BETA_QUOTA, recorded: false, source: 'PLAN' }
  return {
    maxMembers: row.maxMembers,
    maxProjects: row.maxProjects,
    maxVideos: row.maxVideos,
    maxStorageGB: row.maxStorageGB,
    recorded: true,
    source: row.source || 'PLAN',
  }
}

function storageSummaryView(breakdown: { liveBytes: bigint; recycleBinBytes: bigint; totalBytes: bigint; bySource: Record<'video' | 'asset' | 'upload' | 'photo', bigint> }): StorageSummaryView {
  return {
    liveBytes: Number(breakdown.liveBytes),
    recycleBinBytes: Number(breakdown.recycleBinBytes),
    totalBytes: Number(breakdown.totalBytes),
    bySource: {
      video: Number(breakdown.bySource.video),
      asset: Number(breakdown.bySource.asset),
      upload: Number(breakdown.bySource.upload),
      photo: Number(breakdown.bySource.photo),
    },
  }
}

function storagePercent(totalBytes: number, maxStorageGB: number): number | null {
  if (isUnlimitedQuota(maxStorageGB)) return null
  return (totalBytes / (maxStorageGB * GB)) * 100
}

function memberPercent(members: number, maxMembers: number): number | null {
  if (isUnlimitedQuota(maxMembers)) return null
  return (members / maxMembers) * 100
}

function linkSummary(rows: LinkView[]): LinkSummary {
  const summary: LinkSummary = {
    total: rows.length,
    master: 0,
    independent: 0,
    active: 0,
    expired: 0,
    revoked: 0,
    noExpiryIndependent: 0,
    byType: {},
    byScope: {},
  }
  for (const row of rows) {
    if (row.isMaster) summary.master += 1
    else summary.independent += 1
    if (row.status === 'ACTIVE') summary.active += 1
    if (row.status === 'EXPIRED') summary.expired += 1
    if (row.status === 'REVOKED') summary.revoked += 1
    if (!row.isMaster && row.status === 'ACTIVE' && !row.expiresAt) summary.noExpiryIndependent += 1
    summary.byType[row.type] = (summary.byType[row.type] || 0) + 1
    summary.byScope[row.scopeType] = (summary.byScope[row.scopeType] || 0) + 1
  }
  return summary
}

function buildRisks(params: {
  storage: StorageSummaryView
  quota: TeamQuotaView
  usage: TeamUsageView
  links: LinkSummary
  lastActive: LastActiveValue
  membersNeverActive: number
}): Risk[] {
  const risks: Risk[] = []
  const storagePct = storagePercent(params.storage.totalBytes, params.quota.maxStorageGB)
  if (storagePct !== null && storagePct >= 100) risks.push({ key: 'storage-over', label: '存储已超配额', tone: 'danger' })
  else if (storagePct !== null && storagePct >= 90) risks.push({ key: 'storage-near', label: '存储接近配额', tone: 'warning' })

  const memberPct = memberPercent(params.usage.members, params.quota.maxMembers)
  if (memberPct !== null && memberPct >= 100) risks.push({ key: 'members-over', label: '成员已超配额', tone: 'danger' })
  else if (memberPct !== null && memberPct >= 90) risks.push({ key: 'members-near', label: '成员接近配额', tone: 'warning' })

  if (!params.lastActive.at) risks.push({ key: 'never-active', label: '团队从未活跃', tone: 'warning' })
  else if (Date.now() - new Date(params.lastActive.at).getTime() > STALE_TEAM_DAYS * DAY_MS) {
    risks.push({ key: 'stale', label: `超过 ${STALE_TEAM_DAYS} 天不活跃`, tone: 'warning' })
  }
  if (params.links.expired > 0) risks.push({ key: 'expired-links', label: `${params.links.expired} 条链接已过期`, tone: 'warning' })
  if (params.links.noExpiryIndependent > 0) risks.push({ key: 'no-expiry-links', label: `${params.links.noExpiryIndependent} 条独立链接无到期`, tone: 'warning' })
  if (params.membersNeverActive > 0) risks.push({ key: 'never-active-members', label: `${params.membersNeverActive} 名成员从未活跃`, tone: 'warning' })
  return risks
}

async function usageMany(teamIds: string[]): Promise<Map<string, TeamUsageView>> {
  const map = new Map<string, TeamUsageView>()
  if (teamIds.length === 0) return map
  const rows = await prisma.$queryRaw<UsageRow[]>`
    SELECT t.id AS "teamId",
      (SELECT count(*) FROM "TeamMember" m WHERE m."teamId" = t.id AND m."status" = 'ACTIVE')::int AS members,
      (SELECT count(*) FROM "Project" p WHERE p."teamId" = t.id)::int AS projects,
      (SELECT count(*) FROM "Video" v JOIN "Project" p ON p.id = v."projectId" WHERE p."teamId" = t.id AND v."deletedAt" IS NULL)::int AS videos
    FROM "Team" t
    WHERE t.id = ANY(${teamIds}::text[])
  `
  for (const row of rows) map.set(row.teamId, { members: row.members, projects: row.projects, videos: row.videos })
  return map
}

async function quotaMany(teamIds: string[]): Promise<Map<string, TeamQuotaView>> {
  const map = new Map<string, TeamQuotaView>()
  if (teamIds.length === 0) return map
  const rows = await prisma.teamQuota.findMany({
    where: { teamId: { in: teamIds } },
    select: { teamId: true, maxMembers: true, maxProjects: true, maxVideos: true, maxStorageGB: true, source: true },
  })
  for (const row of rows) map.set(row.teamId, quotaView(row))
  return map
}

async function linksForTeams(teamIds: string[]): Promise<LinkRow[]> {
  if (teamIds.length === 0) return []
  return prisma.shareLink.findMany({
    where: { project: { teamId: { in: teamIds } } },
    select: {
      id: true,
      projectId: true,
      token: true,
      name: true,
      type: true,
      scopeType: true,
      scopeId: true,
      permissions: true,
      authMode: true,
      expiresAt: true,
      maxViews: true,
      viewCount: true,
      status: true,
      masterOfProjectId: true,
      createdAt: true,
      project: { select: { teamId: true, status: true, title: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
  })
}

function linkViews(rows: LinkRow[], now = new Date()): LinkView[] {
  return rows.map(row => ({
    id: row.id,
    projectId: row.projectId,
    projectTitle: row.project.title,
    name: row.name,
    type: row.type,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    permissions: row.permissions,
    authMode: row.authMode,
    expiresAt: iso(row.expiresAt),
    maxViews: row.maxViews,
    viewCount: row.viewCount,
    status: effectiveLinkStatus(row, row.project.status, now),
    isMaster: Boolean(row.masterOfProjectId),
    maskedToken: maskToken(row.token),
    createdAt: iso(row.createdAt) as string,
  }))
}

async function teamActivityRows(teamIds: string[]): Promise<Map<string, TeamActivityRow>> {
  const map = new Map<string, TeamActivityRow>()
  if (teamIds.length === 0) return map
  const rows = await prisma.$queryRaw<TeamActivityRow[]>`
    WITH events AS (
      SELECT tm."teamId", 'member'::text AS source, tm."lastActiveAt" AS ts
      FROM "TeamMember" tm
      WHERE tm."status" = 'ACTIVE' AND tm."lastActiveAt" IS NOT NULL AND tm."teamId" = ANY(${teamIds}::text[])
      UNION ALL
      SELECT p."teamId", 'content', v."createdAt"
      FROM "Video" v JOIN "Project" p ON p.id = v."projectId"
      WHERE p."teamId" = ANY(${teamIds}::text[])
      UNION ALL
      SELECT p."teamId", 'content', a."createdAt"
      FROM "VideoAsset" a JOIN "Video" v ON v.id = a."videoId" JOIN "Project" p ON p.id = v."projectId"
      WHERE a."uploadCompletedAt" IS NOT NULL AND p."teamId" = ANY(${teamIds}::text[])
      UNION ALL
      SELECT p."teamId", 'content', u."createdAt"
      FROM "ProjectUpload" u JOIN "Project" p ON p.id = u."projectId"
      WHERE u."uploadCompletedAt" IS NOT NULL AND p."teamId" = ANY(${teamIds}::text[])
      UNION ALL
      SELECT p."teamId", 'content', ph."createdAt"
      FROM "Photo" ph JOIN "PhotoAlbum" al ON al.id = ph."albumId" JOIN "Project" p ON p.id = al."projectId"
      WHERE ph."uploadCompletedAt" IS NOT NULL AND p."teamId" = ANY(${teamIds}::text[])
      UNION ALL
      SELECT p."teamId", 'content', c."createdAt"
      FROM "Comment" c JOIN "Project" p ON p.id = c."projectId"
      WHERE p."teamId" = ANY(${teamIds}::text[])
      UNION ALL
      SELECT pr."teamId", 'content', pr."createdAt"
      FROM "Project" pr
      WHERE pr."teamId" = ANY(${teamIds}::text[])
      UNION ALL
      SELECT p."teamId", 'client', sa."createdAt"
      FROM "SharePageAccess" sa JOIN "Project" p ON p.id = sa."projectId"
      WHERE p."teamId" = ANY(${teamIds}::text[])
      UNION ALL
      SELECT p."teamId", 'client', va."createdAt"
      FROM "VideoAnalytics" va JOIN "Project" p ON p.id = va."projectId"
      WHERE va."eventType" = 'PAGE_VISIT' AND p."teamId" = ANY(${teamIds}::text[])
    )
    SELECT "teamId",
      max("ts") FILTER (WHERE source = 'member') AS "memberAt",
      max("ts") FILTER (WHERE source = 'content') AS "contentAt",
      max("ts") FILTER (WHERE source = 'client') AS "clientAt"
    FROM events GROUP BY "teamId"
  `
  for (const row of rows) map.set(row.teamId, row)
  return map
}

function teamLastActive(row: TeamActivityRow | undefined): { team: LastActiveValue; member: LastActiveValue; client: LastActiveValue } {
  const memberAt = row?.memberAt ?? null
  const contentAt = row?.contentAt ?? null
  const clientAt = row?.clientAt ?? null
  const memberDate = latest(memberAt, contentAt)
  const memberSource: LastActiveValue['source'] = memberDate
    ? (memberAt && (!contentAt || memberAt.getTime() >= contentAt.getTime()) ? 'heartbeat' : 'content')
    : null
  const teamDate = latest(memberAt, contentAt, clientAt)
  let teamSource: LastActiveValue['source'] = null
  if (teamDate) {
    if (memberAt && memberAt.getTime() === teamDate.getTime()) teamSource = 'member'
    else if (contentAt && contentAt.getTime() === teamDate.getTime()) teamSource = 'content'
    else teamSource = 'client'
  }
  return {
    team: { at: iso(teamDate), source: teamSource },
    member: { at: iso(memberDate), source: memberSource },
    client: { at: iso(clientAt), source: clientAt ? 'client' : null },
  }
}

async function memberActivityRows(teamIds: string[]): Promise<MemberActivityRow[]> {
  if (teamIds.length === 0) return []
  return prisma.$queryRaw<MemberActivityRow[]>`
    WITH events AS (
      SELECT p."teamId", v."uploadedBy" AS "userId", v."createdAt" AS ts
      FROM "Video" v JOIN "Project" p ON p.id = v."projectId"
      WHERE p."teamId" = ANY(${teamIds}::text[]) AND v."uploadedBy" IS NOT NULL
      UNION ALL
      SELECT p."teamId", c."userId", c."createdAt"
      FROM "Comment" c JOIN "Project" p ON p.id = c."projectId"
      WHERE p."teamId" = ANY(${teamIds}::text[]) AND c."userId" IS NOT NULL
      UNION ALL
      SELECT pr."teamId", pr."createdById", pr."createdAt"
      FROM "Project" pr
      WHERE pr."teamId" = ANY(${teamIds}::text[])
      UNION ALL
      SELECT p."teamId", a."uploadedBy", a."createdAt"
      FROM "VideoAsset" a JOIN "Video" v ON v.id = a."videoId" JOIN "Project" p ON p.id = v."projectId"
      WHERE p."teamId" = ANY(${teamIds}::text[]) AND a."uploadedBy" IS NOT NULL AND a."uploadedBy" <> 'client'
      UNION ALL
      SELECT p."teamId", ph."uploadedBy", ph."createdAt"
      FROM "Photo" ph JOIN "PhotoAlbum" al ON al.id = ph."albumId" JOIN "Project" p ON p.id = al."projectId"
      WHERE p."teamId" = ANY(${teamIds}::text[]) AND ph."uploadedBy" IS NOT NULL
    ), content AS (
      SELECT "teamId", "userId", max(ts) AS "contentAt"
      FROM events WHERE "userId" IS NOT NULL GROUP BY "teamId", "userId"
    )
    SELECT m."teamId", m."userId", m."lastActiveAt" AS "heartbeatAt", c."contentAt"
    FROM "TeamMember" m
    LEFT JOIN content c ON c."teamId" = m."teamId" AND c."userId" = m."userId"
    WHERE m."status" = 'ACTIVE' AND m."teamId" = ANY(${teamIds}::text[])
  `
}

async function pendingInviteCounts(teamIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (teamIds.length === 0) return map
  const rows = await prisma.teamInvite.groupBy({
    by: ['teamId'],
    where: { teamId: { in: teamIds }, status: 'PENDING', expiresAt: { gt: new Date() } },
    _count: { _all: true },
  })
  for (const row of rows) map.set(row.teamId, row._count._all)
  return map
}

async function projectActivityRows(projectIds: string[]): Promise<Map<string, ProjectActivityRow>> {
  const map = new Map<string, ProjectActivityRow>()
  if (projectIds.length === 0) return map
  const rows = await prisma.$queryRaw<ProjectActivityRow[]>`
    WITH events AS (
      SELECT v."projectId", 'content'::text AS source, v."createdAt" AS ts
      FROM "Video" v WHERE v."projectId" = ANY(${projectIds}::text[])
      UNION ALL
      SELECT v."projectId", 'content', a."createdAt"
      FROM "VideoAsset" a JOIN "Video" v ON v.id = a."videoId"
      WHERE a."uploadCompletedAt" IS NOT NULL AND v."projectId" = ANY(${projectIds}::text[])
      UNION ALL
      SELECT u."projectId", 'content', u."createdAt"
      FROM "ProjectUpload" u
      WHERE u."uploadCompletedAt" IS NOT NULL AND u."projectId" = ANY(${projectIds}::text[])
      UNION ALL
      SELECT al."projectId", 'content', ph."createdAt"
      FROM "Photo" ph JOIN "PhotoAlbum" al ON al.id = ph."albumId"
      WHERE ph."uploadCompletedAt" IS NOT NULL AND al."projectId" = ANY(${projectIds}::text[])
      UNION ALL
      SELECT c."projectId", 'content', c."createdAt"
      FROM "Comment" c WHERE c."projectId" = ANY(${projectIds}::text[])
      UNION ALL
      SELECT pr.id, 'content', pr."createdAt"
      FROM "Project" pr WHERE pr.id = ANY(${projectIds}::text[])
      UNION ALL
      SELECT sa."projectId", 'client', sa."createdAt"
      FROM "SharePageAccess" sa WHERE sa."projectId" = ANY(${projectIds}::text[])
      UNION ALL
      SELECT va."projectId", 'client', va."createdAt"
      FROM "VideoAnalytics" va
      WHERE va."eventType" = 'PAGE_VISIT' AND va."projectId" = ANY(${projectIds}::text[])
    )
    SELECT "projectId",
      max("ts") FILTER (WHERE source = 'content') AS "contentAt",
      max("ts") FILTER (WHERE source = 'client') AS "clientAt"
    FROM events GROUP BY "projectId"
  `
  for (const row of rows) map.set(row.projectId, row)
  return map
}

function projectLastActive(row: ProjectActivityRow | undefined): LastActiveValue {
  if (!row) return { at: null, source: null }
  const date = latest(row.contentAt, row.clientAt)
  const source: LastActiveValue['source'] = !date ? null
    : row.contentAt && row.contentAt.getTime() === date.getTime() ? 'content' : 'client'
  return { at: iso(date), source }
}

function memberLastActive(row: MemberActivityRow | undefined): LastActiveValue {
  if (!row) return { at: null, source: null }
  const date = latest(row.heartbeatAt, row.contentAt)
  const source: LastActiveValue['source'] = !date ? null
    : row.heartbeatAt && row.heartbeatAt.getTime() === date.getTime() ? 'heartbeat' : 'content'
  return { at: iso(date), source }
}

function sortRows(rows: TeamListRow[], sort: PlatformTeamSort, order: SortOrder): TeamListRow[] {
  const value = (row: TeamListRow): number | string | null => {
    if (sort === 'storageUsage') return row.storagePercent
    if (sort === 'lastActive') return row.lastActive.at ? new Date(row.lastActive.at).getTime() : null
    if (sort === 'status') return row.status === 'ACTIVE' ? 0 : 1
    return new Date(row.createdAt).getTime()
  }
  const compare = (a: TeamListRow, b: TeamListRow) => {
    const av = value(a)
    const bv = value(b)
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    const base = av < bv ? -1 : av > bv ? 1 : 0
    return order === 'asc' ? base : -base
  }
  return [...rows].sort(compare)
}

/** One team's identity only; the detail header must not read the whole list. */
export async function getTeamSummary(teamId: string): Promise<TeamSummary | null> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      slug: true,
      shareKey: true,
      status: true,
      createdAt: true,
      subscriptionPlan: true,
      subscriptionStartedAt: true,
      subscriptionExpiresAt: true,
      createdBy: { select: { id: true, name: true, email: true } },
    },
  })
  if (!team) return null
  return {
    id: team.id,
    name: team.name,
    slug: team.slug,
    shareKey: team.shareKey,
    status: team.status,
    createdAt: iso(team.createdAt) as string,
    subscriptionPlan: team.subscriptionPlan,
    subscriptionStartedAt: iso(team.subscriptionStartedAt) as string,
    subscriptionExpiresAt: iso(team.subscriptionExpiresAt),
    createdBy: team.createdBy,
  }
}

export async function getPlatformTeamsList(options: { sort?: PlatformTeamSort; order?: SortOrder } = {}): Promise<TeamListRow[]> {
  const teams = await prisma.team.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      shareKey: true,
      status: true,
      createdAt: true,
      subscriptionPlan: true,
      subscriptionStartedAt: true,
      subscriptionExpiresAt: true,
      createdBy: { select: { id: true, name: true, email: true } },
      members: {
        where: { role: 'OWNER', status: 'ACTIVE' },
        take: 1,
        select: { user: { select: { id: true, name: true, email: true } } },
      },
      _count: { select: { members: { where: { status: 'ACTIVE' } }, projects: true } },
    },
  })
  const ids = teams.map(team => team.id)
  const [usageMap, quotaMap, storageMap, linkRows, activityMap, memberRows, inviteMap] = await Promise.all([
    usageMany(ids),
    quotaMany(ids),
    getTeamStorageSummaries(ids),
    linksForTeams(ids),
    teamActivityRows(ids),
    memberActivityRows(ids),
    pendingInviteCounts(ids),
  ])

  const linksByTeam = new Map<string, LinkView[]>()
  const teamByProject = new Map(linkRows.map(row => [row.projectId, row.project.teamId]))
  for (const view of linkViews(linkRows)) {
    const teamId = teamByProject.get(view.projectId)
    if (!teamId) continue
    const list = linksByTeam.get(teamId) || []
    list.push(view)
    linksByTeam.set(teamId, list)
  }
  const neverActiveByTeam = new Map<string, number>()
  for (const row of memberRows) {
    if (!row.heartbeatAt && !row.contentAt) {
      neverActiveByTeam.set(row.teamId, (neverActiveByTeam.get(row.teamId) || 0) + 1)
    }
  }

  const rows = teams.map(team => {
    const usage = usageMap.get(team.id) || { members: 0, projects: 0, videos: 0 }
    const quota = quotaMap.get(team.id) || quotaView(null)
    const storage = storageSummaryView(storageMap.get(team.id) || {
      liveBytes: BigInt(0), recycleBinBytes: BigInt(0), totalBytes: BigInt(0),
      bySource: { video: BigInt(0), asset: BigInt(0), upload: BigInt(0), photo: BigInt(0) },
    } as any)
    const links = linkSummary(linksByTeam.get(team.id) || [])
    const lastActive = teamLastActive(activityMap.get(team.id)).team
    const membersNeverActive = neverActiveByTeam.get(team.id) || 0
    const row: TeamListRow = {
      id: team.id,
      name: team.name,
      slug: team.slug,
      shareKey: team.shareKey,
      status: team.status,
      createdAt: iso(team.createdAt) as string,
      subscriptionPlan: team.subscriptionPlan,
      subscriptionStartedAt: iso(team.subscriptionStartedAt) as string,
      subscriptionExpiresAt: iso(team.subscriptionExpiresAt),
      createdBy: team.createdBy,
      owners: team.members,
      _count: { members: usage.members, projects: usage.projects },
      usage,
      quota,
      storage,
      links,
      pendingInvites: inviteMap.get(team.id) || 0,
      membersNeverActive,
      lastActive,
      risk: [],
      storagePercent: storagePercent(storage.totalBytes, quota.maxStorageGB),
      memberPercent: memberPercent(usage.members, quota.maxMembers),
    }
    row.risk = buildRisks({ storage, quota, usage, links, lastActive, membersNeverActive })
    return row
  })

  return sortRows(rows, options.sort || 'createdAt', options.order || 'asc')
}

export async function getTeamOverview(teamId: string): Promise<TeamOverview | null> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true, name: true, slug: true, shareKey: true, status: true, createdAt: true,
      subscriptionPlan: true, subscriptionStartedAt: true, subscriptionExpiresAt: true,
      createdBy: { select: { id: true, name: true, email: true } },
    },
  })
  if (!team) return null

  const [quota, usage, storage, linkRows, activityMap, memberRows, inviteCount] = await Promise.all([
    getTeamQuota(teamId),
    getTeamUsage(teamId),
    getTeamStorageBreakdown(teamId),
    linksForTeams([teamId]),
    teamActivityRows([teamId]),
    memberActivityRows([teamId]),
    pendingInviteCounts([teamId]),
  ])
  const quotaValue = quotaView(quota)
  const storageValue = storageSummaryView(storage)
  const links = linkSummary(linkViews(linkRows))
  const lastActive = teamLastActive(activityMap.get(teamId))
  const membersNeverActive = memberRows.filter(row => !row.heartbeatAt && !row.contentAt).length

  const topProjectIds = Array.from(storage.byProject.entries())
    .sort((a, b) => Number(b[1].liveBytes + b[1].recycleBinBytes) - Number(a[1].liveBytes + a[1].recycleBinBytes))
    .slice(0, 5)
    .map(([projectId]) => projectId)
  const titles = topProjectIds.length
    ? await prisma.project.findMany({ where: { id: { in: topProjectIds }, teamId }, select: { id: true, title: true } })
    : []
  const titleMap = new Map(titles.map(project => [project.id, project.title]))
  const byProject = topProjectIds.map(projectId => {
    const value = storage.byProject.get(projectId)!
    const liveBytes = Number(value.liveBytes)
    const recycleBinBytes = Number(value.recycleBinBytes)
    return { projectId, title: titleMap.get(projectId) || projectId, liveBytes, recycleBinBytes, totalBytes: liveBytes + recycleBinBytes }
  })

  const row: TeamListRow = {
    id: team.id,
    name: team.name,
    slug: team.slug,
    shareKey: team.shareKey,
    status: team.status,
    createdAt: iso(team.createdAt) as string,
    subscriptionPlan: team.subscriptionPlan,
    subscriptionStartedAt: iso(team.subscriptionStartedAt) as string,
    subscriptionExpiresAt: iso(team.subscriptionExpiresAt),
    createdBy: team.createdBy,
    owners: [],
    _count: { members: usage.members, projects: usage.projects },
    usage,
    quota: quotaValue,
    storage: storageValue,
    links,
    pendingInvites: inviteCount.get(teamId) || 0,
    membersNeverActive,
    lastActive: lastActive.team,
    risk: [],
    storagePercent: storagePercent(storageValue.totalBytes, quotaValue.maxStorageGB),
    memberPercent: memberPercent(usage.members, quotaValue.maxMembers),
  }
  row.risk = buildRisks({ storage: storageValue, quota: quotaValue, usage, links, lastActive: lastActive.team, membersNeverActive })

  return {
    team: row,
    quota: quotaValue,
    usage,
    storage: { ...storageValue, byProject },
    links,
    pendingInvites: row.pendingInvites,
    membersNeverActive,
    lastActive: {
      team: lastActive.team,
      member: lastActive.member,
      client: lastActive.client,
    },
    risk: row.risk,
    dataQuality: DATA_QUALITY,
  }
}

export async function getTeamProjects(teamId: string, params: { page?: number; pageSize?: number; search?: string; status?: string }): Promise<TeamProjectsPage | null> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } })
  if (!team) return null

  const page = Math.max(1, Math.floor(params.page || 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize || 20)))
  const search = params.search?.trim() || ''
  const status = params.status?.trim() || ''
  const where = {
    teamId,
    ...(status ? { status: status as any } : {}),
    ...(search ? {
      OR: [
        { title: { contains: search, mode: 'insensitive' as const } },
        { projectCode: { contains: search, mode: 'insensitive' as const } },
      ],
    } : {}),
  }

  const [projects, total, storage] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        projectCode: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { videos: { where: { deletedAt: null } } } },
      },
    }),
    prisma.project.count({ where }),
    getTeamStorageBreakdown(teamId),
  ])
  const ids = projects.map(project => project.id)
  const [activityMap, linkRows] = await Promise.all([
    projectActivityRows(ids),
    ids.length ? prisma.shareLink.findMany({
      where: { projectId: { in: ids } },
      select: {
        id: true, projectId: true, token: true, name: true, type: true, scopeType: true, scopeId: true,
        permissions: true, authMode: true, expiresAt: true, maxViews: true, viewCount: true, status: true,
        masterOfProjectId: true, createdAt: true,
        project: { select: { teamId: true, status: true, title: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    }) : [],
  ])
  const linksByProject = new Map<string, LinkView[]>()
  for (const view of linkViews(linkRows as LinkRow[])) {
    const list = linksByProject.get(view.projectId) || []
    list.push(view)
    linksByProject.set(view.projectId, list)
  }

  return {
    page,
    pageSize,
    total,
    projects: projects.map(project => {
      const storageValue = storage.byProject.get(project.id)
      const liveBytes = Number(storageValue?.liveBytes || 0)
      const recycleBinBytes = Number(storageValue?.recycleBinBytes || 0)
      return {
        id: project.id,
        projectCode: project.projectCode,
        title: project.title,
        status: project.status,
        createdAt: iso(project.createdAt) as string,
        updatedAt: iso(project.updatedAt) as string,
        videos: project._count.videos,
        storage: { liveBytes, recycleBinBytes, totalBytes: liveBytes + recycleBinBytes },
        lastActive: projectLastActive(activityMap.get(project.id)),
        links: linksByProject.get(project.id) || [],
      }
    }),
    dataQuality: DATA_QUALITY,
  }
}

export async function getTeamMembers(teamId: string): Promise<TeamMembersPage | null> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } })
  if (!team) return null

  const [members, invites, disabledCount, quota, activityRows] = await Promise.all([
    prisma.teamMember.findMany({
      where: { teamId, status: 'ACTIVE' },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, role: true, status: true, createdAt: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    }),
    prisma.teamInvite.findMany({
      where: { teamId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, phone: true, role: true, status: true, expiresAt: true, createdAt: true },
    }),
    prisma.teamMember.count({ where: { teamId, status: 'DISABLED' } }),
    getTeamQuota(teamId),
    memberActivityRows([teamId]),
  ])
  const activityMap = new Map(activityRows.map(row => [row.userId, row]))
  const now = new Date()
  const pendingInvites: PendingInviteRow[] = invites.map(invite => ({
    id: invite.id,
    email: invite.email,
    phoneMasked: maskPhone(invite.phone),
    role: invite.role,
    status: invite.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : 'PENDING',
    expiresAt: iso(invite.expiresAt) as string,
    createdAt: iso(invite.createdAt) as string,
  }))
  const memberRows: TeamMemberRow[] = members.map(member => ({
    id: member.id,
    userId: member.user.id,
    name: member.user.name,
    email: member.user.email,
    phoneMasked: maskPhone(member.user.phone),
    role: member.role,
    status: member.status,
    joinedAt: iso(member.createdAt) as string,
    lastActive: memberLastActive(activityMap.get(member.user.id)),
  }))

  return {
    members: memberRows,
    pendingInvites,
    disabledCount,
    membersNeverActive: memberRows.filter(member => !member.lastActive.at).length,
    quota: quotaView(quota),
    dataQuality: DATA_QUALITY,
  }
}

export async function getTeamActivity(teamId: string, days: number): Promise<TeamActivityPage | null> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } })
  if (!team) return null

  const windowDays = days === 30 ? 30 : 7
  const startMs = cnDayStart(new Date()) - (windowDays - 1) * DAY_MS
  const since = utcWallClock(startMs)

  const [videoRows, commentRows, visitRows, sessionRows, heartbeatRows, heartbeatSinceRows] = await Promise.all([
    prisma.$queryRaw<{ day: string; n: number; bytes: bigint }[]>`
      SELECT to_char((v."createdAt" + interval '8 hours')::date, 'YYYY-MM-DD') AS day,
             count(*)::int AS n, coalesce(sum(v."originalFileSize"), 0)::bigint AS bytes
      FROM "Video" v JOIN "Project" p ON p.id = v."projectId"
      WHERE p."teamId" = ${teamId} AND v."createdAt" >= ${since}::timestamp
      GROUP BY 1
    `,
    prisma.$queryRaw<{ day: string; n: number }[]>`
      SELECT to_char((c."createdAt" + interval '8 hours')::date, 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM "Comment" c JOIN "Project" p ON p.id = c."projectId"
      WHERE p."teamId" = ${teamId} AND c."createdAt" >= ${since}::timestamp
      GROUP BY 1
    `,
    prisma.$queryRaw<{ day: string; n: number }[]>`
      SELECT to_char((va."createdAt" + interval '8 hours')::date, 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM "VideoAnalytics" va JOIN "Project" p ON p.id = va."projectId"
      WHERE p."teamId" = ${teamId} AND va."eventType" = 'PAGE_VISIT' AND va."createdAt" >= ${since}::timestamp
      GROUP BY 1
    `,
    prisma.$queryRaw<{ day: string; n: number }[]>`
      SELECT to_char((sa."createdAt" + interval '8 hours')::date, 'YYYY-MM-DD') AS day, count(DISTINCT sa."sessionId")::int AS n
      FROM "SharePageAccess" sa JOIN "Project" p ON p.id = sa."projectId"
      WHERE p."teamId" = ${teamId} AND sa."createdAt" >= ${since}::timestamp
      GROUP BY 1
    `,
    prisma.$queryRaw<{ day: string; n: number }[]>`
      SELECT to_char((tm."lastActiveAt" + interval '8 hours')::date, 'YYYY-MM-DD') AS day, count(DISTINCT tm."userId")::int AS n
      FROM "TeamMember" tm
      WHERE tm."teamId" = ${teamId} AND tm."status" = 'ACTIVE' AND tm."lastActiveAt" >= ${since}::timestamp
      GROUP BY 1
    `,
    prisma.$queryRaw<{ since: Date | null }[]>`
      SELECT min(tm."lastActiveAt") AS since
      FROM "TeamMember" tm
      WHERE tm."teamId" = ${teamId} AND tm."status" = 'ACTIVE' AND tm."lastActiveAt" IS NOT NULL
    `,
  ])

  const buckets = new Map<string, ActivityBucket>()
  for (let i = 0; i < windowDays; i += 1) {
    const day = cnDayLabel(startMs + i * DAY_MS)
    buckets.set(day, { day, newVideos: 0, uploadBytes: 0, comments: 0, visits: 0, shareSessions: 0, activeMembers: null })
  }
  const at = (day: string) => buckets.get(day)
  for (const row of videoRows) {
    const bucket = at(row.day)
    if (bucket) { bucket.newVideos = row.n; bucket.uploadBytes = Number(row.bytes) }
  }
  for (const row of commentRows) { const bucket = at(row.day); if (bucket) bucket.comments = row.n }
  for (const row of visitRows) { const bucket = at(row.day); if (bucket) bucket.visits = row.n }
  for (const row of sessionRows) { const bucket = at(row.day); if (bucket) bucket.shareSessions = row.n }

  const heartbeatSince = heartbeatSinceRows[0]?.since ?? null
  const heartbeatSinceDay = heartbeatSince
    ? cnDayLabel(new Date(heartbeatSince).getTime())
    : null
  if (heartbeatSinceDay) {
    for (const bucket of buckets.values()) {
      if (bucket.day >= heartbeatSinceDay) bucket.activeMembers = 0
    }
    for (const row of heartbeatRows) {
      const bucket = at(row.day)
      if (bucket) bucket.activeMembers = row.n
    }
  }

  return {
    days: windowDays,
    buckets: Array.from(buckets.values()).sort((a, b) => (a.day < b.day ? 1 : -1)),
    collected: { activeMembers: Boolean(heartbeatSinceDay), heartbeatSince: iso(heartbeatSince) },
    notes: [
      '日期按北京时间切分；上传素材/上传量按发生量统计，包含已进回收站的历史上传。',
      '项目数/视频数口径：项目含归档，视频不含回收站。',
      heartbeatSinceDay ? `成员心跳自 ${heartbeatSinceDay} 起有记录。` : '成员心跳尚未采集，活跃成员显示“未采集”。',
    ],
  }
}

export async function getTeamLinkForReveal(teamId: string, linkId: string, baseUrl: string): Promise<{ link: LinkView; url: string } | null> {
  const row = await prisma.shareLink.findFirst({
    where: { id: linkId, project: { teamId } },
    select: {
      id: true, projectId: true, token: true, name: true, type: true, scopeType: true, scopeId: true,
      permissions: true, authMode: true, expiresAt: true, maxViews: true, viewCount: true, status: true,
      masterOfProjectId: true, createdAt: true,
      project: { select: { teamId: true, status: true, title: true } },
    },
  })
  if (!row) return null
  const view = linkViews([row as LinkRow])[0]
  return { link: view, url: formatShareLinkUrl(row.token, baseUrl) }
}
