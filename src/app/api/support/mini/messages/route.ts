import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getSupportSettings } from '@/lib/support/settings'
import { supportErrorResponse } from '@/lib/support/http'
import {
  createVisitorMessage,
  findActiveVisitorConversation,
  findVisitorConversation,
  listVisitorMessages,
  toSupportConversationView,
} from '@/lib/support/service'
import { ensureMiniConversation, resolveMiniVisitor } from '@/lib/support/mini'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function miniContext(request: NextRequest) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return { error: authResult }
  const settings = await getSupportSettings()
  if (!settings.enabled) {
    return {
      error: NextResponse.json(
        { error: '在线客服暂时关闭，请使用邮件联系', code: 'SUPPORT_DISABLED' },
        { status: 503 },
      ),
    }
  }
  const user = await prisma.user.findUnique({
    where: { id: authResult.id },
    select: { id: true, name: true, email: true },
  })
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const visitor = await resolveMiniVisitor(user)
  return { user, visitor }
}

/** GET /api/support/mini/messages?afterSeq=12 — 拉取当前会话消息（轮询用）。 */
export async function GET(request: NextRequest) {
  const ctx = await miniContext(request)
  if ('error' in ctx) return ctx.error

  try {
    const conversation = await findActiveVisitorConversation(ctx.visitor.id)
    if (!conversation) {
      return NextResponse.json({ conversation: null, messages: [], hasMore: false })
    }
    const afterSeq = Number(request.nextUrl.searchParams.get('afterSeq')) || null
    const { messages, hasMore } = await listVisitorMessages(conversation.id, afterSeq)
    return NextResponse.json(
      {
        conversation: toSupportConversationView(conversation, 'visitor'),
        messages,
        hasMore,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return supportErrorResponse(error)
  }
}

/** POST /api/support/mini/messages — 发送访客消息 {content, clientId}。 */
export async function POST(request: NextRequest) {
  const ctx = await miniContext(request)
  if ('error' in ctx) return ctx.error

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const conversation =
      (typeof body.conversationId === 'string'
        ? await findVisitorConversation(body.conversationId, ctx.visitor.id)
        : null) || (await ensureMiniConversation(ctx.visitor.id, ctx.user.id))

    if (!conversation) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 })
    }

    const result = await createVisitorMessage({
      conversationId: conversation.id,
      visitorId: ctx.visitor.id,
      body: body.content,
      clientId: body.clientId,
    })

    return NextResponse.json(
      {
        message: result.message,
        conversation: toSupportConversationView(result.conversation, 'visitor'),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return supportErrorResponse(error)
  }
}
