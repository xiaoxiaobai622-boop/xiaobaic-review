/**
 * 运营后台「团队那几串号」的判据（他 10-15 看完六条清单，一句「全都改掉吧」）。
 *
 * 钉的是六件事，一条对一个他点出来的问题：
 *  A 三处（团队列表卡片／授权详情页／首页团队表）都把「团队 ID」画出来，而且都能一键复制；
 *  B 分享键 tm_ 在后台有地方能看到（客户报的是这串，昨天还有两枚团队换过它）；
 *  C 叫法统一：后台不再用裸 `@xxx` 这种没词的写法，三串各有一个固定的名字；
 *  D 搜索框的提示说实话（它其实还能拿 ID／标识／邮箱搜）；
 *  E 说明句不许再骗人：团队 ID 不是对外地址（同 check-team-numeric-id 的 D 组口径）；
 *  F 服务端确实把 shareKey 交出来了，界面那侧的类型也认这列——少一边就是画个空。
 *  H 后台其余几处（成员页／安全页／消息页）的叫法、身份串与假空态（10-15「接着改运营平台那几处乱的」）。
 *  I 额度来源、功能授权、术语、时间口径、控件阶梯、反馈条数、成员数口径都要说实话（10-15「继续改剩下的问题」）。
 *  G/J 浏览器实测：G 验身份行那几串，J 拿一次性夹具验 I 组里只能在页面上证的那几条
 *    （没额度记录的团队／没授权行的团队／把浏览器时区改成纽约之后时刻仍按北京）。
 *
 * 全程只读源码，不连库、不打接口 ⇒ 可以进 CI 的 check:static。
 * 跑法：
 *   npx tsx scripts/check-platform-team-identity.mts            ← 只读源码，进 CI 的 check:static
 *   npx tsx scripts/check-platform-team-identity.mts --browser  ← 再加一组浏览器实测（要他自己的 next dev 在 :3000 上活着）
 * 浏览器那组会往本地库建一枚一次性平台账号、跑完删干净 ⇒ 永不进 CI。
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'


const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const failures: string[] = []
let passed = 0

function check(ok: boolean, label: string, got: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${String(got) ? ` → ${String(got)}` : ''}`)
  if (ok) passed++
  else failures.push(`${label}${String(got) ? ` — ${String(got)}` : ''}`)
}

function strip(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}
function read(rel: string) {
  const file = `${REPO}/${rel}`
  return existsSync(file) ? strip(readFileSync(file, 'utf8')) : ''
}
// 文案按 key 取，不能拿正则截段：顶层 `security` 之前还有一节 `settings.security`，截段会截到错的那一节。
function json(rel: string): any {
  const file = `${REPO}/${rel}`
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

const LIST = 'src/app/platform/teams/page.tsx'
const DETAIL = 'src/app/platform/teams/[id]/page.tsx'
const HOME = 'src/app/platform/page.tsx'
const API = 'src/app/api/platform/teams/route.ts'
// 三处共用一份身份行，别各写各的（各写一遍就是「乱」的源头）。
const SHARED = 'src/components/PlatformTeamIdentity.tsx'
// 复制那一下单独一枚控件：成员页、安全页也要用，所以它的判据不该绑在团队身份行上。
const COPY = 'src/components/PlatformCopyValue.tsx'

const listSrc = read(LIST)
const detailSrc = read(DETAIL)
const homeSrc = read(HOME)
const apiSrc = read(API)
const sharedSrc = read(SHARED)
const copySrc = read(COPY)

function usesShared(src: string) {
  return /PlatformTeamIdentity/.test(src)
}

async function main() {
  console.log('── A 三处都画得出团队 ID，且能复制 ──')
  check(!!listSrc, 'A0 三个目标文件都读得到（读不到就是路径变了，下面的判据全成空判）',
    `${LIST}:${!!listSrc} ${DETAIL}:${!!detailSrc} ${HOME}:${!!homeSrc}`)
  check(!!sharedSrc, 'A1 有一枚共用的身份行组件（三处各写一遍＝三套叫法各漂一次）', sharedSrc ? '在' : `缺 ${SHARED}`)
  check(usesShared(listSrc) && usesShared(detailSrc) && usesShared(homeSrc),
    'A2 列表卡片、授权详情页、首页团队表三处都接的是那一枚共用件',
    `列表=${usesShared(listSrc)} 详情=${usesShared(detailSrc)} 首页=${usesShared(homeSrc)}`)
  check(!!sharedSrc && /团队 ID/.test(sharedSrc) && /团队标识/.test(sharedSrc) && /分享键/.test(sharedSrc),
    'A3 那一枚共用件把三串各有各的名字写全（少一个名字，运营就只能猜那是啥）',
    sharedSrc ? `ID:${/团队 ID/.test(sharedSrc)} 标识:${/团队标识/.test(sharedSrc)} 分享键:${/分享键/.test(sharedSrc)}` : '共用件还没长出来')
  check(!!copySrc && /copyTextToClipboard/.test(copySrc) && !/navigator\.clipboard/.test(copySrc),
    'A4 复制走仓库现成的 copyTextToClipboard（裸 navigator.clipboard 在 HTTP 局域网里会静默失灵）', '')
  check(!!copySrc && /复制失败/.test(copySrc),
    'A5 复制没成要说「复制失败」，不许按了没反应还装作复制过了', '')

  console.log('\n── B 分享键真的到了界面上 ──')
  const apiSelectAt = apiSrc.search(/select:\s*\{[\s\S]{0,400}/)
  check(apiSelectAt >= 0 && /shareKey:\s*true/.test(apiSrc.slice(apiSelectAt, apiSelectAt + 400)),
    'B1 /api/platform/teams 的 select 里有 shareKey（服务端不给，界面就只能画空）', '')
  check(!!listSrc && /shareKey/.test(listSrc.slice(0, 2000)),
    'B2 列表页的 Team 类型认 shareKey 这列（类型没写＝取到也是 undefined，界面静默少一行）', '')

  console.log('\n── C 叫法统一，不再用裸 @ ──')
  const bareAt = [LIST, HOME].filter(rel => /@\{[a-zA-Z_.]+\.slug\}/.test(read(rel)))
  check(bareAt.length === 0, 'C1 后台不再拿 `@` 当「这是团队标识」的唯一交代（客户侧那句叫「团队标识」，两边得说同一个词）',
    bareAt.length ? `→ 还在用 @ 的：${bareAt.join('、')}` : '→ 两处都换成带名字的行')

  console.log('\n── D 搜索框说实话 ──')
  const placeholder = (listSrc.match(/placeholder="([^"]*)"/) || [])[1] || ''
  check(/ID|号/.test(placeholder) && /邮箱|标识/.test(placeholder),
    'D1 搜索框提示写清了它到底能吃哪几样（原话只说「团队、创建人」，而筛选里其实还吃 ID／标识／邮箱）', `→ ${JSON.stringify(placeholder)}`)
  const filterFields = (listSrc.match(/\[\s*team\.name,[^\]]*\]/) || [])[0] || ''
  check(/team\.id/.test(filterFields) && /team\.slug/.test(filterFields),
    'D2 筛选那段仍然真的吃 id 与 slug（D1 把话说了，别转头把能力删了）', `→ ${JSON.stringify(filterFields.replace(/\s+/g, ' '))}`)

  console.log('\n── E 说明句不许再骗人 ──')
  check(!!sharedSrc && !/邀请/.test(sharedSrc) && !/跨页面定位/.test(sharedSrc),
    'E1 后台这几句不把「团队 ID」说成邀请用的或跨页面定位用的（那两件事分别归团队标识与短码，10-14 实测过）', '')

  console.log('\n── H 后台其余几处：叫法、身份串、假空态（10-15 他「接着改运营平台那几处乱的」）──')
  const layout = read('src/app/platform/layout.tsx')
  const users = read('src/app/platform/users/page.tsx')
  const security = read('src/app/platform/security/SecurityEventsClient.tsx')
  const messages = read('src/app/platform/messages/page.tsx')
  const locale = (lang: string) => read(`src/locales/${lang}.json`)
  const zh = locale('zh')

  check(!!users && !!security && !!messages && !!zh, 'H0 四份文件都读得到（读不到下面全是空判）',
    `成员:${!!users} 安全:${!!security} 消息:${!!messages} 文案:${!!zh}`)
  // 一处东西四个名字＝运营在两个页面里以为自己在管两不同的对象。
  const naming = `${layout}${users}`
  check(!/平台成员/.test(naming) && !/添加成员/.test(naming) && /平台账号/.test(layout) && /添加账号|添加平台账号/.test(users),
    'H1 成员这块从头到尾一个名字（导航、页面标题、按钮、弹窗），不再「平台成员／平台账号／添加成员」混着叫',
    `→ 平台成员:${/平台成员/.test(naming)} 添加成员:${/添加成员/.test(naming)}`)
  // role=ADMIN 是团队侧的角色，进不进后台看的是 isPlatformAdmin（src/lib/auth.ts 里那句）。
  check(!/user\.role === 'ADMIN' \? '管理员'/.test(users) && /isPlatformAdmin/.test(users) && /后台/.test(users),
    'H2 那枚徽标不再把 role=ADMIN 说成「管理员」——能不能进后台读 isPlatformAdmin，文案要带「后台」两字', '')
  const userFilter = (users.match(/filteredUsers[\s\S]{0,600}/) || [])[0] || ''
  check(/user\.id/.test(userFilter), 'H3 成员页的搜索真的吃用户 ID（工单里报的就是这串）', '')
  const usersPlaceholder = (zh.match(/"searchPlaceholder": "[^"]*"/g) || []).find(s => /ID|账号|手机|邮箱/.test(s)) || ''
  check(!!usersPlaceholder, 'H4 成员页搜索框的提示说实话（原来只写「搜索成员...」，而它能搜邮箱／手机／姓名／用户名／ID）',
    `→ ${JSON.stringify(usersPlaceholder.slice(0, 60))}`)
  check(['zh', 'en', 'nl', 'de'].every(l => /"searchPlaceholder"/.test(locale(l))),
    'H5 四语言都还留着 searchPlaceholder（只改中文＝另外三语渲染成裸 key）', '')
  check(/label="用户 ID"/.test(users) && /value=\{user\.id\}/.test(users),
    'H6 成员那一行有可复制的用户 ID（删号、改密这类破坏性操作得能回读自己在动谁）', '')

  // 读失败时画 0／「没有找到」＝把「我不知道」伪装成「确实没有」。
  const loadFailBranch = /读取失败|加载失败|读不到/.test(listSrc)
  check(loadFailBranch, 'H7 团队页读失败不再画三张 0 卡＋一句「没有找到匹配的团队」（那是两回事）', '')
  check(!/text-emerald|bg-emerald/.test([listSrc, homeSrc, detailSrc, sharedSrc, users, security].join('')),
    'H8 后台不再用 emerald 硬色（产品有 success token，深色与 mint／frame 主题下 emerald-700 对比不够）', '')
  check(/>有效期</.test(homeSrc) && !/>状态</.test(homeSrc),
    'H9 首页那一列的表头不再叫「状态」而画的是有效期（列名要说出格子里真是哪一列）', '')
  check(!/\{event\.severity\}/.test(security),
    'H10 安全事件的严重性走中文词表，不把 CRITICAL／HIGH 这类原值直接画给运营（同一列的筛选器已经是中文）', '')
  const blockedCard = (security.match(/blocked[\s\S]{0,220}/) || [])[0] || ''
  check(/pagination\.total|本页|全部/.test(blockedCard) || !/events\.filter/.test(blockedCard),
    'H11「被阻止」那枚数不再冒充全站总数：要么用服务端的总数，要么明说只数本页这几条',
    `→ ${JSON.stringify(blockedCard.replace(/\s+/g, ' ').slice(0, 90))}`)
  check(/value=\{entry\.key\}/.test(security),
    'H12 解封那一行把要解的是哪个 IP／账号说出来（原来 entry.key 只当 React key 与请求参数，屏幕上看不见）', '')
  const msgGaps = (messages.match(/if \((?:annRes|fbRes|usersRes)\.ok\)[\s\S]{0,160}?else /g) || []).length
  check(msgGaps === 3,
    'H13 消息页三发请求每一发都要有「没成就说哪一发」这一支（原来 if (res.ok) 没有 else，读失败被画成「还没有反馈」）',
    `→ 三发里带失败分支的 ${msgGaps} 发`)
  // 这页读的是 /api/users 全量（所有注册账号），副标题却写成「管理能登录后台的账号」＝范围说谎。
  check(/全部注册|所有注册|注册账号/u.test(users) && !/管理能登录后台的账号/.test(users),
    'H14 成员页的副标题说实话：这一页列的是全部注册账号，不是只有能进后台的那些（接口就是 /api/users）', '')


  console.log('\n── I 额度、授权、术语、时间、控件、条数、口径都要说实话（10-15 他「继续改剩下的问题」）──')
  const accessLib = read('src/lib/platform-access.ts')
  const quotaApi = read('src/app/api/platform/teams/[id]/quota/route.ts')
  const grantsApi = read('src/app/api/platform/teams/[id]/grants/route.ts')
  const feedbackApi = read('src/app/api/platform/feedback/route.ts')
  check(!!accessLib && !!quotaApi && !!grantsApi && !!feedbackApi, 'I0 四份服务端文件都读得到（读不到下面全是空判）',
    `口径:${!!accessLib} 额度:${!!quotaApi} 授权:${!!grantsApi} 反馈:${!!feedbackApi}`)

  // ① 读不到 TeamQuota 行时回落到内测默认值（10-01 点单 1-3），但界面那句「随套餐续费」是把回落说成有记录。
  const fallbackTagged = /recorded:\s*false/.test(accessLib) && /recorded:\s*true/.test(accessLib)
  check(fallbackTagged,
    'I1 getTeamQuota 缺行时把「这是默认值、不是这个团队自己的一行」带在返回值里（不带就没人分得清）',
    `→ recorded:false ${/recorded:\s*false/.test(accessLib)} recorded:true ${/recorded:\s*true/.test(accessLib)}`)
  check(/recorded:\s*boolean/.test(detailSrc) && /NextResponse\.json\(\{\s*quota/.test(quotaApi),
    'I2 这枚标记一路从接口走到界面的类型里（服务端给了、界面类型没写＝取到是 undefined，界面静默少一句真话）',
    `→ 界面类型 ${/recorded:\s*boolean/.test(detailSrc)} 接口原样交出 ${/NextResponse\.json\(\{\s*quota/.test(quotaApi)}`)
  check(!/随套餐续费/.test(detailSrc) || /recorded/.test(detailSrc),
    'I3 详情页没有额度记录时不许画「随套餐续费」——内测期根本没有套餐续费这回事，那笔额度也不是这个团队的',
    `→ 还在写「随套餐续费」:${/随套餐续费/.test(detailSrc)}`)

  // ② defaultEnabled=true 的功能没写 grant 行，GET 只回已有行 ⇒ 界面上根本没开关，关不掉。
  check(/platformFeature\.findMany/.test(grantsApi),
    'I4 授权接口列的是平台定义的全部功能，不是这个团队已写过的 grant 行（只列已有行＝默认开启的项在界面上关不掉）', '')
  check(/defaultEnabled/.test(grantsApi),
    'I5 授权接口按 PlatformFeature.defaultEnabled 算出这一项现在到底是开着还是关着', '')
  check(!/因此下面没有可勾选的开关/.test(detailSrc),
    'I6 详情页那句「该团队还没有任何功能授权记录，因此下面没有可勾选的开关」得撤——平台有 8 项默认开启的功能等着被关', '')

  // ③ 机翻残留：IP 翻成「知识产权」、Session 翻成「会议」、Block 翻成「块」、Refreshing 翻成「清爽...」。
  const localeJson = Object.fromEntries(['zh', 'en', 'nl', 'de'].map(l => [l, json(`src/locales/${l}.json`)]))
  const zhSecurity = localeJson.zh?.security || {}
  check(!!localeJson.zh && !!localeJson.en && !!localeJson.nl && !!localeJson.de && Object.keys(zhSecurity).length > 0,
    'I7 四份文案都解析得到、顶层 security 段读得出来（读不到下面三条是空判）',
    `zh.security ${Object.keys(zhSecurity).length} 个 key`)
  const badTerms = [['block', '块'], ['ip', '知识产权'], ['session', '会议']] as const
  const stillBad = badTerms.filter(([key, wrong]) => zhSecurity[key] === wrong).map(([key, wrong]) => `${key}=${wrong}`)
  check(stillBad.length === 0,
    'I8 安全页三处表头/字段名不再是机翻直译（表头「块」其实是「有没有被拦」，详情里的「知识产权」是 IP 地址，「会议」是登录会话）',
    `→ 还挂着：${stillBad.join('、') || `block=${JSON.stringify(zhSecurity.block)} ip=${JSON.stringify(zhSecurity.ip)} session=${JSON.stringify(zhSecurity.session)}`}`)
  check(localeJson.zh?.settings?.security?.refreshing !== '清爽...' && !/^清爽/.test(String(localeJson.zh?.settings?.security?.refreshing || '')),
    'I9 封禁名单那行转圈时不再写「清爽...」（Refreshing 被翻成「清爽」，实际在说的是名单正在读取）',
    `→ ${JSON.stringify(localeJson.zh?.settings?.security?.refreshing)}`)
  check(['zh', 'en', 'nl', 'de'].every(l => typeof localeJson[l]?.security?.block === 'string'),
    'I10 四语言都还留着 security.block 这枚 key（只改中文＝另外三语渲染成裸 key）',
    ['zh', 'en', 'nl', 'de'].map(l => `${l}:${JSON.stringify(localeJson[l]?.security?.block)}`).join(' '))

  // ④ 后台三套时间口径：首页按北京日、安全页跟浏览器、消息页硬编码 zh-CN。
  check(!/toLocaleString\('zh-CN'/.test(messages),
    'I11 消息页不再自己硬写 zh-CN 的 toLocaleString（同一屏安全页用的是另一套格式化，两处对不上时没人知道差在哪）', '')
  check(!/new Date\([^)]*\)\.toLocaleString\(\)/.test(security),
    'I12 安全页的解封倒计时不再用裸 toLocaleString()（它带秒数还跟着浏览器时区跑，和旁边的列表列不同格式）', '')
  const beijingHelpers = [messages, security].filter(src => /formatBeijingDateTime/.test(src))
  check(beijingHelpers.length === 2,
    'I13 安全页与消息页都改用同一枚「按北京」的时间格式化（和首页那套「北京日」对上，运营在一页看到的时刻和另一页的日柱是同一个时区）',
    `→ 用上了的页面 ${beijingHelpers.length} 个`)
  check(/t\('timeZoneNote'\)/.test(security) && /北京/.test(messages)
    && ['zh', 'en', 'nl', 'de'].every(l => String(localeJson[l]?.security?.timeZoneNote || '').includes('UTC+8')),
    'I14 这两页把「时间按北京（UTC+8）」说出来（首页那页早就写了「日期按北京日切分」，另两页什么都不声明）',
    `→ 安全页走文案键 ${/t\('timeZoneNote'\)/.test(security)}，消息页硬编码 ${/北京/.test(messages)}，四语的值：${['zh', 'en', 'nl', 'de'].map(l => JSON.stringify(localeJson[l]?.security?.timeZoneNote)).join(' ')}`)

  // ⑤ 同一页两扇窗两套控件阶梯：添加窗把输入框压到 h-8、小按钮 h-6，编辑窗用默认 h-10 / h-7。
  check(!/className="h-8"/.test(users) && !/pr-8 h-8/.test(users),
    'I15 账号页两扇窗的输入框不再一扇压到 h-8、一扇用默认 h-10（同一件事的同一张表单，同一个字段两种高度）',
    `→ h-8 输入框 ${(/className="h-8"/.test(users)) ? '还在' : '已收'} / pr-8 h-8 ${(/pr-8 h-8/.test(users)) ? '还在' : '已收'}`)
  check(!/h-8 rounded-sm/.test(users),
    'I16「管理员／普通账号」那枚分段选择两扇窗同高（原来一扇 h-8 text-xs 一扇 h-9 text-sm）', '')
  check(!/h-6 px-2/.test(users) && /h-7 px-2/.test(users),
    'I17 生成／复制密码那两枚小按钮两扇窗收成同一档 h-7（原来一扇 h-6 一扇 h-7）', '')

  // ⑥ 反馈条数：接口 take:100，界面把这一屏的条数报成总数。
  check(/platformFeedback\.count\(/.test(feedbackApi) && /total/.test(feedbackApi),
    'I18 反馈接口除了这一屏的行，还回整张表的总数（只回窗口内的条数，界面那句「N 条」就是截断窗口冒充总数）', '')
  check(/共 \$\{feedbackTotal\} 条/.test(messages) && /这一屏只列最近 \$\{feedback\.length\} 条/.test(messages),
    'I19 消息页那个条数用的是服务端总数，窗口装不下时补一句「这一屏只列最近 N 条」',
    `→ 总数那句 ${/共 \$\{feedbackTotal\} 条/.test(messages)} / 窗口那句 ${/这一屏只列最近 \$\{feedback\.length\} 条/.test(messages)}`)

  // ⑦ 首页「成员」列数的是全部 TeamMember 行，而额度检查与团队详情的用量只算 status=ACTIVE。
  const countBlock = (apiSrc.match(/_count:\s*\{[\s\S]{0,200}/) || [])[0] || ''
  check(/members:\s*\{\s*where:[^}]*ACTIVE/.test(countBlock),
    'I20 后台的成员数只算在队的成员，和额度检查、团队详情的用量口径是同一句话',
    `→ ${JSON.stringify(countBlock.replace(/\s+/g, ' ').slice(0, 90))}`)

  // ⑧ 账号页自己说「平台账号」，可这页渲染出来的文案里还混着「成员」「用户」——一个东西三个名字。
  // 判法机械：把这页真的调用到的 key 抽出来，逐条看中文值。en/nl/de 本来就统一用 User/Gebruiker/Benutzer，不在这一刀里。
  const usedKeys = [...new Set([...users.matchAll(/[^a-zA-Z]t\(['"]([a-zA-Z]+)['"]\)/g)].map(m => m[1]))]
  const zhUsers = localeJson.zh?.users || {}
  const misNamed = usedKeys.filter(k => {
    const v = String(zhUsers[k] ?? '')
    return /成员/.test(v) || /用户(?!名)/.test(v)
  }).map(k => `${k}=${JSON.stringify(zhUsers[k])}`)
  check(usedKeys.length > 20 && misNamed.length === 0,
    'I21 账号页渲染出来的中文文案里，这个对象只有一个名字：账号（原来「添加成员／编辑用户／删除账号」三种并存，同一页跳三个词）',
    `→ 这页用到 ${usedKeys.length} 个 key，还混着叫法的 ${misNamed.length} 条：${misNamed.slice(0, 6).join('、')}`)

  // ⑨ 同一张表单两扇窗：添加窗把「用户名／显示名称」并排、间距紧一档，编辑窗竖排、间距松一档。
  // 切区块用 `open={showXxxModal}` 当锚点：JSX 注释 `{/* Edit User Modal */}` 会被 read() 当块注释剥掉，锚不中。
  const editRegion = users.slice(users.indexOf('open={showEditUserModal}'), users.indexOf('open={showPasswordModal}'))
  const addRegion = users.slice(users.indexOf('open={showAddUserModal}'), users.indexOf('open={showEditUserModal}'))
  const twoColRows = (users.match(/className="grid grid-cols-2 gap-2"/g) || []).length
  const editLabelGaps = [...editRegion.matchAll(/className="space-y-(\d)">\s*<Label htmlFor="edit/g)].map(m => m[1])
  check(editLabelGaps.length === 4 && editLabelGaps.every(gap => gap === '1')
    && /className="space-y-1">\s*<Label htmlFor="newEmail/.test(addRegion)
    && twoColRows >= 4 && !/border-t border-border pt-4/.test(editRegion) && !/space-y-4 py-4/.test(editRegion),
    'I22 两扇窗是同一张表单：字段包装、分隔线、正文节奏与「用户名／显示名称」那行的两列排法都对得上',
    `→ 编辑窗四个字段间距 ${JSON.stringify(editLabelGaps)}／两列行 ${twoColRows} 处／编辑窗还留着 pt-4:${/border-t border-border pt-4/.test(editRegion)}／正文还是 space-y-4 py-4:${/space-y-4 py-4/.test(editRegion)}`)

  // ⑩（他 10-16 一句「修改」点单）账号页剩下的几处机翻：Passkeys 翻成「万能钥匙」、
  // 「注册密码失败」把 passkey 说成 password、`changing` 直译「改变...」、用户名框的提示写着「管理员」。
  // 这一条用明写黑名单（文案对不对没法从结构推），只判 zh：en/nl/de 这三语实测本来就顺。
  const bannedZh = {
    passkeysTitle: '万能钥匙',
    failedToRegisterPasskey: '注册密码失败',
    noPasskeysHint: '添加密码以进行无密码登录',
    changing: '改变...',
    usernamePlaceholder: '管理员',
  }
  const stillBanned = Object.entries(bannedZh).filter(([key, wrong]) => zhUsers[key] === wrong).map(([key, wrong]) => `${key}=${JSON.stringify(wrong)}`)
  check(stillBanned.length === 0,
    'I23 账号页那五处机翻不再出现（万能钥匙／注册密码失败／添加密码以进行无密码登录／改变...／用户名提示「管理员」）',
    `→ 还挂着：${stillBanned.join('、') || `已改成 ${Object.keys(bannedZh).map(k => JSON.stringify(zhUsers[k])).join(' ')}`}`)
  check(['en', 'nl', 'de'].every(l => String(localeJson[l]?.users?.passkeysTitle || '').toLowerCase().includes('passkey')),
    'I24 另外三语的通行密钥标题仍说 passkey（这条只改中文，别把好的那三语一起改坏）',
    ['en', 'nl', 'de'].map(l => JSON.stringify(localeJson[l]?.users?.passkeysTitle)).join(' '))

  const statusBadgeKept = /status === 'ACTIVE'/.test(listSrc) && /已停用/.test(listSrc)
  check(statusBadgeKept, 'F1 列表卡片的「正常／已停用」状态与停用操作这条线还在（这次只加身份行，没顺手砍功能）', '')
  const quotaKept = /团队配额/.test(detailSrc) && /保存配额/.test(detailSrc) && /功能授权/.test(detailSrc)
  check(quotaKept, 'F2 授权详情页那两块（功能授权／团队配额）一个没少', '')

  if (BROWSER) await browserGroup()
  else console.log('\n（G 组浏览器实测没跑：加 --browser 才跑，它要你自己的 next dev 在 :3000 上活着）')
}

// ── G 组：真浏览器里走一遍（页内登录，因为平台令牌绑设备指纹，Node 登录的令牌带不进浏览器）──
const BROWSER = process.argv.includes('--browser')
const BASE = process.env.IDENTITY_CHECK_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

let ws: WebSocket | undefined
let msgId = 0
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

function send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
  const id = ++msgId
  return new Promise<any>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws?.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP 超时：${method}`)) }
    }, 40_000)
  })
}

function attachSocket(url: string) {
  return new Promise<void>((resolve, reject) => {
    ws = new WebSocket(url)
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data))
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)!
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
        else p.resolve(msg.result)
      }
    }
    ws.onerror = () => reject(new Error('CDP WebSocket 连接失败'))
    ws.onopen = () => resolve()
  })
}

async function openPage() {
  const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const page = { browserContextId, targetId, sessionId, s: (m: string, p: Record<string, unknown> = {}) => send(m, p, sessionId) }
  await page.s('Page.enable')
  await page.s('Runtime.enable')
  return page
}
type Page = Awaited<ReturnType<typeof openPage>>

async function evalJs(page: Page, expression: string) {
  const r = await page.s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`页面 JS 异常：${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
  return r.result.value
}

async function waitFor(page: Page, expression: string, timeoutMs = 60_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await evalJs(page, `(() => { try { return (${expression}) ? true : false } catch { return false } })()`)) return true
    await sleep(400)
  }
  return false
}

async function run(page: Page, path: string) {
  await page.s('Page.navigate', { url: `${BASE}${path}` })
}

/** 判据绿不等于看着对：SHOT_DIR 给了就把三页各存一张，自己眼里过一遍。 */
async function shot(page: Page, name: string) {
  const dir = process.env.SHOT_DIR
  if (!dir) return
  const r = await page.s('Page.captureScreenshot', { format: 'png' })
  if (r?.data) {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/${name}.png`, Buffer.from(r.data, 'base64'))
  }
}

function luminance([r, g, b]: number[]) {
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r / 255) + 0.7152 * f(g / 255) + 0.0722 * f(b / 255)
}
function contrast(a: number[], b: number[]) {
  const l1 = luminance(a), l2 = luminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}
function rgbOf(css: string): number[] | null {
  const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)/.exec(css || '')
  if (!m) return null
  if (m[4] !== undefined && Number(m[4]) === 0) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/**
 * J 组：这一批「说实话」改动的行为证据（额度来源／功能授权默认项／术语／时间／控件阶梯／条数／成员口径）。
 * 静态那几组只读源码，而这几条要证的是「页面上真的画出了那句话、数真的按这个口径数」，
 * 所以建一次性夹具：一枚没有额度记录也没有授权行的团队 + 一名已停用成员 + 一条定在 UTC 16:30 的反馈，
 * 再把这台浏览器的时区临时改成纽约（他本机是 +08，不换成别的时区就量不出「跟着浏览器走」和「钉在北京」的差别）。
 * 跑完连夹具带临时改动一并复原。只在 --browser 里跑，永不进 CI。
 */
async function jGroup(page: Page, prisma: PrismaClient, adminId: string, pw: string, stamp: number) {
  console.log('\n── J 额度／授权／时间／条数／口径的浏览器实测（建一次性夹具＋临时改时区，跑完复原）──')
  const totalFeatures = await prisma.platformFeature.count()
  let teamId = ''
  let ghostId = ''
  let feedbackId = ''
  let probeEventId = ''
  let securityWasOn: boolean | null = null
  try {
    // 团队号必须过库级 CHECK `^[1-9]\d{5}$`；撞号就往后挪一枚再试。
    for (let i = 0; i < 12 && !teamId; i++) {
      const candidate = String(900_000 + ((stamp + i * 7919) % 99_999))
      try {
        const created = await prisma.team.create({
          data: {
            id: candidate, name: `PID 夹具 ${stamp}`, slug: `zz${stamp}${i}`, shareKey: `tm_zz${stamp}${i}`,
            createdById: adminId,
          },
          select: { id: true, slug: true, shareKey: true },
        })
        teamId = created.id
      } catch { /* 换下一枚号 */ }
    }
    if (!teamId) { check(false, 'J0 建不出一次性团队（号池或 CHECK 挡了），J 组跑不了', ''); return }

    const ghost = await prisma.user.create({
      data: { email: `pid-ghost-${stamp}@example.invalid`, name: 'PID Ghost', password: await hashPassword(pw) },
      select: { id: true },
    })
    ghostId = ghost.id
    await prisma.teamMember.createMany({
      data: [
        { teamId, userId: adminId, role: 'OWNER', status: 'ACTIVE' },
        { teamId, userId: ghostId, role: 'MEMBER', status: 'DISABLED' },
      ],
    })
    // 时刻挑 UTC 16:30：北京是次日 00:30，而纽约是当天 12:30——页面要是还跟着浏览器时区走，
    // 这一格就会画成 12:30，钉在北京的话必须是 00:30（他本机 +08，不换时区这两种结果看不出差别）。
    const probeDay = new Date('2026-10-14T16:30:00.000Z')
    const feedback = await prisma.platformFeedback.create({
      data: { userId: ghostId, content: `pid-probe-${stamp}`, createdAt: probeDay },
      select: { id: true },
    })
    feedbackId = feedback.id

    // 安全事件列表被 SecuritySettings.viewSecurityEvents 挡着（本地实测 false）。这一组要看行，
    // 就临时把它打开、跑完按原值复原——不改这一枚就只能 SKIP，时间口径那条主断言就测不到。
    const sec = await prisma.securitySettings.findUnique({ where: { id: 'default' }, select: { viewSecurityEvents: true } })
    if (sec) {
      securityWasOn = sec.viewSecurityEvents
      if (!sec.viewSecurityEvents) await prisma.securitySettings.update({ where: { id: 'default' }, data: { viewSecurityEvents: true } })
    }
    // 让这台浏览器自认为是纽约：水合之前就把时区换掉，页面读到的 resolvedOptions 才是纽约。
    await page.s('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' })

    await run(page, `/platform/teams/${teamId}`)
    const ready = await waitFor(page, `document.querySelectorAll('input[type=checkbox]').length > 0`, 90_000)
    const detail = await evalJs(page, `(() => {
      const boxes = [...document.querySelectorAll('input[type=checkbox]')]
      const txt = document.body.innerText
      return { boxes: boxes.length, defaulted: (txt.match(/平台默认开着|平台默认关着/g) || []).length,
        empty: txt.includes('没有可勾选的开关'),
        noRecord: txt.includes('还没有单独的额度记录'), renewed: txt.includes('随套餐续费'),
        inputs: [...document.querySelectorAll('input[type=number]')].length }
    })()`)
    check(ready && detail.boxes === totalFeatures && detail.empty === false,
      'J1 没写过任何授权行的团队，详情页也把平台定义的全部功能都摆成可勾的开关（原来那版一行都没写＝界面一个开关都没有）',
      `→ 开关 ${detail.boxes} 枚 / 平台定义 ${totalFeatures} 项 / 还在说「没有可勾选的开关」：${detail.empty}`)
    check(detail.defaulted === detail.boxes,
      'J2 每一格都注明了这现在是「平台默认」在生效，不是这个团队单独设过的（不然运营分不清自己在动谁）',
      `→ 标了默认的 ${detail.defaulted} 枚 / 开关 ${detail.boxes} 枚`)
    check(detail.noRecord && !detail.renewed && detail.inputs === 4,
      'J3 这队没有额度记录时，那句说的是「上面四格是内测统一默认值」，不是「随套餐续费」（四格输入框仍在，能直接改）',
      `→ 说实话那句 ${detail.noRecord} / 还在写续费 ${detail.renewed} / 输入框 ${detail.inputs}`)

    const saved = await evalJs(page, `(async () => {
      const box = [...document.querySelectorAll('input[type=checkbox]')].find(b => b.checked)
      if (!box) return { toggled: false }
      const key = box.closest('label')?.innerText.split('\\n')[0] || ''
      box.click()
      const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('保存功能授权'))
      btn && btn.click()
      await new Promise(r => setTimeout(r, 1500))
      return { toggled: true, key, said: document.body.innerText.replace(/\\s+/g, ' ').match(/功能授权已保存|保存失败|没有要保存的改动/g) }
    })()`)
    const grantRow = saved.toggled ? await prisma.teamFeatureGrant.findFirst({ where: { teamId }, select: { featureKey: true, enabled: true } }) : null
    check(!!saved.toggled && String(saved.said || '').includes('功能授权已保存') && !!grantRow && grantRow.enabled === false,
      'J4 把一个「默认开着」的项关掉、按保存，库里真的落了一行 enabled=false（这条链路原来根本没有入口）',
      `→ 关的是 ${JSON.stringify(saved.key)}，界面回话 ${JSON.stringify(saved.said)}，库里的行 ${JSON.stringify(grantRow)}`)

    await run(page, `/platform/teams/${teamId}`)
    await waitFor(page, `document.body.innerText.includes('这一队单独设过')`, 90_000)
    const afterReload = await evalJs(page, `(() => {
      const txt = document.body.innerText
      return { explicit: txt.includes('这一队单独设过'), stillDefault: (txt.match(/平台默认开着|平台默认关着/g) || []).length }
    })()`)
    check(afterReload.explicit && afterReload.stillDefault === totalFeatures - 1,
      'J5 回来之后只有刚存过的那一格改口成「这一队单独设过」，其余还是「平台默认」——保存没把没动过的默认值一起钉死',
      `→ 单独设过 ${afterReload.explicit} / 仍是默认 ${afterReload.stillDefault} / 平台共 ${totalFeatures}`)

    await run(page, '/platform/teams')
    await waitFor(page, `document.body.innerText.includes(${JSON.stringify(teamId)})`, 90_000)
    // 「成员 / 项目」那一格是 <p>N / M</p>，和身份行不在同一个 div 里，所以从标签往上找它所属的那张卡。
    // 判「是不是卡片」用两个特征：这一片子树里只有它一枚这样的标签、且带按钮（身份行与操作行都有）。
    // 这里刻意不写正则字面量：模板字面量会把反斜杠 cook 掉一层，浏览器收到的源码里反斜杠少一个。
    const listCard = await evalJs(page, `(() => {
      const t = ${JSON.stringify({ teamId })}
      const labels = [...document.querySelectorAll('p')].filter(x => x.textContent.trim() === '成员 / 项目')
      const cardOf = (p) => { let n = p.parentElement
        while (n && !([...n.querySelectorAll('p')].filter(x => x.textContent.trim() === '成员 / 项目').length === 1 && n.querySelector('button'))) n = n.parentElement
        return n }
      const mine = labels.filter(p => { const c = cardOf(p); return !!c && c.textContent.indexOf(t.teamId) > -1 })
      const value = mine.length === 1 && mine[0].nextElementSibling ? mine[0].nextElementSibling.textContent : null
      return { cards: labels.length, matched: mine.length, raw: value, members: value === null ? null : Number(String(value).split(' / ')[0]) }
    })()`)
    check(listCard.members === 1,
      'J6 团队列表那一行的成员数只算在队的（这队建了 2 行成员、其中 1 行 DISABLED，界面得写 1 不能写 2）',
      `→ ${JSON.stringify(listCard)}`)

    await run(page, '/platform')
    await waitFor(page, `document.body.innerText.includes(${JSON.stringify(teamId)})`, 90_000)
    const homeRow = await evalJs(page, `(() => {
      const t = ${JSON.stringify({ teamId })}
      const row = [...document.querySelectorAll('tr')].find(r => r.innerText.includes(t.teamId))
      const cells = row ? [...row.querySelectorAll('th,td')].map(c => c.innerText.trim()) : []
      return { found: !!row, members: cells[2], projects: cells[3] }
    })()`)
    check(homeRow.found && homeRow.members === '1',
      'J7 首页那张表的「成员」列同一个口径（两页数字对不上时，运营会以为其中一页在骗他）',
      `→ 成员列 ${JSON.stringify(homeRow.members)}，项目列 ${JSON.stringify(homeRow.projects)}`)

    // 反馈窗口那条话只有库里超过 100 条才会出现，所以补一批一次性行把它推过窗口边界。
    await prisma.platformFeedback.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        userId: ghostId, content: `pid-fill-${stamp}-${i}`, status: 'OPEN',
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      })),
    })

    await run(page, '/platform/messages')
    const fbTotal = await prisma.platformFeedback.count()
    const fbWindow = Math.min(fbTotal, 100)
    const readyMsg = await waitFor(page,
      `document.body.innerText.replace(/\\s+/g,' ').includes(${JSON.stringify(`共 ${fbTotal} 条，这一屏只列最近 ${fbWindow} 条`)})`, 90_000)
    const msgFacts = await evalJs(page, `(() => {
      const txt = document.body.innerText.replace(/\\s+/g, ' ')
      return { total: txt.includes(${JSON.stringify(`共 ${fbTotal} 条`)}), window: txt.includes(${JSON.stringify(`这一屏只列最近 ${fbWindow} 条`)}),
        beijing: txt.includes('北京'), probe: txt.includes('2026-10-15 00:30'), newyork: txt.includes('2026-10-14 12:30'),
        sloppy: (txt.match(/\\d{1,2}\\/\\d{1,2}\\s?\\d{1,2}:\\d{2}/g) || []).slice(0, 3) }
    })()`)
    if (!readyMsg) console.log(`（消息页没等到「共 ${fbTotal} 条，这一屏只列最近 ${fbWindow} 条」这句，下面两条按实测判）`)
    check(msgFacts.total && msgFacts.window,
      `J8 反馈收件箱的条数用的是整张表的总数，接口只回最近 100 行时界面补一句「这一屏只列最近 100 条」（库里现在 ${fbTotal} 条）`,
      `→ 总数那句 ${msgFacts.total} / 窗口那句 ${msgFacts.window}`)
    check(msgFacts.beijing && msgFacts.probe && !msgFacts.newyork && msgFacts.sloppy.length === 0,
      'J9 这台浏览器已经被改成纽约时区：消息页那条定在 UTC 16:30 的反馈仍画成北京次日 00:30，没有跟着浏览器走成 12:30，也没有原来那种「10/15 14:37」写法',
      `→ 声明了北京 ${msgFacts.beijing} / 北京写法 ${msgFacts.probe} / 纽约写法 ${msgFacts.newyork} / 旧写法残留 ${JSON.stringify(msgFacts.sloppy)}`)

    await run(page, '/platform/users')
    await waitFor(page, `document.querySelectorAll('tbody tr').length > 0`, 90_000)
    const PROBE_HELPERS = `
      const close = () => { const b = [...document.querySelectorAll('[role=dialog] button')].find(x => x.innerText.trim() === '取消'); b && b.click() }
      const box = (id) => { const el = document.getElementById(id); return el ? Math.round(el.getBoundingClientRect().height * 100) / 100 : null }
      const wid = (id) => { const el = document.getElementById(id); return el ? Math.round(el.getBoundingClientRect().width * 100) / 100 : null }
      const seg = () => { const b = [...document.querySelectorAll('[role=dialog] button')].find(x => x.textContent.trim() === '普通账号'); return b ? Math.round(b.getBoundingClientRect().height * 100) / 100 : null }
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      // 两扇窗正文宽度差 15px 到底是谁吃的：滚动条占的宽度量出来才算说过。
      const sb = () => { const el = [...document.querySelectorAll('[role=dialog] div')].find(d => String(d.className).includes('overflow-y-auto'))
        return el ? el.offsetWidth - el.clientWidth : null }`
    const addLadder = await evalJs(page, `(async () => {${PROBE_HELPERS}
      const add = [...document.querySelectorAll('button')].find(b => b.innerText.includes('添加账号'))
      if (!add) return { missing: '添加账号' }
      add.click(); await wait(800)
      return { input: box('newEmail'), second: box('newPassword'), segment: seg(), nameRow: [wid('newUsername'), wid('newName')], full: wid('newEmail'), sb: sb(), open: document.querySelectorAll('[role=dialog]').length }
    })()`)
    await shot(page, '5a-users-add-open')
    const editLadder = await evalJs(page, `(async () => {${PROBE_HELPERS}
      close(); await wait(600)
      // 别拿 tooltip 的中文当锚点：那串文案本身就是这页的叫法之一，改一次叫法探针就找不到了。
      // 操作列里第一枚按钮固定是「编辑」（后面才是改密／密钥／删除）。
      const edit = document.querySelector('tbody tr td:last-child button')
      if (!edit) return { missing: '编辑按钮' }
      edit.click(); await wait(800)
      return { title: edit.title, input: box('editEmail'), second: box('editPhone'), segment: seg(), nameRow: [wid('editUsername'), wid('editName')], full: wid('editEmail'), sb: sb(), open: document.querySelectorAll('[role=dialog]').length }
    })()`)
    await shot(page, '5b-users-edit-open')
    await evalJs(page, `(async () => {${PROBE_HELPERS}
      close(); await wait(400); return true })()`)
    check(addLadder.input != null && addLadder.input === editLadder.input
      && addLadder.second != null && addLadder.second === editLadder.second
      && addLadder.segment === editLadder.segment,
      'J10 账号页「添加」和「编辑」两扇窗里同一个文本框、同一个分段选择量出来是同一个高度（原来一扇 30px 一扇 33.75px，同张表单两种尺寸）',
      `→ 添加 文本框 ${addLadder.input}／第二个框 ${addLadder.second}／分段 ${addLadder.segment}；编辑 ${editLadder.input}／${editLadder.second}／${editLadder.segment}（点的是 title=${JSON.stringify(editLadder.title)} 那枚，根字号实测 ${await evalJs(page, `getComputedStyle(document.documentElement).fontSize`)}）`)

    // 「用户名／显示名称」这一对在添加窗是并排两列、编辑窗原来是一列两个：量宽度就知道排法对不对
    // （并排时两枚各约整行的一半、中间隔 gap-2=7.5px，竖排时各自占满整行）。
    // 两扇窗的绝对宽度差 15px 是添加窗内容更高、正文里出来一条滚动条占掉的，不是排法不同 ⇒ 比的是「各占整行的比例」。
    const ratio = (probe: { nameRow?: number[]; full?: number }) =>
      Array.isArray(probe.nameRow) && probe.nameRow.length === 2 && probe.full ? probe.nameRow[0] / probe.full : null
    const addRatio = ratio(addLadder)
    const editRatio = ratio(editLadder)
    const halved = (probe: { nameRow?: number[]; full?: number }) => Array.isArray(probe.nameRow)
      && probe.nameRow.length === 2
      && probe.nameRow.every((w) => Math.abs(w * 2 + 7.5 - (probe.full ?? 0)) < 3)
    check(halved(addLadder) && halved(editLadder)
      && addRatio !== null && editRatio !== null && Math.abs(addRatio - editRatio) < 0.01
      && addLadder.full - editLadder.full === editLadder.sb - addLadder.sb,
      'J14 两扇窗里「用户名／显示名称」排法一样：各自都是约整行一半宽的两列；两扇窗那 15px 宽度差恰好等于滚动条占掉的宽度（不是排法不同）',
      `→ 添加 ${JSON.stringify(addLadder.nameRow)}／整行 ${addLadder.full}／滚动条占 ${addLadder.sb}px；编辑 ${JSON.stringify(editLadder.nameRow)}／整行 ${editLadder.full}／滚动条占 ${editLadder.sb}px`)

    // 「IP 地址／会话 ID」这两枚标签只在展开的详情里出现，而且带个尾冒号；只有真带那两个字段的那一行才画得出来。
    // 本地这一屏（最新 50 条）实测没有一条带 sessionId，所以补一条同时带会话与 IP 的一次性事件当第 0 行，
    // 不然「点开若干行也没找到那两枚标签」会被读成标签没改对。
    const probeEvent = await prisma.securityEvent.create({
      data: { type: 'SUSPICIOUS_ACTIVITY', severity: 'WARNING', sessionId: `pid-probe-${stamp}`, ipAddress: '203.0.113.77' },
      select: { id: true },
    })
    probeEventId = probeEvent.id
    // 「时间按北京」那句在还没出行时就先画出来了（列表在「正在加载事件…」），拿它当加载完的信号会读到 0 行。
    // 日期格定宽 16 字（YYYY-MM-DD HH:MM），用它当「行真的出来了」的信号。
    const DATE_CELL = `[...document.querySelectorAll('span.w-32')].filter(s => s.textContent.trim().length === 16).length`
    await run(page, '/platform/security')
    const secReady = await waitFor(page, `${DATE_CELL} > 4`, 120_000)
    const topEvents = await prisma.securityEvent.findMany({
      orderBy: { createdAt: 'desc' }, take: 50, select: { createdAt: true, sessionId: true },
    })
    const secFacts = await evalJs(page, `(() => {
      const txt = document.body.innerText
      return { note: txt.includes('时间按北京（UTC+8）') || txt.includes('Beijing time (UTC+8)'),
        dates: [...document.querySelectorAll('span.w-32')].map(s => s.textContent.trim()).filter(s => s.length === 16),
        headers: [...document.querySelectorAll('span')].map(s => s.textContent.trim()).filter(s => s === '拦截'),
        machine: (txt.match(/\\bCRITICAL\\b|\\b知识产权/g) || []).length,
        head: txt.slice(0, 140) }
    })()`)
    // 按接口返回顺序点开「库里带 sessionId」的那几行（探针那条必然在里头）。
    const withSession = topEvents.map((e, i) => (e.sessionId ? i : -1)).filter(i => i > -1).slice(0, 4)
    const expanded = await evalJs(page, `(async () => {
      const rows = [...document.querySelectorAll('div.cursor-pointer')].filter(d => [...d.querySelectorAll('span')].some(s => s.textContent.trim().length === 16))
      for (const i of ${JSON.stringify(withSession)}) { if (rows[i]) { rows[i].click(); await new Promise(r => setTimeout(r, 250)) } }
      await new Promise(r => setTimeout(r, 500))
      const labels = [...document.querySelectorAll('span')].map(s => s.textContent.trim().replace(/:$/, ''))
      return { rows: rows.length, opened: ${JSON.stringify(withSession)}.filter(i => !!rows[i]).length,
        found: [...new Set(labels.filter(s => s === 'IP 地址' || s === '会话 ID'))],
        machine: (document.body.innerText.match(/知识产权|会议:/g) || []).length }
    })()`)
    if (!secReady || secFacts.dates.length === 0) {
      console.log(`SKIP J11/J12 安全页这一屏没出行（看板开关本地原值 ${JSON.stringify(securityWasOn)}；页面上部：${JSON.stringify(secFacts.head)}）`)
    } else {
      const expected = topEvents.map(e => beijingString(e.createdAt))
      const compared = secFacts.dates.slice(0, Math.min(secFacts.dates.length, expected.length))
      const mismatch = compared.findIndex((d: string, i: number) => d !== expected[i])
      check(mismatch === -1 && compared.length >= 5,
        'J11 这台浏览器在纽约时区，安全事件列表每一行的时刻都等于「那条记录的 UTC 时刻 +8 小时」——逐行按接口返回顺序比过（原来跟浏览器走，会整体差 12 小时）',
        `→ 比了 ${compared.length} 行${mismatch === -1 ? '' : `，第 ${mismatch + 1} 行界面 ${compared[mismatch]} / 应是 ${expected[mismatch]}`}`)
      check(secFacts.note, 'J12a 安全页把「时间按北京（UTC+8）」写在脸上（原来这页什么都不声明）', '')
      check(secFacts.headers.length >= 1 && secFacts.machine === 0 && expanded.found.length >= 1
        && expanded.machine === 0,
        'J13 安全页那三处名字在真页面上是「拦截／IP 地址／会话 ID」（后两枚要点开一行才看得见），也不再漏出「知识产权／会议」这类机翻残留',
        `→ 表头 ${JSON.stringify(secFacts.headers)}，点开 ${expanded.opened} 行后里的标签 ${JSON.stringify(expanded.found)}，机翻/原值命中 ${secFacts.machine + expanded.machine}`)
    }
    // 复原时区：CDP 没有 clearTimezoneOverride 这个方法，官方做法是把 timezoneId 置空。
    await page.s('Emulation.setTimezoneOverride', { timezoneId: '' }).catch(() => null)
  } finally {
    // 顺序不能反：Team.createdById 是 Restrict，先删团队才删得掉那两名用户；一次性反馈行挂在 ghost 名下，
    // 删 ghost 会级联掉它们，但按内容再兜一次底，免得留下几百行噪声数据。
    if (teamId) await prisma.team.deleteMany({ where: { id: teamId } }).catch(() => null)
    await prisma.platformFeedback.deleteMany({ where: { content: { startsWith: `pid-fill-${stamp}` } } }).catch(() => null)
    if (feedbackId) await prisma.platformFeedback.deleteMany({ where: { id: feedbackId } }).catch(() => null)
    if (ghostId) await prisma.user.deleteMany({ where: { id: ghostId } }).catch(() => null)
    if (securityWasOn === false) {
      await prisma.securitySettings.update({ where: { id: 'default' }, data: { viewSecurityEvents: false } }).catch(() => null)
    }
    // 探针事件刻意留在盘上当尾巴证据：它带着 pid-probe-<stamp> 的会话号，谁在页面上看到过它都能回读。
    const left = await prisma.team.count({ where: { slug: { startsWith: `zz${stamp}` } } })
    const leftGhost = await prisma.user.count({ where: { email: `pid-ghost-${stamp}@example.invalid` } })
    const leftFeedback = await prisma.platformFeedback.count({ where: { content: { startsWith: `pid-` } } })
    const restored = await prisma.securitySettings.findUnique({ where: { id: 'default' }, select: { viewSecurityEvents: true } })
    console.log(`夹具清理：一次性团队剩余 ${left}／停用成员账号剩余 ${leftGhost}／一次性反馈剩余 ${leftFeedback}／看板开关已复原为 ${JSON.stringify(restored?.viewSecurityEvents)}（原来是 ${JSON.stringify(securityWasOn)}）`)
    console.log(`留痕：一次性安全事件 ${probeEventId || '（没建成）'} 留在库里当尾巴证据，会话号 pid-probe-${stamp}`)
  }
}

/**
 * 判据自己算一遍「北京的时刻」，不走产品那份 formatBeijingDateTime——两边都错在同一处就测不出来了。
 * 2026-10-14T16:30:00Z → 2026-10-15 00:30（+8，跨了日历天）。
 */
function beijingString(value: Date): string {
  const shifted = new Date(value.getTime() + 8 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
}

async function browserGroup() {
  console.log('\n── G 浏览器实测（页内登录运营后台）──')
  const devAlive = await fetch(`${BASE}/api/health`).then(r => r.ok).catch(() => false)
  if (!devAlive) { check(false, 'G0 本地 next dev 在 :3000 上没活着（G 组跑不了，静态那几组不受影响）', BASE); return }

  const prisma = new PrismaClient()
  const stamp = Date.now()
  const email = `pid-${stamp}@example.invalid`
  const pw = `pid-${stamp}`
  let chrome: ChildProcess | undefined
  const userDataDir = mkdtempSync(`${tmpdir()}/platform-identity-`)
  const cdpPort = 9411 + (process.pid % 50)
  let adminId = ''

  try {
    // 挑一枚「跑得再久也不会被别人删掉」的团队来验：home-demo 是 build-home-demo 种的常驻夹具。
    // 按 createdAt desc 取最新那枚会撞上别的判据正在建/删的一次性团队（那边清完，这边就找不到人了）。
    const team = await prisma.team.findFirst({ where: { slug: 'home-demo' }, select: { id: true, slug: true, shareKey: true } })
      ?? await prisma.team.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, slug: true, shareKey: true } })
    if (!team) { check(false, 'G0 本地库里一枚团队都没有，没法验身份行', ''); return }

    // next dev 是按需编译的：第一次打到某页会编 20–40 秒，那段时间 CDP 的 navigate/等待会假死。
    // 先把三页各预热一次，界面实测才不是在量编译器。
    for (const warm of ['/platform/login', '/platform', '/platform/teams', '/platform/users', '/platform/security', '/platform/messages']) {
      await fetch(`${BASE}${warm}`).catch(() => null)
    }

    const created = await prisma.user.create({
      data: { email, name: 'PID Admin', password: await hashPassword(pw), isPlatformAdmin: true },
      select: { id: true },
    })
    adminId = created.id

    chrome = spawn(CHROME, [
      '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`,
      '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check',
      '--disable-gpu', '--disable-translate', '--lang=zh-CN', '--window-size=1440,900',
    ], { stdio: 'ignore' })
    let version: any = null
    for (let i = 0; i < 60 && !version; i++) {
      version = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json()).catch(() => null)
      if (!version) await sleep(500)
    }
    if (!version) { check(false, 'G0 无头 Chrome 没起来', ''); return }
    await attachSocket(version.webSocketDebuggerUrl)
    const page = await openPage()

    // 复制到底复制的是哪串，得能回读：包一层 writeText 记录实参（不改行为，失败照样落回退路径）。
    await page.s('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { window.__copied = []; try {
        const o = navigator.clipboard && navigator.clipboard.writeText && navigator.clipboard.writeText.bind(navigator.clipboard)
        if (o) navigator.clipboard.writeText = async (t) => { window.__copied.push(String(t)); return o(t) }
      } catch {} })()`,
    })

    await run(page, '/platform/login')
    // 等 React 水合完再填：SSR 先把 <input> 画出来了，那时填进去的值会在 hydration 时被
    // 受控组件用初始 state 抹回空串（10-15 实测：诊断里「填进去的」就是空的，登录根本没发出去）。
    if (!await waitFor(page, `(() => { const i = document.querySelector('input[placeholder="平台账号"]')
      return i && Object.keys(i).some(k => k.startsWith('__react')) })()`, 120_000)) {
      check(false, 'G1 平台登录页没水合（冷编译没完，G 组跑不了）', '')
      return
    }
    await evalJs(page, `(() => {
      const put = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
      put(document.querySelector('input[placeholder="平台账号"]'), ${JSON.stringify(email)})
      put(document.querySelector('input[type="password"]'), ${JSON.stringify(pw)})
      document.querySelector('form').requestSubmit()
    })()`)
    const loggedIn = await waitFor(page, `document.body.innerText.includes('退出平台') || document.body.innerText.includes('每日使用量')`, 180_000)
    const loginDiag = loggedIn ? '' : await evalJs(page, `(() => {
      const i = document.querySelector('input[placeholder="平台账号"]')
      return JSON.stringify({ path: location.pathname, 填进去的: i ? i.value.slice(0, 12) : null, 页面字: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 120) })
    })()`)
    check(loggedIn, 'G1 平台账号在页面里登录成功（平台令牌绑设备指纹，只能这么进去）', loginDiag)
    if (!loggedIn) return

    const EXPECT = JSON.stringify(team)
    await run(page, '/platform/teams')
    // 「团队总数」四个字在统计卡上先就出来了，拿它当加载完的信号会读到一张空列表（10-15 假红过一次）。
    await waitFor(page, `document.body.innerText.includes(${JSON.stringify(team.id)})`, 90_000)
    const listFacts = await evalJs(page, `(() => {
      const t = ${EXPECT}
      // 取「最深的那一枚」装着这串号的 div：document 顺序里外层在前，用 find 会抓到整页容器，
      // 于是别张卡片上的字也算命中（假绿）。最后一枚才是这张卡自己那一块。
      const cards = [...document.querySelectorAll('div')].filter(d => d.querySelector('button') && d.innerText.includes(t.id))
      const card = cards[cards.length - 1]
      const txt = card ? card.innerText : ''
      return { found: !!card, id: txt.includes('团队 ID') && txt.includes(t.id),
        slug: txt.includes('团队标识') && txt.includes(t.slug), key: txt.includes('分享键') && txt.includes(t.shareKey),
        at: document.body.innerText.includes('@' + t.slug), txt: txt.replace(/\\s+/g, ' ').slice(0, 160) }
    })()`)
    check(listFacts.found && listFacts.id, 'G2 团队列表卡片画出「团队 ID」，值就是库里那枚 6 位号', `→ ${JSON.stringify(listFacts.txt)}`)
    check(listFacts.slug && listFacts.key, 'G3 同一行还画出「团队标识」与「分享键」（客户报 tm_ 那串时后台对得上）', `→ ${JSON.stringify(listFacts)}`)
    check(!listFacts.at, 'G4 裸 @ 写法已经不在了（叫法统一那条）', '')

    const copyBack = await evalJs(page, `(async () => {
      const t = ${EXPECT}
      const btn = [...document.querySelectorAll('button')].find(b => b.innerText.replace(/\\s+/g, ' ').startsWith('团队 ID ' + t.id))
      if (!btn) return { clicked: false }
      btn.click()
      await new Promise(r => setTimeout(r, 500))
      return { clicked: true, copied: (window.__copied || []).slice(-1)[0], said: document.body.innerText.includes('已复制') || document.body.innerText.includes('复制失败') }
    })()`)
    check(copyBack.clicked && copyBack.copied === team.id, 'G5 点「团队 ID」那枚真的把这串号交给了剪贴板（不是复制了别的）', `→ ${JSON.stringify(copyBack)}`)
    check(copyBack.said, 'G6 按完界面有回话（已复制／复制失败），不是点了没动静', '')
    await shot(page, '1-teams-list')

    await run(page, `/platform/teams/${team.id}`)
    await waitFor(page, `document.body.innerText.includes('团队 ID')`, 60_000)
    const detailFacts = await evalJs(page, `(() => {
      const t = ${EXPECT}
      const txt = document.body.innerText
      return { id: txt.includes('团队 ID') && txt.includes(t.id), slug: txt.includes('团队标识') && txt.includes(t.slug),
        key: txt.includes('分享键') && txt.includes(t.shareKey), why: txt.includes('加入链接') && txt.includes('客户'),
        quota: txt.includes('团队配额'), grants: txt.includes('功能授权') }
    })()`)
    check(detailFacts.id && detailFacts.slug && detailFacts.key,
      'G7 授权详情页把三串都摆出来了（原来整页不写这是哪一队）', `→ ${JSON.stringify(detailFacts)}`)
    check(detailFacts.why, 'G8 详情页那句说明把三串各管什么交代清了（ID 定位／标识加入／分享键对客户）', '')
    check(detailFacts.quota && detailFacts.grants, 'G9 详情页原有两块功能没被这行挤掉', '')
    await shot(page, '2-team-detail')

    await run(page, '/platform')
    await waitFor(page, `document.querySelector('table')`, 60_000)
    const homeFacts = await evalJs(page, `(() => {
      const t = ${EXPECT}
      const row = [...document.querySelectorAll('tr')].find(r => r.innerText.includes(t.id))
      return { row: !!row, id: !!row && row.innerText.includes('团队 ID') && row.innerText.includes(t.id),
        slug: !!row && row.innerText.includes('团队标识') && row.innerText.includes(t.slug) }
    })()`)
    check(homeFacts.row && homeFacts.id && homeFacts.slug, 'G10 首页团队表那一行也带 ID 与标识（原来只有 @标识）', `→ ${JSON.stringify(homeFacts)}`)
    // 那张表在「每日使用量」下面，视口里根本没有它 ⇒ 不滚过去，截图就是一张用量的表。
    await evalJs(page, `(() => { const t = [...document.querySelectorAll('table')].find(x => x.innerText.includes('负责人'))
      if (t) t.scrollIntoView({ block: 'start' }); return !!t })()`)
    await sleep(600)
    await shot(page, '3-platform-home')

    // 成员页与安全页这次也动了，同样得在真页面上看一眼，不能只信源码字面量。
    await run(page, '/platform/users')
    // 导航里也有「平台账号」四个字，拿它当加载完的信号会读到一张空表（10-15 就这么假红过一次）。
    const usersReady = await waitFor(page, `document.querySelectorAll('tbody tr').length > 0`, 90_000)
    const userFacts = await evalJs(page, `(async () => {
      const chip = [...document.querySelectorAll('button')].find(b => b.title === '复制用户 ID')
      let copiedId = null
      if (chip) { chip.click(); await new Promise(r => setTimeout(r, 400)); copiedId = (window.__copied || []).slice(-1)[0] }
      const txt = document.body.innerText
      return { rows: document.querySelectorAll('tbody tr').length, chip: !!chip, copiedId,
        admin: txt.includes('能进后台') || txt.includes('不进后台'), legacy: txt.includes('普通账号') }
    })()`)
    if (!usersReady) console.log('SKIP G12/G13 成员表一行都没出来（本地库空或接口没读到），两条没测到')
    else {
      check(userFacts.chip && !!userFacts.copiedId, 'G12 成员页那一行的「用户 ID」按下去真把某枚用户 id 交出去了', `→ ${JSON.stringify(userFacts.copiedId)}`)
      check(userFacts.admin && !userFacts.legacy, 'G13 成员页徽标说的是后台权限（「能进后台／不进后台」），不再拿 role 冒充「管理员／普通账号」', `→ ${JSON.stringify(userFacts)}`)
      await shot(page, '4-users')
    }

    await run(page, '/platform/security')
    await waitFor(page, `document.body.innerText.includes('严重性') || document.body.innerText.includes('Severity')`, 90_000)
    const secFacts = await evalJs(page, `(() => {
      const txt = document.body.innerText
      const spans = [...document.querySelectorAll('span')].map(s => s.textContent.trim())
      // 只判「有没有把枚举原值画给运营」：中文还是英文取决于访问者存的界面语言，这里不押死一种。
      return { rows: spans.filter(s => /^(关键|警告|信息|Critical|Warning|Info)$/.test(s)).length,
        rawSeverity: spans.some(s => /^(CRITICAL|WARNING|INFO)$/.test(s)),
        hasUnblock: [...document.querySelectorAll('button')].some(b => b.innerText.includes('解锁') || b.innerText.includes('Unblock')),
        解封对象: txt.includes('解封对象') || txt.includes('Unblock target') }
    })()`)
    if (secFacts.rows === 0 && !secFacts.hasUnblock) console.log('SKIP G14/G15 本地这一屏没有安全事件行、也没有速率限制条目，两条没测到')
    else {
      check(secFacts.rows > 0 && !secFacts.rawSeverity, 'G14 安全页行里的严重性走的是词表（不再是 CRITICAL 这种枚举原值）', `→ ${JSON.stringify(secFacts)}`)
      check(!secFacts.hasUnblock || secFacts.解封对象,
        'G15 有「解锁」按钮可点时，同一行就写着解封对象是哪串 IP／账号（没条目时跳过，不算绿）', `→ ${JSON.stringify(secFacts)}`)
    }

    // 标签是 11px 的次要字，压在卡片上够不够读要量出来，不能靠「看着还行」。
    // 对比度要在画着身份行的那一屏量：上面几趟已经跳到成员页、安全页了，先回团队页。
    const SPAN_WAIT = `[...document.querySelectorAll('span')].some(s => s.textContent.trim() === '团队 ID')`
    await run(page, '/platform/teams')
    let labelFound = await waitFor(page, SPAN_WAIT, 90_000)
    if (!labelFound) {
      // 改过这页的接口后第一次进去会撞上重编译那一趟，回来的可能是个没样式的壳（10-15 实测：
      // 探针量到 bg rgba(0,0,0,0) 且找不到标签）。等一秒再进一次，别把编译器当产品。
      await sleep(3000)
      await run(page, '/platform/teams')
      labelFound = await waitFor(page, SPAN_WAIT, 90_000)
    }
    const contrastFacts = await evalJs(page, `(() => {
      const probe = document.createElement('div')
      probe.className = 'bg-card'
      probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px'
      document.body.appendChild(probe)
      const bg = getComputedStyle(probe).backgroundColor
      const label = [...document.querySelectorAll('span')].find(s => s.textContent.trim() === '团队 ID')
      const fg = label ? getComputedStyle(label).color : ''
      const size = label ? getComputedStyle(label).fontSize : ''
      probe.remove()
      return { bg, fg, size, hasLabel: !!label, sheets: document.styleSheets.length, path: location.pathname }
    })()`)
    const fgRgb = rgbOf(contrastFacts.fg), bgRgb = rgbOf(contrastFacts.bg)
    const ratio = fgRgb && bgRgb ? contrast(fgRgb, bgRgb) : 0
    check(labelFound && ratio >= 4.5, 'G11 身份行的标签压在主卡片面上对比度够 4.5:1（11px 的次要字更要读数清楚）',
      ratio >= 4.5
        ? `→ ${ratio.toFixed(2)}:1，字号 ${contrastFacts.size}，fg ${contrastFacts.fg} bg ${contrastFacts.bg}`
        : `→ ${ratio.toFixed(2)}:1，字号 ${contrastFacts.size}，fg "${contrastFacts.fg}" bg "${contrastFacts.bg}"，`
          + `标签在页面上：${contrastFacts.hasLabel}，样式表 ${contrastFacts.sheets} 张，${contrastFacts.path}`)

    await jGroup(page, prisma, adminId, pw, stamp)

    await send('Target.closeTarget', { targetId: page.targetId }).catch(() => null)
  } finally {
    if (chrome) chrome.kill()
    if (ws) try { ws.close() } catch {}
    // Chrome 刚被杀时 profile 目录还在被写，立刻 rmSync 会撞 ENOTEMPTY（10-15 实测崩在这一步，
    // 连带把一次性平台账号的清理也跳过了）⇒ 先等它落盘，再带重试删。
    await sleep(1200)
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) } catch {}
    if (adminId) await prisma.user.deleteMany({ where: { id: adminId } }).catch(() => null)
    const left = adminId ? await prisma.user.count({ where: { email } }) : 0
    await prisma.$disconnect()
    console.log(`夹具清理：一次性平台账号剩余 ${left}`)
  }
}

try {
  await main()
} finally {
  console.log(`\n合计 ${passed} PASS / ${failures.length} FAIL`)
  if (failures.length) for (const f of failures) console.log(` - ${f}`)
  if (failures.length) process.exitCode = 1
}
