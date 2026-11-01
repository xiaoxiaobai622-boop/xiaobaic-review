import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { noStoreJson, supportErrorResponse } from '@/lib/support/http'
import { createAgentMessage, findAgentConversation, toSupportConversationView } from '@/lib/support/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePlatformAuth(request)
  if (auth instanceof Response) return auth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '发送过于频繁，请稍后再试',
  }, 'platform-support-reply', auth.id)
  if (limited) return limited

  try {
    const { id } = await params
    const conversation = await findAgentConversation(id)
    if (!conversation) return noStoreJson({ error: '会话不存在' }, { status: 404 })

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const result = await createAgentMessage({
      conversationId: id,
      agentId: auth.id,
      body: body.body,
      clientId: body.clientId,
      visibility: body.visibility === 'INTERNAL' ? 'INTERNAL' : 'PUBLIC',
    })
    if (!result.message) return NextResponse.json({ error: '消息发送失败' }, { status: 500 })

    return noStoreJson({
      message: result.message,
      conversation: toSupportConversationView(result.conversation, 'agent'),
    })
  } catch (error) {
    return supportErrorResponse(error)
  }
}
