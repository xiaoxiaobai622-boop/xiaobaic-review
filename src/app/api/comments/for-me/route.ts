import { NextRequest, NextResponse } from 'next/server'
import { prisma, LIVE_COMMENT } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { getRequestedTeamId } from '@/lib/team-access'
import { projectAccessWhere } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ITEMS = 30
// 回复只可能挂在根评论下（MessageBubble 不给回复套回复），所以「有人回复了我」
// 等价于「这条回复的父评论是我发的」，不需要第二跳。
const SELECT = {
  id: true,
  content: true,
  timecode: true,
  createdAt: true,
  authorName: true,
  authorEmail: true,
  userId: true,
  parentId: true,
  parent: { select: { id: true, content: true, authorName: true } },
  video: { select: { id: true, name: true, version: true } },
  project: { select: { id: true, title: true } },
} as const

/**
 * GET /api/comments/for-me — 我收到的批注回复。
 * `since`（ISO 时间）由前端保存的「上次查看时间」传入，只用于算未读数。
 */
export async function GET(request: NextRequest) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '请求过于频繁，请稍后再试',
  })
  if (limited) return limited

  const sinceParam = request.nextUrl.searchParams.get('since')
  const since = sinceParam ? new Date(sinceParam) : null
  const sinceValid = since instanceof Date && !Number.isNaN(since.getTime())

  try {
    const rows = await prisma.comment.findMany({
      where: {
        ...LIVE_COMMENT,
        parentId: { not: null },
        // 关掉反馈的项目在 /api/comments 里一律读不到正文，通知也不该把人送进空线程。
        project: {
          ...projectAccessWhere(authResult, getRequestedTeamId(request)),
          hideFeedback: false,
        },
        parent: {
          // 邮箱为空时不能拿空串去匹配，否则会把所有没留邮箱的批注都当成「我发的」。
          OR: [
            { userId: authResult.id },
            ...(authResult.email ? [{ authorEmail: authResult.email }] : []),
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      // 自己回自己的线程不算「有人回复了我」；用宽一点的窗口取回来再筛，避免凑不满。
      take: MAX_ITEMS * 3,
      select: SELECT,
    })

    const items = rows
      .filter((row) => row.userId !== authResult.id && row.authorEmail !== authResult.email)
      .slice(0, MAX_ITEMS)
      .map((row) => ({
        id: row.id,
        content: row.content,
        timecode: row.timecode,
        createdAt: row.createdAt,
        authorName: row.authorName || '匿名',
        parentId: row.parentId,
        parentContent: row.parent?.content ?? '',
        parentAuthorName: row.parent?.authorName || '匿名',
        videoId: row.video?.id ?? '',
        videoName: row.video?.name ?? '',
        videoVersion: row.video?.version ?? null,
        projectId: row.project?.id ?? '',
        projectTitle: row.project?.title ?? '',
      }))

    return NextResponse.json(
      {
        items,
        unread: sinceValid ? items.filter((item) => new Date(item.createdAt) > since).length : 0,
        newestAt: items[0]?.createdAt ?? null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return NextResponse.json({ error: 'NOTIFICATIONS_UNAVAILABLE' }, { status: 500 })
  }
}
