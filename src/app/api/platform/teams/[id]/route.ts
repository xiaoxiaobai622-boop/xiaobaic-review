import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user
  const { id } = await params

  const body = await request.json().catch(() => null)
  const status = typeof body?.status === 'string' ? body.status : ''
  if (!['ACTIVE', 'DISABLED'].includes(status)) {
    return NextResponse.json({ error: 'Invalid team status' }, { status: 400 })
  }

  const team = await prisma.team.update({
    where: { id },
    data: { status },
    select: { id: true, name: true, status: true },
  })

  return NextResponse.json({ team })
}
