import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { enqueueExternalNotification } from '@/lib/external-notifications/enqueueExternalNotification'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function testNotificationText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const settingsMessages = messages?.settings || {}
  const notificationsMessages = settingsMessages.notifications || {}

  const authResult = await requirePlatformAdmin(request)
  if (authResult instanceof Response) return authResult

  const rateLimitResult = await rateLimit(
    request,
    {
      windowMs: 60 * 1000,
      maxRequests: 20,
      message: notificationsMessages.tooManyRequestsSlowDown || 'Too many requests. Please slow down.',
    },
    'settings-notifications-test',
    authResult.id
  )
  if (rateLimitResult) return rateLimitResult

  const { id } = await context.params

  try {
    const body = await request.json().catch(() => ({}))

    const title = testNotificationText(body.title, notificationsMessages.testNotificationTitle || 'FrameReview Test Notification')
    const message = testNotificationText(body.message, notificationsMessages.testNotificationBody || 'If you received this, your external notification destination is configured correctly.')

    await enqueueExternalNotification({
      destinationIds: [id],
      eventType: 'TEST',
      title,
      body: message,
      notifyType: 'info',
    })

    return NextResponse.json({ queued: true })
  } catch (error) {
    return NextResponse.json({ error: notificationsMessages.failedToQueueTestNotification || 'Failed to queue test notification' }, { status: 500 })
  }
}
