import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function csvCell(value: unknown) {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export async function GET(request: NextRequest) {
  const auth = await requirePlatformAuth(request)
  if (auth instanceof Response) return auth
  const limited = await rateLimit(request, {
    windowMs: 60 * 60 * 1000,
    maxRequests: 10,
    message: '导出过于频繁，请稍后再试',
  }, 'platform-support-export', auth.id)
  if (limited) return limited

  try {
    const now = new Date()
    const fromParam = request.nextUrl.searchParams.get('from')
    const toParam = request.nextUrl.searchParams.get('to')
    const from = fromParam ? new Date(fromParam) : new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000)
    const to = toParam ? new Date(toParam) : now
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return NextResponse.json({ error: '无效的时间范围' }, { status: 400 })
    }

    const conversations = await prisma.supportConversation.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'asc' },
      take: 1000,
      include: {
        visitor: { select: { name: true, email: true, userId: true } },
        messages: {
          orderBy: { seq: 'asc' },
          take: 500,
          select: { seq: true, senderType: true, visibility: true, body: true, createdAt: true },
        },
      },
    })

    const header = [
      'conversationId', 'publicId', 'status', 'createdAt', 'firstVisitorMessageAt', 'firstAgentReplyAt', 'closedAt',
      'visitorName', 'visitorEmail', 'userId', 'teamId', 'projectId', 'source', 'pagePath', 'locale', 'tags',
      'csatScore', 'messageSeq', 'messageSenderType', 'messageVisibility', 'messageCreatedAt', 'messageBody',
    ]
    const lines = [header.map(csvCell).join(',')]
    for (const conversation of conversations) {
      const base = [
        conversation.id,
        conversation.publicId,
        conversation.status,
        conversation.createdAt.toISOString(),
        conversation.firstVisitorMessageAt?.toISOString(),
        conversation.firstAgentReplyAt?.toISOString(),
        conversation.closedAt?.toISOString(),
        conversation.visitor.name,
        conversation.visitor.email,
        conversation.visitor.userId || conversation.userId,
        conversation.teamId,
        conversation.projectId,
        conversation.source,
        conversation.pagePath,
        conversation.locale,
        conversation.tags.join('|'),
        conversation.csatScore,
      ]
      if (conversation.messages.length === 0) {
        lines.push([...base, '', '', '', '', ''].map(csvCell).join(','))
      } else {
        for (const message of conversation.messages) {
          lines.push([
            ...base,
            message.seq,
            message.senderType,
            message.visibility,
            message.createdAt.toISOString(),
            message.body,
          ].map(csvCell).join(','))
        }
      }
    }

    await prisma.supportEvent.create({
      data: {
        actorType: 'AGENT',
        actorId: auth.id,
        type: 'EXPORTED',
        metadata: {
          conversations: conversations.length,
          messages: conversations.reduce((sum, conversation) => sum + conversation.messages.length, 0),
          from: from.toISOString(),
          to: to.toISOString(),
        },
      },
    })

    const csv = `\uFEFF${lines.join('\n')}`
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="support-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    logError('[SUPPORT] export failed:', error)
    return NextResponse.json({ error: '导出失败' }, { status: 500 })
  }
}
