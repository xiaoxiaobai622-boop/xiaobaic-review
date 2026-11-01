import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { noStoreJson, supportErrorResponse } from '@/lib/support/http'
import { getSupportSettings } from '@/lib/support/settings'
import { publishSupportEvent } from '@/lib/support/pubsub'
import { SUPPORT_INBOX_CHANNEL, supportConversationChannel } from '@/lib/support/constants'
import {
  findAgentConversation,
  listAgentMessages,
  toSupportConversationView,
} from '@/lib/support/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = new Set(['OPEN', 'PENDING', 'CLOSED'])
const PRIORITIES = new Set(['LOW', 'NORMAL', 'HIGH'])

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePlatformAuth(request)
  if (auth instanceof Response) return auth
  try {
    const { id } = await params
    const conversation = await findAgentConversation(id)
    if (!conversation) return noStoreJson({ error: '会话不存在' }, { status: 404 })

    const afterSeq = request.nextUrl.searchParams.get('afterSeq')
    const messages = await listAgentMessages(id, afterSeq ? Number(afterSeq) : null, 100)

    await prisma.supportEvent.create({
      data: {
        conversationId: id,
        actorType: 'AGENT',
        actorId: auth.id,
        type: 'AGENT_VIEWED',
      },
    }).catch(() => {})

    return noStoreJson({
      conversation: toSupportConversationView(conversation, 'agent'),
      messages: messages.messages,
      hasMore: messages.hasMore,
    })
  } catch (error) {
    return supportErrorResponse(error)
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePlatformAuth(request)
  if (auth instanceof Response) return auth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '操作过于频繁，请稍后再试',
  }, 'platform-support-update', auth.id)
  if (limited) return limited

  try {
    const { id } = await params
    const conversation = await findAgentConversation(id)
    if (!conversation) return noStoreJson({ error: '会话不存在' }, { status: 404 })

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const data: Record<string, unknown> = {}
    const events: string[] = []

    if (typeof body.status === 'string' && STATUSES.has(body.status)) {
      const nextStatus = body.status as 'OPEN' | 'PENDING' | 'CLOSED'
      if (nextStatus !== conversation.status) {
        data.status = nextStatus
        if (nextStatus === 'CLOSED') {
          const settings = await getSupportSettings()
          const now = new Date()
          data.closedAt = now
          data.closedByType = 'AGENT'
          data.closedById = auth.id
          data.retentionUntil = new Date(now.getTime() + settings.retentionDays * 24 * 60 * 60 * 1000)
        } else {
          data.closedAt = null
          data.closedByType = null
          data.closedById = null
          data.retentionUntil = null
          if (conversation.status === 'CLOSED') data.reopenCount = { increment: 1 }
        }
        events.push('STATUS_CHANGED')
      }
    }

    if (Array.isArray(body.tags)) {
      data.tags = [...new Set(body.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean))].slice(0, 10)
      events.push('TAGS_CHANGED')
    }
    if (body.priority === null || (typeof body.priority === 'string' && PRIORITIES.has(body.priority))) {
      data.priority = body.priority
      events.push('PRIORITY_CHANGED')
    }
    if (body.assigneeId === null || typeof body.assigneeId === 'string') {
      data.assigneeId = body.assigneeId
      events.push('ASSIGNEE_CHANGED')
    }

    if (Object.keys(data).length === 0) {
      return noStoreJson({ conversation: toSupportConversationView(conversation, 'agent') })
    }

    await prisma.$transaction(async (tx) => {
      await tx.supportConversation.update({ where: { id }, data })
      for (const type of events) {
        await tx.supportEvent.create({
          data: {
            conversationId: id,
            actorType: 'AGENT',
            actorId: auth.id,
            type,
            metadata: {
              status: typeof body.status === 'string' ? body.status : undefined,
              tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
              priority: typeof body.priority === 'string' ? body.priority : null,
              assigneeId: typeof body.assigneeId === 'string' ? body.assigneeId : null,
            } as Prisma.InputJsonValue,
          },
        })
      }
    })

    const updated = await findAgentConversation(id)
    const event = { type: 'conversation.updated', conversationId: id, status: updated?.status, unreadForAgent: updated?.unreadForAgent }
    await Promise.all([
      publishSupportEvent(supportConversationChannel(id), event),
      publishSupportEvent(SUPPORT_INBOX_CHANNEL, event),
    ])

    return noStoreJson({ conversation: updated ? toSupportConversationView(updated, 'agent') : null })
  } catch (error) {
    return supportErrorResponse(error)
  }
}
