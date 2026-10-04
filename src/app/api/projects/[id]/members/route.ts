import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { canAccessProject, canAdministerProject, projectViewersWhere } from '@/lib/project-access'
import { requireProjectWritable } from '@/lib/team-writeable'
import { rateLimit } from '@/lib/rate-limit'
import { logError } from '@/lib/logging'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const USER_SELECT = {
  id: true,
  name: true,
  username: true,
  avatarUrl: true,
  email: true,
  phone: true,
  projectAccessScope: true,
} as const

const addMemberSchema = z.object({ userId: z.string().min(1) })

/**
 * 「这行的人是凭什么进来的」——三句不同的话，不是三种说法的一个意思：
 * 角色进来的、授权范围进来的、本项目单独授权进来的。撤的权限只有第三种，
 * 前两种撤了这行也不会消失（界面那枚 disabled 按钮就是这么来的）。
 */
function sourceOf(viewer: { role: string; user: { projectAccessScope: string } }): 'teamAdmin' | 'allProjects' | 'assigned' {
  if (viewer.role !== 'MEMBER') return 'teamAdmin'
  return viewer.user.projectAccessScope === 'ASSIGNED_ONLY' ? 'assigned' : 'allProjects'
}

async function loadView(projectId: string, teamId: string, canManage: boolean) {
  const viewers = await prisma.teamMember.findMany({
    where: projectViewersWhere({ id: projectId, teamId }),
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: { role: true, createdAt: true, user: { select: USER_SELECT } },
  })

  const members = viewers.map((viewer) => {
    const source = sourceOf(viewer)
    return {
      id: viewer.user.id,
      name: viewer.user.name || viewer.user.username || null,
      avatarUrl: viewer.user.avatarUrl,
      // 联系方式只在管理员这侧给：普通成员看名单是为了认人，不是拿同事邮箱去群发。
      email: canManage ? viewer.user.email : null,
      phone: canManage ? viewer.user.phone : null,
      source,
      canRemove: source === 'assigned',
    }
  })

  // 候选池就是名单的补集：还差这一枚授权行才进得来的人。
  const candidateRows = canManage
    ? await prisma.teamMember.findMany({
        where: {
          teamId,
          status: 'ACTIVE',
          role: 'MEMBER',
          user: { projectAccessScope: 'ASSIGNED_ONLY', projectMemberships: { none: { projectId } } },
        },
        orderBy: { createdAt: 'asc' },
        select: { user: { select: USER_SELECT } },
      })
    : []

  return {
    members,
    candidates: candidateRows.map((row) => ({
      id: row.user.id,
      name: row.user.name || row.user.username || null,
      avatarUrl: row.user.avatarUrl,
      email: row.user.email,
      phone: row.user.phone,
    })),
    memberCount: members.length,
    canManage,
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: 'Too many requests. Please slow down.',
  }, 'project-members-read')
  if (limited) return limited

  try {
    const { id: projectId } = await params
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, teamId: true } })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    if (!(await canAccessProject(prisma, authResult, projectId))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const canManage = await canAdministerProject(prisma, authResult, projectId)
    return NextResponse.json(await loadView(projectId, project.teamId, canManage))
  } catch (error) {
    logError('[members] Failed to load project members:', error)
    return NextResponse.json({ error: 'Failed to fetch project members' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: 'Too many requests. Please slow down.',
  }, 'project-members-write')
  if (limited) return limited

  try {
    const { id: projectId } = await params
    const parsed = addMemberSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'userId is required', code: 'INVALID_REQUEST' }, { status: 400 })
    }

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, teamId: true } })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    if (!(await canAdministerProject(prisma, authResult, projectId))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    const blocked = await requireProjectWritable(projectId)
    if (blocked) return blocked

    // 只授权本团队里在册的人：拿一枚别人的 userId 往自己项目里塞，等于凭空造访问权。
    const membership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId: parsed.data.userId } },
      select: { status: true },
    })
    if (!membership) {
      return NextResponse.json({ error: 'This user is not a member of the team', code: 'NOT_A_TEAM_MEMBER' }, { status: 400 })
    }
    if (membership.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'This team member is disabled', code: 'MEMBER_DISABLED' }, { status: 409 })
    }

    // 同一个人在同一条项目上只能有一行授权：唯一键已经在 schema 里，重复提交就当成没发生。
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: parsed.data.userId } },
      create: { projectId, userId: parsed.data.userId },
      update: {},
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    logError('[members] Failed to add project member:', error)
    return NextResponse.json({ error: 'Failed to add project member' }, { status: 500 })
  }
}
