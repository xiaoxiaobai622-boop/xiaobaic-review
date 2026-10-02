import { prisma } from '@/lib/db'
import { getPlatformStorageTotals, type PlatformStorageTotals } from '@/lib/platform-access'

export const USAGE_DEFAULT_DAYS = 14
export const USAGE_MAX_DAYS = 31

export type DailyUsage = {
  /** 北京日 `YYYY-MM-DD` */
  day: string
  newVideos: number
  uploadBytes: number
  newProjects: number
  newUsers: number
  comments: number
  visits: number
  activeProjects: number
  shareSessions: number
}

export type PlatformUsage = { days: DailyUsage[]; totalStoredBytes: number; storage: PlatformStorageTotals }

const CN_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 每张被读的表里 `createdAt` 都是 `timestamp without time zone` 且存 UTC（生产 information_schema
 * 实测 9 张表全如此），所以「北京的一天」必须是 `createdAt + 8h` 再截 date；少了这 8 小时，今天 00:01
 * 发生的上传会被算进昨天。
 */
function cnDayStart(now: Date) {
  const shifted = new Date(now.getTime() + CN_OFFSET_MS)
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - CN_OFFSET_MS
}

function cnDayLabel(ms: number) {
  return new Date(ms + CN_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * 窗口下界以 UTC 墙钟字符串交给 Postgres 并显式 `::timestamp`。不能直接绑 JS Date：驱动会按机器
 * 时区把它渲染成无时区字面量，窗口就跟着服务器的时区漂。
 */
function utcWallClock(ms: number) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

type Bucket = Omit<DailyUsage, 'day'>

function emptyBucket(): Bucket {
  return { newVideos: 0, uploadBytes: 0, newProjects: 0, newUsers: 0, comments: 0, visits: 0, activeProjects: 0, shareSessions: 0 }
}

/** 只统计「发生量」，所以素材连回收站里的墓碑行也计入：上传这件事当天确实发生过。 */
export async function getPlatformUsage(days = USAGE_DEFAULT_DAYS, now = new Date()): Promise<PlatformUsage> {
  const startMs = cnDayStart(now) - (days - 1) * DAY_MS
  const since = utcWallClock(startMs)

  const buckets = new Map<string, Bucket>()
  for (let i = 0; i < days; i += 1) buckets.set(cnDayLabel(startMs + i * DAY_MS), emptyBucket())
  // 六条查询都按同一个窗口取行，标签落在窗口外就是数据本身有问题（所有行都是 `@default(now())`），
  // 忽略即可 —— 表必须正好 `days` 行，不能让一个异常日期把长度撑开。
  const at = (day: string) => buckets.get(day)

  const [videoRows, projectRows, userRows, commentRows, analyticsRows, shareRows] = await Promise.all([
    prisma.$queryRaw<{ day: string; n: number; bytes: bigint }[]>`
      SELECT to_char(("createdAt" + interval '8 hours')::date, 'YYYY-MM-DD') AS day,
             count(*)::int AS n,
             coalesce(sum("originalFileSize"), 0)::bigint AS bytes
      FROM "Video"
      WHERE "createdAt" >= ${since}::timestamp
      GROUP BY 1`,
    prisma.$queryRaw<{ day: string; n: number }[]>`
      SELECT to_char(("createdAt" + interval '8 hours')::date, 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM "Project"
      WHERE "createdAt" >= ${since}::timestamp
      GROUP BY 1`,
    prisma.$queryRaw<{ day: string; n: number }[]>`
      SELECT to_char(("createdAt" + interval '8 hours')::date, 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM "User"
      WHERE "createdAt" >= ${since}::timestamp
      GROUP BY 1`,
    prisma.$queryRaw<{ day: string; n: number }[]>`
      SELECT to_char(("createdAt" + interval '8 hours')::date, 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM "Comment"
      WHERE "createdAt" >= ${since}::timestamp
      GROUP BY 1`,
    prisma.$queryRaw<{ day: string; n: number; projects: number }[]>`
      SELECT to_char(("createdAt" + interval '8 hours')::date, 'YYYY-MM-DD') AS day,
             count(*)::int AS n,
             count(DISTINCT "projectId")::int AS projects
      FROM "VideoAnalytics"
      WHERE "createdAt" >= ${since}::timestamp AND "eventType" = 'PAGE_VISIT'
      GROUP BY 1`,
    prisma.$queryRaw<{ day: string; sessions: number }[]>`
      SELECT to_char(("createdAt" + interval '8 hours')::date, 'YYYY-MM-DD') AS day,
             count(DISTINCT "sessionId")::int AS sessions
      FROM "SharePageAccess"
      WHERE "createdAt" >= ${since}::timestamp
      GROUP BY 1`,
  ])

  for (const row of videoRows) {
    const bucket = at(row.day)
    if (!bucket) continue
    bucket.newVideos = row.n
    bucket.uploadBytes = Number(row.bytes)
  }
  for (const row of projectRows) {
    const bucket = at(row.day)
    if (bucket) bucket.newProjects = row.n
  }
  for (const row of userRows) {
    const bucket = at(row.day)
    if (bucket) bucket.newUsers = row.n
  }
  for (const row of commentRows) {
    const bucket = at(row.day)
    if (bucket) bucket.comments = row.n
  }
  for (const row of analyticsRows) {
    const bucket = at(row.day)
    if (!bucket) continue
    bucket.visits = row.n
    bucket.activeProjects = row.projects
  }
  for (const row of shareRows) {
    const bucket = at(row.day)
    if (bucket) bucket.shareSessions = row.sessions
  }

  const totals = await getPlatformStorageTotals()

  return {
    days: Array.from(buckets.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, bucket]) => ({ day, ...bucket })),
    totalStoredBytes: totals.totalBytes,
    storage: totals,
  }
}
