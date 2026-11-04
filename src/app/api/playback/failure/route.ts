import { NextRequest, NextResponse } from 'next/server'
import { getRedis } from '@/lib/redis'
import { rateLimit } from '@/lib/rate-limit'
import { logMessage } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PLAYBACK_FAILURE_CAUSES = new Set(['auth', 'network', 'decode', 'unsupported', 'unavailable'])
const PLAYBACK_QUALITIES = new Set(['720p', '1080p', '2160p', 'source', 'hls'])
const COUNTER_TTL_SECONDS = 7 * 24 * 60 * 60

function cleanId(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) : ''
}

function cleanLabel(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,48}$/.test(value) ? value : null
}

function hourBucket(date = new Date()): string {
  return date.toISOString().slice(0, 13).replace(/[-T]/g, '')
}

export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 120,
    message: 'Too many playback failure reports',
  }, 'playback-failure')

  if (limited) return limited

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const cause = typeof body.cause === 'string' && PLAYBACK_FAILURE_CAUSES.has(body.cause) ? body.cause : 'unknown'
  const quality = typeof body.quality === 'string' && PLAYBACK_QUALITIES.has(body.quality) ? body.quality : 'unknown'
  const videoId = cleanId(body.videoId)
  const projectId = cleanId(body.projectId)
  const httpStatus = Number.isInteger(body.httpStatus) ? Number(body.httpStatus) : null
  const mediaErrorCode = Number.isInteger(body.mediaErrorCode) ? Number(body.mediaErrorCode) : null
  const hlsErrorType = cleanLabel(body.hlsErrorType)
  const hlsErrorDetails = cleanLabel(body.hlsErrorDetails)
  const sourceQuality = body.sourceQuality === true
  const recovered = body.recovered === true
  const fallback = body.fallback === true
  const bucket = hourBucket()

  const keys = [
    `playback_failure:hour:${bucket}:total`,
    `playback_failure:hour:${bucket}:cause:${cause}`,
    `playback_failure:hour:${bucket}:quality:${quality}`,
    `playback_failure:hour:${bucket}:source_quality:${sourceQuality ? 'true' : 'false'}`,
    recovered ? `playback_failure:hour:${bucket}:recovered` : `playback_failure:hour:${bucket}:failed`,
  ]
  if (fallback) keys.push(`playback_failure:hour:${bucket}:fallback`)
  if (videoId) {
    keys.push(`playback_failure:video:${videoId}:${bucket}`)
    if (!recovered) keys.push(`playback_failure:video_failed:${videoId}:${bucket}`)
  }

  // Counters are an operational signal, never a gate. A Redis hiccup must not
  // turn into a user-visible response.
  const redis = getRedis()
  await Promise.all(keys.map((key) => (
    redis.multi().incr(key).expire(key, COUNTER_TTL_SECONDS).exec().catch(() => null)
  )))

  logMessage('[PLAYBACK_FAILURE]', {
    cause,
    httpStatus,
    mediaErrorCode,
    hlsErrorType,
    hlsErrorDetails,
    quality,
    videoId: videoId || null,
    projectId: projectId || null,
    sourceQuality,
    recovered,
    fallback,
    userAgent: (request.headers.get('user-agent') || '').slice(0, 180),
  })

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
