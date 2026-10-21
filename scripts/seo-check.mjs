// scripts/seo-check.mjs —— 零依赖本地 SEO 断言。不部署，只打 dev server。
const BASE = process.env.SEO_CHECK_BASE || 'http://127.0.0.1:3000'
const BOT_UA = 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)'
// SITE 必须从 BASE 派生，不能另读一个环境变量：canonical/sitemap 比的是"我们打的这台服务器自己认为
// 它是谁"，部署后跑 `SEO_CHECK_BASE=https://vidx.cn node scripts/seo-check.mjs` 时如果 SITE 还停在
// 127.0.0.1:3000，这 16 条会全红——一道只在该被用的那一刻失效的验收门等于没有。
const SITE = (() => {
  try {
    return new URL(BASE).origin
  } catch {
    // 这条脚本是部署后的验收门。门本身抛一坨 Node 栈，人就当它坏了不看。
    console.error(`SEO_CHECK_BASE 必须是 http(s) 绝对 URL，收到的是：${BASE}`)
    process.exit(1)
  }
})()

const PAGES = [
  { path: '/compare/netdisk-wechat', h1: '用网盘和微信审片，卡在哪三个地方',
    h2: ['链接会过期，文件会被限', '意见对不上画面', '版本靠文件名', '一条链接替掉这一整套', '客户这边什么都不用装', '几个常见顾虑'] },
  { path: '/compare/frame-io', h1: 'Frame.io 在国内用起来别扭的地方',
    h2: ['访问与上传', '登录方式', '中文界面与中文通知', '批注落点', '什么时候仍然该选 Frame.io', '数据放在哪'] },
  { path: '/compare/fenzhen', h1: '逐帧审阅与分秒帧：数据归属与席位口径的差别',
    h2: ['计费模型', '数据归属', '功能对照', '什么时候选分秒帧', '迁移要动什么'] },
  { path: '/features/frame-comments', h1: '意见挂在第几帧，不是"大概三分钟"',
    h2: ['逐帧落点', '画笔圈画', '回复与解决状态', '客户不注册也能评论', '邮件汇总与留档', '手机上批注'] },
  { path: '/features/versions', h1: '每一次修改都有版本记录',
    h2: ['自动成版本', '意见挂在具体版本上', '通过与定稿留痕', '旧版本不会静默消失', '只放行已批准版本'] },
  { path: '/features/share-link', h1: '带密码和有效期的审片链接',
    h2: ['密码与有效期', '一次性验证码', '谁打开过有记录', '客户顺着链接回传原片', '微信里打开的效果'] },
  { path: '/features/review-workflow', h1: '从传第一版到定稿，一条片子怎么走完',
    h2: ['传第一版', '发审片链接', '客户写意见', '处理意见、重传下一版', '点通过、交付原片', '让客户回传素材'] },
]
const HUBS = ['/features', '/compare']

let failed = 0
const report = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`) }
// 契约字符串要按字面量匹配（Frame.io 的 `.`、未来标题里的 `(` 都会破坏 new RegExp）。
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function html(path) {
  try {
    const res = await fetch(BASE + path, { headers: { 'user-agent': BOT_UA }, cache: 'no-store', redirect: 'manual' })
    return { status: res.status, body: res.status === 200 ? await res.text() : '', res }
  } catch {
    report(false, `${path} 请求失败`)
    return { status: 0, body: '', res: null }
  }
}
const has = (b, re, label) => report(re.test(b), label)

for (const p of [...PAGES.map(x => ({ ...x, kind: 'page' })), ...HUBS.map(path => ({ path, kind: 'hub' }))]) {
  const { status, body } = await html(p.path)
  if (status !== 200) { report(false, `${p.path} 返回 ${status}（期望 200）`); continue }
  has(body, /<title>.*\| 逐帧审阅<\/title>/, `${p.path} title 含品牌后缀`)
  has(body, /<meta name="description" content="[^"]{20,}"/, `${p.path} description ≥20 字`)
  // React 把 <link> 渲染成自闭合 `/>`，所以收尾两种写法都收。SITE+path 仍是字面量全等。
  has(body, new RegExp(`<link rel="canonical" href="${esc(SITE)}${esc(p.path)}"\\/?>`), `${p.path} canonical 用 SITE 前缀`)
  has(body, /<meta property="og:title"/, `${p.path} og:title`)
  has(body, /<meta property="og:image"/, `${p.path} og:image`)
  has(body, /<meta property="og:url"/, `${p.path} og:url`)
  has(body, /<html[^>]*lang="zh"/, `${p.path} lang=zh`)
  has(body, /application\/ld\+json/, `${p.path} 有 JSON-LD`)
  // CSP 是 nonce 制（`src/proxy.ts`），内联脚本不带 nonce 就是浏览器直接拒执行——图谱等于没写。
  const ldTags = body.match(/<script[^>]*application\/ld\+json[^>]*>/g) || []
  report(ldTags.length > 0 && ldTags.every((t) => /nonce=/.test(t)), `${p.path} 每块 JSON-LD 都带 nonce`)
  has(body, /"@type":"Organization"/, `${p.path} 有 Organization 节点（品牌实体锚点）`)
  has(body, /"@type":"WebSite"/, `${p.path} 有 WebSite 节点`)
  if (p.kind === 'page') {
    has(body, new RegExp(`<h1[^>]*>${esc(p.h1)}`), `${p.path} H1 正确`)
    for (const h2 of p.h2) has(body, new RegExp(`<h2[^>]*>${esc(h2)}`), `${p.path} H2「${h2}」`)
    has(body, /href="\/login"/, `${p.path} 有指向 /login 的 CTA`)
    has(body, /"@type":"Article"/, `${p.path} 有 Article 节点`)
    has(body, /"@type":"FAQPage"/, `${p.path} 有 FAQPage 节点`)
    has(body, /<meta property="article:modified_time"/, `${p.path} 有 article:modified_time`)
    // 旧包名只禁在对外可见的内容里。根布局会把 next-intl 字典整包塞进 <script>，其中键名 `viTransfer`
    // 是应用自身的 i18n 键（值已是 FrameReview），不属于内容页文案；所以只扫正文与 JSON-LD。
    const visible = body.replace(/<script(?![^>]*application\/ld\+json)[\s\S]*?<\/script>/g, '')
    report(!/vitransfer/i.test(visible), `${p.path} 不含 vitransfer`)
  } else {
    has(body, /"@type":"SoftwareApplication"/, `${p.path} 有 SoftwareApplication 节点`)
    has(body, /"@type":"BreadcrumbList"/, `${p.path} 有 BreadcrumbList 节点`)
  }
}

const { status: nf, body: nfb } = await html('/compare/nonexistent-slug')
report(nf === 404, '未知 slug 返回 404')
report(!(nf === 200 && nfb.length < 20000), '未知 slug 不渲染成薄内容空页')

const robots = await html('/robots.txt')
// 断的是**裸** `/studio`：`Disallow: /studio/`（带尾斜杠）匹配不到裸路径，而裸路径是真能抓到 200 的。
// 用 `$` 收尾，这样"写回带斜杠的旧形态"会直接红，不会静默放行。
report(robots.status === 200 && /^Disallow: \/studio$/m.test(robots.body), 'robots.txt Disallow 覆盖裸 /studio')
// 负向断言必须自带 status 前置：`/robots.txt` 挂了时 body 是空串，"里面没有 X"会恒真空过。
report(robots.status === 200 && !/^Disallow: \/portal/m.test(robots.body), '/portal 不进 Disallow（它自带 noindex，见 robots.ts 注释）')
report(/Sitemap: https?:\/\//.test(robots.body), 'robots.txt 有绝对 Sitemap 行')

const sm = await html('/sitemap.xml')
report(sm.status === 200 && /<urlset/.test(sm.body), 'sitemap.xml 是合法 XML')
report(sm.body.includes(`<loc>${SITE}</loc>`), 'sitemap 首页那条与 canonical 同形（不带尾斜杠）')
for (const p of [...PAGES.map(x => x.path), ...HUBS]) {
  report(sm.body.includes(`<loc>${SITE}${p}</loc>`), `sitemap 含 ${p}`)
}

// 大模型抓取器（GPTBot / OAI-SearchBot / PerplexityBot / ClaudeBot）读的两样东西：
// 页面里的 schema.org 图谱，和站点的 /llms.txt 目录。目录整份由六篇 frontmatter 生成，
// 所以这里的断言同时也是"目录没和文稿脱节"。
const llms = await html('/llms.txt')
report(llms.status === 200, '/llms.txt 返回 200')
report((llms.res?.headers.get('content-type') ?? '').startsWith('text/plain'), '/llms.txt 是 text/plain')
report(llms.body.startsWith('# 逐帧审阅（FrameReview）'), '/llms.txt 首行是品牌名')
report(!/<\/?[a-z][a-z0-9]*>/i.test(llms.body), '/llms.txt 里没有 HTML 标记')
for (const p of [...PAGES.map(x => x.path), ...HUBS, '/', '/terms', '/privacy']) {
  // 首页那条现在不带尾斜杠（与 canonical 同形），用 `${SITE}${p}` 会退化成 `${SITE}/`
  // 这种被任何一条子页链接都满足的弱判据，所以单独按 markdown 链接的形判。
  report(p === '/' ? llms.body.includes(`](${SITE})`) : llms.body.includes(`${SITE}${p}`), `/llms.txt 收录 ${p}`)
}
report(llms.body.includes('老版本会被新传的那版顶掉、看不到了吗？'), '/llms.txt 带文稿里的 FAQ 问句')
// 目录里那句 schema 承诺必须是真的：条款页不带 schema，就不能再写「每个页面都有」。
report(!/每个页面内联 schema/.test(llms.body), '/llms.txt 不再声称「每个页面都有 schema」')

// `/ai.txt` 是 llms.txt 之外另一条已被抓取工具实现的目录约定（10-17 日志里有 bot 打它拿 404）。
const ai = await html('/ai.txt')
report(ai.status === 200 && (ai.res?.headers.get('content-type') ?? '').startsWith('text/plain'), '/ai.txt 返回 200 且是 text/plain')
report(ai.body.length > 0 && ai.body === llms.body, '/ai.txt 与 /llms.txt 同源同内容（不会改一处漏一处）')

// 条款两页此前在 sitemap 里却没有 canonical（sitemap 11 条独缺 2 条）。
for (const p of ['/terms', '/privacy']) {
  const page = await html(p)
  report(page.status === 200 && new RegExp(`<link rel="canonical" href="${esc(SITE)}${esc(p)}"\\/?>`).test(page.body),
    `${p} 有自指 canonical`)
}

const home = await html('/')
report(home.status === 200 && /"@type":"Organization"/.test(home.body), '首页有 Organization 节点')
// 首页此前整页没有 canonical 也没有 og:*（www 与 apex 两份 200 同内容，没有主 URL 信号）。
// 根路径 canonical 被 Next 归一成**不带尾斜杠**（线上实测 `https://vidx.cn`），断言就按这个形判；
// sitemap 的首页那条必须跟它一模一样，差一个斜号等于给同一个页面两个地址。
report(home.status === 200 && new RegExp(`<link rel="canonical" href="${esc(SITE)}"\\/?>`).test(home.body), '首页 canonical 是 SITE（不带尾斜杠）')
report(home.body.includes('<meta property="og:url"'), '首页有 og:url')
// 只断「有 og:image」是假绿：10-08 实测首页画的是 http://localhost:4321/og/brand-1200x630.png
// （相对路径 + 根 layout 没有 metadataBase），微信/推特分享就没有图。所以断它是绝对址，
// 而且 origin 必须跟同一页的 canonical 一致——origin 从页面自己派生，dev 与生产都成立。
const metaHref = (re) => home.body.match(re)?.[1] ?? ''
const originOf = (href) => { try { return new URL(href, `${SITE}/`).origin } catch { return '' } }
const canonicalOrigin = originOf(metaHref(/<link rel="canonical" href="([^"]+)"\s*\/?>/))
const ogImageHref = metaHref(/<meta property="og:image" content="([^"]+)"\s*\/?>/)
report(
  /^https?:\/\/\S+/.test(ogImageHref) && !!canonicalOrigin && originOf(ogImageHref) === canonicalOrigin,
  `首页 og:image 是绝对址且与 canonical 同源（不是 localhost 兜底）`,
)
// Google 站长验证靠这枚 meta；根 layout 一改就容易静默丢掉，掉了验证状态就废。
report(home.body.includes('<meta name="google-site-verification"'), '首页有 google-site-verification')

// —— 10-21 SEO/GEO 补强 ——
// 首页 description 原来 27 字，只占百度摘要三分之一的位置。
const homeDesc = home.body.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''
report([...homeDesc].length >= 60, `首页 description ≥60 字（实测 ${[...homeDesc].length}）`)
// 内测期首页不得出现价格类字样；description 会原样进搜索结果摘要和 AI 转述。
report(!/价格|套餐|计费|试用|￥|¥|元\/月/.test(homeDesc), '首页 description 不含价格类字样')
report(home.body.includes('<meta name="keywords"'), '首页有 keywords（百度/360 弱信号）')
report(/"@type":"SoftwareApplication"/.test(home.body) && /"featureList":\[/.test(home.body), '首页有 SoftwareApplication 且带 featureList')
report(/<meta http-equiv="Cache-Control" content="no-transform"/i.test(home.body), '首页声明 no-transform（禁百度转码）')
report(home.body.includes('<meta name="applicable-device" content="pc,mobile"'), '首页声明 applicable-device')
// SoftwareApplication 只许一个：挪进 BrandLd 后枢纽页那份已删，别再出第二个同名节点。
for (const p of HUBS) {
  const { body } = await html(p)
  report((body.match(/"@type":"SoftwareApplication"/g) || []).length === 1, `${p} 只有一个 SoftwareApplication 节点`)
  report(/"@type":"ItemList"/.test(body), `${p} 有 ItemList 节点`)
}
for (const p of PAGES) {
  const { body } = await html(p.path)
  report(/"@type":"BreadcrumbList"/.test(body), `${p.path} 有 BreadcrumbList 节点`)
  // 长标题要带品类词，不能只是导航里那几个字（「逐帧批注 | 逐帧审阅」）。
  const t = body.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
  report([...t].length >= 18, `${p.path} title 是带品类词的长标题（实测「${t}」）`)
}
report(sm.body.includes(`<loc>${SITE}/news/beta</loc>`), 'sitemap 含 /news/beta')
report(llms.body.includes('## 一句话介绍') && llms.body.includes('## 核心能力'), '/llms.txt 有可直接转述的介绍与能力清单')
report(llms.body.includes(`${SITE}/news/beta`), '/llms.txt 收录 /news/beta')
for (const p of ['/privacy', '/terms']) {
  const { body } = await html(p)
  const d = body.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''
  report(d !== '面向影视团队的在线审片、版本管理与素材收录平台' && [...d].length >= 30, `${p} 有自己的 description（不是全站兜底那句）`)
}

// —— 搜索结果里那枚小图标（10-13 诊断）——
// 引擎画的是 <head> 声明的图标地址。此前三条声明全指向 `/api/branding/favicon`，而
// ① robots.txt 整段 `Disallow: /api/` 把它拦在抓取之外，② 该路由 302 到一小时过期的
// COS 预签名地址，③ 兜底的 `/favicon.ico` 是 404（返回 135 KB 的 HTML 错误页）。
// 三处各自都能单独吃掉图标，所以三处各有一条断言钉住。
async function asset(path) {
  try {
    const res = await fetch(BASE + path, { headers: { 'user-agent': BOT_UA }, cache: 'no-store', redirect: 'manual' })
    return { status: res.status, type: res.headers.get('content-type') ?? '', buf: res.status === 200 ? Buffer.from(await res.arrayBuffer()) : null }
  } catch {
    report(false, `${path} 请求失败`)
    return { status: 0, type: '', buf: null }
  }
}

/**
 * 按 RFC 9309 的**最长前缀**判定，而不是按行序：`Allow: /api/branding/favicon`（22 字符）
 * 胜过 `Disallow: /api/`（7 字符），跟两行谁先印无关。这样断的是引擎实际执行的规则，
 * 以后有人把 `Disallow: /api/` 挪到前面也不会让这条断言变成假绿/假红。
 */
function allowedByRobots(path) {
  let best = null
  for (const m of robots.body.matchAll(/^(Allow|Disallow): (\S+)\s*$/gim)) {
    const prefix = m[2]
    if (path.startsWith(prefix) && (best === null || prefix.length > best.prefix.length)) {
      best = { prefix, allow: m[1].toLowerCase() === 'allow' }
    }
  }
  return best ? best.allow : true
}

report(/^Allow: \/api\/branding\/favicon$/m.test(robots.body), 'robots.txt 放行图标接口地址')

const ico = await asset('/favicon.ico')
report(
  ico.status === 200 && !!ico.buf && ico.buf.length > 6 && ico.buf.readUInt16LE(0) === 0 && ico.buf.readUInt16LE(2) === 1 && ico.buf.readUInt16LE(4) > 0,
  `/favicon.ico 是真 ICO 容器，不是 HTML 兜底页（实测 ${ico.status} ${ico.type || '—'} ${ico.buf?.length ?? 0}B）`,
)

const declared = [...new Set([...home.body.matchAll(/<link rel="(icon|shortcut icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[2]))]
report(declared.length > 0, `<head> 声明了图标地址（实测 ${declared.length} 条）`)
for (const href of declared) {
  let url
  try {
    url = new URL(href, `${SITE}/`)
  } catch {
    report(false, `图标地址 ${href} 解析不了`)
    continue
  }
  report(url.origin === SITE, `图标地址 ${href} 与站点同源`)
  report(robots.status === 200 && allowedByRobots(url.pathname), `图标地址 ${url.pathname} 没被 robots.txt 拦（最长前缀判定）`)
  const a = await asset(url.pathname)
  report(a.status === 200 && a.type.startsWith('image/'), `图标地址 ${url.pathname} 直接回图片字节（实测 ${a.status} ${a.type || '—'}）`)
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
