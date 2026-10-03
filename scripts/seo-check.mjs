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
  if (p.kind === 'page') {
    has(body, new RegExp(`<h1[^>]*>${esc(p.h1)}`), `${p.path} H1 正确`)
    for (const h2 of p.h2) has(body, new RegExp(`<h2[^>]*>${esc(h2)}`), `${p.path} H2「${h2}」`)
    has(body, /href="\/login"/, `${p.path} 有指向 /login 的 CTA`)
    has(body, /application\/ld\+json/, `${p.path} 有 JSON-LD`)
    // 旧包名只禁在对外可见的内容里。根布局会把 next-intl 字典整包塞进 <script>，其中键名 `viTransfer`
    // 是应用自身的 i18n 键（值已是 FrameReview），不属于内容页文案；所以只扫正文与 JSON-LD。
    const visible = body.replace(/<script(?![^>]*application\/ld\+json)[\s\S]*?<\/script>/g, '')
    report(!/vitransfer/i.test(visible), `${p.path} 不含 vitransfer`)
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
for (const p of [...PAGES.map(x => x.path), ...HUBS]) {
  report(sm.body.includes(`<loc>${SITE}${p}</loc>`), `sitemap 含 ${p}`)
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
