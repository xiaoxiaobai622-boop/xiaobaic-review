import { NextRequest, NextResponse } from 'next/server'
import { prisma, LIVE_VIDEO } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { getRequestedTeamId } from '@/lib/team-access'
import { projectAccessWhere } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 每类各裁一刀：搜索页是给人扫的，不是导出全库。 */
const MAX_PER_KIND = 50
/** 同名素材可能有几十版，先取宽一点再按名字折成一行，否则裁到 50 行会全是同一枚素材的旧版。 */
const CANDIDATE_WINDOW = 400

export type SearchProjectHit = {
  id: string
  title: string
  projectCode: string
  status: string
  videoCount: number
}

export type SearchAssetHit = {
  id: string
  name: string
  version: number
  versionLabel: string
  duration: number
  folderId: string | null
  folderName: string | null
  projectId: string
  projectTitle: string
  uploadedByName: string | null
  createdAt: string
  /** 有没有封面帧。只带这一枚布尔：`thumbnailPath` 是存储侧路径，不该跟着搜索结果出到前端。 */
  hasThumbnail: boolean
}

/** 前缀命中排前面：181 集里搜「第3集」不该被「第30集」挤掉。 */
function byPrefix<T extends { name?: string; title?: string }>(needle: string) {
  const key = needle.toLowerCase()
  return (a: T, b: T) => {
    const an = (a.name || a.title || '').toLowerCase()
    const bn = (b.name || b.title || '').toLowerCase()
    return Number(bn.startsWith(key)) - Number(an.startsWith(key))
  }
}

/**
 * GET /api/studio/search — 窄栏搜索那一整页的读端点。
 *
 * 可见范围整个交给 projectAccessWhere：受限项目、别的团队、「仅指定项目」的成员
 * 都在那枚 where 里已经算好了，这里再自己判一次只会和列表页说出不一致的话。
 */
export async function GET(request: NextRequest) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '请求过于频繁，请稍后再试',
  }, 'studio-search')
  if (limited) return limited

  const params = request.nextUrl.searchParams
  const query = (params.get('q') || '').trim()
  const type = params.get('type') || 'all'
  const sort = params.get('sort') || 'relevance'
  if (!query) return NextResponse.json({ query: '', type, sort, total: 0, projects: [], assets: [], truncated: false })

  const access = projectAccessWhere(authResult, getRequestedTeamId(request))
  const contains = { contains: query, mode: 'insensitive' as const }

  try {
    const [projectRows, videoRows] = await Promise.all([
      type === 'assets' ? Promise.resolve([]) : prisma.project.findMany({
        // 命中的那枚 OR 塞进 AND 数组：projectAccessWhere 自己带一枚「受限项目」的 OR，
        // 摊在同一层里后写的会顶掉前面那枚，受限项目就从搜索结果里漏出来（同 project-access 那处修复）。
        where: {
          ...access,
          AND: [{ OR: [{ title: contains }, { projectCode: contains }, { description: contains }] }],
        },
        orderBy: { updatedAt: 'desc' },
        take: MAX_PER_KIND,
        select: {
          id: true, title: true, projectCode: true, status: true,
          _count: { select: { videos: { where: LIVE_VIDEO } } },
        },
      }),
      type === 'projects' ? Promise.resolve([]) : prisma.video.findMany({
        where: { ...LIVE_VIDEO, status: 'READY', name: contains, project: access },
        orderBy: { version: 'desc' },
        take: CANDIDATE_WINDOW,
        select: {
          id: true, name: true, version: true, versionLabel: true, duration: true,
          createdAt: true, uploadedByName: true, thumbnailPath: true, folder: { select: { id: true, name: true } },
          project: { select: { id: true, title: true } },
        },
      }),
    ])

    // 同名折叠成一行，只留最新那一版（播放也只认最新 READY 版）。
    const byName = new Map<string, (typeof videoRows)[number]>()
    for (const row of videoRows) {
      const existing = byName.get(row.name)
      if (!existing || row.version > existing.version) byName.set(row.name, row)
    }
    const newestFirst = [...byName.values()].sort((a, b) => b.version - a.version)
    const ordered = sort === 'newest' ? newestFirst : newestFirst.sort(byPrefix(query))
    const assets: SearchAssetHit[] = ordered.slice(0, MAX_PER_KIND).map((row) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      versionLabel: row.versionLabel,
      duration: row.duration,
      folderId: row.folder?.id ?? null,
      folderName: row.folder?.name ?? null,
      projectId: row.project.id,
      projectTitle: row.project.title,
      uploadedByName: row.uploadedByName,
      createdAt: row.createdAt.toISOString(),
      hasThumbnail: Boolean(row.thumbnailPath),
    }))
    const projects: SearchProjectHit[] = (sort === 'newest'
      ? projectRows
      : [...projectRows].sort(byPrefix(query))
    ).map((row) => ({
      id: row.id,
      title: row.title,
      projectCode: row.projectCode,
      status: row.status,
      videoCount: row._count.videos,
    }))

    return NextResponse.json({
      query,
      type,
      sort,
      total: projects.length + assets.length,
      projects,
      assets,
      truncated: projectRows.length === MAX_PER_KIND || byName.size > MAX_PER_KIND,
    })
  } catch (error) {
    console.error('[studio/search] 查询失败', error)
    return NextResponse.json({ error: '搜索失败，稍后再试' }, { status: 500 })
  }
}
