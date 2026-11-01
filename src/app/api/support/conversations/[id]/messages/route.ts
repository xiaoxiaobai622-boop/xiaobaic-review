import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { attachSupportCookie, isSameOriginSupportRequest, resolveSupportVisitor } from '@/lib/support/session'
import {
  createVisitorMessage,
  findVisitorConversation,
  listVisitorMessages,
  toSupportConversationView,
} from '@/lib/support/service'
import { noStoreJson, parseAfterSeq, supportErrorResponse } from '@/lib/support/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/support/conversations/[id]/messages?afterSeq= — history and reconnect backfill. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { visitor, token } = await resolveSupportVisitor(request)
    const conversation = await findVisitorConversation(id, visitor.id)
    if (!conversation) return noStoreJson({ error: '会话不存在' }, { status: 404 })

    const afterSeq = parseAfterSeq(request.nextUrl.searchParams.get('afterSeq'))
    const limit = Number(request.nextUrl.searchParams.get('limit') || 100)
    const page = await listVisitorMessages(id, afterSeq, limit)
    const response = noStoreJson({ messages: page.messages, hasMore: page.hasMore })
    if (token) attachSupportCookie(response, token, request)
    return response
  } catch (error) {
    return supportErrorResponse(error)
  }
}

/** POST /api/support/conversations/[id]/messages — send a text message, idempotent by clientId. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginSupportRequest(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { id } = await params
    const { visitor, token } = await resolveSupportVisitor(request)
    const limited = await rateLimit(request, {
      windowMs: 60 * 1000,
      maxRequests: 20,
      message: '发送过于频繁，请稍后再试',
    }, 'support-message', visitor.id)
    if (limited) return limited

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const result = await createVisitorMessage({
      conversationId: id,
      visitorId: visitor.id,
      body: body.body,
      clientId: body.clientId,
    })
    if (!result.message) {
      return NextResponse.json({ error: '消息发送失败' }, { status: 500 })
    }

    const response = noStoreJson({
      message: result.message,
      conversation: toSupportConversationView(result.conversation, 'visitor'),
      reopened: Boolean(result.reopened),
    })
    if (token) attachSupportCookie(response, token, request)
    return response
  } catch (error) {
    return supportErrorResponse(error)
  }
}
