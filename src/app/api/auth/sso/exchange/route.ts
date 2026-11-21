import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { issueAdminTokens } from '@/lib/auth'
import { consumeSsoCode } from '@/lib/docs-sso'
import { docsPreflight, withDocsCors } from '@/lib/docs-cors'
import { getAdminDeviceFingerprint } from '@/lib/studio-device'

export const runtime = 'nodejs'

export async function OPTIONS(request: NextRequest) {
  return docsPreflight(request) ?? new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const code = typeof body.code === 'string' ? body.code : ''
  const state = typeof body.state === 'string' ? body.state : ''
  const record = await consumeSsoCode(code, state)
  if (!record) return withDocsCors(NextResponse.json({ error: 'invalid code' }, { status: 401 }))

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { id: true, email: true, phone: true, name: true, avatarUrl: true, onboardingCompleted: true, role: true, isPlatformAdmin: true, projectAccessScope: true },
  })
  if (!user) return withDocsCors(NextResponse.json({ error: 'user not found' }, { status: 401 }))

  const tokens = await issueAdminTokens(user, getAdminDeviceFingerprint(request))
  const memberships = await prisma.teamMember.findMany({
    where: { userId: user.id, status: 'ACTIVE' },
    select: { role: true, team: { select: { id: true, name: true, slug: true, avatarUrl: true } } },
  })

  return withDocsCors(NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, role: user.role },
    teams: memberships.map((m) => ({ ...m.team, role: m.role })),
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: tokens.accessExpiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
    },
  }))
}
