import { prisma } from '@/lib/db'
import { sendPushNotifications } from '@/lib/push-notifications'
import { sendMessageCard } from '@/lib/feishu'
import { sendEmail } from '@/lib/email'
import { getSupportSettings, isSupportOnline } from '@/lib/support/settings'
import { logError } from '@/lib/logging'

function isQuietTime(quietHours: { enabled: boolean; start: string; end: string; timezone: string }, now = new Date()) {
  if (!quietHours.enabled) return false
  return isSupportOnline(
    { timezone: quietHours.timezone, weekdays: [0, 1, 2, 3, 4, 5, 6], start: quietHours.start, end: quietHours.end },
    now,
  )
}

/**
 * Web Push is best-effort: the message is already committed and visible in the
 * inbox/SSE. A failed push must never fail the send path.
 */
export async function notifySupportMessage(input: {
  conversationId: string
  messageId: string
}) {
  const existing = await prisma.supportNotification.findUnique({
    where: {
      messageId_channel_recipientKey: {
        messageId: input.messageId,
        channel: 'WEB_PUSH',
        recipientKey: 'admin-fanout',
      },
    },
  })
  if (existing?.status === 'SENT') return
  const record = existing
    ? await prisma.supportNotification.update({ where: { id: existing.id }, data: { status: 'PENDING', lastError: null } })
    : await prisma.supportNotification.create({
        data: {
          messageId: input.messageId,
          channel: 'WEB_PUSH',
          recipientKey: 'admin-fanout',
          status: 'PENDING',
        },
      })

  try {
    const settings = await getSupportSettings()
    if (isQuietTime(settings.quietHours)) {
      await prisma.supportNotification.update({
        where: { id: record.id },
        data: { status: 'SKIPPED_DND', sentAt: null, lastError: 'quiet hours' },
      })
      return
    }

    const result = await Promise.race([
      sendPushNotifications('SUPPORT_NEW_MESSAGE', {
        title: '新客服消息',
        body: '访客发来一条新消息',
        tag: `support-${input.conversationId}`,
        data: {
          type: 'SUPPORT_NEW_MESSAGE',
          conversationId: input.conversationId,
          url: `/platform/support/${input.conversationId}`,
        },
      }),
      new Promise<{ sent: number; failed: number; timeout: true }>((resolve) => {
        setTimeout(() => resolve({ sent: 0, failed: 1, timeout: true }), 8_000)
      }),
    ])

    const pushOk = result.sent > 0
    await prisma.supportNotification.update({
      where: { id: record.id },
      data: {
        status: pushOk ? 'SENT' : result.failed > 0 ? 'FAILED' : 'SKIPPED',
        attempts: { increment: 1 },
        sentAt: pushOk ? new Date() : null,
        lastError: pushOk ? null : result.failed > 0 ? ('timeout' in result ? 'push timeout' : 'push failed') : 'no subscribed device',
      },
    })

    if (!pushOk) {
      await sendSupportFallbacks(input)
    }
  } catch (error) {
    logError('[SUPPORT] push notification failed:', error)
    await prisma.supportNotification.update({
      where: { id: record.id },
      data: { status: 'FAILED', attempts: { increment: 1 }, lastError: error instanceof Error ? error.message.slice(0, 500) : 'unknown' },
    }).catch(() => {})
    await sendSupportFallbacks(input).catch(() => {})
  }
}

async function logFallback(messageId: string, channel: string, recipientKey: string, ok: boolean, error?: string) {
  await prisma.supportNotification.upsert({
    where: { messageId_channel_recipientKey: { messageId, channel, recipientKey } },
    create: {
      messageId,
      channel,
      recipientKey,
      status: ok ? 'SENT' : 'FAILED',
      attempts: 1,
      sentAt: ok ? new Date() : null,
      lastError: ok ? null : (error || 'fallback failed').slice(0, 500),
    },
    update: {
      status: ok ? 'SENT' : 'FAILED',
      attempts: { increment: 1 },
      sentAt: ok ? new Date() : null,
      lastError: ok ? null : (error || 'fallback failed').slice(0, 500),
    },
  })
}

async function sendSupportFallbacks(input: { conversationId: string; messageId: string }): Promise<void> {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://vidx.cn').replace(/\/$/, '')
  const url = `${baseUrl}/platform/support/${input.conversationId}`
  const admins = await prisma.user.findMany({
    where: { isPlatformAdmin: true },
    select: { id: true, email: true },
  })
  if (admins.length === 0) return
  const adminIds = admins.map((admin) => admin.id)
  const bindings = await prisma.feishuBinding.findMany({
    where: { userId: { in: adminIds } },
    select: { userId: true, openId: true },
  })

  let feishuSent = 0
  await Promise.all(bindings.map(async (binding) => {
    try {
      await sendMessageCard(binding.openId, {
        title: '新客服消息',
        content: '访客发来一条新客服消息。请打开运营后台处理。',
        buttons: [{ text: '打开客服收件箱', url, type: 'primary' }],
      })
      feishuSent += 1
      await logFallback(input.messageId, 'FEISHU', binding.openId, true)
    } catch (error) {
      await logFallback(input.messageId, 'FEISHU', binding.openId, false, error instanceof Error ? error.message : 'feishu failed')
    }
  }))
  if (feishuSent > 0) return

  const emails = admins.map((admin) => admin.email).filter((email): email is string => Boolean(email))
  await Promise.all(emails.map(async (email) => {
    try {
      const result = await sendEmail({
        to: email,
        subject: '新客服消息',
        html: `<p>访客发来一条新客服消息。</p><p><a href="${url}">打开客服收件箱</a></p>`,
        text: `访客发来一条新客服消息：${url}`,
      })
      await logFallback(input.messageId, 'EMAIL', email, result.success, result.success ? undefined : result.error)
    } catch (error) {
      await logFallback(input.messageId, 'EMAIL', email, false, error instanceof Error ? error.message : 'email failed')
    }
  }))
}
