import type { SupportConversation, SupportMessage, SupportVisitor } from '@prisma/client'
import { prisma } from '@/lib/db'
import { logError } from '@/lib/logging'
import {
  SUPPORT_INBOX_CHANNEL,
  SUPPORT_MESSAGE_MAX_LENGTH,
  SUPPORT_PREVIEW_MAX_LENGTH,
  supportConversationChannel,
} from './constants'
import { publishSupportEvent } from './pubsub'
import { notifySupportMessage } from './notify'

export class SupportError extends Error {
  status: number
  code: string

  constructor(message: string, status = 400, code = 'SUPPORT_ERROR') {
    super(message)
    this.name = 'SupportError'
    this.status = status
    this.code = code
  }
}

export type SupportMessageView = {
  id: string
  seq: number
  senderType: string
  body: string
  visibility?: string
  kind: string
  createdAt: string
  clientId: string | null
}

export type SupportConversationView = {
  id: string
  publicId: string
  status: string
  lastMessageAt: string
  lastMessagePreview: string | null
  unreadForVisitor: number
  unreadForAgent?: number
  createdAt: string
  closedAt: string | null
  csatScore: number | null
  csatAt: string | null
  visitor?: {
    id: string
    name: string | null
    email: string | null
    userId: string | null
    locale: string
    lastSeenAt: string
  }
  userId?: string | null
  teamId?: string | null
  projectId?: string | null
  source?: string
  pagePath?: string | null
  locale?: string
  tags?: string[]
  firstVisitorMessageAt?: string | null
  firstAgentReplyAt?: string | null
  reopenCount?: number
  assigneeId?: string | null
}

export function visitorPrincipal(visitorId: string) {
  return `visitor:${visitorId}`
}

export function agentPrincipal(agentId: string) {
  return `agent:${agentId}`
}

export function toSupportMessageView(message: SupportMessage, includeInternal: boolean): SupportMessageView | null {
  if (message.deletedAt) return null
  if (message.visibility === 'INTERNAL' && !includeInternal) return null
  return {
    id: message.id,
    seq: message.seq,
    senderType: message.senderType,
    body: message.body,
    ...(includeInternal ? { visibility: message.visibility } : {}),
    kind: message.kind,
    createdAt: message.createdAt.toISOString(),
    clientId: message.clientId,
  }
}

export function toSupportConversationView(
  conversation: SupportConversation & { visitor?: SupportVisitor | null },
  audience: 'visitor' | 'agent',
): SupportConversationView {
  const base: SupportConversationView = {
    id: conversation.id,
    publicId: conversation.publicId,
    status: conversation.status,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    lastMessagePreview: conversation.lastMessagePreview,
    unreadForVisitor: conversation.unreadForVisitor,
    createdAt: conversation.createdAt.toISOString(),
    closedAt: conversation.closedAt?.toISOString() ?? null,
    csatScore: conversation.csatScore,
    csatAt: conversation.csatAt?.toISOString() ?? null,
  }

  if (audience === 'visitor') return base

  return {
    ...base,
    unreadForAgent: conversation.unreadForAgent,
    visitor: conversation.visitor
      ? {
          id: conversation.visitor.id,
          name: conversation.visitor.name,
          email: conversation.visitor.email,
          userId: conversation.visitor.userId,
          locale: conversation.visitor.locale,
          lastSeenAt: conversation.visitor.lastSeenAt.toISOString(),
        }
      : undefined,
    userId: conversation.userId,
    teamId: conversation.teamId,
    projectId: conversation.projectId,
    source: conversation.source,
    pagePath: conversation.pagePath,
    locale: conversation.locale,
    tags: conversation.tags,
    firstVisitorMessageAt: conversation.firstVisitorMessageAt?.toISOString() ?? null,
    firstAgentReplyAt: conversation.firstAgentReplyAt?.toISOString() ?? null,
    reopenCount: conversation.reopenCount,
    assigneeId: conversation.assigneeId,
  }
}

function previewOf(body: string) {
  return body.length > SUPPORT_PREVIEW_MAX_LENGTH
    ? `${body.slice(0, SUPPORT_PREVIEW_MAX_LENGTH - 1)}…`
    : body
}

function cleanBody(value: unknown) {
  const body = typeof value === 'string' ? value.trim() : ''
  if (!body) throw new SupportError('消息不能为空', 400, 'EMPTY_MESSAGE')
  if (body.length > SUPPORT_MESSAGE_MAX_LENGTH) {
    throw new SupportError(`消息不能超过 ${SUPPORT_MESSAGE_MAX_LENGTH} 字`, 400, 'MESSAGE_TOO_LONG')
  }
  return body
}

function cleanClientId(value: unknown) {
  const clientId = typeof value === 'string' ? value.trim() : ''
  if (!clientId || clientId.length > 120) {
    throw new SupportError('缺少消息标识，请重试', 400, 'INVALID_CLIENT_ID')
  }
  return clientId
}

export async function findVisitorConversation(conversationId: string, visitorId: string) {
  return prisma.supportConversation.findFirst({
    where: { id: conversationId, visitorId, deletedAt: null },
    include: { visitor: true },
  })
}

export async function findActiveVisitorConversation(visitorId: string) {
  return prisma.supportConversation.findFirst({
    where: {
      visitorId,
      deletedAt: null,
      status: { in: ['OPEN', 'PENDING'] },
    },
    orderBy: { lastMessageAt: 'desc' },
    include: { visitor: true },
  })
}

export async function findAgentConversation(conversationId: string) {
  return prisma.supportConversation.findFirst({
    where: { id: conversationId, deletedAt: null },
    include: { visitor: true },
  })
}

export async function listVisitorMessages(conversationId: string, afterSeq: number | null, limit = 100) {
  const take = Math.min(Math.max(limit, 1), 100)
  if (afterSeq && afterSeq > 0) {
    const rows = await prisma.supportMessage.findMany({
      where: { conversationId, visibility: 'PUBLIC', deletedAt: null, seq: { gt: afterSeq } },
      orderBy: { seq: 'asc' },
      take,
    })
    return { messages: rows.map((row) => toSupportMessageView(row, false)).filter(Boolean), hasMore: rows.length === take }
  }

  const rows = await prisma.supportMessage.findMany({
    where: { conversationId, visibility: 'PUBLIC', deletedAt: null },
    orderBy: { seq: 'desc' },
    take,
  })
  return {
    messages: rows.reverse().map((row) => toSupportMessageView(row, false)).filter(Boolean),
    hasMore: rows.length === take,
  }
}

export async function listAgentMessages(conversationId: string, afterSeq: number | null, limit = 100) {
  const take = Math.min(Math.max(limit, 1), 100)
  if (afterSeq && afterSeq > 0) {
    const rows = await prisma.supportMessage.findMany({
      where: { conversationId, deletedAt: null, seq: { gt: afterSeq } },
      orderBy: { seq: 'asc' },
      take,
    })
    return { messages: rows.map((row) => toSupportMessageView(row, true)).filter(Boolean), hasMore: rows.length === take }
  }

  const rows = await prisma.supportMessage.findMany({
    where: { conversationId, deletedAt: null },
    orderBy: { seq: 'desc' },
    take,
  })
  return {
    messages: rows.reverse().map((row) => toSupportMessageView(row, true)).filter(Boolean),
    hasMore: rows.length === take,
  }
}

type CreateVisitorMessageInput = {
  conversationId: string
  visitorId: string
  body: unknown
  clientId: unknown
}

export async function createVisitorMessage(input: CreateVisitorMessageInput) {
  const body = cleanBody(input.body)
  const clientId = cleanClientId(input.clientId)

  const existing = await prisma.supportMessage.findUnique({
    where: { conversationId_clientId: { conversationId: input.conversationId, clientId } },
  })
  if (existing) {
    const conversation = await findVisitorConversation(input.conversationId, input.visitorId)
    if (!conversation) throw new SupportError('会话不存在', 404, 'NOT_FOUND')
    return { message: toSupportMessageView(existing, false), conversation, created: false }
  }

  let createdMessage: SupportMessage
  try {
    const result = await prisma.$transaction(async (tx) => {
      const conversation = await tx.supportConversation.findFirst({
        where: { id: input.conversationId, visitorId: input.visitorId, deletedAt: null },
        select: {
          id: true,
          status: true,
          firstVisitorMessageAt: true,
        },
      })
      if (!conversation) throw new SupportError('会话不存在', 404, 'NOT_FOUND')

      const now = new Date()
      const wasClosed = conversation.status === 'CLOSED'
      const updated = await tx.supportConversation.update({
        where: { id: conversation.id },
        data: {
          lastSeq: { increment: 1 },
          lastMessageAt: now,
          lastMessagePreview: previewOf(body),
          lastMessageSenderType: 'VISITOR',
          unreadForAgent: { increment: 1 },
          unreadForVisitor: 0,
          firstVisitorMessageAt: conversation.firstVisitorMessageAt ?? now,
          status: 'OPEN',
          closedAt: null,
          closedByType: null,
          closedById: null,
          retentionUntil: null,
          ...(wasClosed ? { reopenCount: { increment: 1 } } : {}),
        },
        select: { lastSeq: true },
      })

      const message = await tx.supportMessage.create({
        data: {
          conversationId: conversation.id,
          seq: updated.lastSeq,
          senderType: 'VISITOR',
          senderId: input.visitorId,
          clientId,
          body,
          visibility: 'PUBLIC',
          kind: 'TEXT',
        },
      })

      await tx.supportParticipant.upsert({
        where: {
          conversationId_principalKey: {
            conversationId: conversation.id,
            principalKey: visitorPrincipal(input.visitorId),
          },
        },
        create: {
          conversationId: conversation.id,
          principalKey: visitorPrincipal(input.visitorId),
          role: 'VISITOR',
          visitorId: input.visitorId,
          lastReadSeq: updated.lastSeq,
          lastDeliveredSeq: updated.lastSeq,
        },
        update: {
          lastReadSeq: updated.lastSeq,
          lastDeliveredSeq: updated.lastSeq,
          lastTypingAt: null,
        },
      })

      await tx.supportEvent.create({
        data: {
          conversationId: conversation.id,
          actorType: 'VISITOR',
          actorId: input.visitorId,
          type: wasClosed ? 'CONVERSATION_REOPENED' : 'VISITOR_REPLIED',
          metadata: { seq: updated.lastSeq },
        },
      })

      return { message, wasClosed }
    })

    createdMessage = result.message
    const conversation = await findVisitorConversation(input.conversationId, input.visitorId)
    if (!conversation) throw new SupportError('会话不存在', 404, 'NOT_FOUND')
    const view = toSupportMessageView(createdMessage, false)
    if (view) {
      const event = { type: 'message.created', conversationId: input.conversationId, message: view }
      await Promise.all([
        publishSupportEvent(supportConversationChannel(input.conversationId), event),
        publishSupportEvent(SUPPORT_INBOX_CHANNEL, event),
      ])
      void notifySupportMessage({ conversationId: input.conversationId, messageId: createdMessage.id })
    }
    return { message: view, conversation, created: true, reopened: result.wasClosed }
  } catch (error) {
    if (error instanceof SupportError) throw error
    // A retry that raced the unique (conversationId, clientId) constraint should
    // return the stored row rather than a 500.
    const stored = await prisma.supportMessage.findUnique({
      where: { conversationId_clientId: { conversationId: input.conversationId, clientId } },
    }).catch(() => null)
    if (stored) {
      const conversation = await findVisitorConversation(input.conversationId, input.visitorId)
      if (conversation) return { message: toSupportMessageView(stored, false), conversation, created: false }
    }
    logError('[SUPPORT] createVisitorMessage failed:', error)
    throw new SupportError('消息发送失败', 500, 'SEND_FAILED')
  }
}

type CreateAgentMessageInput = {
  conversationId: string
  agentId: string
  body: unknown
  clientId: unknown
  visibility?: 'PUBLIC' | 'INTERNAL'
}

export async function createAgentMessage(input: CreateAgentMessageInput) {
  const body = cleanBody(input.body)
  const clientId = cleanClientId(input.clientId)
  const visibility = input.visibility === 'INTERNAL' ? 'INTERNAL' : 'PUBLIC'

  const existing = await prisma.supportMessage.findUnique({
    where: { conversationId_clientId: { conversationId: input.conversationId, clientId } },
  })
  if (existing) {
    const conversation = await findAgentConversation(input.conversationId)
    if (!conversation) throw new SupportError('会话不存在', 404, 'NOT_FOUND')
    return { message: toSupportMessageView(existing, true), conversation, created: false }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const conversation = await tx.supportConversation.findFirst({
        where: { id: input.conversationId, deletedAt: null },
        select: { id: true, status: true, firstAgentReplyAt: true },
      })
      if (!conversation) throw new SupportError('会话不存在', 404, 'NOT_FOUND')

      const now = new Date()
      const updated = await tx.supportConversation.update({
        where: { id: conversation.id },
        data: {
          lastSeq: { increment: 1 },
          ...(visibility === 'PUBLIC'
            ? {
                lastMessageAt: now,
                lastMessagePreview: previewOf(body),
                lastMessageSenderType: 'AGENT' as const,
                unreadForVisitor: { increment: 1 },
                unreadForAgent: 0,
                firstAgentReplyAt: conversation.firstAgentReplyAt ?? now,
                ...(conversation.status === 'CLOSED'
                  ? { status: 'OPEN' as const, closedAt: null, closedByType: null, closedById: null, retentionUntil: null }
                  : {}),
              }
            : { unreadForAgent: 0 }),
        },
        select: { lastSeq: true },
      })

      const message = await tx.supportMessage.create({
        data: {
          conversationId: conversation.id,
          seq: updated.lastSeq,
          senderType: 'AGENT',
          senderId: input.agentId,
          clientId,
          body,
          visibility,
          kind: 'TEXT',
        },
      })

      await tx.supportParticipant.upsert({
        where: {
          conversationId_principalKey: {
            conversationId: conversation.id,
            principalKey: agentPrincipal(input.agentId),
          },
        },
        create: {
          conversationId: conversation.id,
          principalKey: agentPrincipal(input.agentId),
          role: 'AGENT',
          userId: input.agentId,
          lastReadSeq: updated.lastSeq,
          lastDeliveredSeq: updated.lastSeq,
        },
        update: {
          lastReadSeq: updated.lastSeq,
          lastDeliveredSeq: updated.lastSeq,
          lastTypingAt: null,
        },
      })

      await tx.supportEvent.create({
        data: {
          conversationId: conversation.id,
          actorType: 'AGENT',
          actorId: input.agentId,
          type: visibility === 'INTERNAL' ? 'INTERNAL_NOTE_ADDED' : 'AGENT_REPLIED',
          metadata: { seq: updated.lastSeq },
        },
      })

      return message
    })

    const conversation = await findAgentConversation(input.conversationId)
    if (!conversation) throw new SupportError('会话不存在', 404, 'NOT_FOUND')
    const view = toSupportMessageView(result, true)
    if (view) {
      const event = { type: 'message.created', conversationId: input.conversationId, message: view }
      await Promise.all([
        publishSupportEvent(supportConversationChannel(input.conversationId), event),
        publishSupportEvent(SUPPORT_INBOX_CHANNEL, event),
      ])
    }
    return { message: view, conversation, created: true }
  } catch (error) {
    if (error instanceof SupportError) throw error
    const stored = await prisma.supportMessage.findUnique({
      where: { conversationId_clientId: { conversationId: input.conversationId, clientId } },
    }).catch(() => null)
    if (stored) {
      const conversation = await findAgentConversation(input.conversationId)
      if (conversation) return { message: toSupportMessageView(stored, true), conversation, created: false }
    }
    logError('[SUPPORT] createAgentMessage failed:', error)
    throw new SupportError('消息发送失败', 500, 'SEND_FAILED')
  }
}

export async function markConversationRead(input: {
  conversationId: string
  readerType: 'VISITOR' | 'AGENT'
  readerId: string
  seq: number
}) {
  const seq = Math.max(0, Math.floor(input.seq))
  const conversation = await prisma.supportConversation.findFirst({
    where:
      input.readerType === 'VISITOR'
        ? { id: input.conversationId, visitorId: input.readerId, deletedAt: null }
        : { id: input.conversationId, deletedAt: null },
    select: { id: true, lastSeq: true },
  })
  if (!conversation) throw new SupportError('会话不存在', 404, 'NOT_FOUND')

  const readSeq = Math.min(seq, conversation.lastSeq)
  const principalKey = input.readerType === 'VISITOR' ? visitorPrincipal(input.readerId) : agentPrincipal(input.readerId)
  const role = input.readerType === 'VISITOR' ? 'VISITOR' : 'AGENT'

  await prisma.$transaction(async (tx) => {
    await tx.supportParticipant.upsert({
      where: { conversationId_principalKey: { conversationId: conversation.id, principalKey } },
      create: {
        conversationId: conversation.id,
        principalKey,
        role,
        ...(input.readerType === 'VISITOR' ? { visitorId: input.readerId } : { userId: input.readerId }),
        lastReadSeq: readSeq,
        lastDeliveredSeq: readSeq,
      },
      update: { lastReadSeq: readSeq, lastDeliveredSeq: readSeq },
    })
    await tx.supportConversation.update({
      where: { id: conversation.id },
      data: input.readerType === 'VISITOR' ? { unreadForVisitor: 0 } : { unreadForAgent: 0 },
    })
  })

  const event = {
    type: 'conversation.read',
    conversationId: conversation.id,
    readerType: input.readerType,
    seq: readSeq,
    ...(input.readerType === 'AGENT' ? { userId: input.readerId } : {}),
  }
  await Promise.all([
    publishSupportEvent(supportConversationChannel(conversation.id), event),
    publishSupportEvent(SUPPORT_INBOX_CHANNEL, {
      type: 'conversation.updated',
      conversationId: conversation.id,
      ...(input.readerType === 'AGENT' ? { unreadForAgent: 0 } : { unreadForVisitor: 0 }),
    }),
  ])

  return { seq: readSeq }
}

export async function setSupportTyping(input: {
  conversationId: string
  senderType: 'VISITOR' | 'AGENT'
  senderId: string
}) {
  const conversation = await prisma.supportConversation.findFirst({
    where:
      input.senderType === 'VISITOR'
        ? { id: input.conversationId, visitorId: input.senderId, deletedAt: null }
        : { id: input.conversationId, deletedAt: null },
    select: { id: true },
  })
  if (!conversation) throw new SupportError('会话不存在', 404, 'NOT_FOUND')
  await publishSupportEvent(supportConversationChannel(conversation.id), {
    type: 'typing',
    conversationId: conversation.id,
    senderType: input.senderType,
    ...(input.senderType === 'AGENT' ? { userId: input.senderId } : {}),
  })
}

export async function getSupportMessageAfter(conversationId: string, afterSeq: number, includeInternal: boolean) {
  const rows = await prisma.supportMessage.findMany({
    where: {
      conversationId,
      seq: { gt: afterSeq },
      deletedAt: null,
      ...(includeInternal ? {} : { visibility: 'PUBLIC' as const }),
    },
    orderBy: { seq: 'asc' },
    take: 100,
  })
  return rows.map((row) => toSupportMessageView(row, includeInternal)).filter(Boolean)
}
