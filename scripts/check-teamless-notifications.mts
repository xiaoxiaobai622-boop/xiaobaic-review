import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'
import { allocateTeamId } from '../src/lib/team-id'
import { issueAdminTokens, type AuthUser } from '../src/lib/auth'

/**
 * 账号自己名下的内容不该被团队门槛挡住：
 *  - 平台公告/回复（侧栏轮询）、反馈、日历订阅令牌：只要求登录。
 *  - 保存的筛选视图：团队里的普通成员也能读写自己的那条。
 *  - 未登录仍然 401；团队边界不因此消失。
 */
const BASE = process.env.VIDX_BASE || 'http://localhost:3000'
const prisma = new PrismaClient()
const stamp = Date.now()
const teamlessEmail = `teamless-notify-${stamp}@example.invalid`
const memberEmail = `member-views-${stamp}@example.invalid`

async function call(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init?.headers || {}) } })
  return { status: response.status, body: await response.json().catch(() => null) }
}

let teamlessId: string | undefined
let memberId: string | undefined
let teamId: string | undefined
try {
  const teamless = await prisma.user.create({
    data: { email: teamlessEmail, password: await hashPassword(`teamless-${stamp}`), name: 'Teamless Notify', role: 'ADMIN' },
  })
  teamlessId = teamless.id
  assert.equal(await prisma.teamMember.count({ where: { userId: teamless.id, status: 'ACTIVE' } }), 0, 'fixture must have no active team')
  const { accessToken: teamlessToken } = await issueAdminTokens(teamless as unknown as AuthUser)
  const bearer = { authorization: `Bearer ${teamlessToken}` }

  const announcements = await call('/api/announcements', { headers: bearer })
  assert.equal(announcements.status, 200, `announcements: ${announcements.status} ${JSON.stringify(announcements.body)}`)
  assert.ok(Array.isArray(announcements.body?.items), 'announcements must still return its list')

  const forMe = await call('/api/comments/for-me', { headers: bearer })
  assert.equal(forMe.status, 200, `for-me: ${forMe.status} ${JSON.stringify(forMe.body)}`)
  assert.deepEqual(forMe.body?.items, [], 'a teamless account has no project replies')

  const marked = await call('/api/announcements/read', {
    method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: JSON.stringify({ ids: ['missing-id'] }),
  })
  assert.equal(marked.status, 200, `announcements/read: ${marked.status} ${JSON.stringify(marked.body)}`)

  const feedback = await call('/api/feedback', { headers: bearer })
  assert.equal(feedback.status, 200, `feedback: ${feedback.status} ${JSON.stringify(feedback.body)}`)
  const submitted = await call('/api/feedback', {
    method: 'POST', headers: { ...bearer, 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'teamless feedback check', category: '其他' }),
  })
  assert.equal(submitted.status, 200, `feedback submit: ${submitted.status} ${JSON.stringify(submitted.body)}`)

  const calendar = await call('/api/calendar/token', { headers: bearer })
  assert.equal(calendar.status, 200, `calendar token: ${calendar.status} ${JSON.stringify(calendar.body)}`)
  const calendarRemoved = await call('/api/calendar/token', { method: 'DELETE', headers: bearer })
  assert.equal(calendarRemoved.status, 200, `calendar delete: ${calendarRemoved.status} ${JSON.stringify(calendarRemoved.body)}`)

  const anonymous = await call('/api/announcements')
  assert.equal(anonymous.status, 401, 'anonymous requests must still be rejected')

  const member = await prisma.user.create({
    data: {
      email: memberEmail,
      password: await hashPassword(`member-${stamp}`),
      name: 'Member Views',
      role: 'ADMIN',
      phone: `1${String(stamp).slice(-10)}`,
    },
  })
  memberId = member.id
  teamId = await prisma.$transaction(async (tx) => {
    const id = await allocateTeamId(tx)
    const team = await tx.team.create({
      data: { id: id, name: `Views ${stamp}`, slug: `tm${stamp}`, shareKey: `tm_views_${stamp}`, createdById: member.id },
    })
    await tx.teamMember.create({ data: { teamId: team.id, userId: member.id, role: 'MEMBER' } })
    return team.id
  })
  const { accessToken: memberToken } = await issueAdminTokens(member as unknown as AuthUser)
  const memberBearer = { authorization: `Bearer ${memberToken}`, 'x-team-id': teamId }

  const views = await call('/api/studio/saved-views', { headers: memberBearer })
  assert.equal(views.status, 200, `saved views: ${views.status} ${JSON.stringify(views.body)}`)
  const createdView = await call('/api/studio/saved-views', {
    method: 'POST', headers: { ...memberBearer, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `View ${stamp}`,
      state: { q: '', statuses: [], clientKeys: [], years: [], dueBuckets: [], sort: 'updatedDesc' },
    }),
  })
  assert.equal(createdView.status, 200, `saved view create: ${createdView.status} ${JSON.stringify(createdView.body)}`)
  const viewId = createdView.body?.view?.id
  assert.ok(viewId, 'saved view create must return its id')
  const removedView = await call(`/api/studio/saved-views/${viewId}`, { method: 'DELETE', headers: memberBearer })
  assert.equal(removedView.status, 200, `saved view delete: ${removedView.status} ${JSON.stringify(removedView.body)}`)

  console.log('PASS personal resources are readable without a team, and members can use their saved views')
} finally {
  if (teamlessId) {
    await prisma.platformFeedback.deleteMany({ where: { userId: teamlessId } }).catch(() => {})
    await prisma.calendarToken.deleteMany({ where: { userId: teamlessId } }).catch(() => {})
  }
  if (memberId) {
    await prisma.adminSavedView.deleteMany({ where: { userId: memberId } }).catch(() => {})
    await prisma.teamMember.deleteMany({ where: { userId: memberId } }).catch(() => {})
  }
  if (teamId) await prisma.team.delete({ where: { id: teamId } }).catch(() => {})
  for (const id of [teamlessId, memberId]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {})
  }
  await prisma.$disconnect()
}
// auth.ts 的 ioredis 连接常驻，断言通过后要显式退出。
process.exit(0)
