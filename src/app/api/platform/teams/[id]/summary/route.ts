import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { getTeamSummary } from '@/lib/platform-team-360'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user
  const started = Date.now()
  const { id } = await params

  try {
    const team = await getTeamSummary(id)
    if (!team) return NextResponse.json({ error: '团队不存在' }, { status: 404 })
    const response = NextResponse.json({ team, meta: { durationMs: Date.now() - started } })
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return response
  } catch (error) {
    logError('[PLATFORM] Failed to read team summary:', error)
    return NextResponse.json({ error: '团队身份读取失败，请稍后重试' }, { status: 500 })
  }
}
