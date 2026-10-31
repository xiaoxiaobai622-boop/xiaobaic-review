import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  countAudience,
  isBroadcastAudience,
  summarizeAudience,
} from './audience'
import { audienceSourceOf } from './feed'
import {
  recordAnnouncementAudit,
  listAnnouncementAudit,
  type AuditActor,
} from './audit'
import {
  STATUS_LABELS,
  TYPE_LABELS,
  canEditAnnouncement,
  isAudienceKind,
  isAnnouncementStatus,
  isAnnouncementType,
  isPrimaryMode,
  modeConstraintError,
  type AnnouncementStatus,
  type AnnouncementType,
  type AudienceKind,
  type PrimaryMode,
} from './constants'
import {
  isCurrentlyActive,
  statusAfterResume,
  statusForPublish,
  syncAnnouncementLifecycles,
} from './lifecycle'
import {
  loadEventTotalsForAnnouncements,
  loadStatsForAnnouncement,
  toListStats,
  type StatsFilters,
} from './stats'
import { addHours, announcementNow } from './time'
import { validateAnnouncementPayload, type NormalizedAnnouncementPayload } from './validation'
import { maskPhoneDisplay } from '@/lib/phone-display'

const adminInclude = {
  rules: true,
  creator: { select: { id: true, name: true, email: true } },
  user: { select: { id: true, name: true, phone: true, email: true } },
  _count: { select: { reads: { where: { readAt: { not: null } } } } },
} satisfies Prisma.PlatformAnnouncementInclude

type AdminAnnouncement = Prisma.PlatformAnnouncementGetPayload<{ include: typeof adminInclude }>

export interface AdminAnnouncementFilters {
  q?: string
  statuses: string[]
  types: string[]
  modes: string[]
  audienceKind?: AudienceKind
  from?: Date
  to?: Date
  includeTest: boolean
  limit: number
}

export interface AdminLifecycleResult {
  ok: boolean
  status: number
  code?: string
  error?: string
  id?: string
}

function validFromQuery(values: string[], predicate: (value: unknown) => boolean): string[] {
  return values.filter((value) => predicate(value))
}

export function parseAdminAnnouncementFilters(searchParams: URLSearchParams): AdminAnnouncementFilters {
  const statuses = validFromQuery(
    searchParams.getAll('status').flatMap((value) => value.split(',')).filter(Boolean),
    isAnnouncementStatus,
  )
  const types = validFromQuery(
    searchParams.getAll('type').flatMap((value) => value.split(',')).filter(Boolean),
    isAnnouncementType,
  )
  const modes = validFromQuery(
    searchParams.getAll('mode').flatMap((value) => value.split(',')).filter(Boolean),
    isPrimaryMode,
  )
  const audienceKindRaw = searchParams.get('audienceKind')
  const audienceKind = audienceKindRaw && isAudienceKind(audienceKindRaw) ? audienceKindRaw : undefined

  const fromRaw = searchParams.get('from')
  const toRaw = searchParams.get('to')
  const from = fromRaw ? new Date(fromRaw) : undefined
  const to = toRaw ? new Date(toRaw) : undefined

  const limitRaw = Number(searchParams.get('limit') || 50)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 50

  return {
    q: searchParams.get('q')?.trim() || undefined,
    statuses,
    types,
    modes,
    audienceKind,
    from: from && !Number.isNaN(from.getTime()) ? from : undefined,
    to: to && !Number.isNaN(to.getTime()) ? to : undefined,
    includeTest: searchParams.get('includeTest') === '1',
    limit,
  }
}

function buildAdminWhere(filters: AdminAnnouncementFilters): Prisma.PlatformAnnouncementWhereInput {
  const where: Prisma.PlatformAnnouncementWhereInput = {
    isTest: filters.includeTest ? undefined : false,
  }
  const and: Prisma.PlatformAnnouncementWhereInput[] = []

  if (filters.q) {
    and.push({
      OR: [
        { title: { contains: filters.q, mode: 'insensitive' } },
        { content: { contains: filters.q, mode: 'insensitive' } },
      ],
    })
  }
  if (filters.statuses.length > 0) where.status = { in: filters.statuses }
  if (filters.types.length > 0) where.type = { in: filters.types }
  if (filters.modes.length > 0) where.primaryMode = { in: filters.modes }
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    }
  }
  if (filters.audienceKind) {
    if (filters.audienceKind === 'ALL') {
      and.push({
        OR: [
          { rules: { some: { kind: 'ALL', mode: 'INCLUDE' } } },
          { rules: { none: {} }, userId: null },
        ],
      })
    } else if (filters.audienceKind === 'USER') {
      and.push({
        OR: [
          { rules: { some: { kind: 'USER', mode: 'INCLUDE' } } },
          { rules: { none: {} }, userId: { not: null } },
        ],
      })
    } else {
      and.push({ rules: { some: { kind: filters.audienceKind, mode: 'INCLUDE' } } })
    }
  }

  if (and.length > 0) where.AND = and
  return where
}

function ratio(users: number, audience: number | null): number | null {
  if (audience === null || audience <= 0) return null
  return users / audience
}

function mapAdminAnnouncement(
  announcement: AdminAnnouncement,
  stats: ReturnType<typeof toListStats>,
  currentAudience: number | null,
  currentAudienceError: string | null,
) {
  const source = audienceSourceOf(announcement)
  const target = announcement.user
  const targetName = target
    ? target.name || maskPhoneDisplay(target.phone) || target.email
    : null

  return {
    id: announcement.id,
    title: announcement.title,
    content: announcement.content,
    type: announcement.type,
    typeLabel: TYPE_LABELS[announcement.type as AnnouncementType] || announcement.type,
    status: announcement.status,
    statusLabel: STATUS_LABELS[announcement.status as keyof typeof STATUS_LABELS] || announcement.status,
    primaryMode: announcement.primaryMode,
    priority: announcement.priority,
    locale: announcement.locale,
    ackRequired: announcement.ackRequired,
    ctaLabel: announcement.ctaLabel,
    ctaUrl: announcement.ctaUrl,
    imageUrl: announcement.imageUrl,
    startAt: announcement.startAt,
    endAt: announcement.endAt,
    publishedAt: announcement.publishedAt,
    createdAt: announcement.createdAt,
    updatedAt: announcement.updatedAt,
    archivedAt: announcement.archivedAt,
    isTest: announcement.isTest,
    version: announcement.version,
    copiedFromId: announcement.copiedFromId,
    broadcast: isBroadcastAudience(source),
    targetName,
    readCount: announcement._count.reads,
    active: isCurrentlyActive(announcement),
    createdBy: announcement.creator
      ? { id: announcement.creator.id, name: announcement.creator.name, email: announcement.creator.email }
      : null,
    audienceSummary: summarizeAudience(source),
    audience: {
      snapshot: announcement.audienceCount,
      current: currentAudience,
      resolvedAt: announcement.audienceResolvedAt,
      error: currentAudienceError,
    },
    audienceRules: announcement.rules.map((rule) => ({
      kind: rule.kind,
      value: rule.value,
      mode: rule.mode,
    })),
    stats: {
      ...stats,
      rates: {
        impression: ratio(stats.impressions.users, currentAudience),
        read: ratio(stats.reads.users, currentAudience),
        ack: ratio(stats.acks.users, currentAudience),
        click: ratio(stats.clicks.users, currentAudience),
        dismiss: ratio(stats.dismisses.users, currentAudience),
      },
    },
  }
}

async function currentAudienceFor(announcement: { userId: string | null; rules: Array<{ kind: string; value: string | null; mode: string }> }) {
  try {
    return { count: await countAudience(audienceSourceOf(announcement)), error: null as string | null }
  } catch {
    return { count: null as number | null, error: '当前受众数解析失败' }
  }
}

export async function listAdminAnnouncements(filters: AdminAnnouncementFilters) {
  await syncAnnouncementLifecycles()

  const items = await prisma.platformAnnouncement.findMany({
    where: buildAdminWhere(filters),
    include: adminInclude,
    orderBy: { createdAt: 'desc' },
    take: filters.limit,
  })

  const totals = await loadEventTotalsForAnnouncements(items.map((item) => item.id))

  return items.map((item) => {
    const totalsForItem = totals.get(item.id)
    // The list intentionally shows the publish-time snapshot only. Resolving
    // current audience per row is an N+1; the detail API still resolves current
    // audience once, where both numbers are shown.
    return mapAdminAnnouncement(
      item,
      toListStats(totalsForItem ?? {
        IMPRESSION: { events: 0, users: 0 },
        READ: { events: 0, users: 0 },
        ACK: { events: 0, users: 0 },
        CLICK: { events: 0, users: 0 },
        DISMISS: { events: 0, users: 0 },
      }),
      null,
      null,
    )
  })
}

export async function getAdminAnnouncement(id: string, statsFilters: StatsFilters = {}) {
  await syncAnnouncementLifecycles()
  const announcement = await prisma.platformAnnouncement.findUnique({
    where: { id },
    include: adminInclude,
  })
  if (!announcement) return null

  const [audience, stats, audit] = await Promise.all([
    currentAudienceFor(announcement),
    loadStatsForAnnouncement({
      id: announcement.id,
      audienceSource: audienceSourceOf(announcement),
      audienceSnapshot: announcement.audienceCount,
      audienceResolvedAt: announcement.audienceResolvedAt,
      filters: statsFilters,
    }),
    listAnnouncementAudit(announcement.id),
  ])

  const totals = await loadEventTotalsForAnnouncements([announcement.id])
  const item = mapAdminAnnouncement(
    announcement,
    toListStats(totals.get(announcement.id) ?? {
      IMPRESSION: { events: 0, users: 0 },
      READ: { events: 0, users: 0 },
      ACK: { events: 0, users: 0 },
      CLICK: { events: 0, users: 0 },
      DISMISS: { events: 0, users: 0 },
    }),
    audience.count,
    audience.error,
  )

  return { item, stats, audit }
}

function rulesCreate(rules: NormalizedAnnouncementPayload['audienceRules']) {
  return rules.map((rule) => ({ kind: rule.kind, value: rule.value, mode: rule.mode }))
}

function payloadData(payload: NormalizedAnnouncementPayload) {
  return {
    title: payload.title,
    content: payload.content,
    locale: payload.locale,
    type: payload.type,
    primaryMode: payload.primaryMode,
    priority: payload.priority,
    startAt: payload.startAt,
    endAt: payload.endAt,
    ackRequired: payload.ackRequired,
    ctaLabel: payload.ctaLabel,
    ctaUrl: payload.ctaUrl,
    imageUrl: payload.imageUrl,
  }
}

export async function createAnnouncementDraft(payload: NormalizedAnnouncementPayload, actor: AuditActor): Promise<string> {
  const created = await prisma.platformAnnouncement.create({
    data: {
      ...payloadData(payload),
      status: 'DRAFT',
      publishedAt: null,
      audienceCount: null,
      audienceResolvedAt: null,
      createdBy: actor.id,
      version: 1,
      isTest: false,
      rules: { create: rulesCreate(payload.audienceRules) },
    },
    select: { id: true },
  })

  await recordAnnouncementAudit({
    announcementId: created.id,
    actor,
    action: 'CREATE',
    detail: { title: payload.title, type: payload.type, mode: payload.primaryMode },
  })
  return created.id
}

export async function updateDraftAnnouncement(
  id: string,
  payload: NormalizedAnnouncementPayload,
  actor: AuditActor,
): Promise<AdminLifecycleResult> {
  const existing = await prisma.platformAnnouncement.findUnique({
    where: { id },
    select: { status: true, title: true, content: true, type: true, primaryMode: true, priority: true },
  })
  if (!existing) return { ok: false, status: 404, code: 'NOT_FOUND', error: '公告不存在' }
  if (!canEditAnnouncement(existing.status as AnnouncementStatus)) {
    return {
      ok: false,
      status: 409,
      code: 'PUBLISHED_IMMUTABLE',
      error: '已发布/已排期的公告不能静默修改；请暂停后复制成新版本',
    }
  }

  const changed = [
    existing.title !== payload.title ? 'title' : null,
    existing.content !== payload.content ? 'content' : null,
    existing.type !== payload.type ? 'type' : null,
    existing.primaryMode !== payload.primaryMode ? 'primaryMode' : null,
    existing.priority !== payload.priority ? 'priority' : null,
    'audienceRules',
  ].filter(Boolean)

  await prisma.$transaction(async (tx) => {
    await tx.platformAnnouncement.update({
      where: { id },
      data: payloadData(payload),
    })
    await tx.announcementAudienceRule.deleteMany({ where: { announcementId: id } })
    await tx.announcementAudienceRule.createMany({
      data: rulesCreate(payload.audienceRules).map((rule) => ({ ...rule, announcementId: id })),
    })
  })

  await recordAnnouncementAudit({
    announcementId: id,
    actor,
    action: 'UPDATE',
    detail: { fields: changed },
  })

  return { ok: true, status: 200, id }
}

function storedPayload(announcement: {
  title: string
  content: string
  locale: string
  type: string
  primaryMode: string
  priority: number
  startAt: Date | null
  endAt: Date | null
  ackRequired: boolean
  ctaLabel: string | null
  ctaUrl: string | null
  imageUrl: string | null
  rules: Array<{ kind: string; value: string | null; mode: string }>
}) {
  return {
    title: announcement.title,
    content: announcement.content,
    locale: announcement.locale,
    type: announcement.type,
    primaryMode: announcement.primaryMode,
    priority: announcement.priority,
    startAt: announcement.startAt?.toISOString() ?? null,
    endAt: announcement.endAt?.toISOString() ?? null,
    ackRequired: announcement.ackRequired,
    ctaLabel: announcement.ctaLabel,
    ctaUrl: announcement.ctaUrl,
    imageUrl: announcement.imageUrl,
    audienceRules: announcement.rules.map((rule) => ({
      kind: rule.kind,
      value: rule.value,
      mode: rule.mode,
    })),
  }
}

export async function publishAnnouncement(
  id: string,
  actor: AuditActor,
  options: { confirmAllModal: boolean },
): Promise<AdminLifecycleResult> {
  const announcement = await prisma.platformAnnouncement.findUnique({
    where: { id },
    include: { rules: true },
  })
  if (!announcement) return { ok: false, status: 404, code: 'NOT_FOUND', error: '公告不存在' }
  if (announcement.status !== 'DRAFT') {
    return { ok: false, status: 409, code: 'NOT_DRAFT', error: '只有草稿可以发布' }
  }

  const validated = validateAnnouncementPayload(storedPayload(announcement), { publishing: true })
  if (!validated.ok) {
    return { ok: false, status: 400, code: 'INVALID_PAYLOAD', error: validated.errors.join('；') }
  }

  const source = audienceSourceOf(announcement)
  const hasAll = source.rules.some((rule) => rule.kind === 'ALL' && rule.mode === 'INCLUDE')
  if (announcement.primaryMode === 'MODAL' && hasAll && !options.confirmAllModal) {
    return {
      ok: false,
      status: 400,
      code: 'CONFIRM_ALL_MODAL',
      error: '全员弹窗公告需要二次确认（confirmAllModal）',
    }
  }

  let audienceCount = 0
  try {
    audienceCount = await countAudience(source)
  } catch {
    return { ok: false, status: 503, code: 'AUDIENCE_UNAVAILABLE', error: '受众解析失败，暂时不能发布' }
  }
  if (audienceCount <= 0) {
    return { ok: false, status: 400, code: 'EMPTY_AUDIENCE', error: '当前受众人数为 0，不能发布' }
  }

  const now = announcementNow()
  if (validated.data.endAt && validated.data.endAt.getTime() <= now.getTime()) {
    return { ok: false, status: 400, code: 'ALREADY_ENDED', error: '结束时间已经过去，请修改后再发布' }
  }
  const startAt = validated.data.startAt && validated.data.startAt.getTime() > now.getTime()
    ? validated.data.startAt
    : now
  const status = statusForPublish(startAt, now)
  const publishedAt = status === 'ACTIVE' ? now : startAt

  await prisma.platformAnnouncement.update({
    where: { id },
    data: {
      status,
      startAt,
      publishedAt,
      audienceCount,
      audienceResolvedAt: now,
    },
  })

  await recordAnnouncementAudit({
    announcementId: id,
    actor,
    action: 'PUBLISH',
    detail: {
      status,
      audienceCount,
      primaryMode: announcement.primaryMode,
      startAt: startAt.toISOString(),
      endAt: announcement.endAt?.toISOString() ?? null,
    },
  })

  return { ok: true, status: 200, id }
}

export async function pauseAnnouncement(id: string, actor: AuditActor): Promise<AdminLifecycleResult> {
  const announcement = await prisma.platformAnnouncement.findUnique({ where: { id }, select: { status: true } })
  if (!announcement) return { ok: false, status: 404, code: 'NOT_FOUND', error: '公告不存在' }
  if (!['ACTIVE', 'SCHEDULED'].includes(announcement.status)) {
    return { ok: false, status: 409, code: 'NOT_PAUSABLE', error: '只有生效中或定时公告可以暂停' }
  }

  await prisma.platformAnnouncement.update({ where: { id }, data: { status: 'PAUSED' } })
  await recordAnnouncementAudit({ announcementId: id, actor, action: 'PAUSE' })
  return { ok: true, status: 200, id }
}

export async function resumeAnnouncement(id: string, actor: AuditActor): Promise<AdminLifecycleResult> {
  const announcement = await prisma.platformAnnouncement.findUnique({
    where: { id },
    select: { status: true, startAt: true, endAt: true },
  })
  if (!announcement) return { ok: false, status: 404, code: 'NOT_FOUND', error: '公告不存在' }
  if (announcement.status !== 'PAUSED') {
    return { ok: false, status: 409, code: 'NOT_PAUSED', error: '只有已暂停公告可以恢复' }
  }

  const status = statusAfterResume(announcement)
  await prisma.platformAnnouncement.update({ where: { id }, data: { status } })
  await recordAnnouncementAudit({ announcementId: id, actor, action: 'RESUME', detail: { status } })
  return { ok: true, status: 200, id }
}

export async function archiveAnnouncement(id: string, actor: AuditActor): Promise<AdminLifecycleResult> {
  const announcement = await prisma.platformAnnouncement.findUnique({ where: { id }, select: { status: true } })
  if (!announcement) return { ok: false, status: 404, code: 'NOT_FOUND', error: '公告不存在' }
  if (announcement.status === 'ARCHIVED') return { ok: true, status: 200, id }

  await prisma.platformAnnouncement.update({
    where: { id },
    data: { status: 'ARCHIVED', archivedAt: announcementNow() },
  })
  await recordAnnouncementAudit({ announcementId: id, actor, action: 'ARCHIVE' })
  return { ok: true, status: 200, id }
}

export async function copyAnnouncement(id: string, actor: AuditActor): Promise<AdminLifecycleResult> {
  const source = await prisma.platformAnnouncement.findUnique({
    where: { id },
    include: { rules: true },
  })
  if (!source) return { ok: false, status: 404, code: 'NOT_FOUND', error: '公告不存在' }

  const created = await prisma.platformAnnouncement.create({
    data: {
      title: source.title,
      content: source.content,
      locale: source.locale,
      type: source.type,
      primaryMode: source.primaryMode,
      priority: source.priority,
      startAt: null,
      endAt: null,
      ackRequired: source.ackRequired,
      ctaLabel: source.ctaLabel,
      ctaUrl: source.ctaUrl,
      imageUrl: source.imageUrl,
      status: 'DRAFT',
      publishedAt: null,
      audienceCount: null,
      audienceResolvedAt: null,
      version: source.version + 1,
      copiedFromId: source.id,
      createdBy: actor.id,
      isTest: false,
      rules: {
        create: source.rules.map((rule) => ({ kind: rule.kind, value: rule.value, mode: rule.mode })),
      },
    },
    select: { id: true },
  })

  await recordAnnouncementAudit({
    announcementId: source.id,
    actor,
    action: 'COPY',
    detail: { copyId: created.id, version: source.version + 1 },
  })
  await recordAnnouncementAudit({
    announcementId: created.id,
    actor,
    action: 'CREATE',
    detail: { copiedFromId: source.id, version: source.version + 1 },
  })

  return { ok: true, status: 200, id: created.id }
}

export async function testSendAnnouncement(id: string, actor: AuditActor): Promise<AdminLifecycleResult> {
  const source = await prisma.platformAnnouncement.findUnique({
    where: { id },
    include: { rules: true },
  })
  if (!source) return { ok: false, status: 404, code: 'NOT_FOUND', error: '公告不存在' }

  const now = announcementNow()
  const testPayload = validateAnnouncementPayload({
    title: `[测试] ${source.title}`.slice(0, 60),
    content: source.content,
    locale: source.locale,
    type: source.type,
    primaryMode: source.primaryMode,
    priority: source.priority,
    startAt: now.toISOString(),
    endAt: addHours(now, 24).toISOString(),
    ackRequired: source.ackRequired,
    ctaLabel: source.ctaLabel,
    ctaUrl: source.ctaUrl,
    imageUrl: source.imageUrl,
    audienceRules: [{ kind: 'USER', value: actor.id, mode: 'INCLUDE' }],
  }, { publishing: true })

  if (!testPayload.ok) {
    return { ok: false, status: 400, code: 'INVALID_TEST', error: testPayload.errors.join('；') }
  }

  const created = await prisma.platformAnnouncement.create({
    data: {
      ...payloadData(testPayload.data),
      status: 'ACTIVE',
      publishedAt: now,
      audienceCount: 1,
      audienceResolvedAt: now,
      createdBy: actor.id,
      version: 1,
      isTest: true,
      rules: { create: rulesCreate(testPayload.data.audienceRules) },
    },
    select: { id: true },
  })

  await recordAnnouncementAudit({
    announcementId: source.id,
    actor,
    action: 'TEST_SEND',
    detail: { testId: created.id },
  })

  return { ok: true, status: 200, id: created.id }
}

export function validModeConstraint(type: string, mode: string, priority: number, ackRequired: boolean): string | null {
  if (!isAnnouncementType(type) || !isPrimaryMode(mode)) return '类型或主模式不合法'
  return modeConstraintError({ type, primaryMode: mode as PrimaryMode, priority, ackRequired })
}
