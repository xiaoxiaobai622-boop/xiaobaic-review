import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { getTeamLinkForReveal } from '@/lib/platform-team-360'
import { logPlatformAudit } from '@/lib/platform-audit'
import { getAppUrl } from '@/lib/url'
import { rateLimit } from '@/lib/rate-limit'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user
  const limited = await rateLimit(request, {
    windowMs: 15 * 60 * 1000,
    maxRequests: 30,
    message: '查看链接次数过多，请稍后再试',
  }, 'platform-link-reveal', user.id)
  if (limited) return limited

  const { id, linkId } = await params
  try {
    const baseUrl = await getAppUrl(request)
    const found = await getTeamLinkForReveal(id, linkId, baseUrl)
    if (!found) return NextResponse.json({ error: '链接不存在' }, { status: 404 })

    await logPlatformAudit({
      request,
      actorId: user.id,
      action: 'LINK_REVEAL',
      teamId: id,
      projectId: found.link.projectId,
      targetType: 'ShareLink',
      targetId: found.link.id,
      details: { maskedToken: found.link.maskedToken, linkName: found.link.name, linkType: found.link.type },
    })

    const response = NextResponse.json({
      url: found.url,
      linkId: found.link.id,
      projectId: found.link.projectId,
      status: found.link.status,
      maskedToken: found.link.maskedToken,
    })
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return response
  } catch (error) {
    logError('[PLATFORM] Failed to reveal a share link:', error)
    return NextResponse.json({ error: '无法读取链接，请稍后重试' }, { status: 500 })
  }
}
