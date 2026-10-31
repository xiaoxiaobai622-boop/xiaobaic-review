import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { getTeamQuota, getTeamUsage, BETA_QUOTA } from '@/lib/platform-access'
import { logPlatformAudit } from '@/lib/platform-audit'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// maxProjects/maxVideos accept 0: readers treat a non-positive allowance as
// "unlimited" (isUnlimitedQuota now lives in lib/platform-access itself; the billing copy
// moved to src/disabled-billing on 10-04).
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

  const before = await prisma.teamQuota.findUnique({ where: { teamId: id } })
  const quota = await prisma.teamQuota.upsert({
    where: { teamId: id },
    // A partial edit must not mint the rest of the row from schema defaults (20 GB etc.);
    // an omitted key means "whatever the team's baseline is", not "50 videos".
    // This IS a hand-edit by definition: source=MANUAL is what makes the next
    // fulfilment confirmation warn that it is about to overwrite these numbers.
    create: { teamId: id, ...BETA_QUOTA, ...data, source: 'MANUAL' },
    update: { ...data, source: 'MANUAL', sourceOrderId: null },
  })

  await logPlatformAudit({
    request,
    actorId: user.id,
    action: 'TEAM_QUOTA_CHANGE',
    teamId: id,
    targetType: 'TeamQuota',
    targetId: quota.id,
    details: {
      before: before ? {
        maxMembers: before.maxMembers,
        maxProjects: before.maxProjects,
        maxVideos: before.maxVideos,
        maxStorageGB: before.maxStorageGB,
        source: before.source,
      } : null,
      after: data,
    },
  }).catch(error => logError('[PLATFORM] Failed to audit team quota change:', error))

  // GET 那侧的 `recorded` 是说「这一行真的存在」：保存之后当然存在，界面采纳响应时才有真话可说。
  return NextResponse.json({ quota: { ...quota, recorded: true } })
}
