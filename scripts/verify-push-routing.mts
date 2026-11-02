import { prisma } from '../src/lib/db'
import { NOTIFICATION_EVENT_TYPES } from '../src/lib/external-notifications/constants'
import { selectPushSubscriptions } from '../src/lib/push-notifications'
import { getProjectTeamAdminEmails } from '../src/lib/team-notification-recipients'

/**
 * 种子事件矩阵：在一次性测试库里造一支团队、一个项目、三种管理员和四条订阅，
 * 逐事件断言收件人。只做选择、不发推送；跑完删掉全部夹具。
 *
 * 跑法（必须指向测试库）：
 *   PUSH_ROUTING_TEST=1 DATABASE_URL=... npx tsx scripts/verify-push-routing.mts
 */
if (process.env.PUSH_ROUTING_TEST !== '1') {
  console.error('拒绝执行：设置 PUSH_ROUTING_TEST=1，并把 DATABASE_URL 指向一次性测试库。')
  process.exit(1)
}
const dbHost = (() => {
  try { return new URL(process.env.DATABASE_URL || '').host } catch { return '(invalid)' }
})()

let failures = 0
function expect(label: string, actual: unknown, want: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  if (!ok) {
    failures++
    console.log(`  ✗ ${label}\n     实际 ${JSON.stringify(actual)}\n     期望 ${JSON.stringify(want)}`)
  } else {
    console.log(`  ✓ ${label}`)
  }
}

async function main() {
  console.log(`测试库 ${dbHost}`)
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
  const userIds: string[] = []
  let teamId = ''
  let projectId = ''
  let teamBId = ''
  let projectBId = ''

  try {
    const creator = await prisma.user.create({
      data: { email: `routing-team-admin-${suffix}@example.invalid`, password: 'x', name: 'Team Admin' },
    })
    const platform = await prisma.user.create({
      data: { email: `routing-platform-${suffix}@example.invalid`, password: 'x', name: 'Platform Admin', isPlatformAdmin: true },
    })
    const both = await prisma.user.create({
      data: { email: `routing-both-${suffix}@example.invalid`, password: 'x', name: 'Platform + Team Admin', isPlatformAdmin: true },
    })
    const creatorB = await prisma.user.create({
      data: { email: `routing-team-b-${suffix}@example.invalid`, password: 'x', name: 'Team B Admin' },
    })
    userIds.push(creator.id, platform.id, both.id, creatorB.id)

    for (let attempt = 0; attempt < 20 && !teamId; attempt++) {
      const candidate = String(900000 + Math.floor(Math.random() * 99999))
      const taken = await prisma.team.findUnique({ where: { id: candidate }, select: { id: true } })
      if (!taken) teamId = candidate
    }
    if (!teamId) throw new Error('无法分配测试团队号')

    await prisma.team.create({
      data: {
        id: teamId,
        name: `Routing Test ${suffix}`,
        slug: `routing-test-${suffix}`,
        shareKey: `routing-share-${suffix}`,
        createdById: creator.id,
      },
    })
    await prisma.teamMember.create({ data: { teamId, userId: creator.id, role: 'OWNER' } })
    await prisma.teamMember.create({ data: { teamId, userId: both.id, role: 'ADMIN' } })

    const project = await prisma.project.create({
      data: {
        projectCode: `RT-${suffix}`,
        title: `Routing Test Project ${suffix}`,
        slug: `routing-project-${suffix}`,
        shareSlug: `routing-project-share-${suffix}`,
        createdById: creator.id,
        teamId,
      },
    })
    projectId = project.id

    for (let attempt = 0; attempt < 20 && !teamBId; attempt++) {
      const candidate = String(880000 + Math.floor(Math.random() * 79999))
      const taken = await prisma.team.findUnique({ where: { id: candidate }, select: { id: true } })
      if (!taken && candidate !== teamId) teamBId = candidate
    }
    if (!teamBId) throw new Error('无法分配测试团队号 B')

    await prisma.team.create({
      data: {
        id: teamBId,
        name: `Routing Test B ${suffix}`,
        slug: `routing-test-b-${suffix}`,
        shareKey: `routing-share-b-${suffix}`,
        createdById: creatorB.id,
      },
    })
    await prisma.teamMember.create({ data: { teamId: teamBId, userId: creatorB.id, role: 'OWNER' } })
    const projectB = await prisma.project.create({
      data: {
        projectCode: `RTB-${suffix}`,
        title: `Routing Test Project B ${suffix}`,
        slug: `routing-project-b-${suffix}`,
        shareSlug: `routing-project-b-share-${suffix}`,
        createdById: creatorB.id,
        teamId: teamBId,
      },
    })
    projectBId = projectB.id

    const allEvents = [...NOTIFICATION_EVENT_TYPES]
    const makeSub = async (userId: string, surface: string, events: string[], name: string) =>
      prisma.pushSubscription.create({
        data: {
          userId,
          endpoint: `https://example.invalid/push/${suffix}/${name}`,
          p256dh: `p256dh-${name}`,
          auth: `auth-${name}`,
          deviceName: name,
          surface,
          subscribedEvents: events,
        },
      })

    const support = await makeSub(platform.id, 'support', ['SUPPORT_NEW_MESSAGE'], 'support-device')
    const platformMain = await makeSub(platform.id, 'main', allEvents, 'platform-main')
    const teamMain = await makeSub(creator.id, 'main', allEvents, 'team-main')
    const bothMain = await makeSub(both.id, 'main', allEvents, 'both-main')
    const teamBMain = await makeSub(creatorB.id, 'main', allEvents, 'team-b-main')

    const ids = (selection: Awaited<ReturnType<typeof selectPushSubscriptions>>) =>
      selection.subscriptions.map((s) => s.id).sort()
    const payload = (data: Record<string, unknown> = {}) => ({ title: 'seed', body: 'seed', data })

    console.log('A 客服事件')
    const supportSelection = await selectPushSubscriptions('SUPPORT_NEW_MESSAGE', payload({ conversationId: 'c1' }))
    expect('客服包含本测试的 support 设备', ids(supportSelection).includes(support.id), true)
    expect('客服不进主 App 设备', ids(supportSelection).some((id) => [platformMain.id, teamMain.id, bothMain.id, teamBMain.id].includes(id)), false)

    console.log('B 安全/登录事件')
    const securitySelection = await selectPushSubscriptions('SECURITY_ALERT', payload())
    expect('安全只到平台管理员主 App', ids(securitySelection), [bothMain.id, platformMain.id].sort())
    expect('安全不进客服 surface', ids(securitySelection).includes(support.id), false)
    expect('非平台管理员的团队管理员不收安全', ids(securitySelection).includes(teamMain.id), false)

    console.log('B2 审计事件禁发')
    for (const eventType of ['ADMIN_ACCESS', 'SHARE_ACCESS'] as const) {
      const selection = await selectPushSubscriptions(eventType, payload({ projectId }))
      expect(`${eventType} 0 收件人`, ids(selection), [])
      expect(`${eventType} 原因 audit-only`, selection.reason, 'audit-only')
    }

    console.log('C 项目事件按团队 OWNER/ADMIN 路由')
    for (const eventType of ['CLIENT_COMMENT', 'CLIENT_UPLOAD', 'VIDEO_APPROVAL', 'DUE_DATE_REMINDER'] as const) {
      const selection = await selectPushSubscriptions(eventType, payload({ projectId }))
      expect(`${eventType} 到团队 OWNER/ADMIN`, ids(selection), [bothMain.id, teamMain.id].sort())
      expect(`${eventType} 不到 support`, ids(selection).includes(support.id), false)
      expect(`${eventType} 不到非团队管理员的平台管理员`, ids(selection).includes(platformMain.id), false)
      expect(`${eventType} 解析出 teamId`, selection.teamId, teamId)
    }

    console.log('C2 A/B 团队互不串台')
    const commentA = await selectPushSubscriptions('CLIENT_COMMENT', payload({ projectId }))
    const commentB = await selectPushSubscriptions('CLIENT_COMMENT', payload({ projectId: projectBId }))
    expect('A 批注到 A 的 OWNER/ADMIN', ids(commentA), [bothMain.id, teamMain.id].sort())
    expect('A 批注不到 B', ids(commentA).includes(teamBMain.id), false)
    expect('B 批注只到 B', ids(commentB), [teamBMain.id].sort())
    expect('B 批注不到 A', ids(commentB).some((id) => [teamMain.id, bothMain.id].includes(id)), false)
    expect('团队邮箱 A 只含 A 管理员', (await getProjectTeamAdminEmails(projectId)).sort(), [creator.email, both.email].sort())
    expect('团队邮箱 B 只含 B 管理员', (await getProjectTeamAdminEmails(projectBId)).sort(), [creatorB.email].sort())

    console.log('D 缺 projectId 时不乱发')
    const missing = await selectPushSubscriptions('CLIENT_COMMENT', payload())
    expect('缺 projectId 无收件人', ids(missing), [])
    expect('缺 projectId 有原因', missing.reason, 'missing-project')
  } finally {
    await prisma.pushDeliveryLog.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
    await prisma.pushSubscription.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
    if (projectId) await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => {})
    if (projectBId) await prisma.project.deleteMany({ where: { id: projectBId } }).catch(() => {})
    if (teamId) {
      await prisma.teamMember.deleteMany({ where: { teamId } }).catch(() => {})
      await prisma.team.deleteMany({ where: { id: teamId } }).catch(() => {})
    }
    if (teamBId) {
      await prisma.teamMember.deleteMany({ where: { teamId: teamBId } }).catch(() => {})
      await prisma.team.deleteMany({ where: { id: teamBId } }).catch(() => {})
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {})
    await prisma.$disconnect()
  }

  if (failures > 0) {
    console.error(`\n=== 种子事件矩阵 ${failures} 项未通过 ===`)
    process.exit(1)
  }
  console.log('\n=== 种子事件矩阵全部通过 ===')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
