import { NextRequest } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { findAgentConversation } from '@/lib/support/service'
import { createSupportStream } from '@/lib/support/stream'
import { noStoreJson, parseAfterSeq, supportErrorResponse } from '@/lib/support/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePlatformAuth(request)
  if (auth instanceof Response) return auth
  try {
    const { id } = await params
    const conversation = await findAgentConversation(id)
    if (!conversation) return noStoreJson({ error: '会话不存在' }, { status: 404 })
    const afterSeq = parseAfterSeq(request.nextUrl.searchParams.get('afterSeq')) ?? 0
    return createSupportStream({
      conversationId: id,
      afterSeq,
      includeInternal: true,
      signal: request.signal,
    })
  } catch (error) {
    return supportErrorResponse(error)
  }
}
