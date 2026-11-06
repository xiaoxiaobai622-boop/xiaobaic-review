import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { findActiveVisitorConversation, visitorPrincipal } from './service'

type MiniUser = { id: string; name?: string | null; email?: string | null }

// 小程序没有浏览器 cookie，按登录用户找/建一个绑定 userId 的访客记录，
// 会话与消息仍走网页端同一套 SupportVisitor / SupportConversation 数据。
export async function resolveMiniVisitor(user: MiniUser) {
  const existing = await prisma.supportVisitor.findFirst({
    where: { userId: user.id, deletedAt: null },
    orderBy: { lastSeenAt: 'desc' },
  })

  if (existing) {
    return prisma.supportVisitor.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date() },
    })
  }

  return prisma.supportVisitor.create({
    data: {
      sessionHash: crypto.randomBytes(32).toString('base64url'),
      userId: user.id,
      name: user.name ?? null,
      email: user.email ?? null,
      locale: 'zh',
    },
  })
}

export async function ensureMiniConversation(visitorId: string, userId: string) {
  const existing = await findActiveVisitorConversation(visitorId)
  if (existing) return existing

  const created = await prisma.$transaction(async (tx) => {
    const conversation = await tx.supportConversation.create({
      data: {
        visitorId,
        userId,
        source: 'WEB',
        pagePath: '/wechat-mini/support',
        locale: 'zh',
      },
    })
    await tx.supportParticipant.create({
      data: {
        conversationId: conversation.id,
        principalKey: visitorPrincipal(visitorId),
        role: 'VISITOR',
        visitorId,
      },
    })
    await tx.supportEvent.create({
      data: {
        conversationId: conversation.id,
        actorType: 'VISITOR',
        actorId: visitorId,
        type: 'CONVERSATION_CREATED',
        metadata: { source: 'WECHAT_MINI', pagePath: '/wechat-mini/support' },
      },
    })
    return conversation
  })

  return prisma.supportConversation.findUnique({
    where: { id: created.id },
    include: { visitor: true },
  })
}
