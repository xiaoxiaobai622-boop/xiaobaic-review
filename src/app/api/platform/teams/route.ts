import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { getPlatformTeamsList, type PlatformTeamSort, type SortOrder } from '@/lib/platform-team-360'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SORTS = new Set<PlatformTeamSort>(['storageUsage', 'lastActive', 'createdAt', 'status'])

export async function GET(request: NextRequest) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user

  const started = Date.now()
  const rawSort = request.nextUrl.searchParams.get('sort') || 'createdAt'
  const rawOrder = request.nextUrl.searchParams.get('order') || 'asc'
  const sort = SORTS.has(rawSort as PlatformTeamSort) ? rawSort as PlatformTeamSort : 'createdAt'
  const order: SortOrder = rawOrder === 'desc' ? 'desc' : 'asc'

  try {
    const teams = await getPlatformTeamsList({ sort, order })
    const response = NextResponse.json({
      teams,
      meta: { sort, order, durationMs: Date.now() - started },
    })
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return response
  } catch (error) {
    logError('[PLATFORM] Failed to list teams with usage:', error)
    return NextResponse.json({ error: '无法读取团队用量，请稍后重试' }, { status: 500 })
  }
}
