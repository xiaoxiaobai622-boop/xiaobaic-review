import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import {
  recordAck,
  recordClick,
  recordDismiss,
  recordImpression,
  recordRead,
  type StateActionResult,
} from '@/lib/announcements/state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function failure(result: Extract<StateActionResult, { ok: false }>) {
  return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
}

/**
 * POST /api/announcements/state
 * READ / ACK / DISMISS / IMPRESSION / CLICK share one per-user state row, so a
 * modal ack is visible to the inbox immediately and vice versa.
 */
export async function POST(request: NextRequest) {
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 120,
    message: '操作过于频繁，请稍后再试',
  }, 'announcement-state', authResult.id)
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const action = typeof body?.action === 'string' ? body.action : ''
  const id = typeof body?.id === 'string' ? body.id : ''
  const mode = body?.mode
  const sessionId = body?.sessionId

  if (action === 'READ') {
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((value: unknown): value is string => typeof value === 'string')
      : id ? [id] : []
    if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 })
    const result = await recordRead(authResult.id, ids, mode ?? 'INBOX')
    return result.ok ? NextResponse.json({ ok: true, marked: result.marked ?? 0 }) : failure(result)
  }

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  if (action === 'ACK') {
    const result = await recordAck(authResult.id, id, mode)
    return result.ok ? NextResponse.json(result) : failure(result)
  }
  if (action === 'DISMISS') {
    const result = await recordDismiss(authResult.id, id, mode)
    return result.ok ? NextResponse.json(result) : failure(result)
  }
  if (action === 'IMPRESSION') {
    const result = await recordImpression(authResult.id, id, mode, sessionId)
    return result.ok ? NextResponse.json(result) : failure(result)
  }
  if (action === 'CLICK') {
    const result = await recordClick(authResult.id, id, mode)
    return result.ok ? NextResponse.json(result) : failure(result)
  }

  return NextResponse.json({ error: '不支持的操作' }, { status: 400 })
}
