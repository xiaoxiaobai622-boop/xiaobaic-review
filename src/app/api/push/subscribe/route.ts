import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePushActor, eventsForPushActor } from '@/lib/push-access'
import { rateLimit } from '@/lib/rate-limit'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type PushSurface = 'main' | 'support'

function normalizeSurface(value: unknown): PushSurface {
  return value === 'support' ? 'support' : 'main'
}

// GET /api/push/subscribe - List push subscriptions for current admin
export async function GET(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const webPushMessages = messages?.settings?.webPush || {}

  const actor = await requirePushActor(request)
  if (actor instanceof Response) {
    return actor
  }

  try {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: actor.user.id },
      select: {
        id: true,
        deviceName: true,
        userAgent: true,
        surface: true,
        subscribedEvents: true,
        createdAt: true,
        lastUsedAt: true,
        endpoint: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    // Mask endpoint for privacy (just show domain)
    const maskedSubscriptions = subscriptions.map((sub) => {
      let origin = ''
      try {
        origin = new URL(sub.endpoint).origin
      } catch {
        origin = ''
      }
      return { ...sub, endpoint: origin }
    })

    return NextResponse.json({ subscriptions: maskedSubscriptions })
  } catch (error) {
    logError('[API] Failed to list push subscriptions:', error)
    return NextResponse.json(
      { error: webPushMessages.failedToLoadSubs || 'Failed to list subscriptions' },
      { status: 500 }
    )
  }
}

// POST /api/push/subscribe - Subscribe browser to push notifications
export async function POST(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const webPushMessages = messages?.settings?.webPush || {}

  const actor = await requirePushActor(request)
  if (actor instanceof Response) {
    return actor
  }

  const rateLimitResult = await rateLimit(
    request,
    { windowMs: 60 * 60 * 1000, maxRequests: 20, message: webPushMessages.tooManySubscriptionAttempts || 'Too many subscription attempts. Please wait.' },
    'push-subscribe',
    actor.user.id
  )
  if (rateLimitResult) return rateLimitResult

  try {
    const body = await request.json()
    const { endpoint, keys, deviceName, subscribedEvents } = body
    const surface = normalizeSurface(body.surface)
    if (surface === 'support' && !actor.isPlatformAdmin) {
      return NextResponse.json(
        { error: 'Only platform administrators can use the support push surface.', code: 'SUPPORT_SURFACE_FORBIDDEN' },
        { status: 403 },
      )
    }

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json(
        { error: webPushMessages.missingRequiredSubscriptionFields || 'Missing required subscription fields' },
        { status: 400 }
      )
    }

    // Validate endpoint URL
    try {
      new URL(endpoint)
    } catch {
      return NextResponse.json(
        { error: webPushMessages.invalidEndpointUrl || 'Invalid endpoint URL' },
        { status: 400 }
      )
    }

    // Validate subscribedEvents. The support entry only owns the support event;
    // the main console never subscribes to it.
    const validEvents = eventsForPushActor(surface, subscribedEvents, actor)

    const userAgent = request.headers.get('user-agent') || undefined
    const resolvedDeviceName = deviceName || (
      surface === 'support'
        ? '运营 PWA'
        : actor.isPlatformAdmin
          ? getDeviceNameFromUserAgent(userAgent)
          : '团队通知'
    )

    const existing = await prisma.pushSubscription.findUnique({
      where: { endpoint },
      select: { userId: true, surface: true },
    })

    if (existing && existing.userId !== actor.user.id) {
      return NextResponse.json(
        { error: webPushMessages.deviceAlreadyRegisteredByAnotherAdmin || 'This device is already registered for push notifications by another admin.' },
        { status: 409 } // Conflict
      )
    }

    if (existing && existing.surface !== surface) {
      return NextResponse.json(
        {
          error: '这台设备已绑定其他通知入口。请先在原入口关闭推送，再在当前入口重新开启。',
          code: 'SURFACE_CONFLICT',
        },
        { status: 409 },
      )
    }

    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId: actor.user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent,
        deviceName: resolvedDeviceName,
        surface,
        subscribedEvents: validEvents,
      },
      update: {
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent,
        deviceName: resolvedDeviceName,
        surface,
        subscribedEvents: validEvents,
        lastUsedAt: new Date(),
      },
    })

    return NextResponse.json({
      success: true,
      subscriptionId: subscription.id,
      deviceName: subscription.deviceName,
      surface: subscription.surface,
    })
  } catch (error) {
    logError('[API] Failed to create push subscription:', error)
    return NextResponse.json(
      { error: webPushMessages.failedToSubscribe || 'Failed to subscribe' },
      { status: 500 }
    )
  }
}

// PATCH /api/push/subscribe - Update subscription settings
export async function PATCH(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const webPushMessages = messages?.settings?.webPush || {}

  const actor = await requirePushActor(request)
  if (actor instanceof Response) {
    return actor
  }

  const rateLimitResult = await rateLimit(
    request,
    { windowMs: 60 * 60 * 1000, maxRequests: 60, message: webPushMessages.tooManySubscriptionUpdates || 'Too many updates. Please wait.' },
    'push-update',
    actor.user.id
  )
  if (rateLimitResult) return rateLimitResult

  try {
    const body = await request.json()
    const { subscriptionId, deviceName, subscribedEvents } = body

    if (!subscriptionId) {
      return NextResponse.json(
        { error: webPushMessages.missingSubscriptionId || 'Missing subscriptionId' },
        { status: 400 }
      )
    }

    const existing = await prisma.pushSubscription.findFirst({
      where: {
        id: subscriptionId,
        userId: actor.user.id,
      },
      select: { id: true, surface: true },
    })

    if (!existing) {
      return NextResponse.json(
        { error: webPushMessages.subscriptionNotFound || 'Subscription not found' },
        { status: 404 }
      )
    }

    if (existing.surface === 'support' && !actor.isPlatformAdmin) {
      return NextResponse.json(
        { error: 'Only platform administrators can manage the support push surface.', code: 'SUPPORT_SURFACE_FORBIDDEN' },
        { status: 403 },
      )
    }

    const updateData: { deviceName?: string; subscribedEvents?: string[] } = {}

    if (deviceName !== undefined) {
      updateData.deviceName = deviceName
    }

    if (subscribedEvents !== undefined) {
      updateData.subscribedEvents = eventsForPushActor(normalizeSurface(existing.surface), subscribedEvents, actor)
    }

    const subscription = await prisma.pushSubscription.update({
      where: { id: subscriptionId },
      data: updateData,
    })

    return NextResponse.json({
      success: true,
      subscription: {
        id: subscription.id,
        deviceName: subscription.deviceName,
        surface: subscription.surface,
        subscribedEvents: subscription.subscribedEvents,
      },
    })
  } catch (error) {
    logError('[API] Failed to update push subscription:', error)
    return NextResponse.json(
      { error: webPushMessages.failedToUpdateSub || 'Failed to update subscription' },
      { status: 500 }
    )
  }
}

/** Extract a friendly device name from user agent */
function getDeviceNameFromUserAgent(userAgent?: string): string {
  if (!userAgent) return 'Unknown Device'

  if (userAgent.includes('iPhone')) return 'iPhone'
  if (userAgent.includes('iPad')) return 'iPad'
  if (userAgent.includes('Android')) {
    const match = userAgent.match(/Android[^;]*;\s*([^)]+)/i)
    if (match && match[1]) {
      const model = match[1].trim().split(' Build')[0]
      return model.length > 30 ? 'Android Device' : model
    }
    return 'Android Device'
  }
  if (userAgent.includes('Mac OS')) return 'Mac'
  if (userAgent.includes('Windows')) return 'Windows PC'
  if (userAgent.includes('Linux')) return 'Linux'
  if (userAgent.includes('Chrome')) return 'Chrome Browser'
  if (userAgent.includes('Firefox')) return 'Firefox Browser'
  if (userAgent.includes('Safari')) return 'Safari Browser'

  return 'Browser'
}
