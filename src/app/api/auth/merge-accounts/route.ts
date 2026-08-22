import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRedis } from '@/lib/redis'
import { getCurrentUserFromRequest, issueAdminTokens } from '@/lib/auth'
import { hashPhoneCode, phoneCodeKey, PHONE_REGEX } from '@/lib/phone-auth'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROLE_PRIORITY: Record<string, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 }

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUserFromRequest(request)
  if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit(request, {
    windowMs: 15 * 60 * 1000,
    maxRequests: 3,
    message: 'Too many merge attempts',
  }, 'account-merge', currentUser.id)
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : ''
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!PHONE_REGEX.test(phone) || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Invalid phone or code' }, { status: 400 })
  }

  const redis = getRedis()
  const key = phoneCodeKey(phone)
  const raw = await redis.get(key)
  if (!raw) return NextResponse.json({ error: 'Code expired' }, { status: 400 })
  const stored = JSON.parse(raw) as { hash: string; attempts: number }
  if (stored.attempts >= 5) {
    await redis.del(key)
    return NextResponse.json({ error: 'Too many failed attempts' }, { status: 400 })
  }
  const expected = Buffer.from(stored.hash, 'hex')
  const actual = Buffer.from(hashPhoneCode(phone, code), 'hex')
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    const ttl = await redis.ttl(key)
    await redis.setex(key, Math.max(ttl, 1), JSON.stringify({ ...stored, attempts: stored.attempts + 1 }))
    return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
  }
  await redis.del(key)

  const target = await prisma.user.findUnique({ where: { phone } })
  if (!target || target.id === currentUser.id) {
    return NextResponse.json({ error: 'No conflicting account found' }, { status: 404 })
  }

  await prisma.$transaction(async (tx) => {
    const currentMemberships = await tx.teamMember.findMany({ where: { userId: currentUser.id } })
    const targetMemberships = await tx.teamMember.findMany({ where: { userId: target.id } })
    for (const targetMembership of targetMemberships) {
      const existing = currentMemberships.find((item) => item.teamId === targetMembership.teamId)
      if (existing) {
        const higherRole = (ROLE_PRIORITY[targetMembership.role] || 0) > (ROLE_PRIORITY[existing.role] || 0)
          ? targetMembership.role
          : existing.role
        await tx.teamMember.update({
          where: { id: existing.id },
          data: { role: higherRole as any, status: 'ACTIVE' },
        })
        await tx.teamMember.delete({ where: { id: targetMembership.id } })
      } else {
        await tx.teamMember.update({
          where: { id: targetMembership.id },
          data: { userId: currentUser.id },
        })
      }
    }

    const currentProjectMemberships = await tx.projectMember.findMany({ where: { userId: currentUser.id } })
    const targetProjectMemberships = await tx.projectMember.findMany({ where: { userId: target.id } })
    for (const targetMembership of targetProjectMemberships) {
      const duplicate = currentProjectMemberships.some((item) => item.projectId === targetMembership.projectId)
      if (duplicate) {
        await tx.projectMember.delete({ where: { id: targetMembership.id } })
      } else {
        await tx.projectMember.update({
          where: { id: targetMembership.id },
          data: { userId: currentUser.id },
        })
      }
    }

    await tx.project.updateMany({ where: { createdById: target.id }, data: { createdById: currentUser.id } })
    await tx.team.updateMany({ where: { createdById: target.id }, data: { createdById: currentUser.id } })
    await tx.wechatIdentity.updateMany({ where: { userId: target.id }, data: { userId: currentUser.id } })
    await tx.comment.updateMany({ where: { userId: target.id }, data: { userId: currentUser.id } })
    await tx.adminSavedView.updateMany({ where: { userId: target.id }, data: { userId: currentUser.id } })
    await tx.passkeyCredential.updateMany({ where: { userId: target.id }, data: { userId: currentUser.id } })
    await tx.pushSubscription.updateMany({ where: { userId: target.id }, data: { userId: currentUser.id } })

    const currentCalendar = await tx.calendarToken.findUnique({ where: { userId: currentUser.id } })
    if (!currentCalendar) {
      await tx.calendarToken.updateMany({ where: { userId: target.id }, data: { userId: currentUser.id } })
    }

    await tx.user.delete({ where: { id: target.id } })
  })

  const mergedUser = await prisma.user.findUniqueOrThrow({ where: { id: currentUser.id } })
  const tokens = await issueAdminTokens({
    id: mergedUser.id,
    email: mergedUser.email,
    phone: mergedUser.phone,
    name: mergedUser.name,
    avatarUrl: mergedUser.avatarUrl,
    onboardingCompleted: mergedUser.onboardingCompleted,
    role: mergedUser.role,
    projectAccessScope: mergedUser.projectAccessScope,
  })

  return NextResponse.json({
    user: {
      id: mergedUser.id,
      email: mergedUser.email,
      phone: mergedUser.phone,
      name: mergedUser.name,
      avatarUrl: mergedUser.avatarUrl,
      onboardingCompleted: mergedUser.onboardingCompleted,
      role: mergedUser.role,
    },
    needsOnboarding: mergedUser.onboardingCompleted === false,
    tokens,
  })
}
