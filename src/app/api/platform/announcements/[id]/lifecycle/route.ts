import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import {
  archiveAnnouncement,
  copyAnnouncement,
  getAdminAnnouncement,
  pauseAnnouncement,
  publishAnnouncement,
  resumeAnnouncement,
  testSendAnnouncement,
  type AdminLifecycleResult,
} from '@/lib/announcements/admin'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACTIONS = new Set(['publish', 'pause', 'resume', 'archive', 'copy', 'test'])

function lifecycleError(result: AdminLifecycleResult) {
  return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
}

/** POST /api/platform/announcements/[id]/lifecycle — audited state transitions. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const platformAuth = await requirePlatformAuth(request)
  if (platformAuth instanceof Response) return platformAuth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: '操作过于频繁，请稍后再试',
  }, 'platform-announcement-lifecycle')
  if (limited) return limited

  const { id } = await params
  const body = await request.json().catch(() => null)
  const action = typeof body?.action === 'string' ? body.action : ''
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: '不支持的操作' }, { status: 400 })
  }

  try {
    let result: AdminLifecycleResult
    if (action === 'publish') {
      result = await publishAnnouncement(id, platformAuth, { confirmAllModal: body?.confirmAllModal === true })
    } else if (action === 'pause') {
      result = await pauseAnnouncement(id, platformAuth)
    } else if (action === 'resume') {
      result = await resumeAnnouncement(id, platformAuth)
    } else if (action === 'archive') {
      result = await archiveAnnouncement(id, platformAuth)
    } else if (action === 'copy') {
      result = await copyAnnouncement(id, platformAuth)
    } else {
      result = await testSendAnnouncement(id, platformAuth)
    }

    if (!result.ok) return lifecycleError(result)

    const targetId = result.id ?? id
    const detail = await getAdminAnnouncement(targetId)
    if (!detail) return NextResponse.json({ error: '公告不存在' }, { status: 404 })
    return NextResponse.json({ ok: true, action, id: targetId, ...detail })
  } catch (error) {
    logError('[ANNOUNCEMENT ADMIN] lifecycle failed:', error)
    return NextResponse.json({ error: '操作失败，请稍后重试' }, { status: 500 })
  }
}
