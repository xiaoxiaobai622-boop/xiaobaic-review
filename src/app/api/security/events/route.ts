import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAdmin } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { getRedis } from '@/lib/redis'
import { getClientIpAddress } from '@/lib/utils'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'




export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const securityMessages = messages?.security || {}

  const authResult = await requirePlatformAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60,
    message: securityMessages.tooManyRequestsSlowDown || 'Too many requests. Please slow down.'
  }, 'security-events-read')
  if (rateLimitResult) return rateLimitResult

  try {
    const settings = await prisma.securitySettings.findUnique({
      where: { id: 'default' },
      select: { viewSecurityEvents: true }
    })

    if (!settings?.viewSecurityEvents) {
      return NextResponse.json(
        { error: securityMessages.securityEventsDashboardDisabled || 'Security events dashboard is disabled' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const type = searchParams.get('type') || undefined
    const severity = searchParams.get('severity') || undefined
    const projectId = searchParams.get('projectId') || undefined

    const skip = (page - 1) * limit

    // Build where clause (supports comma-separated values for multi-select)
    const where: any = {}
    if (type) {
      const types = type.split(',').filter(Boolean)
      where.type = types.length === 1 ? types[0] : { in: types }
    }
    if (severity) {
      const severities = severity.split(',').filter(Boolean)
      where.severity = severities.length === 1 ? severities[0] : { in: severities }
    }
    if (projectId) where.projectId = projectId

    const [events, total] = await Promise.all([
      prisma.securityEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          project: {
            select: {
              id: true,
              title: true,
              slug: true,
            }
          }
        }
      }),
      prisma.securityEvent.count({ where })
    ])

    const stats = await prisma.securityEvent.groupBy({
      by: ['type'],
      _count: {
        id: true
      }
    })

    return NextResponse.json({
      events,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      stats: stats.map(s => ({
        type: s.type,
        count: s._count.id
      }))
    })
  } catch (error) {
    logError('Error fetching security events:', error)
    return NextResponse.json(
      { error: securityMessages.failedToFetchSecurityEvents || 'Failed to fetch security events' },
      { status: 500 }
    )
  }
}

/**
 * The purge record has to survive `trackSecurityLogs` being switched off, otherwise the
 * same administrator can stop the audit trail and then empty it without a trace. So this
 * writes straight to the table instead of through `logSecurityEvent`.
 */
async function recordAuditPurge(request: NextRequest, actorId: string, olderThan: number, deleted: number) {
  try {
    await prisma.securityEvent.create({
      data: {
        type: 'SECURITY_EVENTS_PURGED',
        severity: 'CRITICAL',
        userId: actorId,
        ipAddress: getClientIpAddress(request),
        details: { olderThan, deleted },
      },
    })
  } catch (error) {
    logError('[SECURITY_AUDIT] Failed to record an event purge:', error)
  }
}

export async function DELETE(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const securityMessages = messages?.security || {}

  const authResult = await requirePlatformAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 10,
    message: securityMessages.tooManyRequestsSlowDown || 'Too many requests. Please slow down.'
  }, 'security-events-delete', authResult.id)
  if (rateLimitResult) return rateLimitResult

  try {
    const body = await request.json()
    const { olderThan, confirmAll } = body // Days (0 = delete all)

    if (olderThan === undefined || olderThan === null || olderThan < 0) {
      return NextResponse.json(
        { error: securityMessages.olderThanMustBeZeroOrGreater || 'olderThan must be 0 or greater (0 = delete all)' },
        { status: 400 }
      )
    }

    if (olderThan === 0 && confirmAll !== true) {
      return NextResponse.json(
        { error: securityMessages.confirmAllRequiredToWipeEvents || 'Deleting every security event requires confirmAll: true' },
        { status: 400 }
      )
    }

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - olderThan)

    const result = await prisma.securityEvent.deleteMany({
      where: olderThan === 0 ? {} : { createdAt: { lt: cutoffDate } }
    })

    // The recent-events list in Redis is a flat cache, so it is dropped rather than filtered.
    if (olderThan === 0 || result.count > 0) {
      await getRedis().del('security:events:recent')
    }

    await recordAuditPurge(request, authResult.id, olderThan, result.count)

    const template = olderThan === 0
      ? securityMessages.deletedAllSecurityEvents || 'Deleted all {count} security events'
      : securityMessages.deletedEventsOlderThanDays || 'Deleted {count} events older than {days} days'

    return NextResponse.json({
      success: true,
      deleted: result.count,
      message: template.replace('{count}', String(result.count)).replace('{days}', String(olderThan))
    })
  } catch (error) {
    logError('Error deleting security events:', error)
    return NextResponse.json(
      { error: securityMessages.failedToDeleteSecurityEventsApi || 'Failed to delete security events' },
      { status: 500 }
    )
  }
}
