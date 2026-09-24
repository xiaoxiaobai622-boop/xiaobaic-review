# 营销内容页（一期）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在逐帧审阅站新增 8 个可被抓取的中文营销内容页（6 篇正文 + 2 个枢纽），配套 robots / sitemap / canonical / Open Graph / JSON-LD，全程只改本地不上线。

**Architecture:** 内容以"JSON frontmatter + markdown 正文"的 `.md` 文件存放，由一个带进程内缓存的 loader 解析，经 `marked` → `isomorphic-dompurify` 净化后由 Server Component 直出 HTML；所有绝对 URL 从 `getSiteUrl()` 单点派生。页面结构与文案骨架来自 spec。

**Tech Stack:** Next 16（App Router，`--webpack` dev）、React 19、TypeScript 5.9、Tailwind 3、`marked`（本计划唯一新增依赖）、`isomorphic-dompurify`（已装 3.19.0）、ESLint 9（`npm run lint`）。**无测试框架**——用零依赖 Node 脚本对运行中的 dev server 做 HTTP 断言。

**Spec:** `docs/superpowers/specs/2026-09-20-marketing-content-pages-design.md`（执行时两份一起读，本计划只描述"怎么改"，不描述"改成什么样"）

## Global Constraints

每个任务的隐含要求，逐字来自 spec 或已核实的现状：

- **不 `git commit`、不 `git push`、不触发部署、不连生产。** 已核实 `.github/workflows/xiaobaic-ci-deploy.yml` 的触发是 `push: branches: [main]`，所以**不 push 就等于不上线**。每个任务结尾的"本地检查点"取代 commit。
- **不跑 `npm run build`。** 他会话里前台跑着 `next dev --hostname 127.0.0.1 --port 3000`（pid 61088），build 写 `.next` 会冲掉它。验证一律走 dev server 的 HTTP 断言。
- **不动 `.next`、不 kill 他的进程、不清缓存。**
- **禁止域名字面量兜底。** 不得写 `process.env.X || 'https://mle6.cn'`。现存那两处（`src/lib/deep-link.ts:32`、`src/app/api/auth/feishu/callback/route.ts:16`）本计划**不动**，登记为二期。
- **本期不动 `src/app/layout.tsx:14` 的 `export const dynamic = 'force-dynamic'`**（他选 B）。内容页因此仍每次请求渲染，但 loader 必须进程内缓存文件读取与解析。
- **正文与标题不得出现 `vitransfer` / `ViTransfer` 字样**（上游 vitransfer.com 占词，见 spec §12）。
- **品牌口径**：中文主名「逐帧审阅」，英文括注 `FrameReview`，两处常量化（见 Task 2）。
- **不新增除 `marked` 之外的依赖。** 装依赖前必须先问他，且提醒他装完要重启 dev server（`^` 版本漂移会引发全站 500，是他踩过的）。
- **禁止任何 git 写操作**（`add` / `rm` / `mv` / `commit` / `stash` / `checkout --`）。他的工作树里有别人未提交的改动（`src/app/api/share/[token]/route.ts`），动索引会把它一起卷进去。文件删除/改名一律用普通 `rm` / `mv`，删掉的东西记进 ledger，需要时用 `git checkout -- <path>` 恢复。
- **`getSiteUrl()` 只在 `(marketing)` 路由与 `robots.ts`/`sitemap.ts` 里调用，绝不进根 layout。** 根 layout 每次请求都跑，抛错等于全站 500；限制在营销路由内，env 缺失时只有内容页报错。
- 内容页一律 Server Component 直出，**不得用 `'use client'` 包正文**。
- **文稿只能使用「极小 Markdown 子集」**（见下方专节）。理由：`marked` 至今没装、也不打算为它触发一次 `npm install`（跨 install 不重启 dev 会全站 500，是他踩过的），Task 3 的渲染器大概率是仓库内自写的极小解析器。子集之外的语法在两种渲染器下行为不同，所以**从写作侧就禁止**，而不是等渲染器去兼容。

## 极小 Markdown 子集（六篇文稿的硬约束）

`content/marketing/*.md` 的正文只允许下面这些构造。加载器与渲染器都按这一节实现，写作者按这一节写。

| 允许 | 形式 | 渲染结果 |
|---|---|---|
| 二级标题 | `## 文本` | `<h2 id="slugified">`，**必须**与 frontmatter `sections` 逐字一致 |
| 三级标题 | `### 文本` | `<h3>` |
| 段落 | 裸文本，空行分段 | `<p>` |
| 无序列表 | `- 项`（**只允许一层**） | `<ul><li>` |
| 有序列表 | `1. 项`（**只允许一层**） | `<ol><li>` |
| 粗体 | `**文本**` | `<strong>` |
| 行内代码 | `` `文本` `` | `<code>` |
| 链接 | `[文本](/relative)` 或 `[文本](https://…)` | `<a>`，`href` 只允许站内相对路径或 `http(s)` |
| 表格 | GFM 管道表，**必须带 `|---|---|` 分隔行** | `<table>` |
| 引用 | `> 文本`（单段，不嵌列表） | `<blockquote>` |

**一律禁止**（写了就算不合格，不做兼容）：一级标题 `#`（H1 只来自 frontmatter `h1`）、四级及以上标题、原始 HTML、图片、代码块围栏 ` ``` `、嵌套列表、`---` 单独成行（与 frontmatter 定界符冲突）、setext 标题（下一行 `===`）、斜体 `*x*` / `_x_`、脚注、任务列表、HTML 实体、`\` 转义（中文文稿用不上，留着只会让解析器分叉）。

**其他约定**：段落内不出现裸 `|`；`##` 之前必须有一个空行；文件末尾单个换行；正文里不得出现域名（绝对 URL 一律由 `getSiteUrl()` 在模板里拼）。

## 文件结构

```
创建  scripts/seo-check.mjs                      # 本地 HTTP 断言（红绿循环载体）
创建  content/marketing/compare--netdisk-wechat.md
创建  content/marketing/compare--fenzhen.md
创建  content/marketing/compare--frame-io.md
创建  content/marketing/features--frame-comments.md
创建  content/marketing/features--versions.md
创建  content/marketing/features--share-link.md
创建  src/lib/marketing/site-url.ts              # getSiteUrl()，缺失抛错
创建  src/lib/marketing/brand.ts                 # 品牌常量（两处名字的唯一来源）
创建  src/lib/marketing/content.ts               # frontmatter 解析 + 校验 + 缓存 + slug 索引
创建  src/components/marketing/MarkdownBody.tsx   # marked → DOMPurify → HTML
创建  src/components/marketing/JsonLd.tsx         # 带 nonce 的 JSON-LD
创建  src/app/(marketing)/layout.tsx
创建  src/app/(marketing)/[group]/page.tsx
创建  src/app/(marketing)/[group]/[slug]/page.tsx
创建  src/app/robots.ts                          # 替换 public/robots.txt
创建  src/app/sitemap.ts
修改  src/app/layout.tsx                          # 仅 metadata 段，不碰第 14 行
修改  src/app/page.tsx / home-client.tsx / home.module.css  →  移入 (marketing)/
删除  public/robots.txt
```

---

## Task 0: 前置输入（不做任何代码改动）

**Files:** 无

- [ ] **Step 1: 问他要竞品事实来源**

原文照发：「写 `/compare/fenzhen` 和 `/compare/frame-io` 需要对方公开的定价与功能页链接，你给链接，或者授权我用 WebFetch 抓一次并在页面脚注标抓取日期。对比页我不编对方数据。」

- [ ] **Step 2: 问装依赖的许可**

原文照发：「内容渲染要装一个 `marked`（约 900KB devDeps，无传递依赖）。装的时候 `npm install` 可能让版本漂移，你那个前台 dev 进程装完必须重启一次。现在装还是先跳过、把这两页留到最后？」

- [ ] **Step 3: 记录答复**

拿到答复才进 Task 3。若他要求暂缓 `marked`，则 Task 3 照做、Task 7 的 compare 两页延后，本计划其余任务不受影响。

---

## Task 1: 本地断言脚本（先全红）

**Files:**
- Create: `scripts/seo-check.mjs`

**Interfaces:**
- Produces: `node scripts/seo-check.mjs`，退出码 0=全绿 / 1=有失败；输出每行 `PASS|FAIL <label>`。断言表是后续所有任务的验收标准，**任务 3/4/7/8 都靠它**。

- [ ] **Step 1: 写断言脚本**

```js
// scripts/seo-check.mjs —— 零依赖本地 SEO 断言。不部署，只打 dev server。
const BASE = process.env.SEO_CHECK_BASE || 'http://127.0.0.1:3000'
const BOT_UA = 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)'
const SITE = process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000'

const PAGES = [
  { path: '/compare/netdisk-wechat', h1: '用网盘和微信审片，卡在哪三个地方',
    h2: ['链接会过期，文件会被限', '意见对不上画面', '版本靠文件名', '一条链接替掉这一整套', '客户这边什么都不用装', '几个常见顾虑'] },
  { path: '/compare/frame-io', h1: 'Frame.io 在国内用起来别扭的地方',
    h2: ['访问与上传', '登录方式', '中文界面与中文通知', '批注落点', '什么时候仍然该选 Frame.io', '数据放在哪'] },
  { path: '/compare/fenzhen', h1: '逐帧审阅与分秒帧：三处实质差异',
    h2: ['计费模型', '数据归属', '功能对照', '什么时候选分秒帧', '迁移要动什么'] },
  { path: '/features/frame-comments', h1: '意见挂在第几帧，不是"大概三分钟"',
    h2: ['逐帧落点', '画笔圈画', '回复与解决状态', '客户不注册也能评论', '导出与留档', '手机上批注'] },
  { path: '/features/versions', h1: '每一次修改都有版本记录',
    h2: ['自动成版本', '意见挂在具体版本上', '通过与驳回', '旧版本不会静默消失', '只放行已批准版本'] },
  { path: '/features/share-link', h1: '带密码和有效期的审片链接',
    h2: ['密码与有效期', '一次性验证码', '谁打开过有记录', '客户顺着链接回传原片', '微信里打开的效果'] },
]
const HUBS = ['/features', '/compare']

let failed = 0
const report = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`) }

async function html(path) {
  const res = await fetch(BASE + path, { headers: { 'user-agent': BOT_UA }, cache: 'no-store', redirect: 'manual' })
  return { status: res.status, body: res.status === 200 ? await res.text() : '', res }
}
const has = (b, re, label) => report(re.test(b), label)

for (const p of [...PAGES.map(x => ({ ...x, kind: 'page' })), ...HUBS.map(path => ({ path, kind: 'hub' }))]) {
  const { status, body } = await html(p.path)
  if (status !== 200) { report(false, `${p.path} 返回 ${status}（期望 200）`); continue }
  has(body, /<title>.*\| 逐帧审阅<\/title>/, `${p.path} title 含品牌后缀`)
  has(body, /<meta name="description" content="[^"]{20,}"/, `${p.path} description ≥20 字`)
  has(body, new RegExp(`<link rel="canonical" href="${SITE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${p.path}">`), `${p.path} canonical 用 SITE 前缀`)
  has(body, /<meta property="og:title"/, `${p.path} og:title`)
  has(body, /<meta property="og:image"/, `${p.path} og:image`)
  has(body, /<meta property="og:url"/, `${p.path} og:url`)
  has(body, /<html[^>]*lang="zh"/, `${p.path} lang=zh`)
  if (p.kind === 'page') {
    has(body, new RegExp(`<h1[^>]*>${p.h1}`), `${p.path} H1 正确`)
    for (const h2 of p.h2) has(body, new RegExp(`<h2[^>]*>${h2}`), `${p.path} H2「${h2}」`)
    has(body, /href="\/login"/, `${p.path} 有指向 /login 的 CTA`)
    has(body, /application\/ld\+json/, `${p.path} 有 JSON-LD`)
  }
}

const { status: nf, body: nfb } = await html('/compare/nonexistent-slug')
report(nf === 404 || /找不到|404/.test(nfb), '未知 slug 不返回 200 空页')
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
```

- [ ] **Step 2: 跑一次确认全红**

Run: `cd /Users/xiaoxiaobai/code/xiaobaic-review && node scripts/seo-check.mjs`
Expected: 退出码 1，失败项集中在"返回 404（路由不存在）"与"canonical/og 缺失"。**如果某项现在就 PASS，说明断言写松了，当场收紧。**

- [ ] **Step 3: 本地检查点**

`npm run lint` 无新增 error。**不 commit。**

---

## Task 2: `getSiteUrl()` + 品牌常量 + 根 metadata 基座

**Files:**
- Create: `src/lib/marketing/site-url.ts`
- Create: `src/lib/marketing/brand.ts`
- Modify: `src/app/layout.tsx`（只动 `generateMetadata` 的 return 对象，**不碰第 14 行 `force-dynamic`**）

**Interfaces:**
- Produces: `getSiteUrl(): string`（无参，返回不带尾斜杠的绝对 origin，缺失即抛错）；`BRAND.zh = '逐帧审阅'`、`BRAND.en = 'FrameReview'`、`BRAND.titleTemplate = `%s | ${BRAND.zh}``

- [ ] **Step 1: 写 site-url.ts**

```ts
// src/lib/marketing/site-url.ts
let cached: string | null = null

/** 站点绝对 origin，无尾斜杠。环境变量缺失时直接抛错——绝不能兜底成任何硬编码域名，
 *  否则换域名当天会静默产出一批 canonical 指向废弃域名的页面。 */
export function getSiteUrl(): string {
  if (cached) return cached
  const raw = process.env.NEXT_PUBLIC_APP_URL
  if (!raw) {
    throw new Error('NEXT_PUBLIC_APP_URL 未设置：SEO 绝对 URL（canonical/sitemap/og:image）无法生成')
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`NEXT_PUBLIC_APP_URL 不是合法绝对 URL：${raw}`)
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error(`NEXT_PUBLIC_APP_URL 协议必须是 http/https：${raw}`)
  cached = url.origin
  return cached
}
```

- [ ] **Step 2: 写 brand.ts**

```ts
// src/lib/marketing/brand.ts
const ZH = '逐帧审阅'
const EN = 'FrameReview'

export const BRAND = {
  zh: ZH,
  en: EN,
  titleTemplate: `%s | ${ZH}`,
  description: '面向影视团队的在线审片、版本管理与素材收录平台',
} as const
```

- [ ] **Step 3: 根 metadata 补基座（只补不需要绝对 URL 的那部分）**

在 `src/app/layout.tsx` 的 `generateMetadata` return 对象里加下面三项（`manifest`/`icons`/`appleWebApp` 原样保留，**`metadataBase` 和带绝对 URL 的 `openGraph.images` 不放这里**——见 Global Constraints，根 layout 调 `getSiteUrl()` 抛错就是全站 500）：

```ts
import { BRAND } from '@/lib/marketing/brand'

// return { ...existing, 加这三项：
  title: { default: BRAND.zh, template: BRAND.titleTemplate },
  description: BRAND.description,
  robots: { index: true, follow: true },
// }
```

`metadataBase` 与 `openGraph`（含 `siteName`、`locale: 'zh_CN'`、`images: [{ url: '/brand/logo.png', width: 256, height: 256, alt: BRAND.zh }]`）在 **Task 3 的 `src/app/(marketing)/layout.tsx`** 里通过该 layout 的 `generateMetadata` 下发，那里才调用 `getSiteUrl()`。

- [ ] **Step 4: 本地验一次不抛错**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -A "Mozilla/5.0 (compatible; Baiduspider/2.0)" http://127.0.0.1:3000/`
Expected: `200`，且 `curl -s http://127.0.0.1:3000/ | grep -o '<title>[^<]*</title>'` 变成 `逐帧审阅`（根 default 生效）。本任务不涉及绝对 URL，**`NEXT_PUBLIC_APP_URL` 没设也不该报错**——若 `/` 或 `/login` 因缺 env 而 500，说明 `getSiteUrl()` 被误放进了根 layout，立刻改回来。
同一轮还要改掉 `src/app/page.tsx` 里自己的 `title`：它现在是 `'逐帧审阅 - 专业视频审阅与交付平台'`，会和新加的 template 拼成"逐帧审阅…| 逐帧审阅"。删掉那行 `title`，只留 `description`，让根的 default 生效（Task 5 会把这个文件整体搬进 `(marketing)`，所以此处先改再搬）。

- [ ] **Step 5: 本地检查点**

`node scripts/seo-check.mjs` 仍红（路由未建），但 `npm run lint` 干净、`/` 与 `/login` 都 200。**不 commit。**

---

## Task 3: `(marketing)` 路由组 + 内容 loader + 第一篇内容页

**Files:**
- Create: `content/marketing/compare--netdisk-wechat.md`
- Create: `src/lib/marketing/content.ts`
- Create: `src/components/marketing/MarkdownBody.tsx`
- Create: `src/components/marketing/JsonLd.tsx`（CSP 要求带 nonce，必须与页面同批落地）
- Create: `src/app/(marketing)/layout.tsx`
- Create: `src/app/(marketing)/[group]/[slug]/page.tsx`
- Install: `marked`（Task 0 Step 2 拿到许可之后才做）

**Interfaces:**
- Consumes: `getSiteUrl()`、`BRAND`
- Produces: 类型 `MarketingDoc = { slug: string; group: 'compare' | 'features'; title: string; description: string; h1: string; sections: Section[]; cta: { href: string; label: string }; related: string[]; faq: { q: string; a: string }[]; updatedOn: string; bodyHtml: string }`；函数 `loadDocs(): Map<string, MarketingDoc>`（key 为 `group/slug`）、`getDoc(group: string, slug: string): MarketingDoc | null`

- [ ] **Step 1: 装依赖（先问他）**

```bash
cd /Users/xiaoxiaobai/code/xiaobaic-review && npm install marked --no-audit --no-fund
```
装完**必须提醒他重启前台 dev 进程**（`Ctrl-C` 后重跑他原来的命令），否则可能因依赖漂移全站 500。

- [ ] **Step 2: 写内容文件（frontmatter 用 JSON，零 YAML 依赖）**

`sections` 是数据不是提示：loader 校验正文里每个 `## <heading>` 都存在，断言脚本再验一次。这样"写完了"是可机器判定的。

````markdown
---
{
  "group": "compare",
  "slug": "netdisk-wechat",
  "title": "别再用网盘和微信审片了",
  "description": "网盘链接过期、客户反馈对不上时间点、版本靠文件名——用一条带密码的审片链接替掉这套拼凑流程。",
  "h1": "用网盘和微信审片，卡在哪三个地方",
  "updatedOn": "2026-09-20",
  "sections": ["链接会过期，文件会被限", "意见对不上画面", "版本靠文件名", "一条链接替掉这一整套", "客户这边什么都不用装", "几个常见顾虑"],
  "cta": { "href": "/login", "label": "手机号验证码登录，建一个项目试一条片子" },
  "related": ["features/share-link", "features/frame-comments"],
  "faq": [
    { "q": "素材放在哪里？", "a": "放在你自己的存储里——本地磁盘或你配置的 S3/OSS 桶，站点服务器只做转发和索引。" },
    { "q": "谁能看到我的片子？", "a": "只有拿到链接并通过密码或验证码校验的人；每条链接可单独设有效期，也能立即撤销。" },
    { "q": "客户需要装软件或注册吗？", "a": "不需要。链接打开就是播放器，批注也不需要账号。" }
  ]
}
---

## 链接会过期，文件会被限

<实现者按 spec §6 `/compare/netdisk-wechat` 第 ① 条写 2–3 段正文。事实边界：只描述已核实的机制——分享链接支持密码与有效期（`share/[teamSlug]`、`passwordPrompt`、`otpPrompt`）、支持一次性验证码邮件（`shareOtpEmail`）。不得写具体竞品数据。>

## 意见对不上画面

<按 spec 第 ② 条。可引用的实现事实：批注挂在具体帧、支持画笔圈画（`controls.showDrawingTools`）、客户无需账号即可评论。>

## 版本靠文件名

<按 spec 第 ③ 条。可引用：每次上传自动成版本、版本带上传者与时间（`versionInfo*`）。>

## 一条链接替掉这一整套

<按 spec 第 ④ 条，把上面三点收束成一句产品动作。>

## 客户这边什么都不用装

<按 spec 第 ⑤ 条：打开即播放、微信内可看、回传原片走同一条链接。>

## 几个常见顾虑

<按 spec 第 ⑥ 条：素材存放位置、可见性范围、如何撤销。与 faq 字段内容不重复表述。>
````

> 上面尖括号里的 `<按 spec 第 X 条…>` 是**给实现者的定位指针**，不是待填占位：执行该任务时必须先读 spec §6 对应条目，再落成正文，**交付时文件里不得残留任何尖括号**。

- [ ] **Step 3: 写 loader**

```ts
// src/lib/marketing/content.ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export type Section = { heading: string; html: string }
export type MarketingDoc = {
  slug: string; group: 'compare' | 'features'; title: string; description: string
  h1: string; updatedOn: string; sections: Section[]; cta: { href: string; label: string }
  related: string[]; faq: { q: string; a: string }[]; bodyHtml: string
}

const DIR = join(process.cwd(), 'content', 'marketing')
const GROUPS = new Set(['compare', 'features'])
let cache: Map<string, MarketingDoc> | null = null

/** 解析 `---\n{json}\n---\n` 前言。不用 YAML 库：字段全是字符串/数组/对象，JSON.parse 够用且零依赖。 */
function splitFrontmatter(raw: string, file: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!m) throw new Error(`${file} 缺少 --- JSON frontmatter 块`)
  try {
    return { meta: JSON.parse(m[1]), body: raw.slice(m[0].length) }
  } catch (e) {
    throw new Error(`${file} frontmatter JSON 解析失败：${(e as Error).message}`)
  }
}

/** 按 `## heading` 切正文，顺序与 frontmatter.sections 必须完全一致。 */
function toSections(body: string, expected: string[], file: string): Section[] {
  const parts = body.split(/^## /m).slice(1).map((chunk) => {
    const nl = chunk.search(/\r?\n/)
    const heading = (nl === -1 ? chunk : chunk.slice(0, nl)).trim()
    return { heading, html: nl === -1 ? '' : chunk.slice(nl + 1).trim() }
  })
  const got = parts.map((p) => p.heading)
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    throw new Error(`${file} 正文小节与 sections 不一致\n  期望: ${expected.join(' | ')}\n  实际: ${got.join(' | ')}`)
  }
  return parts
}

function validate(meta: Record<string, unknown>, file: string): MarketingDoc {
  const req = <K extends string>(k: K) => {
    const v = meta[k]
    if (typeof v !== 'string' || !v.trim()) throw new Error(`${file} 缺字符串字段 ${k}`)
    return v
  }
  const group = req('group')
  if (!GROUPS.has(group)) throw new Error(`${file} group 必须是 ${[...GROUPS].join('/')}，实际 ${group}`)
  const sections = meta.sections
  if (!Array.isArray(sections) || sections.length < 3) throw new Error(`${file} sections 至少 3 条`)
  const cta = meta.cta as { href?: string; label?: string } | undefined
  if (!cta?.href || !cta?.label) throw new Error(`${file} 缺 cta.href 或 cta.label`)
  const faq = meta.faq
  if (!Array.isArray(faq) || faq.length < 3) throw new Error(`${file} faq 至少 3 问`)
  return {
    group: group as MarketingDoc['group'], slug: req('slug'), title: req('title'),
    description: req('description'), h1: req('h1'), updatedOn: req('updatedOn'),
    sections: [], cta: { href: cta.href, label: cta.label },
    related: Array.isArray(meta.related) ? (meta.related as string[]) : [],
    faq: faq as { q: string; a: string }[], bodyHtml: '',
  }
}

export async function parseDoc(file: string): Promise<MarketingDoc> {
  const { marked } = await import('marked')
  const raw = readFileSync(join(DIR, file), 'utf8')
  const { meta, body } = splitFrontmatter(raw, file)
  const doc = validate(meta, file)
  doc.sections = toSections(body, meta.sections as string[], file)
  const dirty = marked.parse(body, { async: false }) as string
  const { default: DOMPurify } = await import('isomorphic-dompurify')
  doc.bodyHtml = DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['p','br','strong','em','code','pre','ul','ol','li','h2','h3','h4','a','blockquote','table','thead','tbody','tr','th','td','img','span'],
    ALLOWED_ATTR: ['href','title','src','alt','width','height'],
  })
  return doc
}

export async function loadDocs(): Promise<Map<string, MarketingDoc>> {
  if (cache) return cache
  const map = new Map<string, MarketingDoc>()
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.md'))) {
    const doc = await parseDoc(file)
    map.set(`${doc.group}/${doc.slug}`, doc)
  }
  cache = map
  return map
}

export async function getDoc(group: string, slug: string): Promise<MarketingDoc | null> {
  return (await loadDocs()).get(`${group}/${slug}`) ?? null
}
```

> `force-dynamic` 仍在根上，所以每请求会调 `getDoc`——`loadDocs()` 的 `cache` 就是为此存在，别删。dev 下改完 `.md` 需要重启进程才生效（缓存在进程内），这一点要在交付时告诉他，别让他以为文件没生效是 bug。

- [ ] **Step 4: 写渲染组件与路由**

`src/app/(marketing)/[group]/[slug]/page.tsx`：

```tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getDoc } from '@/lib/marketing/content'
import { getSiteUrl } from '@/lib/marketing/site-url'
import { BRAND } from '@/lib/marketing/brand'
import { MarkdownBody } from '@/components/marketing/MarkdownBody'
import { JsonLd } from '@/components/marketing/JsonLd'

export async function generateMetadata({ params }: { params: Promise<{ group: string; slug: string }> }): Promise<Metadata> {
  const { group, slug } = await params
  const doc = await getDoc(group, slug)
  if (!doc) return { title: '页面不存在', robots: { index: false } }
  const url = `${getSiteUrl()}/${doc.group}/${doc.slug}`
  return {
    title: doc.title,
    description: doc.description,
    alternates: { canonical: url },
    openGraph: { type: 'article', title: doc.title, description: doc.description, url, publishedTime: doc.updatedOn },
  }
}

export default async function MarketingPage({ params }: { params: Promise<{ group: string; slug: string }> }) {
  const { group, slug } = await params
  const doc = await getDoc(group, slug)
  if (!doc) notFound()
  return (
    <article className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="text-3xl font-semibold leading-snug">{doc.h1}</h1>
      <div id="marketing-body"><MarkdownBody html={doc.bodyHtml} /></div>
      <h2>常见问题</h2>
      <dl>{doc.faq.map((f) => (<div key={f.q}><dt>{f.q}</dt><dd>{f.a}</dd></div>))}</dl>
      <p><a href={doc.cta.href} className="inline-block rounded bg-white/90 px-5 py-3 font-medium text-black">{doc.cta.label}</a></p>
      {doc.related.length > 0 && (
        <nav aria-label="相关页面"><ul>{doc.related.map((r) => (<li key={r}><a href={`/${r}`}>{r}</a></li>))}</ul></nav>
      )}
      <JsonLd value={{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: doc.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }} />
      <p className="text-sm opacity-60">信息核实于 {doc.updatedOn}　·　{BRAND.zh}（{BRAND.en}）</p>
    </article>
  )
}
```

`src/components/marketing/MarkdownBody.tsx`：

```tsx
export function MarkdownBody({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
```

`src/components/marketing/JsonLd.tsx`（`src/proxy.ts:77` 的 CSP 是 `script-src 'self' 'nonce-${nonce}'…`，nonce 由 `requestHeaders.set('x-nonce', nonce)` 下发，内联脚本不带 nonce 会被浏览器拒执行）：

```tsx
import { headers } from 'next/headers'

export async function JsonLd({ value }: { value: Record<string, unknown> }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: JSON.stringify(value) }} />
}
```

`src/app/(marketing)/layout.tsx`：页脚内链 `/features`、`/compare`、`/privacy`、`/terms`（页头导航在 Task 6 补），并在这里下发绝对 URL 相关 metadata：

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { getSiteUrl } from '@/lib/marketing/site-url'
import { BRAND } from '@/lib/marketing/brand'

export function generateMetadata(): Metadata {
  const site = getSiteUrl()
  return {
    metadataBase: new URL(site),
    openGraph: {
      type: 'website',
      siteName: BRAND.zh,
      locale: 'zh_CN',
      url: site,
      images: [{ url: '/brand/logo.png', width: 256, height: 256, alt: BRAND.zh }],
    },
    twitter: { cardType: 'summary', title: BRAND.zh, images: ['/brand/logo.png'] },
  }
}
```
（`getSiteUrl()` 在此处调用：`NEXT_PUBLIC_APP_URL` 缺失时只有 `(marketing)` 下的页报错，`/studio`、`/login` 不受影响。）

- [ ] **Step 5: 跑断言验绿（只有这一页）**

Run: `node scripts/seo-check.mjs 2>&1 | grep '/compare/netdisk-wechat'`
Expected: 该页全部 PASS（title/canonical/og/H1/6 个 H2/CTA/JSON-LD 齐）。其余页仍红。
Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/compare/whatever"` → 期望 `404`。

- [ ] **Step 6: 本地检查点**

`npm run lint` 干净；`/`、`/login`、`/studio` 三处仍 200（证明新路由组没干扰既有路由）。**不 commit。**

---

## Task 4: robots.ts + sitemap.ts

**Files:**
- Create: `src/app/robots.ts`, `src/app/sitemap.ts`
- Delete: `public/robots.txt`

**Interfaces:**
- Consumes: `getSiteUrl()`、`loadDocs()`

- [ ] **Step 1: 写两个 Metadata Route**

> **2026-09-20 执行期修订（Task 9 评审带出的策略冲突）**：`Disallow` 与 `<meta name="robots" content="noindex">` 是**互相抵消**的一对 —— 被 Disallow 的页面爬虫根本不会来抓，也就永远看不到 noindex（Google 会退化成"凭外链把 URL 收进索引、不带摘要"）。`/login` 恰好是全站唯一会被**公开外站链接**指向的应用路由：内容页的 CTA 必须指向它（`scripts/seo-check.mjs:52` 就是这条断言）。而 Task 9 已经给 `/login` 加上了真 noindex。
> **裁决：把 `/login` 从 `disallow` 里去掉**，让它"可抓 + noindex"；其余应用路由保持"Disallow 一层"（`/studio` `/platform` 因为 `'use client'` 加不了 meta，本来就只能靠这层）。百度两个机制都认，不受这条影响。

```ts
// src/app/robots.ts
import type { MetadataRoute } from 'next'
import { getSiteUrl } from '@/lib/marketing/site-url'

export default function robots(): MetadataRoute.Robots {
  const disallow = ['/studio/','/platform/','/portal/','/profile/','/device/','/onboarding/','/forgot-password','/reset-password','/wechat-mini-login','/unsubscribe','/api/','/share/']
  return { rules: [{ userAgent: '*', allow: '/', disallow }], sitemap: `${getSiteUrl()}/sitemap.xml` }
}
```

```ts
// src/app/sitemap.ts
import type { MetadataRoute } from 'next'
import { loadDocs } from '@/lib/marketing/content'
import { getSiteUrl } from '@/lib/marketing/site-url'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = getSiteUrl()
  const docs = await loadDocs()
  const now = new Date()
  return [
    { url: `${site}/`, lastModified: now },
    { url: `${site}/privacy`, lastModified: now },
    { url: `${site}/terms`, lastModified: now },
    ...[...docs.values()].map((d) => ({ url: `${site}/${d.group}/${d.slug}`, lastModified: new Date(d.updatedOn) })),
  ]
}
```

- [ ] **Step 2: 删掉静态那份**

```bash
cd /Users/xiaoxiaobai/code/xiaobaic-review && rm public/robots.txt
```
**用 `rm`，不用 `git rm`**（Global Constraints：不动 git 索引）。恢复命令 `git checkout -- public/robots.txt`，已记入 ledger。

- [ ] **Step 3: 验证优先级不是猜的**

Run: `curl -s http://127.0.0.1:3000/robots.txt | head -20`
Expected: 输出里**必须**同时出现 `Disallow: /studio/` 和 `Sitemap: http://127.0.0.1:3000/sitemap.xml`。若还是旧的 `Disallow: /admin/`，说明静态文件仍被优先服务——那就把 `src/app/robots.ts` 改成 `src/app/robots.txt/route.ts`（显式 `export const dynamic = 'force-dynamic'`），改完再验一次，并把结论写回 spec §8。
Run: `node scripts/seo-check.mjs 2>&1 | grep -E 'robots.txt|sitemap'` → 期望 robots/sitemap 项全 PASS。

- [ ] **Step 4: 本地检查点**

`npm run lint`。**不 commit。**

---

## Task 5: 首页迁入 `(marketing)`（只搬家，不改文案）

**Files:**
- Move: `src/app/page.tsx` → `src/app/(marketing)/page.tsx`
- Move: `src/app/home-client.tsx` → `src/app/(marketing)/home-client.tsx`
- Move: `src/app/home.module.css` → `src/app/(marketing)/home.module.css`

**Interfaces:**
- Produces: `/` 由 `(marketing)` 组接管（Task 6 才能改写文案，本任务只求"行为不变"）

- [ ] **Step 1: 留一份迁移前基线**

```bash
cd /Users/xiaoxiaobai/code/xiaobaic-review
curl -s -A "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)" http://127.0.0.1:3000/ > /tmp/home-before.html
wc -c /tmp/home-before.html
```

- [ ] **Step 2: 搬文件并修 import**

```bash
cd /Users/xiaoxiaobai/code/xiaobaic-review
mv src/app/page.tsx "src/app/(marketing)/page.tsx"
mv src/app/home-client.tsx "src/app/(marketing)/home-client.tsx"
mv src/app/home.module.css "src/app/(marketing)/home.module.css"
```
用普通 `mv`，不用 `git mv`（Global Constraints）。`(marketing)` 目录 Task 3 已建。搬完 `src/app/page.tsx` 不存在——若根 layout 之外任何地方以路径引用过它，`npm run lint` 会暴露。
`home-client.tsx` 里 `import styles from './home.module.css'` 相对路径不变；`page.tsx` 里 `import HomeClient from './home-client'` 不变。

- [ ] **Step 3: 对比迁移前后**

Run: `curl -s -A "Mozilla/5.0 (compatible; Baiduspider/2.0)" http://127.0.0.1:3000/ > /tmp/home-after.html; diff <(sed 's/nonce="[^"]*"//g' /tmp/home-before.html) <(sed 's/nonce="[^"]*"//g' /tmp/home-after.html) | head -30`
Expected: 只差 nonce 与 Next 注入的构建 id，正文 HTML 一致。
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/studio` → 仍 200（重定向到 login 也算正常，与迁移前一致即可）。

- [ ] **Step 4: 本地检查点**

`npm run lint` + `node scripts/seo-check.mjs 2>&1 | tail -3` 无新增失败种类。**不 commit。**

---

## Task 6: 首页文案重写 + 页头导航

**Files:**
- Modify: `src/app/(marketing)/home-client.tsx`、`src/app/(marketing)/home.module.css`

**Interfaces:**
- Consumes: `BRAND`、`getSiteUrl()`
- Produces: 首页含指向 `/features`、`/compare`、`/login` 的可见链接（Task 1 断言与 Task 7 内链依赖它）

- [ ] **Step 1: 按 spec §7 定顺序改 JSX**

区块顺序固定为：页头（品牌名 + `功能` `/features` + `对比` `/compare` + `登录` `/login`）→ hero（一句定位用 `BRAND.zh`，副句写"手机号验证码登录就能用"）→ 三个崩点（各带 `<Link href="/compare/netdisk-wechat">` 锚文本）→ 三条能力（`/features/frame-comments`、`/features/versions`、`/features/share-link`）→ 结尾 CTA 区。**保留现有 `<video>` hero 与 `apiFetch('/api/auth/session')` 逻辑不动**，只换文案层与加链接。

- [ ] **Step 2: 事实纪律**

正文不得出现：未核实的产品数据（"已有 N 个团队在用"）、价格、具体竞品数字。CTA 措辞用"登录后按引导建一个团队"，与 `src/app/onboarding/page.tsx` 默认去向 `/studio/team?welcome=1` 对齐（spec §7）。

- [ ] **Step 3: 验**

Run: `curl -s -A "Mozilla/5.0 (compatible; Baiduspider/2.0)" http://127.0.0.1:3000/ | grep -o 'href="/\(features\|compare\|login\)[^"]*"' | sort -u`
Expected: 至少出现 `/features`、`/compare`、`/login` 三者。
Run: `node scripts/seo-check.mjs 2>&1 | grep -c '^FAIL'` → 记录数字，本任务后不得比 Task 5 增加。

- [ ] **Step 4: 本地检查点**

浏览器打开 `http://127.0.0.1:3000/` 肉眼看一遍移动端宽度（他的站是 `maxWidth: 5` 的响应式）。**不 commit。**

---

## Task 7: 其余 5 篇内容页 + 2 个枢纽页

**Files:**
- Create: `content/marketing/compare--fenzhen.md`, `compare--frame-io.md`, `features--frame-comments.md`, `features--versions.md`, `features/share-link.md`（文件名沿用 `features--share-link.md`）
- Create: `src/app/(marketing)/[group]/page.tsx`

**Interfaces:**
- Consumes: Task 3 的 loader 与 `MarketingDoc` 形状（`group/slug` 键、`sections` 必须与正文 `##` 完全一致）
- Produces: `loadDocs()` 返回 6 篇，`/features`、`/compare` 各列出同组全部页

- [ ] **Step 1: 五篇内容文件，frontmatter 逐字如下**

`sections` 的值必须与 `scripts/seo-check.mjs` 里 `PAGES` 的 `h2` 数组**逐字一致**，`h1` 同理；正文按 spec §6 对应小节写满 900–1400 字，每节 1–3 段。

| 文件 | group / slug | title | h1 |
|---|---|---|---|
| `compare--fenzhen.md` | compare / fenzhen | 与分秒帧的差异 | 逐帧审阅与分秒帧：数据归属与席位口径的差别 |
| `compare--frame-io.md` | compare / frame-io | Frame.io 的中文可用替代 | Frame.io 在国内用起来别扭的地方 |
| `features--frame-comments.md` | features / frame-comments | 逐帧批注 | 意见挂在第几帧，不是"大概三分钟" |
| `features--versions.md` | features / versions | 版本与定稿记录 | 每一次修改都有版本记录 |
| `features--share-link.md` | features / share-link | 带密码和有效期的审片链接 | 带密码和有效期的审片链接 |

每篇的 `description` ≥20 字且不复述 h1；`title` 以 spec §6 为准（本表两处曾与 spec 不一致，已改为 spec 的值——spec 是权威，计划是它的论证）。`cta.href` 一律 `/login`；`updatedOn` 填实际核稿日期；`faq` 3–5 问；`related` 填同组另两页的 `group/slug`。

- [ ] **Step 2: 两篇对比页的数据纪律**

`compare--fenzhen.md` 与 `compare--frame-io.md` 中任何关于对方的陈述，只能来自 Task 0 抓取的页面，并在该节末尾用一句"（依据：<对方页 URL>，核实于 <日期>）"。**拿不到就不写那一条，把该节改成能力自述**，不得留空或猜测。两页都必须包含 spec §6 要求的小节「什么时候仍然该选 Frame.io」/「什么时候选分秒帧」。

- [ ] **Step 3: 枢纽页**

```tsx
// src/app/(marketing)/[group]/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadDocs } from '@/lib/marketing/content'
import { getSiteUrl } from '@/lib/marketing/site-url'

const HUBS: Record<string, { title: string; description: string; blurb: string }> = {
  features: { title: '功能', description: '逐帧批注、版本记录、带密码的审片链接——影视团队交付时用得到的部分。', blurb: '交付一条片子会用到的四件事' },
  compare: { title: '对比', description: '和网盘微信、和分秒帧、和 Frame.io 的实质差异，含各自更适合的场景。', blurb: '现在这套流程哪里卡' },
}

export async function generateMetadata({ params }: { params: Promise<{ group: string }> }): Promise<Metadata> {
  const { group } = await params
  const hub = HUBS[group]
  if (!hub) return {}
  return { title: hub.title, description: hub.description, alternates: { canonical: `${getSiteUrl()}/${group}` } }
}

export default async function HubPage({ params }: { params: Promise<{ group: string }> }) {
  const { group } = await params
  const hub = HUBS[group]
  if (!hub) notFound()
  const docs = [...(await loadDocs()).values()].filter((d) => d.group === group)
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="text-3xl font-semibold">{hub.blurb}</h1>
      <ul className="mt-8 space-y-6">{docs.map((d) => (
        <li key={`${d.group}/${d.slug}`}>
          <Link href={`/${d.group}/${d.slug}`} className="font-medium">{d.title}</Link>
          <p className="text-sm opacity-70">{d.description}</p>
        </li>
      ))}</ul>
    </div>
  )
}
```

> 注意 `[group]/page.tsx` 与 `[group]/[slug]/page.tsx` 在 Next 里是两个不同深度，不冲突；`HUBS` 白名单外的 group 走 `notFound()`，避免 `/随便什么` 渲染成空列表被收录。

- [ ] **Step 4: 验**

Run: `node scripts/seo-check.mjs 2>&1 | grep -E '^(FAIL)' | grep -v 'robots.txt\|sitemap'`
Expected: 空输出（除 JSON-LD 相关若 Task 8 未做则允许残留 `JSON-LD` 行）。所有 6 页 + 2 枢纽的 title/canonical/og/H1/H2/CTA 全 PASS。
Run: `node scripts/seo-check.mjs 2>&1 | grep 'sitemap 含' | head` → 8 条全 PASS。

- [ ] **Step 5: 本地检查点**

`npm run lint`。**不 commit。**

---

## Task 8: 枢纽页 schema + CSP 实测（`JsonLd` 组件已在 Task 3 建）

**Files:**
- Modify: `src/app/(marketing)/[group]/page.tsx`（加 `SoftwareApplication` + `BreadcrumbList`）

- [ ] **Step 1: 枢纽页补两类 schema**

在 hub 页 return 前加：

```tsx
<JsonLd value={{ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: BRAND.zh, applicationCategory: 'MultimediaApplication', operatingSystem: 'Web', offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' } }} />
```
`price: '0'` 只有在 Task 0 他确认是免费公测时才保留；若是邀请制或未定价，**整条 `offers` 删掉**，不给搜索引擎错误价格。

同处再加面包屑（`groupLabel` 取 `HUBS[group].title`）：

```tsx
<JsonLd value={{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
  { '@type': 'ListItem', position: 1, name: BRAND.zh, item: getSiteUrl() },
  { '@type': 'ListItem', position: 2, name: HUBS[group].title, item: `${getSiteUrl()}/${group}` },
] }} />
```

- [ ] **Step 2: 验（这条是真被浏览器/CSP 放行，而不是存在）**

Run: `curl -sI http://127.0.0.1:3000/compare/netdisk-wechat | grep -i content-security-policy | grep -o "nonce-[^']*"` 记下 nonce，再 Run: `curl -s http://127.0.0.1:3000/compare/netdisk-wechat | grep -o '<script type="application/ld+json"[^>]*' | head -2`
Expected: 第二个输出的标签上带 `nonce="…"` 且与响应头里的值一致。
再用 chrome-devtools MCP 打开该页跑 `list_console_messages`，Expected: **无** `Refused to execute inline script` 之类 CSP 报错。

- [ ] **Step 3: 本地检查点**

`node scripts/seo-check.mjs` 全绿（含 8 页 JSON-LD 项）。`npm run lint`。**不 commit。**

> 顺带核实一件事：`/brand/logo.png` 只有 256×256，微信/飞书卡片通常要更宽的图才不难看。若他在意分享卡片观感，另开一个小任务加一张 1200×630 的 `/og/marketing.png` 并把 `openGraph.images` 指过去——**不在本计划范围**。

---

## Task 9: 应用页 noindex 双保险

> **2026-09-20 执行期修订（原文不可执行）**：Next 16.3.5 文档 `generate-metadata` 明写
> "`generateMetadata` and the `metadata` export are **only supported in Server Components**"。
> 而 `src/app/studio/layout.tsx` 与 `src/app/platform/layout.tsx` 第 1 行就是 `'use client'`，
> 所以这两页**加不了** metadata —— 除非把 provider 拆到单独文件、让 layout 变回 Server Component，
> 那属于"动应用路由结构"，正是本期决策 B 明确规避的回归面。裁决见下。

**Files:**
- Modify: `src/app/portal/layout.tsx`（Server Component，可直接加）
- Create: `src/app/profile/layout.tsx`、`src/app/onboarding/layout.tsx`、`src/app/login/layout.tsx`（均不存在，新建为只 `return children` 的 Server Component）
- **不动**：`src/app/studio/layout.tsx`、`src/app/platform/layout.tsx`、`src/app/share/**`

**Interfaces:**
- Consumes: 无

- [ ] **Step 1: 能加的应用组 layout 加一行 metadata**

```ts
import type { Metadata } from 'next'
export const metadata: Metadata = { robots: { index: false, follow: false } }
```
已存在 `metadata` 导出时改为合并该字段，不要覆盖既有 title。**`index` 与 `follow` 两个字段必须都写**：Next 的 `resolve-metadata.js` 对子级 key 做整字段替换、`robots` 没有深合并，子级只写 `{ index: false }` 会把根上的 `follow: true` 一起丢掉。

**`/share/` 不加 noindex**——它已被 robots 的 `Disallow: /share/` 覆盖（spec §8 的产品决定待他回复后再定这条）。

**`/studio`、`/platform` 本期放弃 meta noindex**，只靠 Task 4 的 `robots.txt` Disallow 兜底，理由与代价写进 Task 10 的交付说明（不是"忘了做"，是明确记录的一层缺口）。

- [ ] **Step 2: 验**

Run: `for p in /portal /profile /onboarding /login; do printf "%s " $p; curl -s "http://127.0.0.1:3000$p" | grep -o '<meta name="robots"[^>]*>' | head -1; echo; done`
Expected: 四个都出现 `noindex`（未登录被重定向的拿不到 body，记录实际行为并在交付说明里写清，不算失败）。
再跑一次 `for p in /studio /platform; do ...; done`，Expected: **没有** `noindex`，把这条"已知缺口"的实测输出原样抄进交付说明。
最后确认 `/`、`/privacy`、`/terms` 三页仍是 200 且各自 `<title>` 正常（新建的 layout 不该影响别的段）。

- [ ] **Step 3: 本地检查点**

`npm run lint`；`node scripts/seo-check.mjs` 的输出与本轮开工前**逐行一致**（按计划顺序此时应已全绿；实际执行把 Task 9 提前到了 Task 3 之前，所以现在仍是 `2 PASS / 19 FAIL`——不变量是"Task 9 不改变任何一行"）。**不 commit。**


---

## Task 10: 收尾——交付说明与"待上线清单"

**Files:** 无代码改动

- [ ] **Step 1: 跑完整验证并把输出贴给他**

```bash
cd /Users/xiaoxiaobai/code/xiaobaic-review
node scripts/seo-check.mjs; echo "exit=$?"
npm run lint
git status --short
```
Expected: 脚本 `exit=0`；lint 无 error；`git status --short` 里**只有本计划产生的文件与 `M src/app/api/share/[token]/route.ts`（那是他/另一会话的改动，不要碰、不要提交）**。

- [ ] **Step 2: 写上线待办（不执行）**

在 spec 末尾追加一节「上线前必须做（本次未做）」，逐条：
1. 换域名后把 `NEXT_PUBLIC_APP_URL` 指向新域名，重启，跑 `node scripts/seo-check.mjs`（用 `SEO_CHECK_BASE` 指生产）确认 canonical 全部跟着变。
2. 备案下来 → Caddy 站点块、微信小程序/开放平台合法域名、飞书 OAuth 回调白名单、CDN 防盗链逐处加新域名。
3. Google Search Console + 百度站长平台分别提交 `sitemap.xml`；百度另开"主动推送/快速收录"。
4. 一期观察满一个月，再决定要不要做 `force-dynamic` 下移（spec §5）与二期内容（spec §9）。
5. `content/marketing/*.md` 改完需重启 dev 才生效（进程内缓存）。

- [ ] **Step 3: 明确告知他：改动全在本地工作区，一次 commit 都没有，服务器零接触。**

---

## 自检记录

- **spec 覆盖**：§3 域名约束→Task 2；§5 结构与 B 决定→Task 3/5；§6 六页→Task 7（断言在 Task 1 先写）；§7 首页→Task 2 Step 4 + Task 5/6；§8 robots/sitemap/noindex/JSON-LD→Task 4/8/9；§11 验证方式→Task 1 + 各任务验步骤；§12 风险里的"不留空页"→Task 3 Step 3 的 sections 强校验与 Task 7 的 HUBS 白名单。
- **占位扫描**：Task 7 Step 1 的正文指向 spec §6 而非"待填"，且 loader 会在小节不齐时抛错、断言脚本会逐条红——内容缺失无法被"静默通过"。
- **类型一致性**：`MarketingDoc`、`loadDocs()`、`getDoc()`、`getSiteUrl()`、`JsonLd`、`BRAND` 在 Task 2/3 定义，Task 4/7/8/9 使用同名同签名。
