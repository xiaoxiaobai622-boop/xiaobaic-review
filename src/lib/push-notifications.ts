import webpush from 'web-push'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encryption'
import type { NotificationEventType } from '@/lib/external-notifications/constants'
import { loadLocaleMessages } from '@/i18n/locale'
import { logError, logMessage } from '@/lib/logging'

async function getPushLocaleText() {
  const settings = await prisma.settings.findUnique({
    where: { id: 'default' },
    select: { language: true },
  })

  const locale = settings?.language || 'en'
  const messages = await loadLocaleMessages(locale).catch(() => null)

  return {
    auth: messages?.auth || {},
    webPush: messages?.push?.webPush || {},
    notificationsText: messages?.notificationsText || {},
  }
}

/**
 * Get VAPID subject from app domain or fallback
 */
async function getVapidSubject(): Promise<string> {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: 'default' },
      select: { appDomain: true },
    })

    if (settings?.appDomain) {
      const domain = settings.appDomain.startsWith('http')
        ? settings.appDomain
        : `https://${settings.appDomain}`
      return domain
    }
  } catch {
  }

  // VAPID subject is just an identifier for push services
  return 'mailto:push@localhost'
}

interface VapidKeys {
  publicKey: string
  privateKey: string
}

/**
 * Generate new VAPID keys
 */
function generateVapidKeys(): VapidKeys {
  const keys = webpush.generateVAPIDKeys()
  return {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
  }
}

/**
 * Get or create VAPID keys (auto-generate on first use)
 * Keys are stored encrypted in the database
 */
async function getOrCreateVapidKeys(): Promise<VapidKeys> {
  const settings = await prisma.settings.findUnique({
    where: { id: 'default' },
    select: { vapidPublicKey: true, vapidPrivateKey: true },
  })

  if (settings?.vapidPublicKey && settings?.vapidPrivateKey) {
    return {
      publicKey: settings.vapidPublicKey,
      privateKey: decrypt(settings.vapidPrivateKey),
    }
  }

  logMessage('[WEB-PUSH] Generating new VAPID keys...')
  const keys = generateVapidKeys()

  await prisma.settings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      vapidPublicKey: keys.publicKey,
      vapidPrivateKey: encrypt(keys.privateKey),
    },
    update: {
      vapidPublicKey: keys.publicKey,
      vapidPrivateKey: encrypt(keys.privateKey),
    },
  })

  logMessage('[WEB-PUSH] VAPID keys generated and stored')
  return keys
}

/**
 * Get the public VAPID key (for browser subscription)
 */
export async function getVapidPublicKey(): Promise<string> {
  const keys = await getOrCreateVapidKeys()
  return keys.publicKey
}

/**
 * Configure web-push with VAPID keys
 */
async function configureWebPush(): Promise<void> {
  const keys = await getOrCreateVapidKeys()
  const subject = await getVapidSubject()
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey)
}

export interface PushNotificationPayload {
  title: string
  body: string
  icon?: string
  badge?: string
  tag?: string
  data?: Record<string, unknown>
  actions?: Array<{ action: string; title: string; icon?: string }>
}

interface PushSubscriptionData {
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Send a push notification to a single subscription
 */
async function sendToSubscription(
  subscription: PushSubscriptionData,
  payload: PushNotificationPayload
): Promise<{ success: boolean; error?: string; statusCode?: number }> {
  try {
    await configureWebPush()

    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    }

    // Non-2xx pushes reject with a WebPushError, handled in the catch below.
    const response = await webpush.sendNotification(pushSubscription, JSON.stringify(payload))

    return { success: true, statusCode: response?.statusCode ?? 201 }
  } catch (error) {
    // Some push services return 201 which web-push might handle oddly
    if (error instanceof webpush.WebPushError) {
      if (error.statusCode === 201 || error.statusCode === 200) {
        return { success: true, statusCode: error.statusCode }
      }

      // 410 Gone or 404 Not Found = subscription expired
      if (error.statusCode === 410 || error.statusCode === 404) {
        await prisma.pushSubscription.delete({
          where: { endpoint: subscription.endpoint },
        }).catch(() => {
          // Ignore if already deleted
        })
        logMessage('[WEB-PUSH] Removed expired subscription:', subscription.endpoint.slice(0, 50))
        return { success: false, statusCode: error.statusCode, error: 'Subscription expired' }
      }

      logError('[WEB-PUSH] Push error:', error.statusCode, error.message)
      return { success: false, statusCode: error.statusCode, error: `Push service error: ${error.statusCode}` }
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logError('[WEB-PUSH] Send error:', errorMessage)
    return { success: false, error: errorMessage }
  }
}

export type PushAudience = 'support' | 'platform-admins' | 'team-admins' | 'legacy' | 'disabled'

export interface PushTarget {
  id: string
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  surface: string
  deviceName: string | null
}

export interface PushSubscriptionSelection {
  audience: PushAudience
  expectedSurface: 'main' | 'support'
  subscriptions: PushTarget[]
  projectId: string | null
  teamId: string | null
  reason: string | null
}

const PROJECT_PUSH_EVENTS = new Set<NotificationEventType>([
  'CLIENT_COMMENT',
  'CLIENT_UPLOAD',
  'VIDEO_APPROVAL',
  'DUE_DATE_REMINDER',
])

const PLATFORM_PUSH_EVENTS = new Set<NotificationEventType>([
  'SECURITY_ALERT',
])

// Login and share-access events are audit-only; they must not produce any message.
const AUDIT_ONLY_PUSH_EVENTS = new Set<NotificationEventType>([
  'ADMIN_ACCESS',
  'SHARE_ACCESS',
])

const PUSH_TARGET_SELECT = {
  id: true,
  userId: true,
  endpoint: true,
  p256dh: true,
  auth: true,
  surface: true,
  deviceName: true,
} as const

/**
 * Resolve who should receive a web push. Support messages stay on the support
 * surface; project events go to the project's team OWNER/ADMIN; security and
 * login events go to platform admins. Unknown future events keep the legacy
 * main-surface behavior.
 */
export async function selectPushSubscriptions(
  eventType: NotificationEventType,
  payload: PushNotificationPayload,
): Promise<PushSubscriptionSelection> {
  const data = payload.data ?? {}
  const projectId = typeof data.projectId === 'string' ? data.projectId : null

  if (AUDIT_ONLY_PUSH_EVENTS.has(eventType)) {
    return {
      audience: 'disabled',
      expectedSurface: 'main',
      subscriptions: [],
      projectId,
      teamId: null,
      reason: 'audit-only',
    }
  }

  if (eventType === 'SUPPORT_NEW_MESSAGE') {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { subscribedEvents: { has: eventType }, surface: 'support' },
      select: PUSH_TARGET_SELECT,
    })
    return {
      audience: 'support',
      expectedSurface: 'support',
      subscriptions,
      projectId: null,
      teamId: null,
      reason: subscriptions.length ? null : 'no-support-subscription',
    }
  }

  if (PLATFORM_PUSH_EVENTS.has(eventType)) {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: {
        subscribedEvents: { has: eventType },
        surface: 'main',
        user: { isPlatformAdmin: true },
      },
      select: PUSH_TARGET_SELECT,
    })
    return {
      audience: 'platform-admins',
      expectedSurface: 'main',
      subscriptions,
      projectId,
      teamId: null,
      reason: subscriptions.length ? null : 'no-platform-admin-subscription',
    }
  }

  if (PROJECT_PUSH_EVENTS.has(eventType)) {
    if (!projectId) {
      return {
        audience: 'team-admins',
        expectedSurface: 'main',
        subscriptions: [],
        projectId: null,
        teamId: null,
        reason: 'missing-project',
      }
    }
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { teamId: true } })
    if (!project) {
      return {
        audience: 'team-admins',
        expectedSurface: 'main',
        subscriptions: [],
        projectId,
        teamId: null,
        reason: 'project-not-found',
      }
    }
    const admins = await prisma.teamMember.findMany({
      where: { teamId: project.teamId, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
      select: { userId: true },
    })
    if (admins.length === 0) {
      return {
        audience: 'team-admins',
        expectedSurface: 'main',
        subscriptions: [],
        projectId,
        teamId: project.teamId,
        reason: 'no-team-admins',
      }
    }
    const subscriptions = await prisma.pushSubscription.findMany({
      where: {
        subscribedEvents: { has: eventType },
        surface: 'main',
        userId: { in: admins.map((admin) => admin.userId) },
      },
      select: PUSH_TARGET_SELECT,
    })
    return {
      audience: 'team-admins',
      expectedSurface: 'main',
      subscriptions,
      projectId,
      teamId: project.teamId,
      reason: subscriptions.length ? null : 'no-subscribed-team-admin',
    }
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { subscribedEvents: { has: eventType }, surface: 'main' },
    select: PUSH_TARGET_SELECT,
  })
  return {
    audience: 'legacy',
    expectedSurface: 'main',
    subscriptions,
    projectId,
    teamId: null,
    reason: subscriptions.length ? null : 'no-recipients',
  }
}

async function recordPushDelivery(input: {
  subscriptionId: string | null
  userId: string | null
  deviceName: string | null
  eventType: NotificationEventType
  surface: string
  projectId: string | null
  teamId: string | null
  success: boolean
  statusCode?: number
  error?: string
}) {
  await prisma.pushDeliveryLog.create({
    data: {
      subscriptionId: input.subscriptionId,
      userId: input.userId,
      deviceName: input.deviceName,
      eventType: input.eventType,
      surface: input.surface,
      projectId: input.projectId,
      teamId: input.teamId,
      success: input.success,
      statusCode: input.statusCode ?? null,
      error: input.error ?? null,
    },
  }).catch(() => {
    // Audit logging must never fail the send path.
  })
}

/**
 * Send push notifications through the routed audience for an event.
 */
export async function sendPushNotifications(
  eventType: NotificationEventType,
  payload: PushNotificationPayload
): Promise<{ sent: number; failed: number }> {
  try {
    const defaultIcon = '/brand/icon-192.svg'
    const defaultBadge = '/brand/icon-192.svg'
    const normalizedPayload = {
      ...payload,
      icon: payload.icon || defaultIcon,
      badge: payload.badge || defaultBadge,
    }

    const selection = await selectPushSubscriptions(eventType, normalizedPayload)

    if (selection.subscriptions.length === 0) {
      await recordPushDelivery({
        subscriptionId: null,
        userId: null,
        deviceName: null,
        eventType,
        surface: selection.expectedSurface,
        projectId: selection.projectId,
        teamId: selection.teamId,
        success: false,
        error: selection.reason || 'no recipients',
      })
      logMessage(`[WEB-PUSH] Event ${eventType}: no recipients (${selection.audience}:${selection.reason})`)
      return { sent: 0, failed: 0 }
    }

    let sent = 0
    let failed = 0

    const results = await Promise.allSettled(
      selection.subscriptions.map(async (sub) => {
        const result = await sendToSubscription(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          normalizedPayload
        )

        await recordPushDelivery({
          subscriptionId: sub.id,
          userId: sub.userId,
          deviceName: sub.deviceName,
          eventType,
          surface: sub.surface,
          projectId: selection.projectId,
          teamId: selection.teamId,
          success: result.success,
          statusCode: result.statusCode,
          error: result.error,
        })

        if (result.success) {
          // Update lastUsedAt
          await prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { lastUsedAt: new Date() },
          }).catch(() => {
            // Ignore update errors
          })
        }

        return result
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success) {
        sent++
      } else {
        failed++
      }
    }

    logMessage(`[WEB-PUSH] Event ${eventType} (${selection.audience}): sent=${sent}, failed=${failed}`)
    return { sent, failed }
  } catch (error) {
    logError('[WEB-PUSH] Failed to send notifications:', error)
    return { sent: 0, failed: 0 }
  }
}

/**
 * Send a test push notification to a specific subscription
 */
export async function sendTestNotification(
  subscriptionId: string
): Promise<{ success: boolean; error?: string }> {
  const { webPush } = await getPushLocaleText()

  const subscription = await prisma.pushSubscription.findUnique({
    where: { id: subscriptionId },
    select: { endpoint: true, p256dh: true, auth: true, deviceName: true },
  })

  if (!subscription) {
    return { success: false, error: webPush.subscriptionNotFound || 'Subscription not found' }
  }

  const payload: PushNotificationPayload = {
    title: webPush.testTitle || 'FrameReview Test',
    body: (webPush.testBodyForDevice || 'Test notification for {device}')
      .replace('{device}', subscription.deviceName || webPush.thisDevice || 'this device'),
    icon: '/brand/icon-192.svg',
    badge: '/brand/icon-192.svg',
    tag: 'test',
    data: { type: 'TEST' },
  }

  return sendToSubscription(subscription, payload)
}

/**
 * Map notification event types to user-friendly titles and create payloads
 */
export async function createNotificationPayload(
  eventType: NotificationEventType,
  data: {
    projectTitle?: string
    videoName?: string
    authorName?: string
    content?: string
    ip?: string
    email?: string
    title?: string
    body?: string
    notifyType?: string
  }
): Promise<PushNotificationPayload> {
  const { auth, webPush, notificationsText } = await getPushLocaleText()

  const basePayload = {
    icon: '/brand/icon-192.svg',
    badge: '/brand/icon-192.svg',
    tag: eventType,
    data: { type: eventType, ...data },
  }

  switch (eventType) {
    case 'ADMIN_ACCESS':
      return {
        ...basePayload,
        title: data.title || auth.adminLogin || 'Admin Login',
        body: data.body || `${data.email || auth.someoneLabel || 'Someone'} ${auth.loggedInShort || 'logged in'}`,
      }

    case 'SHARE_ACCESS':
      return {
        ...basePayload,
        title: data.title || notificationsText.shareLinkOpenedShortTitle || 'Share Link Opened',
        body: data.body || `${data.email || notificationsText.someone || auth.someoneLabel || 'Someone'} ${(notificationsText.openedProjectShort || 'opened {projectTitle}').replace('{projectTitle}', data.projectTitle || notificationsText.aProject || 'a project')}`,
      }

    case 'CLIENT_COMMENT':
      return {
        ...basePayload,
        title: webPush.newCommentTitle || 'New Comment',
        body: `${data.authorName || notificationsText.someone || auth.someoneLabel || 'Someone'} ${webPush.onLabel || 'on'} ${data.videoName || data.projectTitle || webPush.aVideo || 'a video'}${data.content ? `: "${data.content.slice(0, 50)}${data.content.length > 50 ? '...' : ''}"` : ''}`,
      }

    case 'VIDEO_APPROVAL':
      return {
        ...basePayload,
        title: webPush.videoApprovedTitle || 'Video Approved',
        body: `${data.authorName || webPush.aClient || 'A client'} ${webPush.approvedLabel || 'approved'} ${data.videoName || webPush.aVideo || 'a video'} ${webPush.inLabel || 'in'} ${data.projectTitle || webPush.aProject || 'a project'}`,
      }

    case 'SECURITY_ALERT':
      return {
        ...basePayload,
        title: data.title || auth.securityAlertTitle || 'Security Alert',
        body: data.body || webPush.securityEventOccurred || 'A security event occurred',
      }

    case 'CLIENT_UPLOAD':
      return {
        ...basePayload,
        title: webPush.clientUploadTitle || 'New Upload',
        body: `${data.authorName || notificationsText.someone || auth.someoneLabel || 'Someone'} ${webPush.uploadedFilesTo || 'uploaded files to'} ${data.projectTitle || webPush.aProject || 'a project'}`,
      }

    case 'DUE_DATE_REMINDER':
      return {
        ...basePayload,
        title: data.title || webPush.deadlineReminderTitle || 'Deadline Reminder',
        body: data.body || `${data.projectTitle || webPush.aProjectCapitalized || 'A project'} ${webPush.deadlineApproaching || 'deadline is approaching'}`,
      }

    default:
      return {
        ...basePayload,
        title: webPush.defaultNotificationTitle || 'FrameReview Notification',
        body: webPush.defaultNotificationBody || 'You have a new notification',
      }
  }
}
