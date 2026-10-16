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

  // 列的是「平台定义的全部功能各自现在开不开」，不是这个团队写过的 grant 行：
  // 每行都有独立的行、没写过的按 `defaultEnabled` 生效，只回已有行就等于默认开启的那些项在界面上根本没开关。
  const [features, grants] = await Promise.all([
    prisma.platformFeature.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
    prisma.teamFeatureGrant.findMany({ where: { teamId: id }, select: { featureKey: true, enabled: true } }),
  ])
  const written = new Map(grants.map((grant) => [grant.featureKey, grant.enabled]))

  return NextResponse.json({
    grants: features.map((feature) => ({
      featureKey: feature.key,
      enabled: written.has(feature.key) ? written.get(feature.key)! : feature.defaultEnabled,
      // false = 这个团队从没被单独写过，画面上那格是平台的默认值在生效，改它才会落一行。
      explicit: written.has(feature.key),
      feature,
    })),
  })
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
