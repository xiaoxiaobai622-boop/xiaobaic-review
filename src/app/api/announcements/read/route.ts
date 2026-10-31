import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { recordRead } from '@/lib/announcements/state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/announcements/read — legacy read endpoint, now backed by READ receipts. */
export async function POST(request: NextRequest) {
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '请求过于频繁，请稍后再试',
  }, 'platform-announcements-read', authResult.id)
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const ids: unknown = body?.ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'ids required' }, { status: 400 })
  }

  const result = await recordRead(authResult.id, ids as string[], 'INBOX')
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  }

  return NextResponse.json({ ok: true, marked: result.marked ?? 0 })
}
