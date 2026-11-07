import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireApiUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { markNotificationsSeen } from '@/lib/in-app-notifications/queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).max(100).optional(),
  all: z.boolean().optional(),
  category: z.enum(['TEAM', 'MENTION']).optional(),
}).refine((value) => value.all === true || (value.ids && value.ids.length > 0), {
  message: 'ids or all is required',
})

export async function POST(request: NextRequest) {
  const auth = await requireApiUser(request)
  if (auth instanceof Response) return auth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 120,
    message: '请求过于频繁，请稍后再试',
  }, 'in-app-notifications-seen')
  if (limited) return limited

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  }

  try {
    const updated = await markNotificationsSeen({
      userId: auth.id,
      teamId: auth.authorizedTeamId!,
      ids: parsed.data.ids,
      all: parsed.data.all,
      category: parsed.data.category,
    })
    return NextResponse.json({ updated })
  } catch {
    return NextResponse.json({ error: 'NOTIFICATIONS_UNAVAILABLE' }, { status: 500 })
  }
}
