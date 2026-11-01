import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { noStoreJson, supportErrorResponse } from '@/lib/support/http'
import { findAgentConversation, setSupportTyping } from '@/lib/support/service'

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
    maxRequests: 90,
    message: '请求过于频繁',
  }, 'platform-support-typing', auth.id)
  if (limited) return limited
  try {
    const { id } = await params
    const conversation = await findAgentConversation(id)
    if (!conversation) return noStoreJson({ error: '会话不存在' }, { status: 404 })
    await setSupportTyping({ conversationId: id, senderType: 'AGENT', senderId: auth.id })
    return noStoreJson({ ok: true })
  } catch (error) {
    return supportErrorResponse(error)
  }
}
