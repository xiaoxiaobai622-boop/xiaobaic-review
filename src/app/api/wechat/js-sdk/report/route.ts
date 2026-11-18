import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getRedis } from '@/lib/redis'
import { logMessage, logWarn } from '@/lib/logging'
import { getClientIpAddress } from '@/lib/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const STAGES = new Set(['page-load', 'config-error', 'open-tags-error', 'tag-error', 'tag-launch', 'tag-state'])
const RATE_WINDOW_SECONDS = 60
const RATE_LIMIT = 30

function clean(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').slice(0, max) : ''
}

async function withinRateLimit(request: NextRequest): Promise<boolean> {
  try {
    const redis = getRedis()
    const key = crypto
      .createHash('sha256')
      .update(`wx-open-tag:${getClientIpAddress(request)}`)
      .digest('hex')
      .slice(0, 16)
    const count = await redis.incr(`ratelimit:wx-open-tag:${key}`)
    if (count === 1) await redis.expire(`ratelimit:wx-open-tag:${key}`, RATE_WINDOW_SECONDS)
    return count <= RATE_LIMIT
  } catch {
    // Diagnostics must never fail the page; log anyway if Redis is down.
    return true
  }
}

export async function POST(request: NextRequest) {
  if (!(await withinRateLimit(request))) {
    return NextResponse.json({ error: 'too many' }, { status: 429, headers: NO_STORE })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const stage = clean(body?.stage, 40)
  if (!body || !STAGES.has(stage)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400, headers: NO_STORE })
  }

  const page = clean(body.page, 200)
  const detail = clean(body.detail)
  const ua = clean(request.headers.get('user-agent'), 200)
  const line = `[wx-open-tag] ${stage} page=${page} detail=${detail} ua=${ua}`

  if (stage.endsWith('error')) {
    logWarn(line)
  } else {
    logMessage(line)
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
