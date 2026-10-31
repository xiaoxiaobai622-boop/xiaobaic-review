import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { getTeamProjects } from '@/lib/platform-team-360'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = new Set(['IN_REVIEW', 'APPROVED', 'SHARE_ONLY', 'ARCHIVED'])

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user
  const started = Date.now()
  const { id } = await params
  const { searchParams } = request.nextUrl
  const page = Number(searchParams.get('page') || 1)
  const pageSize = Number(searchParams.get('pageSize') || 20)
  const status = searchParams.get('status') || ''
  if (status && !STATUSES.has(status)) {
    return NextResponse.json({ error: '无效的项目状态' }, { status: 400 })
  }
  if (!Number.isFinite(page) || !Number.isFinite(pageSize)) {
    return NextResponse.json({ error: '分页参数无效' }, { status: 400 })
  }

  try {
    const data = await getTeamProjects(id, {
      page,
      pageSize,
      search: searchParams.get('search') || '',
      status: status || undefined,
    })
    if (!data) return NextResponse.json({ error: '团队不存在' }, { status: 404 })
    const response = NextResponse.json({
      ...data,
      meta: { durationMs: Date.now() - started },
    })
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return response
  } catch (error) {
    logError('[PLATFORM] Failed to read team projects:', error)
    return NextResponse.json({ error: '项目与链接读取失败，请稍后重试' }, { status: 500 })
  }
}
