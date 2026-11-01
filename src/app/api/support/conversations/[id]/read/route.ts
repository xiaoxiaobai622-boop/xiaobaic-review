import { NextRequest, NextResponse } from 'next/server'
import { isSameOriginSupportRequest, resolveSupportVisitor } from '@/lib/support/session'
import { findVisitorConversation, markConversationRead } from '@/lib/support/service'
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
    const conversation = await findVisitorConversation(id, visitor.id)
    if (!conversation) return noStoreJson({ error: '会话不存在' }, { status: 404 })
    const body = (await request.json().catch(() => ({}))) as { seq?: unknown }
    const seq = Number(body.seq)
    if (!Number.isFinite(seq) || seq < 0) return NextResponse.json({ error: '无效的已读位置' }, { status: 400 })
    return noStoreJson(await markConversationRead({ conversationId: id, readerType: 'VISITOR', readerId: visitor.id, seq }))
  } catch (error) {
    return supportErrorResponse(error)
  }
}
