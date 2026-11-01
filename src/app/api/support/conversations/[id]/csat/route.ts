import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isSameOriginSupportRequest, resolveSupportVisitor } from '@/lib/support/session'
import { findVisitorConversation } from '@/lib/support/service'
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

    const body = (await request.json().catch(() => ({}))) as { score?: unknown; comment?: unknown }
    const score = Number(body.score)
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return NextResponse.json({ error: '评分需为 1–5' }, { status: 400 })
    }
    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 1000) : null

    await prisma.$transaction(async (tx) => {
      await tx.supportConversation.update({
        where: { id },
        data: { csatScore: score, csatComment: comment || null, csatAt: new Date() },
      })
      await tx.supportEvent.create({
        data: {
          conversationId: id,
          actorType: 'VISITOR',
          actorId: visitor.id,
          type: 'CSAT_SUBMITTED',
          metadata: { score },
        },
      })
    })

    return noStoreJson({ ok: true })
  } catch (error) {
    return supportErrorResponse(error)
  }
}
