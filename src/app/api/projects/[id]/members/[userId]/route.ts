import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { canAdministerProject } from '@/lib/project-access'
import { requireProjectWritable } from '@/lib/team-writeable'
import { rateLimit } from '@/lib/rate-limit'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 撤的是「本项目单独给的那行授权」，不是这个人。角色或团队范围进来的人在这里撤不动
 * （界面那枚 disabled 按钮说的就是这件事），所以没有授权行可删时照字面回 404，
 * 而不是悄悄回一个 200 让界面以为撤掉了。
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 20,
    message: 'Too many requests. Please slow down.',
  }, 'project-members-remove')
  if (limited) return limited

  try {
    const { id: projectId, userId } = await params
    if (!userId) return NextResponse.json({ error: 'userId is required', code: 'INVALID_REQUEST' }, { status: 400 })

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    if (!(await canAdministerProject(prisma, authResult, projectId))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    const blocked = await requireProjectWritable(projectId)
    if (blocked) return blocked

    const removed = await prisma.projectMember.deleteMany({ where: { projectId, userId } })
    if (removed.count === 0) {
      return NextResponse.json({ error: 'This user is not assigned to the project', code: 'NOT_ASSIGNED' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    logError('[members] Failed to remove project member:', error)
    return NextResponse.json({ error: 'Failed to remove project member' }, { status: 500 })
  }
}
