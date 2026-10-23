import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'
import { allocateTeamId } from '../src/lib/team-id'

/**
 * 团队之间的越权实测（黑盒）。
 *
 * A 队的人拿着 B 队的 project/video/comment/shareLink/team… 的 id 去打每一枚接口，
 * 期望一律 401/403/404。**出现 2xx ＝ 越过团队边界**；400/409/422 记「未验归属就进了校验层」，
 * 那种情况今天没漏数据，但换个合法 body 就可能是下一枚洞。
 *
 * 跑法（本地 dev）：
 *   AUTHZ_CHECK_BASE=http://localhost:3000 npx tsx scripts/check-cross-team-authz.mts
 *
 * 会写库建夹具、跑完删干净；**不进 CI**（和 check-player-spinner 同一条规矩）。
 */

const BASE = process.env.AUTHZ_CHECK_BASE || 'http://localhost:3000'
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(BASE)) {
  throw new Error(`只准打本地：${BASE}`)
}

const prisma = new PrismaClient()
const stamp = Date.now()
const short = String(stamp).slice(-7)
const pw = `authz-${stamp}`

const A_EMAIL = `authz-a-${short}@example.invalid`
const B_EMAIL = `authz-b-${short}@example.invalid`

type Probe = { method: string; path: string; body?: unknown; note?: string; headers?: Record<string, string>; expect?: number[] }
type Result = { method: string; path: string; status: number; pass: boolean; warn: boolean; allowed?: boolean; sample?: string }

const results: Result[] = []

async function call(method: string, path: string, token: string, body?: unknown, extraHeaders?: Record<string, string>) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  const text = await res.text().catch(() => '')
  return { status: res.status, text }
}

async function probe(token: string, p: Probe) {
  let status = 0
  let text = ''
  try {
    const r = await call(p.method, p.path, token, p.body, p.headers)
    status = r.status
    text = r.text
  } catch (error) {
    status = -1
    text = (error as Error).message
  }
  const pass = (p.expect ?? [401, 403, 404]).includes(status) || status === 401 || status === 403 || status === 404
  const expects2xx = (p.expect ?? []).some((code) => code >= 200 && code < 300)
  const leak = status >= 200 && status < 300 && !expects2xx
  const warn = !pass && !leak
  results.push({ method: p.method, path: p.path, status, pass, warn, allowed: expects2xx, sample: text.slice(0, 120) })
  const tag = leak ? 'FAIL 越权' : pass ? 'PASS' : warn ? 'WARN 未验归属' : 'ERROR'
  console.log(`${tag} ${p.method} ${p.path} → ${status}${p.note ? `（${p.note}）` : ''}${leak ? ` ← ${text.slice(0, 100)}` : ''}`)
}

const ids: Record<string, string> = {}
const users: string[] = []

try {
  // ── 夹具：两队，各一套资源 ─────────────────────────────────────────────
  const userA = await prisma.user.create({
    data: { email: A_EMAIL, name: `甲-${short}`, password: await hashPassword(pw), phone: `135${short}1` },
  })
  const userB = await prisma.user.create({
    data: { email: B_EMAIL, name: `乙-${short}`, password: await hashPassword(pw), phone: `136${short}2` },
  })
  users.push(userA.id, userB.id)

  const teamA = await prisma.team.create({
    data: {
      id: await allocateTeamId(prisma), name: `authz-a-${short}`, slug: `authz-a-${short}`, shareKey: `authz-a-${short}`,
      createdById: userA.id, subscriptionPlan: 'BETA',
      members: { create: { userId: userA.id, role: 'OWNER', status: 'ACTIVE' } },
    },
  })
  const teamB = await prisma.team.create({
    data: {
      id: await allocateTeamId(prisma), name: `authz-b-${short}`, slug: `authz-b-${short}`, shareKey: `authz-b-${short}`,
      createdById: userB.id, subscriptionPlan: 'BETA',
      members: { create: { userId: userB.id, role: 'OWNER', status: 'ACTIVE' } },
    },
  })
  ids.teamA = teamA.id
  ids.teamB = teamB.id
  ids.userA = userA.id
  ids.userB = userB.id

  const projectB = await prisma.project.create({
    data: {
      teamId: teamB.id, createdById: userB.id, projectCode: `${100 + (stamp % 900)}`, title: `乙队项目-${short}`,
      slug: `authz-p-${short}`, shareSlug: `authz-s-${short}`, allowReverseShare: true,
    },
  })
  ids.projectB = projectB.id

  const videoB = await prisma.video.create({
    data: {
      projectId: projectB.id, name: `乙队素材-${short}`, version: 1, versionLabel: 'v1',
      originalFileName: 'b.mp4', originalFileSize: BigInt(1024), originalStoragePath: `authz/${short}/b.mp4`,
      duration: 10, width: 640, height: 360, fps: 24, status: 'READY', approved: true,
    },
  })
  ids.videoB = videoB.id

  const commentB = await prisma.comment.create({
    data: { projectId: projectB.id, videoId: videoB.id, timecode: '00:00:01:00', content: `乙队批注-${short}`, authorName: '乙', authorEmail: B_EMAIL },
  })
  ids.commentB = commentB.id

  const linkB = await prisma.shareLink.create({
    data: { projectId: projectB.id, token: `authz-link-${short}`, name: '乙队分享' },
  })
  ids.linkB = linkB.id

  const folderB = await prisma.projectFolder.create({ data: { projectId: projectB.id, name: `乙队文件夹-${short}` } })
  ids.folderB = folderB.id

  const albumB = await prisma.photoAlbum.create({ data: { projectId: projectB.id, name: `乙队相册-${short}` } })
  ids.albumB = albumB.id

  const uploadB = await prisma.projectUpload.create({
    data: { projectId: projectB.id, fileName: 'b-client.mp4', fileSize: BigInt(2048), storagePath: `authz/${short}/upload.mp4` },
  })
  ids.uploadB = uploadB.id

  const recipientB = await prisma.projectRecipient.create({ data: { projectId: projectB.id, email: `guest-${short}@example.invalid`, name: '乙队客户' } })
  ids.recipientB = recipientB.id

  const clientB = await prisma.clientCompany.create({ data: { teamId: teamB.id, name: `乙队客户公司-${short}` } })
  ids.clientB = clientB.id

  const joinB = await prisma.teamJoinRequest.create({ data: { teamId: teamB.id, userId: userA.id, status: 'PENDING' } })
  ids.joinB = joinB.id

  const noneLink = await prisma.shareLink.create({
    data: { projectId: projectB.id, token: `authz-none-${short}`, name: '乙队公开链接', authMode: 'NONE', status: 'ACTIVE', permissions: ['view'] },
  })
  const pwLink = await prisma.shareLink.create({
    data: { projectId: projectB.id, token: `authz-pw-${short}`, name: '乙队口令链接', authMode: 'PASSWORD', sharePassword: 'not-a-real-hash', status: 'ACTIVE', permissions: ['view'] },
  })
  const revokedLink = await prisma.shareLink.create({
    data: { projectId: projectB.id, token: `authz-rev-${short}`, name: '乙队已撤销链接', authMode: 'NONE', status: 'REVOKED', permissions: ['view'] },
  })
  const groupB = await prisma.projectGroup.create({ data: { teamId: teamB.id, name: `乙队分组-${short}` } })
  const inviteB = await prisma.teamInvite.create({
    data: { teamId: teamB.id, email: `other-${short}@example.invalid`, token: `authz-inv-${short}`, role: 'MEMBER', expiresAt: new Date(Date.now() + 86400_000), createdById: userB.id },
  })

  const recycleB = await prisma.recycleBinItem.create({
    data: { projectId: projectB.id, itemType: 'VIDEO', itemName: 'b-trash.mp4', paths: [], directories: [], expiresAt: new Date(Date.now() + 86400_000) },
  })
  ids.recycleB = recycleB.id

  // ── 登录 A ────────────────────────────────────────────────────────────
  const login = await call('POST', '/api/auth/login', '', { email: A_EMAIL, password: pw })
  const token = (JSON.parse(login.text) as any)?.tokens?.accessToken as string | undefined
  if (!token) throw new Error(`A 登录失败 → ${login.status} ${login.text.slice(0, 200)}`)
  console.log(`A 队用户登录 ✓（teamA=${teamA.id} / 攻击目标 teamB=${teamB.id}）\n`)

  const P = ids.projectB
  const V = ids.videoB
  const C = ids.commentB
  const L = ids.linkB
  const F = ids.folderB
  const AL = ids.albumB
  const U = ids.uploadB
  const R = ids.recipientB
  const CL = ids.clientB
  const T = ids.teamB
  const UB = ids.userB

  // ── 读：拿 B 的 id 去读 ────────────────────────────────────────────────
  const reads: Probe[] = [
    { method: 'GET', path: `/api/projects/${P}` },
    { method: 'GET', path: `/api/projects/by-code/${100 + (stamp % 900)}` },
    { method: 'GET', path: `/api/projects/${P}/members` },
    { method: 'GET', path: `/api/projects/${P}/share-links` },
    { method: 'GET', path: `/api/projects/${P}/share-links/${L}/accesses` },
    { method: 'GET', path: `/api/projects/${P}/folders` },
    { method: 'GET', path: `/api/projects/${P}/photo-albums` },
    { method: 'GET', path: `/api/projects/${P}/project-uploads` },
    { method: 'GET', path: `/api/projects/${P}/recycle-bin` },
    { method: 'GET', path: `/api/projects/${P}/recipients` },
    { method: 'GET', path: `/api/projects/${P}/project-uploads/${U}/download` },
    { method: 'GET', path: `/api/comments?videoId=${V}` },
    { method: 'GET', path: `/api/videos/${V}` },
    { method: 'GET', path: `/api/videos/${V}/assets` },
    { method: 'GET', path: `/api/videos/${V}/client-assets` },
    { method: 'GET', path: `/api/videos/${V}/download` },
    { method: 'GET', path: `/api/analytics/${P}` },
    { method: 'GET', path: `/api/teams/${T}` },
    { method: 'GET', path: `/api/teams/${T}/members` },
    { method: 'GET', path: `/api/teams/${T}/overview` },
    { method: 'GET', path: `/api/teams/${T}/join-requests` },
    { method: 'GET', path: `/api/users/${UB}` },
    { method: 'GET', path: `/api/clients/${CL}` },
    { method: 'GET', path: `/api/feishu/push/${P}/preview` },
  ]
  for (const p of reads) await probe(token, p)

  // ── 写：拿 B 的 id 去改（先写后删，先不删资源）────────────────────────
  const writes: Probe[] = [
    { method: 'PATCH', path: `/api/projects/${P}`, body: { title: `被甲改了-${short}` } },
    { method: 'POST', path: `/api/projects/${P}/members`, body: { email: A_EMAIL } },
    { method: 'POST', path: `/api/projects/${P}/share-links`, body: { name: '甲建链接', scopeType: 'PROJECT', authMode: 'NONE', permissions: ['view'] } },
    { method: 'PATCH', path: `/api/projects/${P}/share-links/${L}`, body: { name: '甲改的' } },
    { method: 'POST', path: `/api/projects/${P}/folders`, body: { name: `甲建文件夹-${short}` } },
    { method: 'PATCH', path: `/api/projects/${P}/folders`, body: { folderId: F, name: '甲改的' } },
    { method: 'POST', path: `/api/projects/${P}/photo-albums`, body: { name: `甲建相册-${short}` } },
    { method: 'PATCH', path: `/api/projects/${P}/photo-albums/${AL}`, body: { name: '甲改的' } },
    { method: 'POST', path: `/api/projects/${P}/recipients`, body: { email: `evil-${short}@example.invalid` } },
    { method: 'PATCH', path: `/api/projects/${P}/recipients/${R}`, body: { name: '甲改的' } },
    { method: 'POST', path: `/api/projects/${P}/recipients/${R}/reveal-phone`, body: {} },
    { method: 'POST', path: `/api/projects/${P}/approve`, body: {} },
    { method: 'POST', path: `/api/projects/${P}/unapprove`, body: {} },
    { method: 'POST', path: `/api/projects/${P}/review-status`, body: { status: 'CHANGES_REQUESTED' } },
    { method: 'POST', path: `/api/projects/${P}/reprocess`, body: {} },
    { method: 'POST', path: `/api/projects/${P}/notify`, body: {} },
    { method: 'POST', path: `/api/projects/${P}/share-slug/rotate`, body: {} },
    { method: 'POST', path: `/api/projects/${P}/project-uploads/${U}/download-token`, body: {} },
    { method: 'POST', path: `/api/projects/${P}/project-uploads/${U}/promote`, body: {} },
    { method: 'POST', path: `/api/projects/${P}/recycle-bin/purge`, body: { ids: [ids.recycleB] } },
    { method: 'POST', path: `/api/projects/${P}/folders/download-zip-token`, body: { folderId: F } },
    { method: 'PATCH', path: `/api/videos/${V}`, body: { name: `被甲改了-${short}` } },
    { method: 'POST', path: `/api/videos/${V}/duplicate`, body: {} },
    { method: 'POST', path: `/api/videos/${V}/download-token`, body: {} },
    { method: 'POST', path: `/api/videos/${V}/assets/download-zip-token`, body: {} },
    { method: 'POST', path: `/api/videos/${V}/client-assets`, body: {} },
    { method: 'PATCH', path: `/api/videos/batch`, body: { ids: [V] } },
    { method: 'POST', path: `/api/comments`, body: { projectId: P, videoId: V, timecode: '00:00:02:00', content: `甲写的-${short}` } },
    { method: 'PATCH', path: `/api/comments/${C}`, body: { content: '被甲改了' } },
    { method: 'DELETE', path: `/api/comments/${C}` },
    { method: 'POST', path: `/api/teams/${T}/members`, body: { email: A_EMAIL } },
    { method: 'PATCH', path: `/api/teams/${T}/members/${UB}`, body: { role: 'ADMIN' } },
    { method: 'DELETE', path: `/api/teams/${T}/members/${UB}` },
    { method: 'PATCH', path: `/api/teams/${T}`, body: { name: '被甲改了' } },
    { method: 'POST', path: `/api/teams/${T}/activate`, body: {} },
    { method: 'POST', path: `/api/teams/${T}/transfer-owner`, body: { userId: ids.userA } },
    { method: 'POST', path: `/api/teams/${T}/invitations`, body: { email: A_EMAIL, role: 'MEMBER' } },
    { method: 'POST', path: `/api/teams/${T}/leave`, body: {} },
    { method: 'PATCH', path: `/api/teams/${T}/join-requests/${ids.joinB}`, body: { action: 'APPROVE' } },
    { method: 'PATCH', path: `/api/users/${UB}`, body: { name: '被甲改了' } },
    { method: 'POST', path: `/api/users/${UB}/reveal-phone`, body: {} },
    { method: 'PATCH', path: `/api/clients/${CL}`, body: { name: '被甲改了' } },
    { method: 'POST', path: `/api/clients/${CL}/contacts`, body: { name: '甲塞的' } },
    { method: 'POST', path: `/api/feishu/push/${P}`, body: {} },
  ]
  for (const p of writes) await probe(token, p)

  // ── 第二轮：上一轮被 400 挡下的那几条，补上合法 body 再打一次 ─────────
  // 没补这一轮的话，400 会让「没验归属」和「验了」看起来一样。
  const retry: Probe[] = [
    { method: 'POST', path: `/api/projects/${P}/members`, body: { userId: ids.userA } },
    { method: 'POST', path: `/api/projects/${P}/approve`, body: { selectedVideoId: V } },
    { method: 'PATCH', path: `/api/projects/${P}/review-status`, body: { selectedVideoId: V, reviewStatus: 'IN_REVIEW' } },
    { method: 'POST', path: `/api/projects/${P}/unapprove-video`, body: { selectedVideoId: V } },
    { method: 'POST', path: `/api/projects/${P}/videos/download-zip-token`, body: { ids: [V] } },
    { method: 'GET', path: `/api/projects/${P}/photo-albums/${AL}/photos` },
    { method: 'PATCH', path: `/api/comments/${C}`, body: { resolved: true } },
    { method: 'POST', path: `/api/videos/${V}/duplicate`, body: { targetName: `甲复制-${short}` } },
    { method: 'POST', path: `/api/videos/${V}/assets/download-zip-token`, body: { assetIds: ['fake-asset'] } },
    { method: 'PATCH', path: `/api/videos/batch`, body: { videoIds: [V], name: `甲批量-${short}` } },
    { method: 'GET', path: `/api/studio/video-token?videoId=${V}&projectId=${P}&quality=720p` },
    { method: 'GET', path: `/api/share/url?projectId=${P}` },
  ]
  for (const p of retry) await probe(token, p)

  // 搜索：搜 B 队的项目名，命中里不许出现 B 的任何一行。
  const searchRes = await call('GET', `/api/studio/search?q=${encodeURIComponent(`乙队项目-${short}`)}`, token)
  // 只在**命中结果**里找，不在整个 body 里找：响应会把 q 原样回显，拿整串搜必然命中自己。
  let leaked = false
  try {
    const data = JSON.parse(searchRes.text) as { projects?: any[]; assets?: any[] }
    leaked = (data.projects || []).some((p) => String(p.title || '').includes(short))
      || (data.assets || []).some((a) => String(a.name || '').includes(short) || String(a.projectTitle || '').includes(short))
  } catch {
    leaked = true
  }
  console.log(`${leaked ? 'FAIL 越权' : 'PASS'} GET /api/studio/search?q=<B 的项目名> → ${searchRes.status}${leaked ? ' ← 命中了 B 的数据' : '（命中里没有 B）'}`)
  results.push({ method: 'GET', path: '/api/studio/search?q=<B 的项目名>', status: searchRes.status, pass: !leaked, warn: false, allowed: !leaked })

  // by-slug 是**设计上**对任何登录用户开放的（申请加入页要靠 slug 确认团队名）。
  // 这里断言的不是 403，而是「只交了 id/名称/标识这三样」——多交一项就是可枚举的经营信息。
  const slugRes = await call('GET', `/api/teams/by-slug/${`authz-b-${short}`}`, token)
  let slugFields = 'parse-error'
  try { slugFields = Object.keys(JSON.parse(slugRes.text)?.team || {}).sort().join(',') } catch { /* 保持 parse-error */ }
  const slugOk = slugRes.status === 200 && slugFields === 'id,name,slug'
  console.log(`${slugOk ? 'PASS' : 'FAIL'} GET /api/teams/by-slug/<B 的标识> → ${slugRes.status}，字段 ${slugFields}（设计上开放，但不许多交）`)
  results.push({ method: 'GET', path: '/api/teams/by-slug/<B 的标识>', status: slugRes.status, pass: slugOk, warn: !slugOk && slugRes.status !== 200, allowed: slugOk })

  // ── 伪造团队头：A 把 x-team-id 写成 B 的团队号 ──────────────────────────
  // 这是另一条越权路径：接口如果信这枚头而不查成员表，A 就能「以 B 队身份」读。
  const spoof = { 'x-team-id': ids.teamB }
  const spoofProbes: Probe[] = [
    { method: 'GET', path: '/api/projects', headers: spoof },
    { method: 'GET', path: `/api/projects/${P}`, headers: spoof },
    { method: 'GET', path: `/api/studio/search?q=${encodeURIComponent(`乙队项目-${short}`)}`, headers: spoof },
    { method: 'GET', path: '/api/comments/for-me', headers: spoof },
  ]
  for (const p of spoofProbes) await probe(token, p)

  // team-center 本来就该 200（列的是「我的」团队）；伪造头之后要紧的是它仍然不列 B 的团队。
  const tcRes = await call('GET', '/api/team-center', token, undefined, spoof)
  // A 在这套夹具里确实对 B 有一条「申请加入」（后面 join-requests 那几条要用），
  // 所以 team-center 里出现 B 不算越权，**以什么身份**出现才算：必须不是 OWNER/ADMIN/MEMBER，
  // 也不许带项目数/成员数。
  let bEntry: any = null
  try {
    const data = JSON.parse(tcRes.text) as { teams?: any[] }
    bEntry = (data.teams || []).find((t) => String(t?.team?.name || '').includes(`authz-b-${short}`)) || null
  } catch { /* 解析失败按越权算 */ }
  const asMember = Boolean(bEntry) && ['OWNER', 'ADMIN', 'MEMBER'].includes(String(bEntry?.role))
  const withCounts = Boolean(bEntry) && ('projectCount' in bEntry || 'memberCount' in bEntry || '_count' in bEntry)
  const tcLeak = asMember || withCounts
  console.log(`${tcLeak ? 'FAIL 越权' : 'PASS'} GET /api/team-center（x-team-id 写成 B）→ ${tcRes.status}，B 那条 ${JSON.stringify(bEntry)}`)
  results.push({ method: 'GET', path: '/api/team-center（x-team-id=B）', status: tcRes.status, pass: !tcLeak && tcRes.status === 200, warn: false, allowed: true })

  // ── 其余入口：访客链、平台后台、全局设置、邀请、分组、内容 token ─────────
  const random32 = `not-a-real-token-${short}`.padEnd(40, 'x')
  const leftover: Probe[] = [
    // 访客分享链：链接本身就是凭证（公开链接 200 是设计），口令链未验口令、撤销链、乱码 token 都要被挡
    { method: 'GET', path: `/api/share/${`authz-none-${short}`}`, note: '公开链接＝设计上可看', expect: [200] },
    { method: 'GET', path: `/api/share/${`authz-pw-${short}`}`, note: '口令链未验口令' },
    { method: 'POST', path: `/api/share/${`authz-pw-${short}`}/verify`, body: { password: 'wrong-password' }, note: '口令错' },
    { method: 'GET', path: `/api/share/${`authz-rev-${short}`}`, note: '已撤销', expect: [410] },
    { method: 'GET', path: `/api/share/${random32}`, note: '乱码 token' },
    // 内容直链：按 token 走的，拿 B 的原始 id 或乱码都不许命中
    { method: 'GET', path: `/api/content/${V}`, note: '拿素材 id 当内容 token' },
    { method: 'GET', path: `/api/content/${random32}`, note: '乱码 token' },
    { method: 'GET', path: `/api/content/video-zip/${random32}`, note: '乱码 token' },
    { method: 'GET', path: `/api/content/folder-zip/${random32}`, note: '乱码 token' },
    // 平台后台：A 不是平台管理员
    { method: 'GET', path: '/api/platform/teams' },
    { method: 'GET', path: '/api/platform/usage' },
    { method: 'POST', path: '/api/platform/announcements', body: { title: 'x', content: 'y' } },
    // 全局设置（SMTP、域名这些）只有平台管理员能动
    { method: 'GET', path: '/api/settings' },
    { method: 'PATCH', path: '/api/settings', body: { companyName: `被甲改了-${short}` } },
    // 定时任务没实现
    { method: 'GET', path: '/api/cron/cleanup-uploads', expect: [501] },
    // 邀请是发给别人的邮箱：A 拿着 token 也接不了
    { method: 'POST', path: `/api/teams/${T}/invitations/${`authz-inv-${short}`}/accept`, body: {} },
    // 项目分组按团队隔离
    { method: 'PATCH', path: `/api/studio/project-groups/${groupB.id}`, body: { name: '被甲改了' } },
    { method: 'DELETE', path: `/api/studio/project-groups/${groupB.id}` },
    // 头像只能改自己的
    { method: 'POST', path: `/api/users/${UB}/avatar`, body: {}, headers: { 'content-type': 'image/png' } },
    // 日历 / 退订这类 token 链
    { method: 'GET', path: `/api/calendar/feed?token=${random32}` },
    { method: 'GET', path: `/api/unsubscribe?token=${random32}` },
    // 安全页是团队管理员页面：伪造 B 的团队头要 403
    { method: 'GET', path: '/api/security/events', headers: { 'x-team-id': ids.teamB } },
  ]
  for (const p of leftover) await probe(token, p)

  // ── 删：把 B 的资源当自己的删 ──────────────────────────────────────────
  const deletes: Probe[] = [
    { method: 'DELETE', path: `/api/projects/${P}/share-links/${L}` },
    { method: 'DELETE', path: `/api/projects/${P}/folders`, body: { folderId: F } },
    { method: 'DELETE', path: `/api/projects/${P}/photo-albums/${AL}` },
    { method: 'DELETE', path: `/api/projects/${P}/recycle-bin`, body: { ids: [ids.recycleB] } },
    { method: 'DELETE', path: `/api/videos/${V}` },
    { method: 'DELETE', path: `/api/users/${UB}` },
    { method: 'DELETE', path: `/api/clients/${CL}` },
    { method: 'DELETE', path: `/api/projects/${P}` },
    { method: 'DELETE', path: `/api/teams/${T}` },
  ]
  for (const p of deletes) await probe(token, p)

  // ── 汇总 ──────────────────────────────────────────────────────────────
  const leaks = results.filter((r) => r.status >= 200 && r.status < 300 && !r.allowed)
  const warns = results.filter((r) => r.warn)
  console.log(`\n合计 ${results.length} 次：越权 ${leaks.length} / 未验归属 ${warns.length} / 通过 ${results.filter((r) => r.pass).length}`)
  if (leaks.length) {
    console.log('\n⚠️ 越权（2xx）：')
    for (const r of leaks) console.log(`  ${r.method} ${r.path} → ${r.status} ${r.sample ?? ''}`)
  }
  if (warns.length) {
    console.log('\n未验归属就被别的层挡下（400/409/422/5xx）：')
    for (const r of warns) console.log(`  ${r.method} ${r.path} → ${r.status} ${r.sample?.slice(0, 90) ?? ''}`)
  }

  // 夹具还在吗？没被越权删掉的话这里会打印出来，方便核对「哪些操作真的穿过去了」
  const survivors = {
    project: await prisma.project.count({ where: { id: P } }),
    video: await prisma.video.count({ where: { id: V } }),
    team: await prisma.team.count({ where: { id: T } }),
    userB: await prisma.user.count({ where: { id: UB } }),
  }
  console.log(`\n夹具现状（被越权删掉就会是 0）：${JSON.stringify(survivors)}`)
} finally {
  // ── 清场：按依赖顺序删 ────────────────────────────────────────────────
  const P = ids.projectB
  if (P) {
    const videoIds = (await prisma.video.findMany({ where: { projectId: P }, select: { id: true } })).map((v) => v.id)
    await prisma.comment.deleteMany({ where: { OR: [{ projectId: P }, { videoId: { in: videoIds } }] } })
    await prisma.notificationQueue.deleteMany({ where: { projectId: P } }).catch(() => null)
    await prisma.sharePageAccess.deleteMany({ where: { projectId: P } }).catch(() => null)
    await prisma.shareLink.deleteMany({ where: { projectId: P } })
    await prisma.recycleBinItem.deleteMany({ where: { projectId: P } })
    await prisma.projectUpload.deleteMany({ where: { projectId: P } })
    await prisma.photoAlbum.deleteMany({ where: { projectId: P } })
    await prisma.projectRecipient.deleteMany({ where: { projectId: P } })
    await prisma.projectMember.deleteMany({ where: { projectId: P } }).catch(() => null)
    await prisma.projectFolder.deleteMany({ where: { projectId: P } })
    await prisma.video.deleteMany({ where: { projectId: P } })
    await prisma.project.deleteMany({ where: { id: P } })
  }
  for (const teamId of [ids.teamA, ids.teamB].filter(Boolean)) {
    await prisma.teamJoinRequest.deleteMany({ where: { teamId } })
    await prisma.teamInvite.deleteMany({ where: { teamId } })
    await prisma.projectGroup.deleteMany({ where: { teamId } })
    await prisma.clientCompany.deleteMany({ where: { teamId } })
    await prisma.project.deleteMany({ where: { teamId } })
    await prisma.team.deleteMany({ where: { id: teamId } })
  }
  if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } })
  const left = {
    teams: await prisma.team.count({ where: { slug: { startsWith: 'authz-' } } }),
    users: await prisma.user.count({ where: { email: { in: [A_EMAIL, B_EMAIL] } } }),
    projects: await prisma.project.count({ where: { slug: { startsWith: 'authz-p-' } } }),
  }
  console.log(`清场 → 剩 ${JSON.stringify(left)}`)
  await prisma.$disconnect()
}

const failed = results.filter((r) => !r.pass).length
process.exit(failed === 0 ? 0 : 1)
