import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { getTeamQuota, getTeamUsage, TRIAL_QUOTA } from '@/lib/platform-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// maxProjects/maxVideos accept 0: readers treat a non-positive allowance as
// "unlimited" (lib/platform-access isUnlimitedQuota).
const QUOTA_MINIMUMS: Record<string, number> = {
  maxMembers: 1,
  maxProjects: 0,
  maxVideos: 0,
  maxStorageGB: 1,
}

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
  for (const [key, minimum] of Object.entries(QUOTA_MINIMUMS)) {
    const value = body?.[key]
    if (typeof value === 'number' && value >= minimum) data[key] = Math.floor(value)
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const quota = await prisma.teamQuota.upsert({
    where: { teamId: id },
    // A partial edit must not mint the rest of the row from schema defaults (20 GB etc.);
    // an omitted key means "whatever the team's baseline is", not "50 videos".
    create: { teamId: id, ...TRIAL_QUOTA, ...data },
    update: data,
  })

  return NextResponse.json({ quota })
}
