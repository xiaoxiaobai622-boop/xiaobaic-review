import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRedis } from '@/lib/redis'
import { getTeamQuota } from '@/lib/platform-access'
import { getCurrentUserFromRequest, requireApiUser } from '@/lib/auth'
import { getTeamMember } from '@/lib/team-access'
import {
  checkWechatText,
  CONTENT_VIOLATION_MESSAGE,
} from '@/lib/wechat-content-security'
import { withMaskedPhone } from '@/lib/phone-field'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const membership = await getTeamMember(id, authResult.id)
  // Keep team details available while a team is disabled so the owner can
  // view the status and redeem an activation card. Project and other team
  // operations still enforce the team's ACTIVE status separately.
  if (!membership || membership.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  let team: any
  try {
    team = await prisma.team.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
        createdById: true,
        subscriptionPlan: true,
        subscriptionStartedAt: true,
        subscriptionExpiresAt: true,
        members: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            status: true,
            teamNickname: true,
            teamProfession: true,
            department: true,
            bio: true,
            createdAt: true,
            updatedAt: true,
            user: {
              select: { id: true, name: true, email: true, phone: true, avatarUrl: true, updatedAt: true },
            },
          },
        },
        _count: { select: { projects: true, members: true } },
      },
    })
  } catch {
    // During rolling deployments the application image can be newer than the
    // database migration. Keep the team page usable until the migration is
    // applied, with empty team-profile fields as a safe fallback.
    const legacyTeam = await prisma.team.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
        createdById: true,
        subscriptionPlan: true,
        subscriptionStartedAt: true,
        subscriptionExpiresAt: true,
        members: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            user: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true, updatedAt: true } },
          },
        },
        _count: { select: { projects: true, members: true } },
      },
    })
    team = legacyTeam
      ? {
          ...legacyTeam,
          members: legacyTeam.members.map((member) => ({
            ...member,
            teamNickname: null,
            teamProfession: null,
            department: null,
            bio: null,
          })),
        }
      : null
  }

  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  // 成员名单是批量展示：所有手机号都只给掩码，自己的那行也不留明文。
  const members = team.members.map((member: any) =>
    ({ ...member, user: withMaskedPhone(member.user) }))
  // 团队页那句「几名成员、几 GB」读的是这里的 team.quota：额度可以被运营逐团改，
  // 页面写死一组数字，改一次就变假话。缺行回落到内测口径（getTeamQuota 不落行）。
  const quota = await getTeamQuota(team.id)
  const response = NextResponse.json({ team: { ...team, members, quota }, currentRole: membership.role })
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  response.headers.set('Pragma', 'no-cache')
  response.headers.set('Expires', '0')
  return response
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult
  const { id } = await params

  const membership = await getTeamMember(id, authResult.id)
  if (!membership || membership.status !== 'ACTIVE' || membership.role !== 'OWNER') {
    return NextResponse.json({ error: 'Owner permission required' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const data: Record<string, string> = {}
  if (typeof body?.name === 'string') {
    const name = body.name.trim()
    if (!name || name.length > 80) return NextResponse.json({ error: 'Invalid team name' }, { status: 400 })
    const securityCheck = await checkWechatText(name, { userId: authResult.id, scene: 1 })
    if (!securityCheck.passed) {
      return NextResponse.json(
        { error: securityCheck.error },
        { status: securityCheck.error === CONTENT_VIOLATION_MESSAGE ? 400 : 503 },
      )
    }
    data.name = name
  }
  if (typeof body?.avatarUrl === 'string') data.avatarUrl = body.avatarUrl
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const team = await prisma.team.update({ where: { id }, data })
  return NextResponse.json({ team })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult
  const { id } = await params

  const membership = await getTeamMember(id, authResult.id)
  if (!membership || membership.status !== 'ACTIVE' || membership.role !== 'OWNER') {
    return NextResponse.json({ error: 'Owner permission required' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const phoneVerificationToken = typeof body?.phoneVerificationToken === 'string'
    ? body.phoneVerificationToken.trim()
    : ''
  const redis = getRedis()
  const grantKey = `account-phone:${authResult.id}:grant:${phoneVerificationToken}`
  const grantValue = JSON.stringify({ phone: authResult.phone })
  if (
    !/^[a-f0-9]{48}$/.test(phoneVerificationToken) ||
    await redis.get(grantKey) !== grantValue
  ) {
    return NextResponse.json(
      { error: '解散团队需要先完成手机验证', code: 'PHONE_VERIFICATION_REQUIRED' },
      { status: 403 },
    )
  }

  const [projectCount, activeMemberCount, orderCount] = await Promise.all([
    prisma.project.count({ where: { teamId: id } }),
    prisma.teamMember.count({ where: { teamId: id, status: 'ACTIVE' } }),
    prisma.order.count({ where: { teamId: id } }),
  ])

  if (projectCount > 0) {
    return NextResponse.json(
      { error: '团队中还有项目，请先删除或转移项目后再删除团队' },
      { status: 409 },
    )
  }

  if (activeMemberCount > 1) {
    return NextResponse.json(
      { error: '团队中还有其他成员，请先移除成员或转让团队' },
      { status: 409 },
    )
  }

  if (orderCount > 0) {
    return NextResponse.json(
      { error: '该团队已有账单记录，不能删除，请联系平台' },
      { status: 409 },
    )
  }

  await redis.del(grantKey)
  await prisma.team.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
