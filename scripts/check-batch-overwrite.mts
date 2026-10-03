import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { prisma } from '../src/lib/db'
import { hashPassword } from '../src/lib/encryption'

/**
 * 需求②「收录文件那里也需要一个多文件覆盖，就把选择相同名字的视频一键覆盖上去。覆盖的视频需要确定一下。」
 * 做法是把现成的单条 promote 端点在批量条上顺序跑一遍，服务端一字不改，所以判据分四组：
 *  A 现成能力（回归闸，动手前就该绿）—— 列表接口发的是显示名（中文名才配得上同名），
 *    同名组 promote 真的排到下一版而不是新建素材；
 *  B 计划函数（真调用，不是正则）—— 什么算「同名」、没同名的为什么被跳过、
 *    转码中与非视频为什么不进批次；
 *  C 界面接线（结构）—— 批量入口、逐行列出「文件 → 素材」的确认弹窗、进度与失败单独说、
 *    走的还是那条单条路由（不新造端点、不动 50 次/小时的限流）；
 *  D 文案 —— 四种语言的新 key 一个不缺。
 * 键全部由 stamp 派生，finally 删行、删一次性文件并读回残留。
 */
const BASE = process.env.SHARE_CHECK_BASE || 'http://localhost:3000'
const stamp = Date.now()
const failures: string[] = []
const teamSlug = `bov-${stamp}`
const ownerEmail = `bov-owner-${stamp}@example.invalid`
const ownerPw = `bov-${stamp}`
const UPLOAD_KEYS = [
  'bulkOverwrite',
  'overwriteConfirmTitle',
  'overwriteConfirmDescription',
  'overwriteInto',
  'overwriteSkipped',
  'overwriteNothingMatched',
  'overwriteProgress',
  'overwritePartial',
  'overwriteFailed',
]
const LOCALES = ['zh', 'en', 'de', 'nl']
const HERE = dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = join(HERE, '..', process.env.STORAGE_ROOT?.replace(/^\.\//, '') || 'uploads')

type PlanItem = { id: string; fileName: string; fileType: string | null; transcodeStatus: string }
type OverwritePlan = { matches: Array<{ uploadId: string; fileName: string; videoName: string }>; skipped: Array<{ uploadId: string; fileName: string }> }
type PlanModule = {
  buildOverwritePlan: (items: PlanItem[], videoNames: string[]) => OverwritePlan
  findTargetVideoName: (fileName: string, videoNames: string[]) => string | null
}

function report(ok: boolean, label: string, kind: '行为' | '结构' | '文案', detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} [${kind}] ${label}${detail ? ` → ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

function readSource(rel: string): string | null {
  const file = join(HERE, '..', 'src', rel)
  return existsSync(file) ? readFileSync(file, 'utf8') : null
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

/** 收进来但还没覆盖的文件：一条 ProjectUpload 加一个真存在于磁盘上的原片。 */
async function collectFile(projectId: string, displayFileName: string, storageName: string) {
  const storagePath = `tests/${stamp}/${storageName}`
  const absolute = join(STORAGE_ROOT, storagePath)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, Buffer.alloc(2048, 7))
  return prisma.projectUpload.create({
    data: {
      projectId,
      fileName: storageName,
      originalFileName: displayFileName,
      fileSize: BigInt(2048),
      fileType: 'video/mp4',
      storagePath,
      category: 'project',
      uploadCompletedAt: new Date(),
      transcodeStatus: 'READY',
    },
  })
}

const ready = (id: string, fileName: string): PlanItem => ({ id, fileName, fileType: 'video/mp4', transcodeStatus: 'READY' })

try {
  const owner = await prisma.user.create({
    data: { email: ownerEmail, name: 'bov-owner', password: await hashPassword(ownerPw), phone: `139${String(stamp).slice(-8)}` },
  })
  const team = await prisma.team.create({
    data: {
      name: teamSlug, slug: teamSlug, shareKey: teamSlug, createdById: owner.id,
      subscriptionPlan: 'BETA',
      members: { create: { userId: owner.id, role: 'OWNER', status: 'ACTIVE' } },
    },
  })
  const project = await prisma.project.create({
    data: {
      teamId: team.id, createdById: owner.id,
      projectCode: `BO${String(stamp).slice(-7)}`, title: `bov-${stamp}`,
      slug: `bov-${stamp}`, shareSlug: `bovs-${stamp}`,
    },
  })
  const login = await call('POST', '/api/auth/login', '', { email: ownerEmail, password: ownerPw })
  const token = login.json?.tokens?.accessToken as string | undefined
  if (!token) throw new Error(`登录失败 → ${login.status}`)

  // 同名组：库里先有一条 v1，收录进来一份同名的原片。
  const groupName = `城市夜景-${stamp}`
  await prisma.video.create({
    data: {
      projectId: project.id, name: groupName, version: 1, versionLabel: 'v1',
      originalFileName: `${groupName}.mp4`, originalFileSize: BigInt(1024),
      originalStoragePath: `tests/${stamp}/existing.mp4`,
      duration: 12, width: 1920, height: 1080, status: 'READY',
    },
  })
  const matched = await collectFile(project.id, `${groupName}.mp4`, `ascii-${stamp}.mp4`)

  // ── A 现成能力（动手前就该绿，改坏了会在这里响）──────────────────────
  const list = await call('GET', `/api/projects/${project.id}/project-uploads`, token)
  const listed = (list.json?.uploads || []).find((u: { id: string }) => u.id === matched.id)
  report(list.status === 200 && !!listed, 'A1 收录列表读得到刚收进来的文件', '行为', `→ ${list.status}`)
  report(listed?.fileName === `${groupName}.mp4`, 'A2 列表发的是显示名（中文名才配得上同名）', '行为', `→ fileName=${listed?.fileName}`)

  const promoted = await call('POST', `/api/projects/${project.id}/project-uploads/${matched.id}/promote`, token, { videoName: groupName })
  report(promoted.status === 200, 'A3 同名 promote 成功', '行为', `→ ${promoted.status} ${JSON.stringify(promoted.json ?? '').slice(0, 140)}`)
  report(promoted.json?.version === 2 && promoted.json?.videoName === groupName, 'A3b 排到了该组的第 2 版，不是另起素材', '行为', `→ v=${promoted.json?.version} name=${promoted.json?.videoName}`)
  report(await prisma.projectUpload.count({ where: { id: matched.id } }) === 0, 'A3c 覆盖完这条收录记录就没了（不会重复覆盖）', '行为')
  const versions = await prisma.video.findMany({ where: { projectId: project.id, name: groupName }, select: { version: true } })
  report(versions.length === 2, 'A3d 组里现在是两版', '行为', `→ ${versions.map((v) => v.version).join(',')}`)

  // ── B 计划函数（真调用；动手前该红，因为函数还不存在）─────────────────
  let plan: PlanModule | null = null
  try {
    plan = (await import('../src/lib/overwrite-plan')) as unknown as PlanModule
  } catch {
    plan = null
  }
  report(!!plan, 'B0 存在可单独测的覆盖计划函数', '行为')

  if (plan) {
    const assets = ['城市夜景', 'Sunset BEACH', '预告片']
    const single = plan.buildOverwritePlan([ready('u1', '城市夜景.mp4')], assets)
    report(
      single.matches.length === 1 && single.matches[0].videoName === '城市夜景' && single.skipped.length === 0,
      'B1 中文名去扩展名后命中素材', '行为', JSON.stringify(single)
    )

    const cased = plan.buildOverwritePlan([ready('u2', 'sunset beach.MOV')], assets)
    report(
      cased.matches.length === 1 && cased.matches[0].videoName === 'Sunset BEACH',
      'B2 忽略大小写，且用的是素材自己那个名字（大小写不被改写）', '行为', JSON.stringify(cased)
    )

    const unmatched = plan.buildOverwritePlan([ready('u3', '新片子.mp4')], assets)
    report(
      unmatched.matches.length === 0 && unmatched.skipped.length === 1 && unmatched.skipped[0].uploadId === 'u3',
      'B3 库里没同名的不算覆盖，进 skipped（批量路径不许顺手新建素材）', '行为', JSON.stringify(unmatched)
    )

    const mixed = plan.buildOverwritePlan([ready('u4', '预告片.mp4'), ready('u5', '花絮.mp4'), ready('u6', '废片.mp4')], assets)
    report(
      mixed.matches.length === 1 && mixed.skipped.length === 2,
      'B4 选中 3 份：1 份覆盖、2 份跳过，各报各的', '行为', JSON.stringify(mixed)
    )

    const processing = plan.buildOverwritePlan(
      [{ id: 'u7', fileName: '城市夜景.mp4', fileType: 'video/mp4', transcodeStatus: 'PROCESSING' }], assets
    )
    report(
      processing.matches.length === 0 && processing.skipped.length === 1,
      'B5 还在转码的文件不进批次（服务端本来就拒绝，界面不许白跑一趟）', '行为', JSON.stringify(processing)
    )

    const image = plan.buildOverwritePlan(
      [{ id: 'u8', fileName: '城市夜景.png', fileType: 'image/png', transcodeStatus: 'READY' }, ready('u9', '城市夜景.mp4')],
      assets
    )
    report(
      image.matches.length === 1 && image.matches[0].uploadId === 'u9' && image.skipped.length === 1,
      'B6 非视频文件不进批次，同名的视频那份照常覆盖', '行为', JSON.stringify(image)
    )

    const none = plan.buildOverwritePlan([], assets)
    report(none.matches.length === 0 && none.skipped.length === 0, 'B7 一份都没选时计划是空的', '行为', JSON.stringify(none))

    report(plan.findTargetVideoName('城市夜景.mp4', assets) === '城市夜景', 'B8 单条对话框与批量共用同一枚匹配函数', '行为', `→ ${plan.findTargetVideoName('城市夜景.mp4', assets)}`)
    report(plan.findTargetVideoName('没有这个名字.mp4', assets) === null, 'B8b 匹配不到时返回 null，对话框才落回「新建素材」', '行为')
  }

  // ── C 界面接线（结构；动手前该红）────────────────────────────────────
  const ui = readSource('components/ProjectUploadsBlock.tsx') || ''
  report(/bulkOverwrite|handleBulkOverwrite/.test(ui), 'C1 批量条里有「覆盖到同名视频」入口', '结构')
  report(/overwriteConfirmTitle/.test(ui), 'C2 动手前有确认弹窗', '结构')
  report(/buildOverwritePlan/.test(ui), 'C3 弹窗与执行都吃同一份计划（不是界面里另写一遍匹配）', '结构')
  report(/overwriteInto/.test(ui), 'C4 弹窗逐行列出「文件 → 目标素材」', '结构')
  report(/overwriteSkipped/.test(ui), 'C5 跳过的数量要报出来', '结构')
  report(/overwriteNothingMatched/.test(ui), 'C6 一份都没匹配上时要有话，不许静默成功', '结构')
  report(/overwriteProgress/.test(ui), 'C7 逐条进度（第 N / 共 M）', '结构')
  report(/overwritePartial|overwriteFailed/.test(ui), 'C8 失败单独说，不许吞', '结构')
  report(/findTargetVideoName/.test(ui), 'C9 单条对话框改成共用那枚匹配函数', '结构')
  report(/project-uploads\/\$\{[^}]*\}\/promote/.test(ui), 'C10 走的是现成的单条 promote 路由', '结构')
  const batchRoute = existsSync(join(HERE, '..', 'src/app/api/projects/[id]/project-uploads/batch-promote'))
  report(!batchRoute, 'C11 没有另造批量端点（限流口径原样保留）', '结构')
  const singleRoute = readSource('app/api/projects/[id]/project-uploads/[uploadId]/promote/route.ts') || ''
  report(/maxRequests:\s*50/.test(singleRoute) && /60 \* 60 \* 1000/.test(singleRoute), 'C12 单条 promote 的 50 次/小时闸门一字未改', '结构')

  for (const locale of LOCALES) {
    const messages = JSON.parse(readSource(`locales/${locale}.json`) || '{}')
    const missing = UPLOAD_KEYS.filter((key) => typeof messages.projects?.[key] !== 'string' || !messages.projects[key].trim())
    report(missing.length === 0, `D1 ${locale} 补齐 ${UPLOAD_KEYS.length} 个新 key`, '文案', missing.length ? `缺 ${missing.join(', ')}` : '')
  }
  const zhText = readSource('locales/zh.json') || ''
  report(/overwriteConfirmDescription["']?\s*:\s*"[^"]*\{count\}/.test(zhText), 'D2 确认句报得出条数', '文案')
  report(/overwriteProgress["']?\s*:\s*"[^"]*\{done\}[^"]*\{total\}/.test(zhText), 'D3 进度句有当前与总数', '文案')
  report(/overwriteSkipped["']?\s*:\s*"[^"]*\{count\}/.test(zhText), 'D4 跳过句报得出个数', '文案')
} finally {
  const teamRow = await prisma.team.findFirst({ where: { slug: teamSlug }, select: { id: true } })
  // promote 把收录原片搬进 teams/<teamId>/projects/<projectId>/videos/，行删了文件还在，
  // 所以清场必须连这支团队自己的存储目录一起删。
  const teamStorageDir = teamRow ? join(STORAGE_ROOT, 'teams', teamRow.id) : ''
  if (teamStorageDir) rmSync(teamStorageDir, { recursive: true, force: true })
  if (teamRow) {
    const projectIds = (await prisma.project.findMany({ where: { teamId: teamRow.id }, select: { id: true } })).map((p) => p.id)
    for (const pid of projectIds) {
      await prisma.projectUpload.deleteMany({ where: { projectId: pid } })
      await prisma.recycleBinItem.deleteMany({ where: { projectId: pid } })
      await prisma.video.deleteMany({ where: { projectId: pid } })
      await prisma.securityEvent.deleteMany({ where: { projectId: pid } })
    }
    await prisma.project.deleteMany({ where: { teamId: teamRow.id } })
    await prisma.teamMember.deleteMany({ where: { teamId: teamRow.id } })
    await prisma.team.deleteMany({ where: { id: teamRow.id } })
  }
  await prisma.user.deleteMany({ where: { email: ownerEmail } })
  rmSync(join(STORAGE_ROOT, 'tests', String(stamp)), { recursive: true, force: true })
  const left = {
    uploads: await prisma.projectUpload.count({ where: { project: { team: { slug: teamSlug } } } }),
    videos: await prisma.video.count({ where: { project: { team: { slug: teamSlug } } } }),
    projects: await prisma.project.count({ where: { team: { slug: teamSlug } } }),
    teams: await prisma.team.count({ where: { slug: teamSlug } }),
    users: await prisma.user.count({ where: { email: ownerEmail } }),
    files: existsSync(join(STORAGE_ROOT, 'tests', String(stamp))) || (teamStorageDir !== '' && existsSync(teamStorageDir)),
  }
  if (left.uploads + left.videos + left.projects + left.teams + left.users > 0 || left.files) {
    console.error(`LEAK 清场后仍有残留：${JSON.stringify(left)} stamp=${stamp}`)
    failures.push('清场后仍有残留')
  }
  console.log(`CLEANUP ${JSON.stringify(left)}`)
}

console.log(`\n${failures.length === 0 ? 'ALL PASS' : `${failures.length} FAILED`}`)
for (const f of failures) console.log(`  · ${f}`)
await prisma.$disconnect()
process.exit(failures.length === 0 ? 0 : 1)
