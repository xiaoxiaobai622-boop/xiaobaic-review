import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { noStoreJson, supportErrorResponse } from '@/lib/support/http'
import { findAgentConversation } from '@/lib/support/service'
import { publishSupportEvent } from '@/lib/support/pubsub'
import { SUPPORT_INBOX_CHANNEL } from '@/lib/support/constants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePlatformAuth(request)
  if (auth instanceof Response) return auth
  try {
    const { id } = await params
    const conversation = await findAgentConversation(id)
    if (!conversation) return noStoreJson({ error: '会话不存在' }, { status: 404 })
    await prisma.$transaction(async (tx) => {
      await tx.supportConversation.update({ where: { id }, data: { unreadForAgent: Math.max(1, conversation.unreadForAgent) } })
      await tx.supportEvent.create({
        data: { conversationId: id, actorType: 'AGENT', actorId: auth.id, type: 'MARKED_UNREAD' },
      })
    })
    await publishSupportEvent(SUPPORT_INBOX_CHANNEL, {
      type: 'conversation.updated',
      conversationId: id,
      unreadForAgent: 1,
    })
    return noStoreJson({ ok: true })
  } catch (error) {
    return supportErrorResponse(error)
  }
}
