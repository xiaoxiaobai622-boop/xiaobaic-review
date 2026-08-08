import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const user = await requireApiUser(request)
  if (user instanceof Response) return user

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '请求过于频繁，请稍后再试',
  }, 'project-code-open', user.id)
  if (limited) return limited

  const { code } = await params
  if (!/^\d{3}$/.test(code) || Number(code) < 1) {
    return NextResponse.json({ error: '请输入三位项目 ID' }, { status: 400 })
  }

  const project = await prisma.project.findUnique({
    where: { projectCode: code },
    select: { id: true, title: true, slug: true, projectCode: true, status: true },
  })
  if (!project) {
    return NextResponse.json({ error: `没有找到项目 ${code}` }, { status: 404 })
  }
  if (!(await canAccessProject(prisma, user, project.id))) {
    return NextResponse.json(
      { error: '你没有这个项目的访问权限，请联系团队管理员' },
      { status: 403 }
    )
  }

  return NextResponse.json(project)
}
