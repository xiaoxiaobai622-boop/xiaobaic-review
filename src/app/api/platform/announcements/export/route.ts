import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { listAdminAnnouncements, parseAdminAnnouncementFilters } from '@/lib/announcements/admin'
import { beijingDayKey } from '@/lib/announcements/time'
import { formatBeijingDateTime } from '@/lib/utils'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function percent(value: number | null): string {
  return value === null ? '' : `${(value * 100).toFixed(1)}%`
}

function formatDate(value: Date | null): string {
  return value ? formatBeijingDateTime(value) : ''
}

/** GET /api/platform/announcements/export — announcement-level CSV, no user rows. */
export async function GET(request: NextRequest) {
  const platformAuth = await requirePlatformAuth(request)
  if (platformAuth instanceof Response) return platformAuth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 10,
    message: '导出过于频繁，请稍后再试',
  }, 'platform-announcement-export')
  if (limited) return limited

  try {
    const filters = parseAdminAnnouncementFilters(request.nextUrl.searchParams)
    const items = await listAdminAnnouncements({
      ...filters,
      includeTest: false,
      limit: 100,
    })

    const header = [
      '公告 ID',
      '标题',
      '类型',
      '状态',
      '主模式',
      '优先级',
      '受众摘要',
      '发布时受众数',
      '当前受众数',
      '曝光次数',
      '独立曝光人数',
      '已读人数',
      '已知晓人数',
      '点击次数',
      '点击人数',
      '关闭人数',
      '已读率',
      '已知晓率',
      '曝光率',
      '点击率',
      '关闭率',
      '创建人',
      '创建时间',
      '发布时间',
      '开始时间',
      '结束时间',
    ]

    const rows = items.map((item) => [
      item.id,
      item.title,
      item.typeLabel,
      item.statusLabel,
      item.primaryMode,
      item.priority,
      item.audienceSummary,
      item.audience.snapshot,
      item.audience.current,
      item.stats.impressions.events,
      item.stats.impressions.users,
      item.stats.reads.users,
      item.stats.acks.users,
      item.stats.clicks.events,
      item.stats.clicks.users,
      item.stats.dismisses.users,
      percent(item.stats.rates.read),
      percent(item.stats.rates.ack),
      percent(item.stats.rates.impression),
      percent(item.stats.rates.click),
      percent(item.stats.rates.dismiss),
      item.createdBy?.name || '',
      formatBeijingDateTime(item.createdAt),
      formatDate(item.publishedAt),
      formatDate(item.startAt),
      formatDate(item.endAt),
    ])

    const csv = '\uFEFF' + [header, ...rows]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="announcements-${beijingDayKey()}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    logError('[ANNOUNCEMENT EXPORT] failed:', error)
    return NextResponse.json({ error: '导出失败，请稍后重试' }, { status: 500 })
  }
}
