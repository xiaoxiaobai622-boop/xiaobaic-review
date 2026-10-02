/**
 * 体检修复判据（102-110 服务端 / 112-116 客户端；105 经查清判定不动，见报告）。
 * 跑法：npx tsx scripts/check-resilience.mts（行为用例要他自己的 next dev 在 :3000 上活着）
 * 口径逐条标在输出里：
 *   行为 = 真跑生产代码路径（黑洞 HTTP 服务器、真 ffprobe 读 FIFO、真库、真并发 HTTP）
 *   结构 = 只断源码形状（没有可注入边界，或必须 React 运行时才观测得到）
 * 全程只在本地库建 stamp 派生的一次性 fixture，删完读回来自查。
 */
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'
import { createServer } from 'http'
import { readFileSync } from 'fs'
import path from 'path'

const prisma = new PrismaClient()
const BASE = process.env.RESILIENCE_CHECK_BASE || 'http://localhost:3000'
const stamp = Date.now()
const failures: string[] = []
const sourceCache = new Map<string, string>()

function load(rel: string): string {
  if (!sourceCache.has(rel)) sourceCache.set(rel, readFileSync(path.resolve(process.cwd(), rel), 'utf8'))
  return sourceCache.get(rel)!
}

function report(ok: boolean, label: string, kind: '行为' | '结构', detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} [${kind}] ${label} — ${detail}`)
  if (!ok) failures.push(label)
}

/** 在 ms 内落定就算 settled（reject 也算落定），没落定就是真挂着 */
async function within(promise: Promise<unknown>, ms: number): Promise<{ settled: boolean; elapsedMs: number; error?: unknown }> {
  const startedAt = Date.now()
  const holder: { error?: unknown } = {}
  const settled = await Promise.race([
    promise.then(() => true, (e) => { holder.error = e; return true }),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ])
  return { settled, elapsedMs: Date.now() - startedAt, error: holder.error }
}

/** 从 `fetch(` 的左括号走到配平的右括号，返回这段调用文本 */
function fetchCallText(text: string, matchIndex: number): string {
  const open = text.indexOf('(', text.indexOf('fetch(', matchIndex))
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') { depth--; if (depth === 0) return text.slice(open, i + 1) }
  }
  return text.slice(open)
}

/** 服务端往第三方发的 fetch 必须带超时；返回缺 signal 的行号 */
function fetchSitesMissingSignal(rel: string): { total: number; missing: number[] } {
  const text = load(rel)
  const missing: number[] = []
  let total = 0
  const re = /await\s+fetch\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    total++
    if (!/AbortSignal\.timeout|signal:/.test(fetchCallText(text, m.index))) {
      missing.push(text.slice(0, m.index).split('\n').length)
    }
  }
  return { total, missing }
}

// ---------------------------------------------------------------- 行为

/** 104：端点收下连接却永不回应时，S3 读元数据必须自己限时断开 */
async function caseS3BlackHole() {
  const hole = createServer(() => { /* accept, never respond */ })
  await new Promise<void>((r) => hole.listen(0, '127.0.0.1', r))
  const port = (hole.address() as { port: number }).port
  Object.assign(process.env, {
    S3_ENDPOINT: `http://127.0.0.1:${port}`,
    S3_ACCESS_KEY_ID: 'probe-key',
    S3_SECRET_ACCESS_KEY: 'probe-secret',
    S3_BUCKET: 'probe-bucket',
    S3_FORCE_PATH_STYLE: 'true',
    MEDIA_CDN_ENABLED: 'false',
  })
  try {
    const { s3FileExists } = await import('../src/lib/s3-storage')
    const r = await within(s3FileExists(`resilience-${stamp}`), 45_000)
    report(r.settled, '104 S3 元数据读对黑洞端点必须限时落定', '行为',
      r.settled ? `${r.elapsedMs}ms 落定（${String(r.error).slice(0, 70)}）` : `45 秒仍未落定 = 没有任何超时`)
  } finally {
    hole.closeAllConnections()
    hole.close()
  }
}

/** 103 的 ffprobe 这一半：黑洞端点上实测它 23ms 内吐完 banner 就再无输出，正是无进度看门狗要抓的形状 */
async function caseFfprobeBlackHole() {
  const hole = createServer(() => { /* accept, never respond */ })
  await new Promise<void>((r) => hole.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(hole.address() as { port: number }).port}/stream`
  try {
    const { getVideoMetadata } = await import('../src/lib/ffmpeg')
    const r = await within(getVideoMetadata(url), 30_000)
    report(r.settled, '103 ffprobe 对永不回数据的输入必须限时失败', '行为',
      r.settled ? `${r.elapsedMs}ms 落定（${String(r.error).slice(0, 70)}）` : '30 秒仍未落定 = 没有看门狗')
  } finally {
    hole.closeAllConnections()
    hole.close()
  }
}

/** 109：永久失败的那条持久任务必须走到终局，而不是每小时重投到永远 */
async function caseDurableTaskTerminal() {
  const dedupeKey = `resilience-${stamp}`
  try {
    const task = await prisma.durableTask.create({
      data: { kind: 'UNSUPPORTED_PROBE_KIND', dedupeKey, payload: { probe: true } },
    })
    const { dispatchDurableTask } = await import('../src/lib/durable-tasks')
    let attempts = 0
    let gone = false
    for (let round = 0; round < 12; round++) {
      // 只把退避时钟拨快，投的仍然是生产那条函数与那个分支
      await prisma.durableTask.update({ where: { id: task.id }, data: { availableAt: new Date() } })
      await dispatchDurableTask(task.id)
      const row = await prisma.durableTask.findUnique({ where: { id: task.id }, select: { attempts: true } })
      if (!row) { gone = true; break }
      attempts = row.attempts
    }
    report(gone, '109 永久失败的持久任务必须被判死移出队列', '行为',
      gone ? `${attempts} 次失败后已消失` : `第 12 轮仍在队列里，attempts=${attempts}`)
  } finally {
    await prisma.durableTask.deleteMany({ where: { dedupeKey } })
  }
}

/** 106：8 路同时建团必须全成且编号互不重复 */
async function caseConcurrentTeamCreates() {
  const email = `resilience-${stamp}@example.invalid`
  const pw = `resilience-${stamp}`
  const names = Array.from({ length: 8 }, (_, i) => `体检并发建团-${stamp}-${i}`)
  const tokens: string[] = []
  let userId: string | null = null
  try {
    const user = await prisma.user.create({
      data: { email, name: 'resilience', password: await hashPassword(pw), phone: `136${String(stamp).slice(-8)}` },
    })
    userId = user.id
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw }),
    })
    const loginJson = await loginRes.json().catch(() => null)
    const token: string | undefined = loginJson?.tokens?.accessToken
    if (!token) { report(false, '106 并发建团 8 路全成且编号不撞', '行为', `登录 fixture 没拿到 token（${loginRes.status}）`); return }
    tokens.push(token)

    const res = await Promise.all(names.map((name) => fetch(`${BASE}/api/teams`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ name }),
    })))
    const statuses = res.map((r) => r.status)
    const bodies = await Promise.all(res.map(async (r) => (r.ok ? (await r.json().catch(() => null))?.team?.slug : null)))
    const slugs = bodies.filter(Boolean) as string[]
    const distinct = new Set(slugs).size === slugs.length
    report(statuses.every((s) => s === 201) && slugs.length === names.length && distinct, '106 并发建团 8 路全成且编号不撞', '行为',
      `状态码=${statuses.join(',')} 拿到 slug=${slugs.length}/${names.length} 互不重复=${distinct}`)
  } finally {
    const created = userId ? await prisma.team.findMany({ where: { name: { in: names } }, select: { id: true } }) : []
    const teamIds = created.map((t) => t.id)
    if (userId) await prisma.teamMember.deleteMany({ where: { userId } })
    if (teamIds.length) await prisma.teamQuota.deleteMany({ where: { teamId: { in: teamIds } } })
    if (teamIds.length) await prisma.team.deleteMany({ where: { id: { in: teamIds } } })
    if (userId) await prisma.team.deleteMany({ where: { createdById: userId } })
    for (const t of tokens) {
      await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${t}` } }).catch(() => null)
    }
    if (userId) {
      const left = await prisma.teamMember.count({ where: { userId } })
      if (left > 0) console.log(`LEAK 106 仍挂着 ${left} 条团队关系`)
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } })
  }
}

// ---------------------------------------------------------------- 结构

function caseServerFetchTimeouts() {
  const files = [
    'src/lib/tencent-tc3.ts',
    'src/lib/tencent-cdn.ts',
    'src/lib/wechat-content-security.ts',
    'src/lib/wechat-mini-login.ts',
    'src/lib/wechat-mini-auth.ts',
    'src/lib/phone-auth.ts',
    'src/lib/feishu.ts',
    'src/app/api/auth/wechat/callback/route.ts',
    'src/app/api/auth/wechat/mini/login/route.ts',
    'src/app/api/feishu/avatar/[userId]/route.ts',
  ]
  for (const rel of files) {
    const { total, missing } = fetchSitesMissingSignal(rel)
    report(total > 0 && missing.length === 0, `102 服务端外网 fetch 全部带超时：${rel}`, '结构',
      `${total} 处 await fetch，缺超时的行=${missing.join(',') || '无'}`)
  }
}

/** 103 的转码/缩略图/波形那一半：每个 spawn 出来的子进程都得挂上无进度看门狗 */
function caseFfmpegIdleWatchdogs() {
  const rel = 'src/lib/ffmpeg.ts'
  const text = load(rel)
  const vars = [...text.matchAll(/const\s+(\w+)\s*=\s*spawn\(/g)].map((m) => m[1])
  const wired = vars.filter((v) => new RegExp(`attachIdleWatchdog\\(${v},`).test(text))
  const spawns = (text.match(/=\s*spawn\(/g) ?? []).length
  report(spawns > 0 && wired.length === vars.length && new Set(vars).size >= 2, '103 每个 ffmpeg/ffprobe 子进程都挂了无进度看门狗', '结构',
    `spawn 变量=${vars.join(',')}，已挂看门狗的=${wired.join(',') || '无'}`)
}

function caseCdnUrlCacheBounded() {
  const rel = 'src/lib/s3-storage.ts'
  const text = load(rel)
  const write = /cdnUrlCache\.set\(/.test(text)
  const evict = /cdnUrlCache\.delete\(/.test(text) && /cdnUrlCache\.size\s*>=/.test(text)
  report(write && evict, '110 cdnUrlCache 有淘汰上限（照同文件 s3FileExistsCache 的做法）', '结构',
    `有写入=${write}，有按上限淘汰=${evict}`)
}

function caseAdvisoryLockScopedPerTeam() {
  const rel = 'src/lib/project-access.ts'
  const line = load(rel).split('\n').find((l) => l.includes('pg_advisory_xact_lock')) ?? ''
  report(/hashtext\(\s*\$\{?\w*teamId/.test(line), '107 项目编号的 advisory lock 按团队派生 key', '结构', `原文：${line.trim()}`)
}

function caseCancelNotificationsChunked() {
  const rel = 'src/lib/video-version-rollback.ts'
  const text = load(rel)
  const at = text.indexOf('cancelCommentNotification(')
  const window = text.slice(Math.max(0, at - 320), at + 320)
  report(at >= 0 && /\.slice\(/.test(window) && /for \(/.test(window), '108 回滚取消通知按并发上限分块', '结构',
    `调用点附近分=${/\.slice\(/.test(window)}，有循环=${/for \(/.test(window)}`)
}

function caseTeamSlugBounded() {
  const rel = 'src/app/api/teams/route.ts'
  const text = load(rel)
  const uncapped = /while\s*\(\s*await\s+prisma\.team\.findUnique/.test(text)
  const inTransaction = /\$transaction[\s\S]{0,600}getNextTeamIdentifier/.test(text)
  const scopedLock = /pg_advisory_xact_lock/.test(text)
  report(!uncapped && inTransaction && scopedLock, '106 建团编号有上限、算在事务内、并互相排队', '结构',
    `仍有不设限的 while=${uncapped}，已进事务=${inTransaction}，已加锁=${scopedLock}`)
}

// ---------------------------------------------------------------- 客户端（结构）

function caseClientMemoAndCleanup() {
  const mgr = 'src/components/AdminVideoManager.tsx'
  const mgrText = load(mgr)
  const grouped = /const videoGroups = useMemo\(/.test(mgrText)
  const mutatingSort = /videos=\{groupVideos\.sort\(/.test(mgrText)
  report(grouped && !mutatingSort, '112 素材分组按 videos 身份缓存，且不在渲染里原地 sort', '结构',
    `分组已 useMemo=${grouped}，就地 sort 已去掉=${!mutatingSort}`)

  const sec = 'src/app/platform/security/SecurityEventsClient.tsx'
  const secText = load(sec)
  const cbStart = secText.indexOf('const loadEvents = useCallback(')
  const depsStart = secText.indexOf('\n  }, [', cbStart)
  const loadEventsDeps = secText.slice(depsStart, secText.indexOf(')', depsStart))
  const selfWritten = /stats\.length|typeFilter|pagination\.page/.test(loadEventsDeps)
  const initsInside = cbStart >= 0 && depsStart > cbStart
    && /if \(typeFilter === null &&/.test(secText.slice(cbStart, depsStart))
  const initsInEffect = /useEffect\(\(\) => \{[\s\S]{0,200}if \(typeFilter === null &&[\s\S]{0,140}setTypeFilter/.test(secText)
  report(cbStart >= 0 && !selfWritten && !initsInside && initsInEffect,
    '113 安全事件页首屏只打一次（取数回调不吃自己写的状态）', '结构',
    `回调 deps 含自写状态=${selfWritten}，回调内初始化筛选=${initsInside}，初始化已进 useEffect=${initsInEffect}；回调 deps 原文：${loadEventsDeps.trim()}`)

  const acc = 'src/components/AccentColorProvider.tsx'
  const accText = load(acc)
  report(/new MutationObserver/.test(accText) && /\.disconnect\(\)/.test(accText), '114 MutationObserver 会 disconnect', '结构',
    `disconnect 命中=${(/\.disconnect\(\)/g.exec(accText) ? 1 : 0)}`)

  const hover = 'src/components/TimelineHoverPreview.tsx'
  report(/removeEventListener\(\s*['"]loadedmetadata/.test(load(hover)), '115 loadedmetadata 监听在 cleanup 里摘掉', '结构',
    '看 cleanup 有没有 removeEventListener')

  const chars = 'src/components/ui/animated-characters.tsx'
  const charsText = load(chars)
  const peekBlock = charsText.slice(charsText.indexOf('Purple sneaky peeking'), charsText.indexOf('Purple sneaky peeking') + 1200)
  const bothCleared = (peekBlock.match(/clearTimeout\(/g) ?? []).length >= 2
  const selfDep = /, isPurplePeeking\s*\]/.test(peekBlock)
  report(bothCleared && !selfDep, '115 紫鸭 peek 两个句柄都存下来并 clear，isPurplePeeking 不在 deps', '结构',
    `clear 次数=${(peekBlock.match(/clearTimeout\(/g) ?? []).length}，自依赖=${selfDep}`)

  const swText = load('src/components/ServiceWorkerProvider.tsx')
  const detachesUpdate = /removeEventListener\(\s*['"]updatefound/.test(swText)
  const cleanupOnEveryPath = /document\.readyState === 'complete'\)\s*\{[\s\S]{0,120}return\s+(cleanup|\(\) =>)[\s\S]{0,120}return\s+(cleanup|\(\) =>)/.test(swText)
  report(detachesUpdate && cleanupOnEveryPath, '116 SW 的 updatefound 会摘、两条注册路径都返回 cleanup', '结构',
    `摘 updatefound=${detachesUpdate}，两条路径都返回 cleanup=${cleanupOnEveryPath}`)
}

// ---------------------------------------------------------------- 主流程

async function main() {
  console.log(`体检判据 stamp=${stamp}`)
  await caseS3BlackHole()
  await caseFfprobeBlackHole()
  await caseDurableTaskTerminal()
  caseServerFetchTimeouts()
  caseFfmpegIdleWatchdogs()
  caseCdnUrlCacheBounded()
  caseAdvisoryLockScopedPerTeam()
  caseCancelNotificationsChunked()
  caseTeamSlugBounded()
  caseClientMemoAndCleanup()
  await caseConcurrentTeamCreates()

  const leak = await prisma.durableTask.count({ where: { dedupeKey: { startsWith: 'resilience-' } } })
  console.log(`清场读回 durableTask 残留=${leak}`)
  if (leak > 0) failures.push('清场失败：resilience-* 任务仍在')
  console.log(failures.length ? `\n${failures.length} 条未过：${failures.join(' | ')}` : '\n全部通过')
  process.exitCode = failures.length ? 1 : 0
}

await main()
await prisma.$disconnect()
