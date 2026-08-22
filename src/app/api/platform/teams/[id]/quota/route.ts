import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { getTeamQuota, getTeamUsage } from '@/lib/platform-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user
  const { id } = await params

  const [quota, usage] = await Promise.all([getTeamQuota(id), getTeamUsage(id)])
  return NextResponse.json({ quota, usage })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user
  const { id } = await params
  const body = await request.json().catch(() => null)

  const data: Record<string, number> = {}
  for (const key of ['maxMembers', 'maxProjects', 'maxVideos', 'maxStorageGB']) {
    if (typeof body?.[key] === 'number' && body[key] >= 1) data[key] = Math.floor(body[key])
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const quota = await prisma.teamQuota.upsert({
    where: { teamId: id },
    create: { teamId: id, ...data },
    update: data,
  })

  return NextResponse.json({ quota })
}
