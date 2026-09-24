// scripts/seo-check.mjs —— 零依赖本地 SEO 断言。不部署，只打 dev server。
const BASE = process.env.SEO_CHECK_BASE || 'http://127.0.0.1:3000'
const BOT_UA = 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)'
// 与 app 的 getSiteUrl() 保持一致：origin 会剥掉尾部斜杠与路径前缀。
const SITE = new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://127.0.0.1:3000').origin

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
  has(body, new RegExp(`<link rel="canonical" href="${esc(SITE)}${esc(p.path)}">`), `${p.path} canonical 用 SITE 前缀`)
  has(body, /<meta property="og:title"/, `${p.path} og:title`)
  has(body, /<meta property="og:image"/, `${p.path} og:image`)
  has(body, /<meta property="og:url"/, `${p.path} og:url`)
  has(body, /<html[^>]*lang="zh"/, `${p.path} lang=zh`)
  if (p.kind === 'page') {
    has(body, new RegExp(`<h1[^>]*>${esc(p.h1)}`), `${p.path} H1 正确`)
    for (const h2 of p.h2) has(body, new RegExp(`<h2[^>]*>${esc(h2)}`), `${p.path} H2「${h2}」`)
    has(body, /href="\/login"/, `${p.path} 有指向 /login 的 CTA`)
    has(body, /application\/ld\+json/, `${p.path} 有 JSON-LD`)
    report(!/vitransfer/i.test(body), `${p.path} 不含 vitransfer`)
  }
}

const { status: nf, body: nfb } = await html('/compare/nonexistent-slug')
report(nf === 404, '未知 slug 返回 404')
report(!(nf === 200 && nfb.length < 20000), '未知 slug 不渲染成薄内容空页')

const robots = await html('/robots.txt')
report(robots.status === 200 && /Disallow: \/studio\//.test(robots.body), 'robots.txt Disallow /studio/')
report(/Sitemap: https?:\/\//.test(robots.body), 'robots.txt 有绝对 Sitemap 行')

const sm = await html('/sitemap.xml')
report(sm.status === 200 && /<urlset/.test(sm.body), 'sitemap.xml 是合法 XML')
for (const p of [...PAGES.map(x => x.path), ...HUBS]) {
  report(sm.body.includes(`<loc>${SITE}${p}</loc>`), `sitemap 含 ${p}`)
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
