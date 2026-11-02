import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePushActor } from '@/lib/push-access'
import { rateLimit } from '@/lib/rate-limit'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/push/unsubscribe
 * Unsubscribe the browser from push notifications
 */
export async function POST(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const webPushMessages = messages?.settings?.webPush || {}

  const actor = await requirePushActor(request)
  if (actor instanceof Response) {
    return actor
  }

  // Rate limit: 20 unsubscribe attempts per hour per admin
  const rateLimitResult = await rateLimit(
    request,
    { windowMs: 60 * 60 * 1000, maxRequests: 20, message: webPushMessages.tooManyUnsubscribeRequests || 'Too many requests. Please wait.' },
    'push-unsubscribe',
    actor.user.id
  )
  if (rateLimitResult) return rateLimitResult

  try {
    const body = await request.json()
    const { endpoint, subscriptionId } = body

    // Support unsubscribe by endpoint or subscriptionId
    if (!endpoint && !subscriptionId) {
      return NextResponse.json(
        { error: webPushMessages.endpointOrSubscriptionIdRequired || 'Either endpoint or subscriptionId is required' },
        { status: 400 }
      )
    }

    // The earlier guard guarantees exactly one handle is present, and both
    // deletes are scoped to the caller's own userId.
    const target = subscriptionId
      ? { id: subscriptionId, userId: actor.user.id }
      : { endpoint, userId: actor.user.id }
    const { count } = await prisma.pushSubscription.deleteMany({ where: target })

    if (count === 0) {
      return NextResponse.json(
        { error: webPushMessages.subscriptionNotFound || 'Subscription not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('[API] Failed to unsubscribe:', error)
    return NextResponse.json(
      { error: webPushMessages.failedToUnsubscribe || 'Failed to unsubscribe' },
      { status: 500 }
    )
  }
}
