import { existsSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { prisma, INCLUDE_DELETED } from '../src/lib/db'
import { hashPassword } from '../src/lib/encryption'
import { createRecycleBinItem } from '../src/lib/recycle-bin'

/**
 * 需求①「回收站需要一个清空回收站的功能」。判据分三组，行为组全走真库真 HTTP：
 *  A 端点结构 —— 路由存在、导出 POST、三道闸门（登录 / 项目可达 / 限流）一道不能少，
 *    且必须复用现成的 permanentlyDeleteRecycleBinItem，不许另写一份删除逻辑；
 *  B 端点行为 —— 入参校验（缺字段、非数组、空数组、超上限）、真按 id 逐条彻底删除、
 *    没勾选的一条不许被连坐、跨项目的 id 清不动、不存在的 id 记成失败而不是 500、
 *    重复提交同一个 id 不许谎报成功、清完再读列表是空的；
 *  C 界面与文案 —— 勾选框、全选、「清空回收站」与「永久删除所选」两枚入口、动手前的确认弹窗、
 *    四种语言的新 key 一个不缺、确认句必须带条数（不许只写「确定吗」）。
 * 键全部由 stamp 派生，finally 按 slug 清场并读回残留。
 */
const BASE = process.env.SHARE_CHECK_BASE || 'http://localhost:3000'
const stamp = Date.now()
const failures: string[] = []
const teamSlug = `rbc-${stamp}`
const ownerEmail = `rbc-owner-${stamp}@example.invalid`
const ownerPw = `rbc-${stamp}`
const PURGE_KEYS = [
  'recycleBinClearAll',
  'recycleBinDeleteSelected',
  'recycleBinConfirmClearAll',
  'recycleBinConfirmDeleteSelected',
  'recycleBinSelectedCount',
  'recycleBinSelectAll',
  'recycleBinDeselectAll',
  'recycleBinSelectItem',
  'recycleBinClearing',
  'recycleBinClearDone',
  'recycleBinClearPartial',
  'recycleBinClearFailed',
]
const COUNTED_KEYS = [
  'recycleBinConfirmClearAll',
  'recycleBinConfirmDeleteSelected',
  'recycleBinSelectedCount',
  'recycleBinClearDone',
  'recycleBinClearPartial',
]
const LOCALES = ['zh', 'en', 'de', 'nl']

function report(ok: boolean, label: string, kind: '行为' | '结构' | '文案', detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} [${kind}] ${label}${detail ? ` → ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

/** 相对脚本自己而不是 cwd 解析：`fs` 走的是进程工作目录，模块说明符走的才是本文件。 */
function readSource(rel: string): string | null {
  const file = fileURLToPath(new URL(`../src/${rel}`, import.meta.url))
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

function readLocale(locale: string): Record<string, any> {
  return JSON.parse(readSource(`locales/${locale}.json`) ?? '{}')
}

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

const purgePath = (projectId: string) => `/api/projects/${projectId}/recycle-bin/purge`

/** 照 videos/[id] 的删除分支一模一样地造记录：视频行还在，只是立了墓碑。 */
async function putVideoInBin(projectId: string, name: string) {
  const video = await prisma.video.create({
    data: {
      projectId, name, version: 1, versionLabel: 'v1',
      originalFileName: `${name}.mp4`, originalFileSize: BigInt(1024),
      originalStoragePath: `tests/${stamp}/${name}.mp4`,
      duration: 12, width: 1920, height: 1080, status: 'READY',
    },
  })
  await prisma.$transaction(async (tx) => {
    await createRecycleBinItem(tx, projectId, {
      itemType: 'VIDEO',
      itemName: `${name} v1`,
      metadata: { videoId: video.id, originalFileName: `${name}.mp4`, name, version: 1 },
      paths: [`tests/${stamp}/${name}.mp4`],
      directories: [],
    })
    await tx.video.update({ where: { id: video.id }, data: { deletedAt: new Date() } })
  })
  const item = await prisma.recycleBinItem.findFirst({ where: { projectId, itemName: `${name} v1` } })
  return { videoId: video.id, itemId: item!.id }
}

async function binItemAlive(itemId: string) {
  return Boolean(await prisma.recycleBinItem.findUnique({ where: { id: itemId }, select: { id: true } }))
}

/** 「彻底删除」的判据只能是行真的没了；带墓碑读一次，还在就是没删干净。 */
async function videoRowGone(videoId: string) {
  const row = await prisma.video.findUnique({ where: { id: videoId, deletedAt: INCLUDE_DELETED }, select: { id: true } })
  return row === null
}

try {
  const owner = await prisma.user.create({
    data: { email: ownerEmail, name: 'rbc-owner', password: await hashPassword(ownerPw), phone: `138${String(stamp).slice(-8)}` },
  })
  const team = await prisma.team.create({
    data: {
      name: teamSlug, slug: teamSlug, shareKey: teamSlug, createdById: owner.id,
      subscriptionPlan: 'BETA',
      members: { create: { userId: owner.id, role: 'OWNER', status: 'ACTIVE' } },
    },
  })
  const createProject = (tag: string) => prisma.project.create({
    data: {
      teamId: team.id, createdById: owner.id,
      projectCode: `RB${tag}${String(stamp).slice(-7)}`, title: `rbc-${tag}-${stamp}`,
      slug: `rbc-${tag}-${stamp}`, shareSlug: `rbcs-${tag}-${stamp}`,
    },
  })
  const projectA = await createProject('a')
  const projectB = await createProject('b')
  const a1 = await putVideoInBin(projectA.id, `a1-${stamp}`)
  const a2 = await putVideoInBin(projectA.id, `a2-${stamp}`)
  const a3 = await putVideoInBin(projectA.id, `a3-${stamp}`)
  const b1 = await putVideoInBin(projectB.id, `b1-${stamp}`)
  const allFixtures = [a1, a2, a3, b1]

  const login = await call('POST', '/api/auth/login', '', { email: ownerEmail, password: ownerPw })
  const token = login.json?.tokens?.accessToken as string | undefined
  if (!token) throw new Error(`登录失败 → ${login.status} ${JSON.stringify(login.json)}`)

  // ── A 端点结构 ────────────────────────────────────────────────────────
  const routeSource = readSource('app/api/projects/[id]/recycle-bin/purge/route.ts')
  report(routeSource !== null, 'A1 存在 purge 路由', '结构', 'src/app/api/projects/[id]/recycle-bin/purge/route.ts')
  if (routeSource) {
    report(/export\s+async\s+function\s+POST/.test(routeSource), 'A2 导出 POST', '结构')
    report(/requireApiAdmin\s*\(/.test(routeSource), 'A3 登录闸门 requireApiAdmin', '结构')
    report(/canAccessProject\s*\(/.test(routeSource), 'A4 项目可达闸门 canAccessProject', '结构')
    report(/rateLimit\s*\(/.test(routeSource), 'A5 有限流（批量删除必须挡刷）', '结构')
    report(/permanentlyDeleteRecycleBinItem|purgeRecycleBinItems/.test(routeSource), 'A6 复用现成的彻底删除核心，不另写一份', '结构')
  }

  // ── B 端点行为 ────────────────────────────────────────────────────────
  const noAuth = await call('POST', purgePath(projectA.id), '', { itemIds: [a1.itemId] })
  report(noAuth.status === 401, 'B1 无凭据 401', '行为', `→ ${noAuth.status}`)
  report(await binItemAlive(a1.itemId), 'B1b 无凭据那次没清掉任何东西', '行为')

  const missing = await call('POST', purgePath(projectA.id), token, {})
  report(missing.status === 400, 'B2 缺 itemIds 回 400', '行为', `→ ${missing.status}`)
  const notArray = await call('POST', purgePath(projectA.id), token, { itemIds: 'whatever' })
  report(notArray.status === 400, 'B3 itemIds 非数组回 400', '行为', `→ ${notArray.status}`)
  const emptyArray = await call('POST', purgePath(projectA.id), token, { itemIds: [] })
  report(emptyArray.status === 400, 'B4 空数组回 400（不许当成「全清」）', '行为', `→ ${emptyArray.status}`)
  const tooMany = await call('POST', purgePath(projectA.id), token, {
    itemIds: Array.from({ length: 101 }, (_unused, i) => `nope-${stamp}-${i}`),
  })
  report(tooMany.status === 400, 'B5 一次超过 100 条回 400', '行为', `→ ${tooMany.status}`)
  for (const fixture of allFixtures) {
    report(await binItemAlive(fixture.itemId), `B5b 被拒的这几趟一条都没清（${fixture.itemId.slice(-4)}）`, '行为')
  }

  const partial = await call('POST', purgePath(projectA.id), token, { itemIds: [a1.itemId, a2.itemId] })
  report(partial.status === 200, 'B6 勾选两条 → 200', '行为', `→ ${partial.status} ${JSON.stringify(partial.json ?? '').slice(0, 120)}`)
  report(partial.json?.purged === 2, 'B6b 回报 purged=2', '行为', `→ purged=${partial.json?.purged}`)
  report(Array.isArray(partial.json?.failed), 'B6c 回报 failed 数组', '行为', `→ ${JSON.stringify(partial.json?.failed)}`)
  report(!(await binItemAlive(a1.itemId)) && !(await binItemAlive(a2.itemId)), 'B6d 两条回收站记录都没了', '行为')
  report(await videoRowGone(a1.videoId) && await videoRowGone(a2.videoId), 'B6e 两条背后的 Video 行真的消失（不是又立一层墓碑）', '行为')
  report(await binItemAlive(a3.itemId), 'B7 没勾选的那条还在回收站（不连坐）', '行为')
  report(!(await videoRowGone(a3.videoId)), 'B7b 没勾选的那条视频行仍带墓碑在', '行为')

  const crossProject = await call('POST', purgePath(projectA.id), token, { itemIds: [b1.itemId] })
  report(await binItemAlive(b1.itemId), 'B8 拿 A 项目的入口清不动 B 项目的记录', '行为', `→ ${JSON.stringify(crossProject.json)}`)
  report((crossProject.json?.purged ?? -1) === 0, 'B8b 跨项目那条算没清掉，不报成功', '行为', `→ purged=${crossProject.json?.purged}`)

  const bogus = await call('POST', purgePath(projectA.id), token, { itemIds: [`missing-${stamp}`] })
  report(bogus.status === 200, 'B9 不存在的 id 不炸 500', '行为', `→ ${bogus.status}`)
  report((bogus.json?.failed?.length ?? 0) === 1, 'B9b 不存在的 id 进了 failed', '行为', `→ ${JSON.stringify(bogus.json?.failed)}`)

  const repeated = await call('POST', purgePath(projectA.id), token, { itemIds: [a1.itemId, `missing-${stamp}x`] })
  report((repeated.json?.purged ?? -1) === 0, 'B10 重复提交已清掉的 id 不谎报成功', '行为', `→ ${JSON.stringify(repeated.json)}`)

  const last = await call('POST', purgePath(projectA.id), token, { itemIds: [a3.itemId] })
  report(last.json?.purged === 1, 'B11 逐条勾到最后一条也清得掉', '行为', `→ ${JSON.stringify(last.json)}`)
  const listAfter = await call('GET', `/api/projects/${projectA.id}/recycle-bin`, token)
  report(
    Array.isArray(listAfter.json?.items) && listAfter.json.items.length === 0,
    'B12 清完再读列表是空的',
    '行为',
    `→ items=${JSON.stringify(listAfter.json?.items?.length)}`,
  )
  const b1Still = await call('GET', `/api/projects/${projectB.id}/recycle-bin`, token)
  report((b1Still.json?.items?.length ?? 0) === 1, 'B13 B 项目的回收站完全没被牵连', '行为', `→ items=${JSON.stringify(b1Still.json?.items?.length)}`)

  // ── C 界面与文案 ──────────────────────────────────────────────────────
  const ui = readSource('components/RecycleBinBlock.tsx') || ''
  report(/type="checkbox"/.test(ui), 'C1 每行有勾选框', '结构')
  report(/recycleBinSelectAll/.test(ui), 'C2 有全选入口', '结构')
  report(/recycleBinClearAll/.test(ui), 'C3 有「清空回收站」按钮', '结构')
  report(/recycleBinDeleteSelected/.test(ui), 'C4 有「永久删除所选」按钮', '结构')
  report(/appConfirm\s*\(\s*\{/.test(ui) && /recycleBinConfirm(ClearAll|DeleteSelected)/.test(ui), 'C5 动手前有带新文案的确认弹窗', '结构')
  report(/recycle-bin\/purge/.test(ui), 'C6 前端打的是 purge 端点', '结构')
  report(/recycleBinClearPartial/.test(ui), 'C7 部分失败要说话，不许静默', '结构')

  for (const locale of LOCALES) {
    const messages = readLocale(locale)
    const missingKeys = PURGE_KEYS.filter((key) => typeof messages.projects?.[key] !== 'string' || !messages.projects[key].trim())
    report(missingKeys.length === 0, `C8 ${locale} 补齐 12 个新 key`, '文案', missingKeys.length ? `缺 ${missingKeys.join(', ')}` : '')
  }
  const zh = readLocale('zh')
  const noInterp = COUNTED_KEYS.filter((key) => !String(zh.projects?.[key] ?? '').includes('{'))
  report(COUNTED_KEYS.every((k) => zh.projects?.[k]) && noInterp.length === 0, 'C9 带数量的句子必须插值（不许只写「确定吗」）', '文案', noInterp.length ? `没插值：${noInterp.join(', ')}` : '')
  report(
    /recycleBinConfirmClearAll["']?\s*:\s*"[^"]*\{count\}[^"]*"/.test(readSource('locales/zh.json') ?? ''),
    'C10 清空确认句里真的写了条数占位',
    '文案',
  )
} finally {
  const teamRow = await prisma.team.findFirst({ where: { slug: teamSlug }, select: { id: true } })
  if (teamRow) {
    const projectIds = (await prisma.project.findMany({ where: { teamId: teamRow.id }, select: { id: true } })).map((p) => p.id)
    for (const pid of projectIds) {
      await prisma.recycleBinItem.deleteMany({ where: { projectId: pid } })
      await prisma.video.deleteMany({ where: { projectId: pid } })
    }
    await prisma.project.deleteMany({ where: { teamId: teamRow.id } })
    await prisma.teamMember.deleteMany({ where: { teamId: teamRow.id } })
    await prisma.team.deleteMany({ where: { id: teamRow.id } })
  }
  await prisma.user.deleteMany({ where: { email: ownerEmail } })
  const left = {
    bin: await prisma.recycleBinItem.count({ where: { project: { team: { slug: teamSlug } } } }),
    videos: await prisma.video.count({ where: { project: { team: { slug: teamSlug } }, deletedAt: INCLUDE_DELETED } }),
    projects: await prisma.project.count({ where: { team: { slug: teamSlug } } }),
    teams: await prisma.team.count({ where: { slug: teamSlug } }),
    users: await prisma.user.count({ where: { email: ownerEmail } }),
  }
  if (left.bin + left.videos + left.projects + left.teams + left.users > 0) {
    console.error(`LEAK 清场后仍有残留：${JSON.stringify(left)} stamp=${stamp}`)
    failures.push('清场后仍有残留')
  }
  console.log(`CLEANUP ${JSON.stringify(left)}`)
}

console.log(`\n${failures.length === 0 ? 'ALL PASS' : `${failures.length} FAILED`}`)
for (const f of failures) console.log(`  · ${f}`)
await prisma.$disconnect()
process.exit(failures.length === 0 ? 0 : 1)
