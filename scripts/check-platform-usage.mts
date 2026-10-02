import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'

/**
 * 首页「每天使用量」判据。两类分开跑：
 *  行为 —— 真库真接口，钉北京日边界（漏了 +8h 会把今天算到昨天）、钉零使用日必须是 0 而不是缺行、
 *         钉独立会话按 sessionId 去重、钉回收站素材仍计入上传量。
 *  结构 —— 鉴权闸门与 days 参数钳位。
 * 判据键全部由 stamp 派生，finally 按键清场并读回。
 */
const BASE = process.env.PLATFORM_CHECK_BASE || 'http://localhost:3000'
const prisma = new PrismaClient()
const stamp = Date.now()
const failures: string[] = []
const tokens: string[] = []
const fixtureProjectIds: string[] = []

const slug = `usage-${stamp}`
const adminEmail = `usage-admin-${stamp}@example.invalid`
const videoName = `usage-video-${stamp}`
const projectTitle = `usage-project-${stamp}`
const analyticsNote = `usage-${stamp}`

const CN_OFFSET_MS = 8 * 3_600_000
const DAY_MS = 86_400_000

/** 库里所有 createdAt 都是 `timestamp without time zone` 存 UTC（生产实测），所以北京日 = UTC + 8h 取 date。 */
function toCnDay(d: Date) {
  return new Date(d.getTime() + CN_OFFSET_MS).toISOString().slice(0, 10)
}
function cnDayStart(d: Date) {
  const shifted = new Date(d.getTime() + CN_OFFSET_MS)
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - CN_OFFSET_MS
}

const todayStart = cnDayStart(new Date())
const atToday0001 = new Date(todayStart + 60_000)      // 北京今天 00:01 —— UTC 仍昨天，用来钉 +8h
const atYesterday2359 = new Date(todayStart - 60_000)  // 北京昨天 23:59
const TODAY = toCnDay(atToday0001)
const YESTERDAY = toCnDay(atYesterday2359)

function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

async function callUsage(token: string, query = '') {
  const res = await fetch(`${BASE}/api/platform/usage${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

async function login() {
  const res = await fetch(`${BASE}/api/platform/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: adminEmail, password: pw }),
  })
  const json = await res.json().catch(() => null)
  const token = json?.tokens?.accessToken
  if (!token) throw new Error(`平台登录失败 → ${res.status} ${JSON.stringify(json)?.slice(0, 120)}`)
  tokens.push(token)
  return token as string
}
const pw = `usage-${stamp}`

async function createFixtures() {
  const admin = await prisma.user.create({
    data: { email: adminEmail, name: 'usage-admin', password: await hashPassword(pw), isPlatformAdmin: true },
  })
  const team = await prisma.team.create({
    data: { name: slug, slug, shareKey: slug, createdById: admin.id, subscriptionPlan: 'BETA' },
  })
  const mkProject = (suffix: string, createdAt?: Date) => prisma.project.create({
    data: {
      title: `${projectTitle}${suffix}`, teamId: team.id, createdById: admin.id, authMode: 'NONE',
      projectCode: `U${String(stamp).slice(-6)}${suffix}`, slug: `${slug}-p${suffix}`, shareSlug: `usage-${stamp}${suffix}`,
      ...(createdAt ? { createdAt } : {}),
    },
  }).then((p) => { fixtureProjectIds.push(p.id); return p })
  const project = await mkProject('')
  const second = await mkProject('-b')
  const mk = (createdAt: Date, size: number, version: number, extra: Record<string, unknown> = {}) => prisma.video.create({
    data: {
      projectId: project.id, name: videoName, version, versionLabel: `v${version}`,
      originalFileName: `${videoName}.mp4`, originalFileSize: BigInt(size),
      originalStoragePath: `${slug}/${videoName}-v${version}-${createdAt.getTime()}`,
      duration: 1, width: 640, height: 360, status: 'READY', uploadedBy: admin.id, createdAt,
      ...extra,
    },
  })
  // 4 枚素材：今天 3（含 1 枚已在回收站）、昨天 1（卡在 +8h 边界外侧）
  const firstVideo = await mk(atToday0001, 1_000, 1)
  await mk(atToday0001, 2_000, 2, { deletedAt: atToday0001 })
  await mk(atToday0001, 4_000, 3)
  await mk(atYesterday2359, 8_000, 4)

  await mkProject('-u', atToday0001)

  // 访问：今天 3 行分布在 2 个项目；昨天 1 行
  await prisma.videoAnalytics.createMany({
    data: [
      { projectId: project.id, videoId: null, eventType: 'PAGE_VISIT', createdAt: atToday0001 },
      { projectId: project.id, videoId: null, eventType: 'PAGE_VISIT', createdAt: atToday0001 },
      { projectId: second.id, videoId: null, eventType: 'PAGE_VISIT', createdAt: atToday0001 },
      { projectId: project.id, videoId: null, eventType: 'PAGE_VISIT', createdAt: atYesterday2359 },
    ],
  })
  // 分享会话：今天两条同 sessionId ⇒ 必须只算 1
  await prisma.sharePageAccess.createMany({
    data: [
      { projectId: project.id, accessMethod: 'GUEST', sessionId: `same-${analyticsNote}`, createdAt: atToday0001 },
      { projectId: project.id, accessMethod: 'GUEST', sessionId: `same-${analyticsNote}`, createdAt: atToday0001 },
      { projectId: second.id, accessMethod: 'GUEST', sessionId: `other-${analyticsNote}`, createdAt: atToday0001 },
    ],
  })
  await prisma.comment.create({
    data: {
      projectId: project.id, videoId: firstVideo.id, timecode: '00:00:01:00',
      content: analyticsNote, userId: admin.id, createdAt: atToday0001,
    },
  })

  return { admin, team, project, second }
}

async function teardown() {
  const t = await prisma.team.findFirst({ where: { slug }, select: { id: true } })
  const projects = await prisma.project.findMany({ where: { teamId: t?.id ?? '__none__' }, select: { id: true } })
  const ids = projects.map((p) => p.id)
  if (ids.length) {
    await prisma.videoAnalytics.deleteMany({ where: { projectId: { in: ids } } })
    await prisma.sharePageAccess.deleteMany({ where: { projectId: { in: ids } } })
    await prisma.comment.deleteMany({ where: { projectId: { in: ids } } })
    await prisma.video.deleteMany({ where: { projectId: { in: ids } } })
    await prisma.project.deleteMany({ where: { id: { in: ids } } })
  }
  if (t) await prisma.team.deleteMany({ where: { id: t.id } })
  await prisma.user.deleteMany({ where: { email: adminEmail } })
}

try {
  await createFixtures()
  const token = await login()

  const anon = await callUsage('')
  check(anon.status === 401, '结构：无 token 必须 401', `→ ${anon.status}`)

  const res = await callUsage(token, '?days=14')
  check(res.status === 200, '行为：带 token 必须 200', `→ ${res.status} ${JSON.stringify(res.json)?.slice(0, 120)}`)

  const days: any[] = res.json?.days ?? []
  const byDay = new Map(days.map((d) => [d.day, d]))
  check(days.length === 14, '行为：days=14 必须返回 14 行（零使用日也要在）', `→ ${days.length}`)
  check(days.every((d) => Number.isInteger(d.newVideos) && Number.isInteger(d.uploadBytes)
    && Number.isInteger(d.visits) && Number.isInteger(d.shareSessions)
    && Number.isInteger(d.activeProjects) && Number.isInteger(d.comments)
    && Number.isInteger(d.newProjects) && Number.isInteger(d.newUsers)),
    '行为：每行九个指标都必须是整数')

  const today = byDay.get(TODAY)
  const yesterday = byDay.get(YESTERDAY)
  check(!!today && !!yesterday, '行为：今天与昨天的桶都要存在', `TODAY=${TODAY} YESTERDAY=${YESTERDAY}`)

  // +8h 边界：北京今天 00:01 的那枚素材（UTC 还在昨天）必须落进今天
  check(today?.newVideos >= 3 && today?.uploadBytes >= 7_000,
    '行为：北京今天 00:01 的上传必须算进今天（漏 +8h 会掉到昨天）',
    `→ newVideos=${today?.newVideos} bytes=${today?.uploadBytes}`)
  check(yesterday?.newVideos >= 1 && yesterday?.uploadBytes >= 8_000,
    '行为：北京昨天 23:59 的上传必须算进昨天',
    `→ newVideos=${yesterday?.newVideos} bytes=${yesterday?.uploadBytes}`)
  check(days.reduce((s, d) => s + d.newVideos, 0) >= 4,
    '行为：回收站里的素材也计入当天上传量', `→ 窗口合计 ${days.reduce((s: number, d: any) => s + d.newVideos, 0)}`)

  check(today?.visits === 3, '行为：访问次数按行计', `→ ${today?.visits}`)
  check(today?.activeProjects === 2, '行为：活跃项目按 distinct projectId', `→ ${today?.activeProjects}`)
  check(today?.shareSessions === 2, '行为：独立会话按 distinct sessionId 去重', `→ ${today?.shareSessions}`)
  check(today?.comments >= 1, '行为：新批注计入', `→ ${today?.comments}`)
  check(today?.newProjects >= 1, '行为：新建项目计入', `→ ${today?.newProjects}`)
  check(today?.newUsers >= 1, '行为：新用户计入（今天 00:01 建的账号）', `→ ${today?.newUsers}`)

  check(typeof res.json?.totalStoredBytes === 'number' && res.json.totalStoredBytes >= 15_000,
    '行为：存储总量是数值且含本次 fixture', `→ ${res.json?.totalStoredBytes}`)

  // 首页要把总量拆成「使用中 / 回收站」和四个来源，所以拆分必须自洽：两半相加就是总量。
  const st = res.json?.storage
  check(!!st && typeof st.liveBytes === 'number' && typeof st.recycleBinBytes === 'number'
    && st.liveBytes + st.recycleBinBytes === st.totalBytes && st.totalBytes === res.json?.totalStoredBytes,
    '行为：存储拆分三数自洽（使用中＋回收站＝总量＝totalStoredBytes）', `→ ${JSON.stringify(st)?.slice(0, 200)}`)
  check(!!st && st.recycleBinBytes >= 2_000 && st.liveBytes >= 13_000,
    '行为：回收站那枚素材单独计到 recycleBinBytes，其余在使用中',
    `→ bin=${st?.recycleBinBytes} live=${st?.liveBytes}`)
  check(!!st && ['video', 'asset', 'upload', 'photo'].every((k) => typeof st.bySource?.[k] === 'number'),
    '结构：bySource 四个来源都是数值', `→ ${JSON.stringify(st?.bySource)}`)
  check(!!st && st.bySource.video + st.bySource.asset + st.bySource.upload + st.bySource.photo === st.totalBytes,
    '行为：四来源相加就是总量（不许有落单的对象）',
    `→ ${st ? st.bySource.video + st.bySource.asset + st.bySource.upload + st.bySource.photo : 'undefined'} vs ${st?.totalBytes}`)
  check(!!st && st.bySource.video >= 15_000,
    '行为：视频来源含本次 fixture 的 15,000 字节', `→ video=${st?.bySource?.video}`)

  const wide = await callUsage(token, '?days=999')
  check(wide.status === 200 && wide.json?.days?.length === 31, '结构：days 超上限必须钳到 31', `→ ${wide.json?.days?.length}`)
  const junk = await callUsage(token, '?days=abc')
  check(junk.status === 200 && junk.json?.days?.length === 14, '结构：days 非数字回落到 14', `→ ${junk.json?.days?.length}`)

} catch (err) {
  failures.push(`中断：${String(err).slice(0, 1500)}`)
  console.error(`中断：${String(err).slice(0, 1500)}`)
} finally {
  for (const t of tokens) {
    await fetch(`${BASE}/api/platform/auth/logout`, {
      method: 'POST', headers: { authorization: `Bearer ${t}` },
    }).catch(() => null)
  }
  try {
    await teardown()
  } catch (err) {
    console.error(`LEAK 清场抛错，手工清：slug=${slug} email=${adminEmail}`, err)
    failures.push('清场抛错')
  }
  const left = {
    team: await prisma.team.count({ where: { slug } }),
    users: await prisma.user.count({ where: { email: adminEmail } }),
    projects: await prisma.project.count({ where: { title: { startsWith: projectTitle } } }),
    videos: await prisma.video.count({ where: { name: videoName } }),
    analytics: await prisma.videoAnalytics.count({ where: { projectId: { in: fixtureProjectIds } } }),
    shareAccess: await prisma.sharePageAccess.count({
      where: { sessionId: { in: [`same-${analyticsNote}`, `other-${analyticsNote}`] } },
    }),
  }
  if (left.team + left.users + left.projects + left.videos + left.analytics + left.shareAccess > 0) {
    console.error(`LEAK 读回来还有行：${JSON.stringify(left)} stamp=${stamp}`)
    failures.push('清场后仍有残留')
  }
  await prisma.$disconnect()
}

if (failures.length) {
  console.error(`\n${failures.length} 条失败：\n` + failures.join('\n'))
  process.exit(1)
}
console.log('\n全部断言通过')
