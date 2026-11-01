import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { isSameOriginSupportRequest, resolveSupportVisitor } from '@/lib/support/session'
import { findVisitorConversation, setSupportTyping } from '@/lib/support/service'
import { noStoreJson, supportErrorResponse } from '@/lib/support/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginSupportRequest(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const { id } = await params
    const { visitor } = await resolveSupportVisitor(request)
    const limited = await rateLimit(request, {
      windowMs: 60 * 1000,
      maxRequests: 60,
      message: '请求过于频繁',
    }, 'support-typing', visitor.id)
    if (limited) return limited
    const conversation = await findVisitorConversation(id, visitor.id)
    if (!conversation) return noStoreJson({ error: '会话不存在' }, { status: 404 })
    await setSupportTyping({ conversationId: id, senderType: 'VISITOR', senderId: visitor.id })
    return noStoreJson({ ok: true })
  } catch (error) {
    return supportErrorResponse(error)
  }
}
