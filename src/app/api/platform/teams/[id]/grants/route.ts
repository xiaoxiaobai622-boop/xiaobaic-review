import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user
  const { id } = await params

  const grants = await prisma.teamFeatureGrant.findMany({
    where: { teamId: id },
    include: { feature: true },
    orderBy: { featureKey: 'asc' },
  })

  return NextResponse.json({ grants })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user
  const { id } = await params

  const body = await request.json().catch(() => null)
  const grants = Array.isArray(body?.grants) ? body.grants : []
  if (grants.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  await prisma.$transaction(
    grants
      .filter((grant: any) => typeof grant?.featureKey === 'string' && typeof grant?.enabled === 'boolean')
      .map((grant: any) =>
        prisma.teamFeatureGrant.upsert({
          where: { teamId_featureKey: { teamId: id, featureKey: grant.featureKey } },
          create: { teamId: id, featureKey: grant.featureKey, enabled: grant.enabled },
          update: { enabled: grant.enabled },
        }),
      ),
  )

  return NextResponse.json({ success: true })
}
