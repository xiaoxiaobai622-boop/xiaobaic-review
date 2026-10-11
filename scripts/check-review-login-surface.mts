import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * A 组体检修复的判据：审片界面上的对外准入声明、登录弹窗的四语接线、会话状态判定、
 * 团队到期残留、「带水印」承诺、/lab 守卫、打赏挂件。
 *
 * 全是源码级静态判据（不写库、不跑浏览器 ⇒ 可以进 CI 的 check:static）。
 * 为什么静态够用：这次改的都是「这句话还在不在、这句话走不走 locale、这条分支还算不算」，
 * 都是文件里能数出来的事实。界面级复验另跑一次浏览器（见报告）。
 */
const root = new URL('../', import.meta.url)
const read = (rel: string): string => {
  const file = fileURLToPath(new URL(`src/${rel}`, root))
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}
const readLocale = (lang: string): Record<string, Record<string, string>> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`src/locales/${lang}.json`, root)), 'utf8'))

const LOCALES = ['zh', 'en', 'de', 'nl'] as const
const BRAND = '逐帧审阅'
const failures: string[] = []
let passed = 0

function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` → ${detail}` : ''}`)
  if (ok) passed += 1
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

/** 剥掉注释，免得注释里复述了一句被禁的话就判绿/判红。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')
    .replace(/([^:])\/\/[^\n]*/g, '$1')
}

/**
 * 组件里「用户会读到」的中文：JSX 文本节点、可见属性、字符串字面量。
 * 品牌名允许硬编码（专有名词不翻译），其余一律要走 locale —— 这条就是「切了 English
 * 弹窗还是整块中文」那个缺陷的守门人。
 */
function chineseLiterals(source: string): string[] {
  const code = stripComments(source)
  const found = new Set<string>()
  const push = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || !/[\u4e00-\u9fff]/.test(trimmed)) return
    if (/^[\u4e00-\u9fff]+$/.test(trimmed) && trimmed === BRAND) return
    found.add(trimmed.replace(/\s+/g, ' ').slice(0, 60))
  }
  // JSX 文本：>中文<（含被标签包着的一行）
  for (const m of code.matchAll(/>([^<>{}]*)</g)) push(m[1])
  // 可见属性与字符串字面量
  for (const m of code.matchAll(/(?:aria-label|title|placeholder)="([^"]*)"/g)) push(m[1])
  for (const m of code.matchAll(/'([^'\n]*)'|`([^`\n$]*)`/g)) push(m[1] ?? m[2] ?? '')
  return [...found].filter(s => /[\u4e00-\u9fff]/.test(s) && s !== BRAND)
}

/** 抓出组件用到的 (namespace, key)：`useTranslations('ns')` 的变量名 + 它的 `x('key')` 调用。 */
function translationKeys(source: string): Array<{ ns: string; key: string }> {
  const code = stripComments(source)
  const translators = new Map<string, string>()
  for (const m of code.matchAll(/const\s+(\w+)\s*=\s*useTranslations\(\s*'([\w.]+)'\s*\)/g)) {
    translators.set(m[1], m[2])
  }
  const out: Array<{ ns: string; key: string }> = []
  for (const [variable, ns] of translators) {
    for (const m of code.matchAll(new RegExp(`${variable}\\(\\s*'([\\w.]+)'\\s*\\)`, 'g'))) {
      out.push({ ns, key: m[1] })
    }
  }
  return out
}

const reviewLogin = read('components/ReviewLoginActions.tsx')
const locales = LOCALES.map(lang => ({ lang, data: readLocale(lang) }))
// ── 1. 对外准入声明：这两句是产品口径，不是界面装饰 ─────────────────────
check(!reviewLogin.includes('目前仅限内部团队成员访问'),
  'R1 登录块不再对受邀客户宣布「仅限内部团队成员访问」（现状是手机号一验就建号，这句对外是假的）',
  `→ 命中 ${reviewLogin.split('目前仅限内部团队成员访问').length - 1} 次`)
check(!reviewLogin.includes('申请使用权限') && !reviewLogin.includes('Xiaobai-v001'),
  'R2 组件里不再硬写「申请使用权限」与个人微信号（全仓唯一一处就是这个登录框）')
const leakedElsewhere = ['components/StudioRail.tsx', 'components/TeamSwitcher.tsx', 'components/AdminHeader.tsx']
  .filter(f => read(f).includes('Xiaobai-v001'))
check(leakedElsewhere.length === 0, 'R2b 个人微信号没有从登录框挪到别的常驻外壳里', `→ ${leakedElsewhere.join(',') || '无'}`)

// ── 2. 四语接线：切了语言就得真翻，key 必须四份都在 ─────────────────────
// 登录弹窗由两个组件拼出来：外壳 + 微信二维码那块。英文界面下只翻外壳，QR 面板照样
// 整块中文（10-10 实测「Sign in with WeChat」底下就是「正在生成微信小程序码...」），
// 所以这一条要一次扫两个文件。
const modalFiles = ['components/ReviewLoginActions.tsx', 'components/WechatMiniQrLogin.tsx']
const leftovers = modalFiles.flatMap(f => chineseLiterals(read(f)).map(text => `${f.split('/').pop()}：${text}`))
check(modalFiles.every(f => read(f).length > 0) && leftovers.length === 0,
  'R3 登录弹窗里没有硬编码中文（只有品牌名允许直接写；这条钉住「界面切到 English、弹窗整块还是中文」）',
  `→ 剩下 ${leftovers.length} 条${leftovers.length ? `：${leftovers.slice(0, 6).join('｜')}` : ''}`)
const keys = [...new Map(modalFiles.flatMap(f => translationKeys(read(f))).map(k => [`${k.ns}.${k.key}`, k])).values()]
check(keys.length >= 20, 'R3b 登录块真的走了 locale（少于 20 个 key 就是还在写死）', `→ ${keys.length} 个`)
const missing = keys.flatMap(k => locales.filter(({ data }) => !data[k.ns]?.[k.key]).map(l => `${l.lang}:${k.ns}.${k.key}`))
check(keys.length >= 20 && missing.length === 0,
  'R4 用到的每个 key 在 zh/en/de/nl 四份里都存在（少一个语言就是切过去就白屏级缺字）',
  `→ ${missing.length ? missing.slice(0, 8).join(' ') : '四语齐'}`)

// ── 3. 会话判定：一次查不到不许把已登录的人当陌生人 ──────────────────────
const recheck = /addEventListener\(\s*['"](visibilitychange|focus|review-auth-changed)['"]/.test(reviewLogin)
  || /window\.addEventListener\([^)]*pageshow/.test(reviewLogin)
check(recheck,
  'R5 会话状态有重查路径（只在挂载时查一次＝项目审片页没传 onIdentityChange，依赖数组永不变，一次抖动就永远显示「登录」）')
const catchWipesLogin = /catch\s*\([^)]*\)\s*=>\s*\{[^}]*setPasswordUser\(null\)/.test(reviewLogin)
check(!catchWipesLogin,
  'R5b 网络/服务异常不许直接判「未登录」（catch 里清空已知用户＝把还在用的人踢成陌生人）')

// ── 4. 团队到期与激活动作残留 ───────────────────────────────────────────
const projectHeader = read('app/studio/projects/[id]/page.tsx')
const expiryLeaks = ['还剩 ${', '等待激活', '已到期', '激活后团队'].filter(s => projectHeader.includes(s))
check(expiryLeaks.length === 0,
  'R6 项目头页不再报倒计时／等待激活／已到期（另外 5 处 10-01 已收敛成「已停用／长期有效」，且激活端点已 410）',
  `→ 还在用：${expiryLeaks.join('｜')}`)
const twoStates = projectHeader.includes("status === 'DISABLED'") && /长期有效/.test(projectHeader)
check(twoStates, 'R6b 项目头页保留两档口径（已停用／长期有效），不是整块删掉了事')

// ── 5. 「带水印」承诺（烧水印那条链 09-28 已整条删除）────────────────────
const projectInfo = read('components/ProjectInfo.tsx')
check(!/watermarkEnabled\s*\?\s*t\('withWatermark'\)/.test(projectInfo),
  'R7 预览描述不再拼「带水印」（没有烧录、没有开关，这句是空头承诺）')

// ── 6. 收钱入口退出应用外壳 ─────────────────────────────────────────────
const studioLayout = read('app/studio/layout.tsx')
check(!studioLayout.includes('KofiWidget'),
  'R8 登录后的应用外壳里不再挂 Ko-fi 打赏挂件（全站唯一收钱入口；没 ICP 许可证时这类入口不进构建）')
check(read('components/KofiWidget.tsx').length > 0,
  'R8b 组件文件留着没删（撤的是挂载点，不是把东西毁了）')

// ── 7. 改版草稿页不该对全世界开放 ───────────────────────────────────────
const labLayout = read('app/lab/layout.tsx')
check(/AuthProvider/.test(labLayout) && /requireAuth/.test(labLayout),
  'R9 /lab 挂在登录守卫之下（此前匿名 GET /lab/projects 直接 200，草稿页写着「未接生产」）',
  `→ layout ${labLayout.length} 字节`)

// ── 8. 边界与闸门 ───────────────────────────────────────────────────────
const frozen = ['app/share/[teamSlug]/SharePageClient.tsx', 'app/studio/projects/[id]/share/page.tsx', 'components/ThumbnailReel.tsx']
const frozenLeaks = frozen.filter(f => /仅限内部团队成员|申请使用权限/.test(read(f)))
check(frozenLeaks.length === 0,
  'R10 冻结区三文件不受这次改动影响（文案都在组件里，本来就不该动它们）',
  `→ ${frozenLeaks.join('｜') || '干净'}`)
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('package.json', root)), 'utf8')) as { scripts: Record<string, string> }
check(String(pkg.scripts['check:static'] ?? '').includes('check-review-login-surface.mts'),
  'R11 这枚判据接进 npm run check:static（纯静态、不写库，够格进 CI 闸门）')


// ── B/C 组：准入链路与文案残留 ────────────────────────────────────────────
const bySlug = read('app/api/teams/by-slug/[slug]/route.ts')
const joinPage = read('app/studio/team/join/page.tsx')
const teamPage = read('app/studio/team/page.tsx')
const membersPage = read('app/studio/team/members/page.tsx')
const consoleUsers = read('app/platform/users/page.tsx')
const joinRoute = read('app/api/teams/[id]/join-requests/route.ts')
const joinNotifier = read('lib/join-request-notifications.ts')

check(bySlug.includes('select: {') && !bySlug.includes('_count') && !joinPage.includes('team._count'),
  'S1 按 slug 查团队不再交出成员数与项目数（任何登录用户都能逐个 slug 枚举经营信息），申请页也不再显示它们',
  `→ 路由 _count ${bySlug.includes('_count') ? '还在' : '已去'}，页面引用 ${joinPage.includes('team._count') ? '还在' : '已去'}`)
check(joinPage.includes('手机号') && joinPage.includes('审批') && joinPage.indexOf('手机号') < joinPage.indexOf('提交申请'),
  'S2 申请加入页把资格与流程写在提交按钮之前（现状是 401/403 才告诉人办不了）')
check(teamPage.includes('这条链接本身不给任何人权限'),
  'S3 团队设置里那条「团队加入链接」说清了对方的代价（登录＋绑手机＋负责人审批）')
check(!teamPage.includes('5 名成员') && teamPage.includes('team.quota')
    && read('app/api/teams/[id]/route.ts').includes('getTeamQuota'),
  'S4 团队页那句额度不再写死数字，改成从真实 quota 读（运营后台能逐团改额度，写死必变假话）',
  `→ 页面兜底 ${teamPage.includes('5 名成员') ? '还在写死' : '已去掉'}，接口 ${read('app/api/teams/[id]/route.ts').includes('getTeamQuota') ? '带 quota' : '没带'}、team-center ${read('app/api/team-center/route.ts').includes('BETA_QUOTA') ? '还挂着多余的 quota 载荷' : '干净'}`)
check(membersPage.includes('canManage && <Button onClick={invite}>')
    && membersPage.includes('canManage && <Button variant="outline" size="sm" onClick={bulkRemove}')
    && membersPage.includes('canManage && <Card><CardHeader><CardTitle className="text-base">邀请成员'),
  'S5 席位页对没管理权的人不再画一排用不了的控件（原来是 disabled，看着像坏了）')
check(membersPage.includes("canManage ? '成员管理' : '团队成员'"),
  'S5b 同一页的副标题按角色说实话（非管理员看到的是「查看团队里有谁」而不是「管理…」）')
check(consoleUsers.includes('平台账号') && !consoleUsers.includes('>团队成员</h1>') && !consoleUsers.includes("'团队成员'"),
  'S6 运营后台那页不再把「全部平台账号」叫成「团队成员」（它读的是 /api/users 全量，不是某个团队的成员）')
check(joinRoute.includes('notifyTeamAdminsOfJoinRequest') && joinNotifier.includes('platformAnnouncement.create'),
  'S7 提交申请之后真的会叫醒负责人（复用窄栏「平台消息」的定向公告，不新造一套通知）')
check(/  } catch \(error\)/.test(joinNotifier) && /void notifyTeamAdminsOfJoinRequest/.test(joinRoute),
  'S7b 通知失败绝不能把申请打回（辅助函数整体兜异常，调用处不 await）')
check(!/applicantName:[^\n]*\.email/.test(joinRoute),
  'S7c 通知里的申请人姓名不许退到 email 那一列（可能是 wechat-…@wechat.local 占位符，落到负责人眼里就是假身份）')

// 审批的反向那一半：决定落库之后，申请人凭什么知道结果。
const reviewRoute = read('app/api/teams/[id]/join-requests/[requestId]/route.ts')
check(reviewRoute.includes('notifyApplicantOfJoinDecision') && joinNotifier.includes('export async function notifyApplicantOfJoinDecision'),
  'S9 通过／拒绝都会给申请人一条定向「平台消息」（此前两个分支只改库状态，申请人零提醒）')
check(/void notifyApplicantOfJoinDecision/.test(reviewRoute)
    && read('app/api/teams/[id]/join-requests/[requestId]/route.ts').indexOf('void notifyApplicantOfJoinDecision')
      > read('app/api/teams/[id]/join-requests/[requestId]/route.ts').indexOf('} else {'),
  'S9b 这条通知排在两个决定分支之后、且不 await（通知失败绝不许把审批打成 500）')
check(joinPage.includes('通过或拒绝都会给你一条站内消息')
    && joinPage.indexOf('站内消息') < joinPage.indexOf('提交申请'),
  'S9c 申请页在提交之前就写明「结果会以站内消息通知你」（界面承诺的那件事真有人做）')

const legacyGone = ['nav', 'auth', 'common']
const deadKeys: Array<[string, string]> = [
  ['nav', 'githubRepo'], ['nav', 'dockerHub'], ['nav', 'reportIssue'], ['nav', 'aboutViTransfer'], ['nav', 'aboutDescription'],
  ['auth', 'internalAccess'], ['common', 'poweredBy'], ['common', 'yes'], ['common', 'unsavedChanges'],
  ['videos', 'withWatermark'],
]
const stillThere = deadKeys.flatMap(([ns, k]) => locales.filter(({ data }) => data[ns]?.[k] !== undefined).map(l => `${l.lang}:${ns}.${k}`))
check(stillThere.length === 0,
  'S8 开源时代与已下线功能的遗留 key 从四语文件里删净（GitHub 源码／Docker Hub／「仅限内部团队成员访问」／「带水印」等 10 条）',
  `→ 还在：${stillThere.join(' ') || '无'}`)
const leafCount = locales.map(({ data }) => Object.values(data).reduce((n, v) => n + Object.keys(v as object).length, 0))
check(new Set(leafCount).size === 1, 'S8b 删完之后四语的 key 总数仍然一致（删一边不删另一边＝切语言就缺字）', `→ ${leafCount.join('/')}`)

console.log(`\n合计 ${passed} PASS / ${failures.length} FAIL`)
if (failures.length) {
  for (const f of failures) console.log(` - ${f}`)
  process.exit(1)
}
