import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { noStoreJson, supportErrorResponse } from '@/lib/support/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function percentile(values: number[], p: number) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function secondsBetween(a: Date, b: Date) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000))
}

export async function GET(request: NextRequest) {
  const auth = await requirePlatformAuth(request)
  if (auth instanceof Response) return auth
  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '请求过于频繁',
  }, 'platform-support-metrics', auth.id)
  if (limited) return limited

  try {
    const now = new Date()
    const fromParam = request.nextUrl.searchParams.get('from')
    const toParam = request.nextUrl.searchParams.get('to')
    const from = fromParam ? new Date(fromParam) : new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000)
    const to = toParam ? new Date(toParam) : now
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return noStoreJson({ error: '无效的时间范围' }, { status: 400 })
    }

    const conversations = await prisma.supportConversation.findMany({
      where: { deletedAt: null, createdAt: { gte: from, lte: to } },
      select: {
        id: true,
        status: true,
        createdAt: true,
        firstVisitorMessageAt: true,
        firstAgentReplyAt: true,
        closedAt: true,
        csatScore: true,
        source: true,
        locale: true,
      },
    })

    const answered = conversations.filter((item) => item.firstVisitorMessageAt && item.firstAgentReplyAt)
    const firstResponseSeconds = answered.map((item) => secondsBetween(item.firstVisitorMessageAt!, item.firstAgentReplyAt!))
    const resolved = conversations.filter((item) => item.closedAt)
    const resolutionSeconds = resolved.map((item) => secondsBetween(item.createdAt, item.closedAt!))
    const csat = conversations.map((item) => item.csatScore).filter((score): score is number => typeof score === 'number')
    const unanswered = conversations.filter((item) => !item.firstAgentReplyAt)
    const lastNotification = await prisma.supportNotification.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { status: true, lastError: true, createdAt: true },
    })
    const bySource: Record<string, number> = {}
    const byLocale: Record<string, number> = {}
    for (const item of conversations) {
      bySource[item.source] = (bySource[item.source] || 0) + 1
      byLocale[item.locale] = (byLocale[item.locale] || 0) + 1
    }

    return noStoreJson({
      range: { from: from.toISOString(), to: to.toISOString() },
      volume: conversations.length,
      open: conversations.filter((item) => item.status !== 'CLOSED').length,
      closed: resolved.length,
      unanswered: unanswered.length,
      firstResponseSeconds: {
        median: percentile(firstResponseSeconds, 50),
        p90: percentile(firstResponseSeconds, 90),
        answered: answered.length,
      },
      resolutionSeconds: {
        median: percentile(resolutionSeconds, 50),
        p90: percentile(resolutionSeconds, 90),
        resolved: resolved.length,
      },
      csat: {
        average: csat.length ? Number((csat.reduce((sum, score) => sum + score, 0) / csat.length).toFixed(2)) : null,
        responses: csat.length,
        rate: conversations.length ? Number((csat.length / conversations.length).toFixed(3)) : 0,
      },
      bySource,
      byLocale,
      notification: lastNotification
        ? { status: lastNotification.status, error: lastNotification.lastError, at: lastNotification.createdAt.toISOString() }
        : null,
    })
  } catch (error) {
    return supportErrorResponse(error)
  }
}
