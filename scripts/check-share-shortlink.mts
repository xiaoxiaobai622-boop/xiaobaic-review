import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'
import { getRedis } from '../src/lib/redis'

/**
 * 逐帧审阅｜分享链接需求（§1 根路径短链、§2 8~12 位安全随机＋撤销立即失效、
 * §3 有效期出口＋访问记录挂到具体链接＋口令、§1 版本级分享、§6 载荷精简）。判据分十二组，全用真库真 HTTP：
 *  A 短码生成器 —— 长度/字符集/唯一性/冲突重试有上限；
 *  B 创建路由 —— 返回的就是根级 URL，token 满足 A 的形状；
 *  C 根级路由 —— 有效码出页、无效码 404、/login 等既有页面不受影响、旧 /share/ 入口仍在；
 *  D 撤销立即失效 —— 撤销后该链接的内容令牌立刻 403，且同项目另一枚链接不受连坐；
 *  E 访问记录 —— 每条 SharePageAccess 认得出它是哪枚链接带来的；
 *  F 有效期/次数出口 —— 访客页拿得到到期日与剩余次数，过期与超次真的 410，后台按链接读访问记录；
 *  G 访客下载原片 —— 「允许下载」归链接权限管，未登录访客也放行，未批准与未勾选都拦得住；
 *  V 版本级分享 —— 钉到某个版本的链接只出那一版，且不被项目级「访客只看最新版」滤空；
 *  P 访客载荷精简 —— §6 之外的内容（客户邮箱、收件人名单）不许进匿名访客的响应；
 *  K 访问口令 —— 口令设在链接这一层，错口令换不到会话、对口令真拿到素材；
 *  M 项目主链接 —— 项目自己的地址已经是一行真 ShareLink：短码、幂等、权限仍派生自项目、
 *    有效期/查看次数/访问记录挂得上、访客身份与收录两道闸门没被误改、归档立刻收、读列表不铸行；
 *  R 收录短链 —— COLLECT 链接只带 upload，裸短码自己跳到 ?mode=collect，载荷的 allowReverseShare 照项目列。
 * 键全部由 stamp 派生，finally 清场并读回。
 */
const BASE = process.env.SHARE_CHECK_BASE || 'http://localhost:3000'
const prisma = new PrismaClient()
const redis = getRedis()
const stamp = Date.now()
const failures: string[] = []

const CODE_CHARSET = 'abcdefghjkmnpqrstuvwxyz23456789'
const teamSlug = `share-${stamp}`
const ownerEmail = `share-owner-${stamp}@example.invalid`
const pw = `share-${stamp}`
const tokens: string[] = []

function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

function codeShape(code: string) {
  return code.length >= 8 && code.length <= 12
    && [...code].every(ch => CODE_CHARSET.includes(ch))
}

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function pageStatus(path: string) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' })
  return res.status
}

/** 一枚 PROJECT 范围、authMode=NONE 的链接：访客不需要口令就能拿到 viewer bearer。 */
async function createNoneLink(projectId: string, adminToken: string, name: string, extra: Record<string, unknown> = {}) {
  const created = await call('POST', `/api/projects/${projectId}/share-links`, adminToken, {
    name, scopeType: 'PROJECT', authMode: 'NONE', permissions: ['view', 'comment'], ...extra,
  })
  return created
}

/** 打开一次分享页，拿回 viewer bearer 与该素材的内容令牌（撤销判据的被试）。 */
async function openAsViewer(shareToken: string, videoId: string) {
  const opened = await call('GET', `/api/share/${shareToken}`, '')
  const viewer = opened.json?.shareToken as string | undefined
  if (!viewer) return { viewer: undefined as string | undefined, contentToken: undefined as string | undefined }
  const minted = await call('GET', `/api/share/${shareToken}/video-token?videoId=${videoId}&quality=720p`, viewer)
  return { viewer, contentToken: minted.json?.token as string | undefined }
}

try {
  // ── fixtures ──────────────────────────────────────────────────────────
  const owner = await prisma.user.create({
    data: { email: ownerEmail, name: 'share-owner', password: await hashPassword(pw), phone: `137${String(stamp).slice(-8)}` },
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
      projectCode: `P${stamp}`, title: `share-${stamp}`,
      slug: `proj-${stamp}`, shareSlug: `ss-${stamp}`,
    },
  })
  const video = await prisma.video.create({
    data: {
      projectId: project.id, name: 'reel', version: 1, versionLabel: 'v1',
      originalFileName: 'reel.mp4', originalFileSize: BigInt(1024), originalStoragePath: `tests/${stamp}/reel.mp4`,
      duration: 12, width: 1920, height: 1080, status: 'READY',
    },
  })

  const login = await call('POST', '/api/auth/login', '', { email: ownerEmail, password: pw })
  const adminToken = login.json?.tokens?.accessToken as string | undefined
  if (!adminToken) throw new Error(`登录失败 → ${login.status}`)
  tokens.push(adminToken)

  // ── A 短码生成器 ──────────────────────────────────────────────────────
  let shareTokens: typeof import('../src/lib/share-tokens') | null = null
  try {
    shareTokens = await import('../src/lib/share-tokens')
  } catch (err) {
    check(false, 'A0 短码生成器可导入', `→ ${String(err).slice(0, 120)}`)
  }
  if (shareTokens?.randomShareCode) {
    const codes = Array.from({ length: 500 }, () => shareTokens!.randomShareCode())
    check(codes.every(codeShape), 'A1 连生 500 枚全是 8~12 位、无 -_ 无易混字母',
      `→ 长度 ${Math.min(...codes.map(c => c.length))}~${Math.max(...codes.map(c => c.length))}`)
    check(new Set(codes).size === codes.length, 'A2 连生 500 枚零重复')

    // 前 3 次查询都报「已占用」，第 4 次才放行；断言的是查询次数而不只是结果。
    const taken = new Set(codes.slice(0, 3))
    let probes = 0
    const busyDb = { shareLink: { count: async () => { probes++; return probes <= 3 ? 1 : 0 } } }
    const allocated = await shareTokens.allocateShareToken(busyDb as any)
    check(!taken.has(allocated) && codeShape(allocated), 'A3 撞码时重抽直到未占用')
    check(probes === 4, 'A4 前 3 枚被占就恰好查 4 次（真在重试，不是碰运气）', `→ ${probes} 次`)

    probes = 0
    const alwaysBusy = { shareLink: { count: async () => { probes++; return 1 } } }
    const overflow = await shareTokens.allocateShareToken(alwaysBusy as any).then(() => 'resolved').catch(() => 'rejected')
    check(overflow === 'rejected' && probes > 0 && probes <= 10, 'A5 永远撞码时抛错且查询次数有上限（不许死循环）',
      `→ ${overflow} / ${probes} 次`)
  } else if (shareTokens) {
    check(false, 'A1 短码生成器已导出 randomShareCode/allocateShareToken')
  }

  // ── B 创建路由 ────────────────────────────────────────────────────────
  const createdA = await createNoneLink(project.id, adminToken, '撤销试验 A')
  check(createdA.status === 201 && !!createdA.json?.shareLink?.token, 'B1 新建分享链接成功', `→ ${createdA.status}`)
  const linkA = createdA.json?.shareLink
  const linkB = (await createNoneLink(project.id, adminToken, '撤销试验 B')).json?.shareLink
  check(codeShape(linkA?.token ?? ''), 'B2 新链的 token 是 8~12 位无歧义短码', `→ ${linkA?.token}`)
  const linkPath = (() => { try { return new URL(linkA.url).pathname } catch { return '' } })()
  check(linkPath === `/${linkA.token}`, 'B3 返回的分享地址是根级 {域名}/{code}，不带 /share/ 前缀', `→ ${linkA?.url}`)
  check(!!linkB?.token && linkB.token !== linkA?.token, 'B4 同项目连建两枚各自独立')

  // ── C 根级路由 ────────────────────────────────────────────────────────
  check(await pageStatus(`/${linkA?.token}`) === 200, 'C1 GET /{code} 出分享页')
  check(await pageStatus('/' + 'z'.repeat(10)) === 404, 'C2 GET /{不存在的码} 404')
  check(await pageStatus('/login') === 200, 'C3 根级动态段没吃掉 /login')
  check(await pageStatus('/profile') === 200, 'C4 /profile 不受影响')
  check(await pageStatus(`/share/${linkA?.token}`) === 200, 'C5 旧 /share/{code} 入口仍在')
  check(await pageStatus('/robots.txt') === 200, 'C6 根级动态段没吃掉 public/robots.txt')
  check(await pageStatus('/sw.js') === 200, 'C7 根级动态段没吃掉 public/sw.js')

  // ── D 撤销立即失效 ────────────────────────────────────────────────────
  const a = await openAsViewer(linkA?.token, video.id)
  const b = await openAsViewer(linkB?.token, video.id)
  check(!!a.contentToken && !!b.contentToken, 'D0 两枚链接各自拿到内容令牌（前提）',
    `→ A ${a.contentToken ? '有' : '无'} / B ${b.contentToken ? '有' : '无'}`)

  const alive = async (t?: string) => (t ? await redis.exists(`video_access:${t}`) : 0)
  const contentStatus = async (t?: string) =>
    (t ? (await fetch(`${BASE}/api/content/${t}`, { redirect: 'manual' })).status : 0)

  check(await alive(a.contentToken) === 1 && await alive(b.contentToken) === 1,
    'D1 撤销前两枚链接的内容令牌都活着（Redis 里有记录）',
    `→ A ${await alive(a.contentToken)} / B ${await alive(b.contentToken)}`)

  const revoked = await call('PATCH', `/api/projects/${project.id}/share-links/${linkA?.id}`, adminToken, { status: 'REVOKED' })
  check(revoked.status === 200 && revoked.json?.shareLink?.status === 'REVOKED', 'D2 撤销写成功', `→ ${revoked.status}`)

  const stillAliveA = await alive(a.contentToken)
  check(stillAliveA === 0 && await contentStatus(a.contentToken) === 403,
    'D3 撤销后 A 的内容令牌被收回，/api/content 立刻 403（"立即失效"要打到字节这一层）',
    `→ 键 ${stillAliveA} / HTTP ${await contentStatus(a.contentToken)}`)
  check(a.viewer ? (await call('GET', `/api/share/${linkA?.token}`, a.viewer)).status === 410 : false,
    'D4 撤销后 A 的 viewer bearer 不再能读分享数据')

  check(await alive(b.contentToken) === 1 && await contentStatus(b.contentToken) !== 403,
    'D5 撤销 A 不许连坐同项目的 B（失效粒度到链接）',
    `→ 键 ${await alive(b.contentToken)} / HTTP ${await contentStatus(b.contentToken)}`)
  check(await redis.exists(`revoked:share_session:${`none:${project.id}:${linkB?.token}`}`) === 0,
    'D6 B 的会话未被标记撤销')

  // ── E 访问记录挂到具体链接 ────────────────────────────────────────────
  const settings = await prisma.securitySettings.findUnique({ where: { id: 'default' }, select: { trackAnalytics: true } })
  check(settings?.trackAnalytics !== false, 'E0 本地库开着 analytics（否则 E 组无样本）')
  const rowsA = await prisma.sharePageAccess.findMany({ where: { projectId: project.id }, select: { shareLinkId: true, sessionId: true } })
  // 去重键在 trackSharePageAccess 返回之后才写，所以「键有、行没有」只可能是那次插入在服务端抛了；
  // 再用本脚本的客户端插一条同形状的行作对照，就能把「库/列不认识」和「服务端进程不认识」分开。
  const dedupeKeys = await redis.keys(`share_access:none:${project.id}:*`)
  let directWrite = false
  try {
    const probe = await prisma.sharePageAccess.create({
      data: {
        projectId: project.id, accessMethod: 'NONE', sessionId: `direct:${stamp}`,
        shareLinkId: linkA?.id ?? null, ipAddress: '127.0.0.1',
      },
      select: { id: true, shareLinkId: true },
    })
    directWrite = probe.shareLinkId === linkA?.id
    await prisma.sharePageAccess.delete({ where: { id: probe.id } })
  } catch {
    directWrite = false
  }
  const serverSideOnly = rowsA.length === 0 && dedupeKeys.length === 2 && directWrite
  check(rowsA.length === 2, 'E1 两枚链接各留下一行访问记录',
    `→ ${rowsA.length} 行${serverSideOnly ? `（去重键 ${dedupeKeys.length} 枚＝分支跑过；本脚本直插同形状成功＝库认这一列；只有服务端的插入没落）` : ''}`)
  check(rowsA.length === 2 && rowsA.some(r => r.shareLinkId === linkA?.id) && rowsA.some(r => r.shareLinkId === linkB?.id),
    'E2 每行认得出是哪枚链接带来的（撤销与"谁看过这条链接"都靠它）',
    `→ ${JSON.stringify(rowsA.map(r => r.shareLinkId))}`)
  check(rowsA.length === 2 && new Set(rowsA.map(r => r.sessionId)).size === 2,
    'E3 同项目两枚链接的 sessionId 互不相同（NONE 会话要带链接段，否则撤销必然连坐）',
    `→ ${JSON.stringify(rowsA.map(r => r.sessionId))}`)

  // ── F 有效期／剩余次数出口 ＋ 后台按链接看访问记录 ────────────────────
  const linkC = (await createNoneLink(project.id, adminToken, '有效期试验', {
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), maxViews: 5,
  })).json?.shareLink
  const openedC = await call('GET', `/api/share/${linkC?.token}`, '')
  check(!!openedC.json?.shareExpiresAt && new Date(openedC.json.shareExpiresAt).getTime() > Date.now(),
    'F1 访客接口带出有效期（页面要回答"几时到期"）', `→ ${openedC.json?.shareExpiresAt}`)
  check(openedC.json?.shareViewsRemaining === 4,
    'F2 剩余次数算上这一次打开（限 5 次、打开一次就该剩 4，不许报创建时的旧值）', `→ ${openedC.json?.shareViewsRemaining}`)
  const openedB = await call('GET', `/api/share/${linkB?.token}`, '')
  check(openedB.json?.shareExpiresAt === null && openedB.json?.shareViewsRemaining === null,
    'F3 没设限制的链接不许谎报限制', `→ ${JSON.stringify([openedB.json?.shareExpiresAt, openedB.json?.shareViewsRemaining])}`)

  const linkD = (await createNoneLink(project.id, adminToken, '已过期', {
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  })).json?.shareLink
  check((await call('GET', `/api/share/${linkD?.token}`, '')).status === 410, 'F4 有效期一过，访客打开接口 410')
  check(await pageStatus(`/${linkD?.token}`) === 404, 'F5 有效期一过，根级地址不再出页')

  const linkE = (await createNoneLink(project.id, adminToken, '只看一次', { maxViews: 1 })).json?.shareLink
  const firstOpen = await call('GET', `/api/share/${linkE?.token}`, '')
  const secondOpen = await call('GET', `/api/share/${linkE?.token}`, '')
  check(firstOpen.status === 200 && secondOpen.status === 410,
    'F6 次数用满后访客打开 410（"限制次数"真的拦得住）', `→ ${firstOpen.status} / ${secondOpen.status}`)

  // 同一枚链接同时来两发是常态：React 开发期双发effect、访客开两个标签页、链接预取后真点开。
  // 乐观并发的 viewCount 撞车不等于「次数用满」，谁都不该被踢回去。
  const linkRace = (await createNoneLink(project.id, adminToken, '同时打开两次', { maxViews: 5 })).json?.shareLink
  const raced = await Promise.all([
    call('GET', `/api/share/${linkRace?.token}`, ''),
    call('GET', `/api/share/${linkRace?.token}`, ''),
  ])
  check(raced.every(r => r.status === 200), 'F6b 同时打开同一枚限次链接：两发都拿到内容（撞车要重试，不许报 410）',
    `→ ${raced.map(r => r.status).join(' / ')}`)
  const raceCount = await prisma.shareLink.findUnique({ where: { id: linkRace?.id ?? '' }, select: { viewCount: true } })
  check(raceCount?.viewCount === 2, 'F6c 撞过车的两发各记一次数（既不放过也不重复计）', `→ ${raceCount?.viewCount}`)

  // 访客把页面开着不动，客户端每 15 秒刷一次素材目录。那是同一次浏览的延续，不是又来了一个人：
  // 按浏览计数的话，限 5 次的链接在第七十五秒就自己死了。
  const refreshOf = (code: string) => fetch(`${BASE}/api/share/${code}`, { headers: { 'x-share-refresh': 'catalog' } })
  const linkP = (await createNoneLink(project.id, adminToken, '挂着页面刷新', { maxViews: 3 })).json?.shareLink
  await call('GET', `/api/share/${linkP?.token}`, '')
  const refreshed = await refreshOf(linkP?.token ?? '')
  const afterRefresh = await prisma.shareLink.findUnique({ where: { id: linkP?.id ?? '' }, select: { viewCount: true } })
  check(refreshed.status === 200 && afterRefresh?.viewCount === 1,
    'F6d 素材目录刷新照常给内容，但不吃掉一次查看次数', `→ ${refreshed.status} / viewCount ${afterRefresh?.viewCount}`)

  await call('GET', `/api/share/${linkP?.token}`, '')
  await call('GET', `/api/share/${linkP?.token}`, '')
  const exhaustedRefresh = await refreshOf(linkP?.token ?? '')
  check(exhaustedRefresh.status === 410, 'F6e 次数真的用满之后，连刷新也拦得住（不计数不等于不闸门）', `→ ${exhaustedRefresh.status}`)

  // 读取端的判据不依赖 E 组那条写入路径：脚本自己按链接插好行，只验筛得对不对。
  // 基线先数一遍：E 组的写入哪天转绿就会往这枚链接上多挂行，写死 2 条会变成假 FAIL。
  const beforeA = await prisma.sharePageAccess.count({ where: { shareLinkId: linkA?.id ?? '' } })
  await prisma.sharePageAccess.createMany({
    data: [
      { projectId: project.id, accessMethod: 'NONE', sessionId: `f:${stamp}:a1`, shareLinkId: linkA?.id ?? null, createdAt: new Date(Date.now() - 5000) },
      { projectId: project.id, accessMethod: 'GUEST', sessionId: `f:${stamp}:a2`, shareLinkId: linkA?.id ?? null, createdAt: new Date() },
      { projectId: project.id, accessMethod: 'NONE', sessionId: `f:${stamp}:b1`, shareLinkId: linkB?.id ?? null },
    ],
  })
  // 新增路由文件在 dev 进程里第一次被命中会先 404（webpack 现编译），第二发才稳。
  // 先打一发丢掉，免得把编译波读成「路由不存在」的假 FAIL。
  await call('GET', `/api/projects/${project.id}/share-links/${linkA?.id}/accesses`, adminToken)
  const accA = await call('GET', `/api/projects/${project.id}/share-links/${linkA?.id}/accesses`, adminToken)
  const accTimes: number[] = (accA.json?.accesses ?? []).map((item: any) => new Date(item.createdAt).getTime())
  check(accA.status === 200 && accA.json?.total === beforeA + 2 && accA.json?.accesses?.length === beforeA + 2,
    'F7 后台按链接读访问记录：只数得出这枚链接带来的（另两枚的行不许混进来）',
    `→ ${accA.status} / total ${accA.json?.total}（基线 ${beforeA}＋2）/ ${accA.json?.accesses?.length} 条`)
  check(accTimes.length === beforeA + 2 && accTimes.every((t, i) => i === 0 || accTimes[i - 1] >= t),
    'F8 访问记录按时间倒序（最新的在前）', `→ ${JSON.stringify(accTimes)}`)
  // 空态要分「没人来过」和「压根没在记」两句，靠的就是这个字段，值必须真从设置里读出来。
  const tracking = await prisma.securitySettings.findUnique({ where: { id: 'default' }, select: { trackAnalytics: true } })
  check(accA.status === 200 && accA.json?.trackingEnabled === (tracking?.trackAnalytics ?? true),
    'F10 访问记录接口带出追踪开关（关着时空态不许谎报"没人来过"）',
    `→ 接口 ${JSON.stringify(accA.json?.trackingEnabled)} / 设置 ${JSON.stringify(tracking?.trackAnalytics ?? null)}`)

  const project2 = await prisma.project.create({
    data: {
      teamId: team.id, createdById: owner.id, projectCode: `Q${stamp}`,
      title: `share2-${stamp}`, slug: `proj2-${stamp}`, shareSlug: `ss2-${stamp}`,
    },
  })
  const linkF = (await createNoneLink(project2.id, adminToken, '别项目的链接')).json?.shareLink
  const accCross = await call('GET', `/api/projects/${project.id}/share-links/${linkF?.id}/accesses`, adminToken)
  // 路由压根不存在也是 404，所以这道闸门必须挂在 F7 已通的基础上，否则就是假绿。
  check(accA.status === 200 && accCross.status === 404,
    'F9 用别项目的 linkId 打这个项目的记录路由：404，一条都不吐', `→ ${accCross.status}`)

  // ── G 访客下载原片 ────────────────────────────────────────────────────
  // §3 的「禁止/允许下载」只有打到未登录访客才算真的存在：链接权限说了算，
  // 登录与否不管。这里量的是 mint 那一层（权限判定就在这一层），批准是第二道。
  const dlCreated = await createNoneLink(project.id, adminToken, '允许下载', { permissions: ['view', 'download'] })
  const dlToken = dlCreated.json?.shareLink?.token as string | undefined
  const dlViewer = (await call('GET', `/api/share/${dlToken}`, '')).json?.shareToken as string | undefined
  const askOriginal = (shareToken?: string, viewer?: string) =>
    call('GET', `/api/share/${shareToken}/video-token?videoId=${video.id}&quality=original`, viewer ?? '')

  const beforeApprove = await askOriginal(dlToken, dlViewer)
  check(beforeApprove.status === 403 && !beforeApprove.json?.token,
    'G1 素材未批准时访客要原片：403（"允许下载"不等于放行未批准的版本）', `→ ${beforeApprove.status}`)

  await prisma.video.update({ where: { id: video.id }, data: { approved: true } })
  const afterApprove = await askOriginal(dlToken, dlViewer)
  const originalToken = afterApprove.json?.token as string | undefined
  check(afterApprove.status === 200 && !!originalToken,
    'G2 勾了「允许下载」的链接：未登录访客也能 mint 原片令牌', `→ ${afterApprove.status}`)
  const originalRecord = originalToken ? JSON.parse((await redis.get(`video_access:${originalToken}`)) || '{}') : {}
  check(originalRecord?.quality === 'original' && originalRecord?.shareId === dlToken,
    'G3 mint 出来的是原片，且绑在这枚链接自己的会话上（撤销才收得住）',
    `→ quality ${originalRecord?.quality ?? '无'} / shareId ${originalRecord?.shareId === dlToken ? '同一枚' : '不是这枚'}`)

  const viewOnly = await openAsViewer(linkB?.token, video.id)
  const onViewOnly = await askOriginal(linkB?.token, viewOnly.viewer)
  check(afterApprove.status === 200 && onViewOnly.status === 403 && !onViewOnly.json?.token,
    'G4 只勾 view/comment 的链接：访客 mint 原片 403，素材批准了也不行', `→ ${onViewOnly.status}`)

  // ── V 版本级分享 ──────────────────────────────────────────────────────
  // §1 要「为视频/版本生成分享链接」。同一枚文件补第二个版本，量的就是这一条：
  // 钉到某个版本的链接，访客目录里就该只有那一个；而项目级的「访客只看最新版」
  // （列默认 true）不许把被点名的旧版本滤没——滤没了链接就开天窗。
  const v2 = await prisma.video.create({
    data: {
      projectId: project.id, name: 'reel', version: 2, versionLabel: 'v2',
      originalFileName: 'reel.mp4', originalFileSize: BigInt(2048), originalStoragePath: `tests/${stamp}/reel-v2.mp4`,
      duration: 12, width: 1920, height: 1080, status: 'READY', approved: true,
    },
  })
  const newest = await prisma.project.findUnique({ where: { id: project.id }, select: { guestLatestOnly: true } })
  const idsOf = (json: any) => (json?.videos ?? []).map((item: any) => item.id)
  const linkOldVer = (await createNoneLink(project.id, adminToken, '仅旧版本', { scopeType: 'VIDEO_VERSION', scopeId: video.id })).json?.shareLink
  const openedOldVer = await call('GET', `/api/share/${linkOldVer?.token}`, '')
  const oldVerIds = idsOf(openedOldVer.json)
  check(openedOldVer.status === 200 && oldVerIds.length === 1 && oldVerIds[0] === video.id,
    'V1 钉在旧版本的链接：访客目录里就是那一个版本（项目级「只看最新版」不许把它滤没）',
    `→ ${JSON.stringify(oldVerIds)} / guestLatestOnly ${newest?.guestLatestOnly}`)

  const linkAllVer = (await createNoneLink(project.id, adminToken, '整个文件', { scopeType: 'VIDEO', scopeId: v2.id })).json?.shareLink
  const allVerIds = idsOf((await call('GET', `/api/share/${linkAllVer?.token}`, '')).json).sort()
  check(allVerIds.includes(video.id) && allVerIds.includes(v2.id),
    'V2 选「全部版本」的链接：新旧两版都在（对话框那句"以后上传的新版本也算在内"才立得住）', `→ ${JSON.stringify(allVerIds)}`)

  const viewerOldVer = openedOldVer.json?.shareToken as string | undefined
  const mintHidden = await call('GET', `/api/share/${linkOldVer?.token}/video-token?videoId=${v2.id}&quality=720p`, viewerOldVer ?? '')
  check(mintHidden.status >= 400 && !mintHidden.json?.token,
    'V3 拿没分享的那一版 id 直接 mint：拦得住（页面藏起来不算，服务端也得认）', `→ ${mintHidden.status}`)
  const mintPinned = await call('GET', `/api/share/${linkOldVer?.token}/video-token?videoId=${video.id}&quality=720p`, viewerOldVer ?? '')
  check(mintPinned.status === 200 && !!mintPinned.json?.token,
    'V4 同一枚链接 mint 被点名的那一版：照常放行（V3 拦的是越界，不是整条路）', `→ ${mintPinned.status}`)

  // ── P 访客载荷精简 ────────────────────────────────────────────────────
  // §6 列的是访客页「必要内容」：项目/素材名、播放器、版本、批注、按权限的下载、口令验证。
  // 客户邮箱与整份收件人名单不在这一列里，而拿着短链的匿名的人手里根本没有身份。
  const clientEmail = `client-${stamp}@example.invalid`
  await prisma.projectRecipient.create({
    data: { projectId: project.id, name: `客户-${stamp}`, email: clientEmail, isPrimary: true },
  })
  const leakBody = JSON.stringify((await call('GET', `/api/share/${linkB?.token}`, '')).json ?? {})
  check(!leakBody.includes(clientEmail),
    'P1 匿名访客的响应里不许出现收件人邮箱（拿到链接就拿到全项目的客户名单，这是漏）',
    `→ 命中 ${leakBody.split(clientEmail).length - 1} 次`)
  const ownerBody = JSON.stringify((await call('GET', `/api/share/${linkB?.token}`, adminToken)).json ?? {})
  check(ownerBody.includes(clientEmail),
    'P2 登录的项目成员打开同一枚链接：收件人名单照常在（精简不能顺手砍掉功能）', `→ 命中 ${ownerBody.split(clientEmail).length - 1} 次`)

  // ── K 访问口令 ────────────────────────────────────────────────────────
  // §3 的口令设在链接这一层（不是项目那一层）：错口令换不到会话，对口令要真拿到内容。
  const linkPw = (await createNoneLink(project.id, adminToken, '要口令', { authMode: 'PASSWORD', password: `link-${stamp}` })).json?.shareLink
  const anonPw = await call('GET', `/api/share/${linkPw?.token}`, '')
  check(anonPw.status === 401 && anonPw.json?.requiresPassword === true,
    'K1 设了口令的链接：匿名打开 401 且明说要口令（页面才画得出输入框）',
    `→ ${anonPw.status} / requiresPassword ${JSON.stringify(anonPw.json?.requiresPassword)}`)
  check(await pageStatus(`/${linkPw?.token}`) === 200, 'K2 设了口令的链接根级地址照常出页（框在页里，不是 404）')
  const wrongPw = await call('POST', `/api/share/${linkPw?.token}/verify`, '', { password: `wrong-${stamp}` })
  check(wrongPw.status >= 400 && !wrongPw.json?.shareToken, 'K3 口令错：换不到会话令牌', `→ ${wrongPw.status}`)
  const rightPw = await call('POST', `/api/share/${linkPw?.token}/verify`, '', { password: `link-${stamp}` })
  check(rightPw.status === 200 && !!rightPw.json?.shareToken, 'K4 口令对：换到会出内容的会话令牌', `→ ${rightPw.status}`)
  const pastPw = await call('GET', `/api/share/${linkPw?.token}`, rightPw.json?.shareToken ?? '')
  check(pastPw.status === 200 && (pastPw.json?.videos ?? []).length >= 1,
    'K5 口令过了真的拿到素材（不是只回一个成功）', `→ ${pastPw.status} / ${(pastPw.json?.videos ?? []).length} 条`)

  // ── M 项目主链接：现在是一行真实的 ShareLink ─────────────────────────
  // 「全换短链」之后，项目自己的地址不再是 `/share/{团队}/{slug}` 那种合成路径，
  // 而是一行真的 ShareLink：有效期、查看次数、访问记录、撤销全都挂在这一行上，
  // 而谁能批注、谁能下载仍然只在设置页改。这两件事必须同时成立。
  const shareLib = await import('../src/lib/share-links')
  const urlLib = await import('../src/lib/url')
  const pathOf = (u?: string) => { try { return new URL(String(u)).pathname } catch { return '' } }

  // 脚本里没有请求上下文，本机的 Settings.appDomain 也还没配域名，所以按「带请求头」这条路
  // 喂一枚只有 host 的假请求：M1 量的是这条地址的**形状**，与域名从哪来无关。
  const standIn = { url: `${BASE}/api/x`, headers: new Headers({ host: 'localhost:3000' }) } as any
  const masterUrl = await urlLib.generateProjectShareUrlById(project.id, standIn)
  const masterCode = pathOf(masterUrl).slice(1)
  check(pathOf(masterUrl) === `/${masterCode}` && codeShape(masterCode),
    'M1 项目自己的地址就是根级短链 {域名}/{code}', `→ ${masterUrl}`)

  const masterRows = await prisma.shareLink.findMany({ where: { masterOfProjectId: project.id }, select: { id: true, token: true } })
  check(masterRows.length === 1 && masterRows[0].token === masterCode,
    'M2 一枚项目只有一行主链接，且铸的就是 M1 那枚短码', `→ ${masterRows.length} 行`)

  const reminted = await shareLib.ensureProjectMasterLink(project.id)
  check(reminted?.id === masterRows[0]?.id && await prisma.shareLink.count({ where: { masterOfProjectId: project.id } }) === 1,
    'M3 再要一次地址不铸第二枚（通知重发、面板刷新都不许多生一个入口）')

  const masterResolved = await shareLib.resolveShareMetadata(masterCode)
  check(masterResolved.link !== null && masterResolved.policy?.isProjectMaster === true,
    'M4 短码解得出「这是项目主链接」这个身份（访客端那几道按身份分叉的闸门全靠它）')
  check(await pageStatus(`/${masterCode}`) === 200, 'M5 项目主链接的根级地址出页')
  check(await pageStatus(`/share/${teamSlug}/${project.shareSlug}`) === 200,
    'M6 旧的 /share/{团队}/{shareSlug} 地址照常能开（搬家的规矩是不撇下已经发出去的信）')

  // 唯一的改权限的地方还是设置页：项目那一列改了，主链接这一行当场跟着变，两边不许各存一套。
  await prisma.project.update({
    where: { id: project.id },
    data: { authMode: 'NONE', guestMode: true, allowReverseShare: true, allowAssetDownload: true },
  })
  check((await shareLib.resolveShareMetadata(masterCode)).policy?.permissions.includes('download') === true,
    'M7 设置页勾「允许下载」→ 主链接立刻有 download（行的权限是从项目派生的）')
  await prisma.project.update({ where: { id: project.id }, data: { allowAssetDownload: false } })
  check((await shareLib.resolveShareMetadata(masterCode)).policy?.permissions.includes('download') === false,
    'M8 取消勾选立刻收回（派生不能只单向生效）')

  // 打开一次就要留下次数与访问记录：这两样以前主地址根本没有行可挂，现在有了。
  // 访客有两条路，两条都得量到：免密直接打开，和开了「访客身份」之后先换会话令牌再打开。
  await prisma.project.update({ where: { id: project.id }, data: { guestMode: false } })
  const masterOpened = await call('GET', `/api/share/${masterCode}`, '')
  check(masterOpened.status === 200 && masterOpened.json?.shareExpiresAt === null && masterOpened.json?.shareViewsRemaining === null,
    'M9 免密的主链接匿名可开，且没设限制时如实报 null（页面据此画「长期有效」）', `→ ${masterOpened.status}`)
  const noneRows = await prisma.sharePageAccess.count({ where: { shareLinkId: masterRows[0]?.id, accessMethod: 'NONE' } })
  check(noneRows >= 1, 'M10 免密那条路留下的访问记录挂在这枚主链接上（面板的「访问记录」按钮点得开）', `→ ${noneRows} 行`)

  await prisma.project.update({ where: { id: project.id }, data: { guestMode: true } })
  const masterGuest = await call('POST', `/api/share/${masterCode}/guest`, '')
  const guestOpened = await call('GET', `/api/share/${masterCode}`, masterGuest.json?.shareToken as string ?? '')
  check(guestOpened.status === 200 && (guestOpened.json?.videos ?? []).length >= 1,
    'M9b 访客身份开主链接：先换令牌再打开真的出内容（裸请求被访客闸门挡在 401，所以这条要单独量）',
    `→ ${guestOpened.status} / ${(guestOpened.json?.videos ?? []).length} 条`)
  const guestRows = await prisma.sharePageAccess.count({ where: { shareLinkId: masterRows[0]?.id, accessMethod: 'GUEST' } })
  check(guestRows >= 1, 'M10b 访客身份那条路也认得出是哪枚链接带来的（漏掉链接段＝主地址点开是空列表）', `→ ${guestRows} 行`)

  await call('GET', `/api/projects/${project.id}/share-links`, adminToken)
  const panel = await call('GET', `/api/projects/${project.id}/share-links`, adminToken)
  const panelMaster = panel.json?.masterLink
  check(panel.status === 200 && pathOf(panelMaster?.url) === `/${masterCode}`,
    'M11 分享记录面板把主链接单独给一行（表格首行）', `→ ${panelMaster?.url}`)
  // 断言里带上「这一组真的有行」：面板 500 时 `?? []` 会让 every() 空过。
  check(Array.isArray(panel.json?.shareLinks) && panel.json.shareLinks.length > 0
    && panel.json.shareLinks.every((l: any) => pathOf(l.url) !== `/${masterCode}`),
    'M12 主链接不在普通分享记录里再出现一遍',
    `→ ${panel.json?.shareLinks?.length ?? '无列表'} 行`)
  // 查看次数在这一组里被打开过好几次（免密、访客身份、页面本身），所以不写死数字，
  // 量的是「面板那一行等于库里那一行」。
  const masterRowNow = await prisma.shareLink.findUnique({ where: { id: masterRows[0]?.id ?? '' }, select: { viewCount: true } })
  check(panelMaster?.viewCount === masterRowNow?.viewCount && panelMaster?.expiresAt === null && panelMaster?.maxViews === null,
    'M13 那一行带出有效期/次数/查看次数三个栏位，且查看次数与库里的行一致（面板那句「长期有效 · N」才不是编的）',
    `→ 面板 ${panelMaster?.viewCount} / 库 ${masterRowNow?.viewCount} / expiresAt ${JSON.stringify(panelMaster?.expiresAt)}`)

  // 这两条是「主链接变成真行」最容易踩的坑：原来靠「有没有链接行」区分的分支，现在必须按身份判断。
  const guestOnMaster = await call('POST', `/api/share/${masterCode}/guest`, '')
  check(guestOnMaster.status === 200 && !!guestOnMaster.json?.shareToken,
    'M14 主地址的「访客身份」入口没被误关（它现在也是一行 ShareLink，判断要看身份）', `→ ${guestOnMaster.status}`)
  const guestOnLink = await call('POST', `/api/share/${linkB?.token}/guest`, '')
  check(guestOnLink.status === 403, 'M15 单独创建的分享链接照旧不给访客身份（这条闸门不能跟着放宽）', `→ ${guestOnLink.status}`)
  const uploadOnReview = await call('POST', `/api/share/${linkB?.token}/project-uploads`, '')
  check(uploadOnReview.status === 403, 'M16 审阅链接不收素材', `→ ${uploadOnReview.status}`)
  const uploadOnMaster = await call('POST', `/api/share/${masterCode}/project-uploads`, '')
  check(uploadOnMaster.status === 401,
    'M17 主地址收素材：链接这道闸门放过去了，只停在「先登录」（脚本没有登录 cookie）', `→ ${uploadOnMaster.status}`)

  // 归档是本人的总开关：面板那一行不许继续说「有效」，根级地址也要开不出。
  const statusBeforeArchive = (await prisma.project.findUnique({ where: { id: project.id }, select: { status: true } }))?.status
  await prisma.project.update({ where: { id: project.id }, data: { status: 'ARCHIVED' } })
  const archivedPanel = await call('GET', `/api/projects/${project.id}/share-links`, adminToken)
  check(archivedPanel.json?.masterLink?.status === 'ARCHIVED',
    'M18 归档项目的主链接行状态改成 ARCHIVED（访客已经打不开，界面不许还说「有效」）',
    `→ ${JSON.stringify(archivedPanel.json?.masterLink?.status)}`)
  check(await pageStatus(`/${masterCode}`) === 404, 'M19 归档后主链接的根级地址 404')
  await prisma.project.update({ where: { id: project.id }, data: { status: statusBeforeArchive ?? 'IN_REVIEW' } })

  // 列表页要给卡片显示短链，但读列表不许铸行（整改 D1）：没打开过的项目就是没有。
  const projectsList = await call('GET', '/api/projects', adminToken)
  const rowOf = (id: string) => (projectsList.json?.projects ?? []).find((p: any) => p.id === id)
  check(projectsList.status === 200 && rowOf(project.id)?.shareCode === masterCode,
    'M20 项目列表接口带出 shareCode，卡片直接就能拼出短链', `→ ${JSON.stringify(rowOf(project.id)?.shareCode)}`)
  check(rowOf(project2.id)?.shareCode === null
    && await prisma.shareLink.count({ where: { masterOfProjectId: project2.id } }) === 0,
    'M21 没被打开过的项目在列表里是 null，且读列表没有替它铸出一行',
    `→ ${JSON.stringify(rowOf(project2.id)?.shareCode)}`)

  // 访客身份项目的裸请求注定被 401 挡回去（见 M9b），那种「没人看见任何东西」的一发不许记查看
  // 次数：记了就是限 N 次只进得来 N/2 个人。计数必须排在闸门之后，闸门本身不许松。
  const masterViews = async () => (await prisma.shareLink.findUnique({
    where: { id: masterRows[0]?.id ?? '' }, select: { viewCount: true },
  }))?.viewCount ?? -1
  const guestVisit = async () => {
    const t = (await call('POST', `/api/share/${masterCode}/guest`, '')).json?.shareToken as string
    return call('GET', `/api/share/${masterCode}`, t)
  }
  const budgetBase = await masterViews()
  await prisma.shareLink.update({ where: { id: masterRows[0]?.id ?? '' }, data: { maxViews: budgetBase + 2 } })
  const knocked = await call('GET', `/api/share/${masterCode}`, '')
  check(knocked.status === 401 && await masterViews() === budgetBase,
    'M22 被访客闸门挡回去的那一发不记查看次数（401 那一发没人看见任何东西）',
    `→ ${knocked.status} / viewCount ${await masterViews()}（应为 ${budgetBase}）`)
  const visit1 = await guestVisit()
  check(visit1.status === 200 && await masterViews() === budgetBase + 1,
    'M23 真的进来了才记一次（该记的一条都不许少）', `→ ${visit1.status} / viewCount ${await masterViews()}`)
  await call('GET', `/api/share/${masterCode}`, '')
  const visit2 = await guestVisit()
  check(visit2.status === 200 && await masterViews() === budgetBase + 2,
    'M24 限 2 次就正好进 2 个人（中间两次被拒不吃预算）', `→ ${visit2.status} / viewCount ${await masterViews()}`)
  const visit3 = await guestVisit()
  check(visit3.status === 410, 'M25 次数真的用满之后访客身份也拦得住（不计数不等于不闸门）', `→ ${visit3.status}`)
  await prisma.shareLink.update({ where: { id: masterRows[0]?.id ?? '' }, data: { maxViews: null } })

  // ── R 收录改用 COLLECT 短链 ───────────────────────────────────────────
  // A4 那条 `?mode=collect` 的长地址删了，收录改由一枚真的链接承载。访客页（冻结文件）
  // 只认 `?mode=collect` 这一个开关，所以裸短码必须自己跳过去。
  const collectCreated = await call('POST', `/api/projects/${project.id}/share-links`, adminToken, {
    name: '收录试验', type: 'COLLECT', scopeType: 'PROJECT', authMode: 'NONE',
    permissions: ['view', 'comment', 'download'],
  })
  const collectToken = collectCreated.json?.shareLink?.token as string | undefined
  check(collectCreated.status === 201 && JSON.stringify(collectCreated.json?.shareLink?.permissions) === '["upload"]',
    'R1 收录链接落库的权限只有 upload（多发过来的下载/批注一律不认）',
    `→ ${JSON.stringify(collectCreated.json?.shareLink?.permissions)}`)

  const bareCollect = await fetch(`${BASE}/${collectToken}`, { redirect: 'manual' })
  const collectLocation = bareCollect.headers.get('location') || ''
  check([302, 307, 308].includes(bareCollect.status) && collectLocation.includes('mode=collect'),
    'R2 裸的收录短码自己补上 ?mode=collect（地址要能被人在地址栏敲进去）',
    `→ ${bareCollect.status} ${collectLocation}`)
  check(await pageStatus(`/${collectToken}?mode=collect`) === 200,
    'R3 带着参数的地址直接出页（不循环重定向）')

  const collectPayload = await call('GET', `/api/share/${collectToken}`, '')
  check(collectPayload.json?.shareType === 'COLLECT' && (collectPayload.json?.videos ?? []).length === 0,
    'R4 访客端收到收录形态：素材清单为空、明说这枚链接是 COLLECT', `→ ${collectPayload.status}`)
  check(collectPayload.json?.allowAssetDownload === false && collectPayload.json?.allowClientAssetUpload === false,
    'R5 收录页不顺手给下载口子')
  check(collectPayload.json?.allowReverseShare === true,
    'R6 项目开着收录：载荷如实说能收（面板据此才画上传框）',
    `→ ${JSON.stringify(collectPayload.json?.allowReverseShare)}`)
  await prisma.project.update({ where: { id: project.id }, data: { allowReverseShare: false } })
  check((await call('GET', `/api/share/${collectToken}`, '')).json?.allowReverseShare === false,
    'R7 项目关掉收录后载荷跟着改口（原先这里硬写 true＝画出一个每次上传都 403 的面板）')
  await prisma.project.update({ where: { id: project.id }, data: { allowReverseShare: true } })

  const collectRow = (await call('GET', `/api/projects/${project.id}/share-links`, adminToken)).json?.shareLinks
  const collectLine = (collectRow ?? []).find((l: any) => l.token === collectToken)
  check(collectLine?.type === 'COLLECT' && collectLine?.scopeType === 'PROJECT',
    'R8 分享记录面板里那一行的范围是「整个项目」', `→ ${JSON.stringify(collectLine?.scopeType)}`)
} catch (err) {
  failures.push(`中断：${String(err).slice(0, 1500)}`)
  console.error(`中断：${String(err).slice(0, 1500)}`)
} finally {
  for (const t of tokens) {
    await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${t}` } }).catch(() => null)
  }
  const teamRow = await prisma.team.findFirst({ where: { slug: teamSlug }, select: { id: true } })
  if (teamRow) {
    const projectIds = (await prisma.project.findMany({ where: { teamId: teamRow.id }, select: { id: true } })).map(p => p.id)
    for (const pid of projectIds) {
      // 令牌是脚本自己 mint 的，按会话前缀清干净，别留 15 分钟的孤儿键。
      const keys = await redis.keys(`video_access:*`)
      for (const key of keys) {
        const raw = await redis.get(key)
        if (!raw) continue
        if (JSON.parse(raw).projectId === teamRow.id || String(JSON.parse(raw).sessionId).includes(teamSlug)) {
          await redis.del(key)
        }
      }
      await prisma.shareLink.deleteMany({ where: { projectId: pid } })
      await prisma.sharePageAccess.deleteMany({ where: { projectId: pid } })
      await prisma.securityEvent.deleteMany({ where: { projectId: pid } })
      await prisma.video.deleteMany({ where: { projectId: pid } })
    }
    await prisma.project.deleteMany({ where: { teamId: teamRow.id } })
    await prisma.team.deleteMany({ where: { id: teamRow.id } })
  }
  await prisma.user.deleteMany({ where: { email: ownerEmail } })

  const left = {
    links: await prisma.shareLink.count({ where: { project: { team: { slug: teamSlug } } } }),
    access: await prisma.sharePageAccess.count({ where: { project: { team: { slug: teamSlug } } } }),
    projects: await prisma.project.count({ where: { team: { slug: teamSlug } } }),
    teams: await prisma.team.count({ where: { slug: teamSlug } }),
    users: await prisma.user.count({ where: { email: ownerEmail } }),
  }
  if (left.links + left.access + left.projects + left.teams + left.users > 0) {
    console.error(`LEAK 清场后仍有残留：${JSON.stringify(left)} stamp=${stamp}`)
    failures.push('清场后仍有残留')
  }
  await prisma.$disconnect()
  // 全绿的那条路没有 process.exit()：Redis 连接不摘，Node 事件循环就一直有句柄，脚本跑完也不退出。
  await redis.quit().catch(() => null)
}

if (failures.length) { console.error(`\n${failures.length} 条失败：\n` + failures.join('\n')); process.exit(1) }
console.log('\n全部断言通过')
