import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { noStoreJson, supportErrorResponse } from '@/lib/support/http'
import { findAgentConversation, markConversationRead } from '@/lib/support/service'

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
    const body = (await request.json().catch(() => ({}))) as { seq?: unknown }
    const seq = Number(body.seq)
    if (!Number.isFinite(seq) || seq < 0) return NextResponse.json({ error: '无效的已读位置' }, { status: 400 })
    return noStoreJson(await markConversationRead({ conversationId: id, readerType: 'AGENT', readerId: auth.id, seq }))
  } catch (error) {
    return supportErrorResponse(error)
  }
}
