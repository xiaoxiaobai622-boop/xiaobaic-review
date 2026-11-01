import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { noStoreJson, supportErrorResponse } from '@/lib/support/http'
import { toSupportConversationView } from '@/lib/support/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = new Set(['OPEN', 'PENDING', 'CLOSED'])

export async function GET(request: NextRequest) {
  const auth = await requirePlatformAuth(request)
  if (auth instanceof Response) return auth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 120,
    message: '请求过于频繁，请稍后再试',
  }, 'platform-support-list', auth.id)
  if (limited) return limited

  try {
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const q = (searchParams.get('q') || '').trim().slice(0, 100)
    const unreadOnly = searchParams.get('unread') === '1'
    const cursor = searchParams.get('cursor') || undefined
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 30), 1), 50)

    const where: Prisma.SupportConversationWhereInput = {
      deletedAt: null,
      ...(status && STATUSES.has(status) ? { status: status as 'OPEN' | 'PENDING' | 'CLOSED' } : {}),
      ...(unreadOnly ? { unreadForAgent: { gt: 0 } } : {}),
      ...(q
        ? {
            OR: [
              { lastMessagePreview: { contains: q, mode: 'insensitive' } },
              { publicId: { contains: q, mode: 'insensitive' } },
              { visitor: { name: { contains: q, mode: 'insensitive' } } },
              { visitor: { email: { contains: q, mode: 'insensitive' } } },
              { tags: { has: q } },
            ],
          }
        : {}),
    }

    const rows = await prisma.supportConversation.findMany({
      where,
      include: { visitor: true },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    return noStoreJson({
      items: page.map((row) => toSupportConversationView(row, 'agent')),
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    })
  } catch (error) {
    return supportErrorResponse(error)
  }
}
