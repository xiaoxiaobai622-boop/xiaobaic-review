import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { getTeamActivity } from '@/lib/platform-team-360'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user
  const started = Date.now()
  const { id } = await params
  const rawDays = request.nextUrl.searchParams.get('days')
  const days = rawDays === '30' ? 30 : rawDays === '7' ? 7 : null
  if (!days) return NextResponse.json({ error: 'days 只能是 7 或 30' }, { status: 400 })

  try {
    const data = await getTeamActivity(id, days)
    if (!data) return NextResponse.json({ error: '团队不存在' }, { status: 404 })
    const response = NextResponse.json({
      ...data,
      meta: { durationMs: Date.now() - started },
    })
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return response
  } catch (error) {
    logError('[PLATFORM] Failed to read team activity:', error)
    return NextResponse.json({ error: '活跃趋势读取失败，请稍后重试' }, { status: 500 })
  }
}
