import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { countAudience, sampleAudience, type AudienceSource } from '@/lib/announcements/audience'
import { validateAudienceRules } from '@/lib/announcements/validation'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/platform/announcements/audience — server-resolved count + masked sample. */
export async function POST(request: NextRequest) {
  const platformAuth = await requirePlatformAuth(request)
  if (platformAuth instanceof Response) return platformAuth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '预览过于频繁，请稍后再试',
  }, 'platform-announcement-audience')
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const validated = validateAudienceRules(body?.audienceRules)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.errors.join('；'), details: validated.errors }, { status: 400 })
  }

  const source: AudienceSource = { userId: null, rules: validated.rules }
  const sampleLimit = Number(body?.sampleLimit)
  try {
    const [count, sample] = await Promise.all([
      countAudience(source),
      sampleAudience(source, Number.isFinite(sampleLimit) ? sampleLimit : 5),
    ])
    return NextResponse.json({
      audience: { count, sample },
      rules: validated.rules,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    logError('[ANNOUNCEMENT AUDIENCE] preview failed:', error)
    return NextResponse.json({ error: '受众预览失败，请检查规则后重试' }, { status: 503 })
  }
}
