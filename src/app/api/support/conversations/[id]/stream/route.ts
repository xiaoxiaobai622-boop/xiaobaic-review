import { NextRequest } from 'next/server'
import { resolveSupportVisitor } from '@/lib/support/session'
import { findVisitorConversation } from '@/lib/support/service'
import { createSupportStream } from '@/lib/support/stream'
import { noStoreJson, parseAfterSeq, supportErrorResponse } from '@/lib/support/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { visitor } = await resolveSupportVisitor(request)
    const conversation = await findVisitorConversation(id, visitor.id)
    if (!conversation) return noStoreJson({ error: '会话不存在' }, { status: 404 })
    const afterSeq = parseAfterSeq(request.nextUrl.searchParams.get('afterSeq')) ?? 0
    return createSupportStream({
      conversationId: id,
      afterSeq,
      includeInternal: false,
      signal: request.signal,
    })
  } catch (error) {
    return supportErrorResponse(error)
  }
}
