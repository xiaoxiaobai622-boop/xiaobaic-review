# vidx.cn 生产功能面只读巡检报告

- 巡检时间：2026-10-17 19:36–19:47（UTC+8）
- 方式：**只用 GET**（含 4 条 Range GET，无 POST/PUT/DELETE，无注册/登录/发码，无爆破，无越权试探）
- 实际发出请求数：**约 92 条**（84 条走串行 harness + 8 条直连补测），串行 + 每条间隔 0.35s，远低于 150 上限
- 出口：`curl 8.7.1`，桌面 Chrome UA；移动端用 iPhone 17.5 UA
- 凭据红线：全程未打印任何预签名 URL / AKID / token / 连接串。第三方响应里出现的 `__jsluid_s` cookie、COS `x-cos-request-id`、CSP nonce 值一律只描述「存在」，不落原文
- 本地仓库仅读取（`/Users/xiaoxiaobai/code/xiaobaic-review` 的 `src/app/robots.ts`、`sitemap.ts`、`src/lib/marketing/content.ts`、`public/manifest.json` 用于对照预期），未做任何修改，未执行 git 写操作
- 原始数据：`/tmp/audit-1017/probe/results.tsv`、`/tmp/audit-1017/probe/bodies/`

## 覆盖度总览

| 扫描项 | 结论 |
|---|---|
| 1 路由矩阵 | 63 条不同路径实测，形态全对；发现问题见 P10/P12 |
| 2 域名收口 | 三源全收敛，`http://www` 多一跳（P11） |
| 3 安全响应头 | HTML 层满分；`/api/branding/favicon` 全缺（P3）；CSP 遗留第三方（P4） |
| 4 缓存头 | HTML 未被中间层缓存（已验通过）；静态与图标若干问题（P9/P13/P14） |
| 5 HTML 层 | `/privacy`、`/terms` 缺 canonical（P2）；og/twitter 若干缺项（P8） |
| 6 JSON-LD | 12 页 44 个块全部可解析；`isPartOf` 悬空（P5）、维度缺失（P6、P7） |
| 7 死链内链 | 13 条同源链接全 200，0 死链；2 条外链一条断在登录墙（P1） |
| 8 图标链 | 10 个图标地址全 200，尺寸全对得上；apple-touch-icon 指 SVG（P14） |
| 9 sitemap/robots/noindex 三方 | sitemap 11 条全 200 且无 noindex（通过）；8 条 Disallow 页仍声明 index（P10） |
| 10 文案红线 | 无我方价格/套餐/订单字样（**通过**）；旧品牌名残留 2 处（P15）；竞品价格叙述（P16）；备案号待业主确认（P17） |
| 11 移动端 | 完整 SSR 正文，与桌面逐字节等长（**通过**） |

---

## 问题清单

### P1 · 首页页脚「帮助文档」「联系我们」两条唯一对外入口，匿名访客被踢进飞书登录墙
**严重度：重要｜谁能修：只有业主能做**

- 现象：首页是全站唯一放这两条链接的页面（其余 10 个营销页 0 命中）。两条 `<a>` 都指向同一个私有飞书 wiki，匿名访问不返回内容而是跳飞书登录页。对没登录飞书的潜在客户，「了解平台 → 帮助文档」这条路径直接断头，且「联系我们」是页面上唯一的对外联络口径。
- 证据：
  ```
  $ grep -c 'feishu\.cn/wiki' bodies/home.html        # 2 处，其余营销页均为 0
  首页 <a> 清单：帮助文档 / 联系我们 → https://scnqe74t5owc.feishu.cn/wiki/UOxownMcRiBLeekZwcEc3BBAnc2
  $ curl -o /dev/null -D - 'https://scnqe74t5owc.feishu.cn/wiki/UOxownMcRiBLeekZwcEc3BBAnc2'
    HTTP/2 302
    location: https://accounts.feishu.cn/accounts/page/login?app_id=2&query_scope=all&redirect_uri=…  （已截断）
  $ 跟随 location 再取一次 → 仍是 302 回同一登录页，无正文
  ```
- 结论：不是死链（对方站点活着），是**权限配置错**——文档设成了内部可见。属于「链接存在但公开访客打不开」，比 404 更糟，因为来的人以为自己被拒了。
- 修法归属：只有业主能在飞书后台把该 wiki 切成「互联网上获得链接的人可阅读」，或换成公开帮助站地址。

### P2 · `/privacy` 与 `/terms` 在 sitemap 里但没有 canonical（11 条中缺 2 条）
**严重度：重要｜谁能修：代码侧**

- 现象：sitemap 11 条 URL 中 9 条有严格自指 canonical，`/privacy`、`/terms` 两条 `<link rel="canonical">` 数量实测为 0，而它们都在 sitemap 里、都声明 `index, follow`。同时这两条也是全站唯一带 `www` 变体风险却没有 canonical 的页——`https://www.vidx.cn/privacy` 现在靠 301 兜住，一旦某条外链写成 `?utm=` 形式就没有归一依据。
- 证据：
  ```
  sitemap 11 条逐条交叉核对（canonical 与 <loc> 字符串全等判 EXACT）：
    /                              canonical=https://vidx.cn                       EXACT
    /features                      canonical=https://vidx.cn/features              EXACT
    /compare                       canonical=https://vidx.cn/compare               EXACT
    /privacy                       canonical=None                                  ABSENT
    /terms                         canonical=None                                  ABSENT
    /compare/fenzhen               canonical=https://vidx.cn/compare/fenzhen       EXACT
    （其余 5 条 docs 全 EXACT）
  $ grep -c 'rel="canonical"' bodies/privacy.html   # 0
  ```
  仓库 `src/app/sitemap.ts` 注释明确要求「绝对前缀与页面 canonical 同源」，`privacy`/`terms` 没接上这条链。
- 结论：`src/app/privacy/page.tsx`、`terms/page.tsx` 的 `metadata` 未导出 `metadata.alternates.canonical`。sitemap 收录 + 无 canonical = 给同一页留了两个可索引地址。

### P3 · `/api/branding/favicon` 与 `/favicon.ico` 零安全响应头（含缺 `X-Content-Type-Options`），而同目录静态图却带全套
**严重度：重要｜谁能修：生产配置侧（Caddy/中间件 matcher）+ 代码侧**

- 现象：`/api/branding/favicon` 是 robots.txt 里**唯一被显式 Allow 的 `/api/` 路径**、且被全站每页 `<head>` 的三条 icon 声明引用（`shortcut icon` / `icon` / `apple-touch-icon`），爬虫和第三方客户端都会直接打它。它返回的是 `image/svg+xml`，而响应里 CSP、`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy`、`Strict-Transport-Security`、`Permissions-Policy` **一个都没有**。`/favicon.ico` 同样缺 CSP / nosniff / HSTS。
- 证据：
  ```
  $ curl -D - -o /dev/null https://vidx.cn/api/branding/favicon
    HTTP/2 200
    cache-control: public, max-age=300, must-revalidate
    content-type: image/svg+xml
    date / vary / via: 1.1 Caddy / alt-svc / x-origin-server   ← 仅此 6 行，无任何安全头
  头计数（1=存在，0=缺失）：
    apifav    sts=0 csp=0 nosniff=0
    favicoc   sts=0 csp=0 nosniff=0
    oghost    sts=1 csp=1 nosniff=1     ← 同为 public/ 下静态图，却拿满
    robots    sts=0 csp=0 nosniff=1
  HTML 对照组（/ 、一条内容页、/login）：csp / XFO=DENY / nosniff / referrer / HSTS / permissions-policy 六项全在
  ```
  同一份 `via: 1.1 Caddy` 下，`/og/*.png` 带全套头而 `/favicon.ico` 不带，说明中间层是按路径清单加头的，favicon 系列被漏在 matcher 外。
- 结论：真正要紧的是 **`image/svg+xml` 缺 `X-Content-Type-Options: nosniff`**。这个接口的字节来自管理端上传的品牌图（`api/settings/favicon/route.ts` 硬编码为该路径），SVG 本身可携带脚本；同源、无 CSP、无 nosniff 三者叠加，等于给「上传一张图」这条路径留了一个同源执行面。补上 nosniff + CSP 是纯配置动作，成本低。

### P4 · CSP 仍保留与本项目无关的第三方收信口，其中包含一个**打赏/支付域**的 `frame-src`
**严重度：重要｜谁能修：代码侧**

- 现象：`script-src`/`connect-src`/`img-src`/`frame-src` 里允许 `ko-fi.com`（`https://ko-fi.com`、`https://storage.ko-fi.com`、`https://*.ko-fi.com`，且 `frame-src 'self' https://ko-fi.com`）、`static.cloudflareinsights.com`、一个匿名 CloudFront 分发 `d8j0ntlcm91z4.cloudfront.net`。全站 41 个响应体里这些域名**一次都没被引用过**（`ko-fi` 在所有 body 中命中 0 次）。Ko-fi 是捐赠/支付挂件，站点当前无 ICP 许可证、页面上也不允许出现任何付费元素。
- 证据：
  ```
  $ for f in bodies/*.html; do grep -c -i 'ko-fi' $f; done | sort -u   # 全部 0
  cloudflareinsights / d8j0ntlcm91z4：同样 0 次引用
  CSP 中却存在：frame-src 'self' https://ko-fi.com
              img-src … https://storage.ko-fi.com https://*.ko-fi.com
                      https://d8j0ntlcm91z4.cloudfront.net …
              script-src … https://static.cloudflareinsights.com
  对照：https://static.vidx.cn 在首页出现 17 次（真在用）、media.vidx.cn 与 myqcloud 在营销页 0 次（但属播放面，登录后才用，判为合理保留）
  ```
- 结论：这几条是从旧项目（vitransfer，见 P15）继承的死配置。`frame-src https://ko-fi.com` 等于提前给生产页面开好了嵌打赏 iframe 的口子——现在没嵌，以后一次误配置就会嵌上。与 P15 同源，清理时一并办。
- 注：`media.vidx.cn`、`cos.ap-shanghai.myqcloud.com`、`mle6-media-sh-…myqcloud.com` 在营销页不出现是预期内（审片器在登录态才加载），**未**列为问题。

### P5 · 六篇内容文稿的 `Article.isPartOf` 指向同页并不存在的节点（引用悬空）
**严重度：次要｜谁能修：代码侧**

- 现象：每页的 `Article` 带 `isPartOf.@id = https://vidx.cn/features#hub` 或 `…/compare#hub`，但该页所有 JSON-LD 节点里没有任何 `@id` 等于这两个值——hub 页自己发的 `SoftwareApplication`/`BreadcrumbList` 也没有 `@id`。也就是说 `#hub` 这个节点**在全站任何一页都不存在**。
- 证据：
  ```
  $ python3 jsonld.py（解析每页所有 <script type="application/ld+json">，同页 @id 集合内闭合判 OK/DANGLING）
  [featuresframe-comments]  ref Article.isPartOf.@id = https://vidx.cn/features#hub  -> DANGLING
  [featuresshare-link]      ref Article.isPartOf.@id = https://vidx.cn/features#hub  -> DANGLING
  [featuresversions]        ref Article.isPartOf.@id = https://vidx.cn/features#hub  -> DANGLING
  [comparefenzhen|frame-io|netdisk-wechat]  … = https://vidx.cn/compare#hub -> DANGLING
  六篇同构，全部 DANGLING
  [features]/[compare] 枢纽页 SoftwareApplication：@id=ABSENT  ← 本应承载 #hub 的节点没发 @id
  ```
  对比闭合正常的引用（这些是**通过**的）：`WebSite.publisher.@id`、`Article.author.@id`、`Article.publisher.@id` 全部指向同页存在的 `https://vidx.cn/#organization`，7 页 × 3 条引用 0 悬空。
  `Article.mainEntityOfPage.@id` 也判为 DANGLING，但它按规范允许只写 URL 而不必内联 `WebPage` 节点，**不计为缺陷**。
- 结论：`isPartOf` 的 `#hub` 锚点从未被 emit。要么在 hub 页给 `SoftwareApplication`/`WebPage` 补 `@id: …#hub`，要么把 `isPartOf` 改指 `https://vidx.cn/#website`（该节点确实存在）。

### P6 · 六篇 `Article` 一律没有 `image`，内容页也一律没有 `BreadcrumbList`
**严重度：次要｜谁能修：代码侧**

- 现象：`Article` 必填项齐（见「已验通过」），但 Google 建议的 `image` 六篇全缺；`BreadcrumbList` 只在 `/features`、`/compare` 两个枢纽页出现，6 篇真正吃搜索流量的深层页一个都没有——层级关系反了。
- 证据：
  ```
  [每篇] image=ABSENT (recommended for Article)     ×6
  @type set：
    features/compare   = ['BreadcrumbList','Organization','SoftwareApplication','WebSite']
    6 篇文稿           = ['Article','FAQPage','Organization','WebSite']   ← 无 BreadcrumbList
  页面已有可用图：/og/brand-1200x630.png（200，1200×630，72825B，sharp 实测）
  ```
- 结论：`Article.image` 可直接填 og 那张（已是绝对地址、已验 200）；`BreadcrumbList` 复用枢纽页那段加一层即可。

### P7 · `SoftwareApplication` 无 `@id`、无 `aggregateRating`；`Organization` 无 `sameAs`
**严重度：次要｜谁能修：代码侧（`aggregateRating` 需业主决定）**
- 现象：两个枢纽页的 `SoftwareApplication` 必填三项齐全（`name=逐帧审阅` / `operatingSystem=Web` / `applicationCategory=MultimediaApplication`），但无 `@id`（因此无法被其它节点引用，直接造成 P5）且无 `offers`/`aggregateRating`，拿不到富结果。`Organization` 缺 `sameAs`，实体对齐没有外部锚点。
- 证据：
  ```
  [features] SoftwareApplication name='逐帧审阅' os='Web' cat='MultimediaApplication' missing=[]
             @id=ABSENT   url='https://vidx.cn'   offers/aggregateRating: 均不存在
  [home] Organization @id=https://vidx.cn/#organization url=https://vidx.cn
         logo.url=https://vidx.cn/brand/logo-512.png（实测 200，512×512）
         optional-missing=['sameAs','contactPoint']
  ```
- 结论：`offers` **不该**加（无 ICP 许可证，见 P17 口径），`aggregateRating` 无真实评分来源也不该造。这两项按「有意留空」处理，只补 `@id` 与 `sameAs`。

### P8 · `twitter:site` 全站缺失；6 篇文稿比枢纽页少 `og:site_name`/`og:locale`；`/privacy`、`/terms`、`/login` 无任何 og/twitter
**严重度：次要｜谁能修：代码侧**
- 证据：
  ```
  home/features/compare          missing=['twitter:site']
  6 篇文稿                        missing=['og:site_name','og:locale','twitter:site']
  privacy / terms / login        og/twitter 12 项全缺
  存在项实测：og:type website(hub)/article(docs)、og:url 与 canonical 9/9 逐字符串 MATCH、twitter:card 全为 summary_large_image
  og:image 全站统一 https://vidx.cn/og/brand-1200x630.png
  $ curl 该地址 → 200 image/png 72825B（真打得开，已验通过）
  ```
- 结论：继承链不完整——根 layout 给了 `og:site_name`/`og:locale`，文稿页 metadata 覆写时没合并进去。

### P9 · HTML 与静态/文本层缓存策略若干不一致（`/llms.txt` 是唯一有真实 TTL 的 SEO 文件；og 图不缓存）
**严重度：次要｜谁能修：生产配置侧**
- 现象与实测数字：
  ```
  HTML（/ 、内容页 、/login 、/studio …）：cache-control: private, no-cache, no-store, max-age=0, must-revalidate
    vidx.cn _origin_ 全部 63 条不同路径的响应里 age / x-cache / cf-cache-status / x-swift 命中数 = 0（79 份头文件逐个 grep 无匹配；仅 static.vidx.cn 的 CDN 响应带 age: 0 / x-cache-lookup，属另一台源）
    → 结论：中间层完全没有缓存 HTML，每请求走真 SSR
  /robots.txt   public, max-age=0, must-revalidate   （301B）  → 不可能过期，通过
  /sitemap.xml  public, max-age=0, must-revalidate   （1183B） → 不可能过期，通过
  /llms.txt     public, max-age=3600                 （4493B） → SEO 三件套里唯一被缓存 1 小时的
  /favicon.ico  public, max-age=0                    （4932B） → 无 must-revalidate
  /manifest.json /sw.js public, max-age=0 + ETag
  /og/brand-1200x630.png（含 static.vidx.cn 上同一文件）public, max-age=0   ← 品牌不变量却完全不缓存
  /_next/static/chunks/*.js  *.css  public, immutable, max-age=31536000      ← 正确，通过
  ```
- 结论：真正的问题只有一个——**内容不可变的 `/og/*.png` 与 `/favicon.ico` 用 `max-age=0`**，社交爬虫每次抓取都回源；而 `/_next/static` 的 `immutable, 31536000` 是对的。`/llms.txt` 1 小时 TTL 对 AI 抓取器可接受，但它与 robots/sitemap 的 `must-revalidate` 不同形，改文案时要记得这 1 小时窗口。
- 另外：`/api/branding/favicon`、`/robots.txt`、`/sitemap.xml`、`/llms.txt`、`/manifest.json`、`/sw.js` 上都挂着 `vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch`（RSC 路由用的头，出现在二进制图和纯文本接口上没有意义，只让缓存键碎掉）。次要，属 Next metadata-route 默认行为。

### P10 · 8 条被 robots `Disallow` 的路径，页面自己仍声明 `index, follow`
**严重度：次要｜谁能修：代码侧**
- 现象：`/studio`、`/platform`、`/device`、`/forgot-password`、`/reset-password`、`/unsubscribe`、`/wechat-mini-login`、`/lab/projects` 全部 200 可打开，`<meta name="robots">` 都是 `index, follow`，而它们只在 `Disallow` 名单里、没有 noindex。仓库 `robots.ts` 注释对 `/login` 已经把「Disallow 会让 noindex 读不到」讲清楚了，并且真的给 `/portal`、`/profile`、`/onboarding` 配了 noindex（实测确认），但上面这 8 条走了另一半逻辑。
- 证据：
  ```
  $ for p in studio platform device forgot-password reset-password unsubscribe wechat-mini-login lab/projects
      → HTTP 200, <meta name="robots" content="index, follow"/>（每页恰好 1 个 robots meta，无 noindex）
    对照  portal / profile / onboarding → content="noindex, nofollow"（且不在 Disallow 名单，符合注释）
          login → content="noindex, nofollow"（不在 Disallow 名单，符合注释）
  robots.txt 实测正文与 src/app/robots.ts 逐行一致（Allow: / , /api/branding/favicon；10 条 Disallow；Sitemap 绝对址）
  ```
- 结论：风险有限（这 8 条没有被公开外链），但 `/studio` 确实是 manifest 的 `start_url`（PWA 安装后直达），一旦有外站直链就会被「凭外链收进索引、不带摘要」。要么给它们补 noindex，要么按 `/login` 的口径把它们移出 Disallow。二者选一，别两边都不动。
- 附带实测：`/lab` 与 `/share` 裸路径为 404，`/lab/projects` 为 200 —— 与 robots 里带斜杠的写法自洽，无「刚好没人看的缝」。

### P11 · `http://www.vidx.cn` 到 apex 要两跳，且三段收口用了两种状态码
**严重度：次要｜谁能修：生产配置侧（Caddy）**
- 证据（同一代表路径 `/compare/fenzhen`，含 query 的 `/features/versions?utm_source=audit&utm_medium=x` 也逐条验过，参数完整保留）：
  ```
  http://vidx.cn/compare/fenzhen          → hops=1  final=https://vidx.cn/…  200  time=0.328s   （308）
  https://www.vidx.cn/compare/fenzhen     → hops=1  final=https://vidx.cn/…  200  time=0.356s   （301）
  http://www.vidx.cn/compare/fenzhen      → hops=2  final=https://vidx.cn/…  200  time=1.598s
      第 1 跳 308 → https://www.vidx.cn/…    第 2 跳 301 → https://vidx.cn/…
  带 query 一条：308 location=https://vidx.cn/features/versions?utm_source=audit&utm_medium=x（未丢参）
  ```
- 结论：方向全对、无环路、路径与 query 无损，只是 `http+www` 组合多付一跳（实测耗时 1.6s vs 0.33s，约 5 倍）。Caddy 里给 `www` 的 80 站点直接写一条「301 → `https://vidx.cn{path}`」即可省掉中间跳。另外 http→https 用 308、www→apex 用 301，两种码混着不算错，但统一成 301 对老客户端更稳。

### P12 · 所有 404 响应同时输出 `index, follow` 和 `noindex` 两条互相矛盾的 robots meta
**严重度：重要｜谁能修：代码侧**
- 现象：任何打不开的路径（未知 slug、大写路径、未知短码、`/lab`、`/brand`、`/admin`）都返回 404 + 约 141–147KB 完整页面壳，而壳里**两个** `<meta name="robots">`：根 layout 的 `index, follow` 没被 not-found 边界覆盖掉，只追加了一条 `noindex`。
- 证据：
  ```
  $ grep -aoE '<meta name="robots"[^>]*/?>' bodies/unknown_path.html | sort | uniq -c
      1 <meta name="robots" content="index, follow"/>
      1 <meta name="robots" content="noindex"/>
  正常 200 页对照：home / studio / platform 各只有 1 条（index, follow）；login 只有 1 条（noindex, nofollow）
  触发面实测 9 条，全部同形态：
    /features/no-such-feature-xyz  404 147286B    /totally-unknown-page-xyz   404 141678B
    /compare/no-such-compare-xyz   404 147283B    /Features                   404 141646B
    /features/privacy              404 147262B    /Features/Frame-Comments    404 145243B
    /ABC1234567 /abcdef1234 /aB3Cd4Ef5G  均 404 140–142KB
  404 页 <title> 仍是品牌默认「逐帧审阅_专业的视频审片与批注协作平台_FrameReview」，canonical 0 条（此处不该有，判通过）
  ```
- 结论：404 状态码本身会压过 meta，所以现在还没被收进索引；但这是明确的输出缺陷，且 404 页带完整默认 title/description，是搜索引擎判断「soft 404」的典型输入。修法是给 `not-found.tsx` 覆写 `robots: { index: false, follow: false }`，让它**替换**而不是叠加默认值。归到「重要」是因为它出现在 100% 的错误路径上且修复成本极低。

### P13 · `/dl` 对外下载入口 302 到 COS 上的定版安装包，响应带 `content-encoding: aws-chunked`
**严重度：次要｜谁能修：生产配置侧（COS 对象元数据）**
- 证据：
  ```
  $ curl -D - -o /dev/null https://vidx.cn/dl
    HTTP/2 302  location: https://dl.vidx.cn/desktop/vidx-setup-0.1.16.exe
  $ curl -r 0-1023 <该址>   （只取头 1KB，未整包下载）
    HTTP/2 206  content-type: application/octet-stream
    content-encoding: aws-chunked        ← 问题所在
    content-range: bytes 0-1023/112073851   （整包约 106.9 MB）
    server: tencent-cos
  $ xxd -l 16 → 4d5a 9000 …   file → PE32 executable (GUI) Intel 80386  ← 字节本身是干净的
  $ curl https://dl.vidx.cn/desktop/  → 403 application/xml（无目录浏览，判通过）
  ```
- 结论：跳转目标活着、字节正确、断点续传（206/Range）支持。唯一不对的是 `Content-Encoding: aws-chunked`——这是分块上传遗留的对象元数据，规范里它属于传输编码，严格模式的下载器/浏览器会尝试解码并报错。字节能过是因为 Range 请求绕过了解码。属 COS 对象元数据清理。另：安装包版本号硬编码在 `src/app/dl/route.ts`（`0.1.16`），发新版忘改就是 404，建议纳入发布检查。

### P14 · `<head>` 把 `apple-touch-icon` 指到一个返回 SVG 的接口，且非方形
**严重度：次要｜谁能修：代码侧**
- 现象：每页三条 icon 声明（`shortcut icon` / `icon` / `apple-touch-icon`）全部指向 `/api/branding/favicon`，该址实测 `content-type: image/svg+xml`，SVG 根元素自带 `width="184" height="190"`。iOS 的 `apple-touch-icon` 要求 PNG 且需方形，SVG 不认。同时 `/favicon.ico`（合法 3 尺寸 ICO）没有任何 `<link>` 声明，只靠浏览器默认兜。
- 证据：
  ```
  首页 <head> 实测声明：
    <link rel="manifest" href="/manifest.json"/>
    <link rel="shortcut icon" href="/api/branding/favicon"/>
    <link rel="icon"        href="/api/branding/favicon"/>
    <link rel="apple-touch-icon" href="/api/branding/favicon"/>
    <meta name="theme-color" content="#111318"/>
  $ curl -D - /api/branding/favicon → 200 image/svg+xml 2698B
    <svg … viewBox="36 33 184 190" width="184" height="190">   ← 非方形
  $ file bodies/favicoc.html → MS Windows icon resource - 3 icons, 16x16, 32x32 (+48x48 目录项), 4932B  ← ICO 本身合法
  ```
- 结论：iOS 添加到主屏时拿不到图标（会退化成截图）。manifest 里已有现成的 192/512 PNG（见「已验通过」），`apple-touch-icon` 换成 `/brand/logo-192.png` 即可；同时建议显式声明一条 `<link rel="icon" type="image/x-icon" href="/favicon.ico">` 作为 SVG 不支持时的回退。

### P15 · 旧品牌名 `vitransfer` 在生产环境残留 2 处（不在可见正文与 JSON-LD，但在下发给爬虫的字节里）
**严重度：次要｜谁能修：代码侧**
- 现象：任务要扫的「可见正文 + JSON-LD」这两个面**是干净的**（下证）。但 `vitransfer` 以两种形式随生产响应下发：① `/sw.js` 的缓存名常量；② 每个 HTML 内联的 Next.js RSC/国际化字典里的**键名**（值是正确的新品牌）。
- 证据：
  ```
  $ grep -aoiE '.{0,60}vitransfer.{0,60}' bodies/sw.html
    const CACHE_NAME = 'vitransfer-v1'
  首页内联 payload 片段：
    …"viTransfer":"FrameReview","videoReviewTagline":"视频审片、反馈与交付"…
    …"website":"vidx.cn","supportViTransfer":"支持 FrameReview"…
  可见文本（剥掉 <script>/<style> 后）vitransfer 命中：0（12 页 × 全部路径，含 /llms.txt）
  JSON-LD 44 个块 vitransfer 命中：0（脚本逐块判过）
  ```
- 结论：不是用户可见的品牌错乱，但 `/sw.js` 与页面 payload 都是公开可取的，AI 抓取器/爬虫读原始 HTML 会看到旧域名时代的键名。i18n 键 `viTransfer`/`supportViTransfer` 改名 + `sw.js` 缓存名换成 `framereview-v2`（注意：换名会触发一次旧缓存清理，`activate` 里已有删除逻辑，安全）。与 P4 是同一批遗留。

### P16 · `sw.js` 的 `notificationclick` 默认落到 `/admin`，而 `/admin*` 全站不存在
**严重度：重要｜谁能修：代码侧**
- 现象：下发的 service worker 在通知点击时，若 payload 没带 `data.url`，按 `data.type` 分支拼出 `/admin`、`/admin/projects/{id}`、`/admin/security` 三类地址并 `openWindow`。这三类地址实测全 404。同时兜底文案是英文、通知图标指向 SVG。
- 证据：
  ```
  bodies/sw.html 片段：  let url = '/admin'
                        case CLIENT_COMMENT|VIDEO_APPROVAL|CLIENT_UPLOAD|SHARE_ACCESS: url = `/admin/projects/${data.projectId}`
                        case ADMIN_ACCESS|SECURITY_ALERT: url = '/admin/security'
                        …if (client.url.includes('/admin') && 'focus' in client) client.navigate(url)
  $ curl -o /dev/null -w '%{http_code}' https://vidx.cn/admin            → 404
                                          https://vidx.cn/admin/security  → 404
  英文兜底串：title:'FrameReview', body:'You have a new notification'（zh-CN 站点）
  通知图标：icon/badge = '/brand/icon-192.svg' → 实测 200 image/svg+xml 2648B（存在，但 SVG 做 Web Notification 图标在部分内核不渲染）
  另：fetch 监听里 caches.match(...) 兜底，但全脚本无 caches.open/add → 该缓存永远为空，离线兜底恒返回 Response.error()（死代码）
  ```
- 结论：站内路由早已从 `/admin` 迁到 `/platform`（实测 `/platform` 200），worker 的落点表没跟着迁。凡是走服务端推送且不带 `url` 的通知，点开来就是 404 标签页。这是本次唯一「功能面上真的会打开一个错误页」的缺陷，和 P1 一起构成对外断头路径。

### P17 · 全站页脚对外打印备案号与企业名
**严重度：次要（合规敏感，必须业主确认）｜谁能修：只有业主能做**
- 现象：11 个营销/法务页（`/privacy` 命中 1 次，其余逐页均 1 次）页脚固定输出 `© 2026 南宁轻创社科技有限公司 桂ICP备2026022852号`，备案号外链 `https://beian.miit.gov.cn/`。
- 证据：
  ```
  首页页脚原文：…© 2026 南宁轻创社科技有限公司 桂ICP备2026022852号
  /privacy 页脚：…逐帧审阅 桂ICP备2026022852号…
  备案号外链实测：$ curl https://beian.miit.gov.cn/ → HTTP/2 521, server: nginx, 857B, 下发第三方 cookie 1 枚（值不落原文）
    → 判定：对方站点对脚本客户端反爬/源站异常，**不可判定**，不当死链
  ```
- 结论：两件事要业主自己拍板，我不替它下结论：① 这个备案号是否真实存在且主体就是「南宁轻创社科技有限公司」（我无从核验，且 beian.miit.gov.cn 程序化查不到）；② 备案号 ≠ ICP 许可证——如果继续只提供免费内测服务，展示备案号是合规要求，**别撤**；但一旦开始收费就必须另办经营性许可，因此 P18 的口径要长期守住。

### P18 · 文案红线复核：未见任何我方付费/套餐/席位额度承诺（**通过**），但有两处需要长期守住的边缘表述
**严重度：次要｜谁能修：代码侧**
- 现象与判定：
  ```
  逐页对「可见正文 + JSON-LD」双面扫描词表（付费/收费/价格/定价/续费/订阅/套餐/激活码/订单/下单/购买/付款/退款/元每年/¥/席位/额度）：
    我方定价字样 = 0 命中（12 页 + /llms.txt 全清）
    套餐 / 激活码 / 订单 / 续费 / 退款 = 0 命中
  '订阅' 1 处（首页）：原文「还能订阅到 Google、Outlook 或 Apple 日历」→ 日历订阅，非付费订阅，判为误报
  '免费' 7 处，全部在首页，口径统一为「内测期间免费开放 / 免费加入内测 / 内测期间所有功能免费使用」→ 无付费承诺，方向安全，但「内测期间」隐含将来收费
  '席位' 出现在 comparefenzhen(可见 9 / JSON-LD 6)、comparenetdisk-wechat(3/3)、compare(1)
    原文关键句：「占席位的是你团队里被邀请进来的成员，另一条是存储空间……具体额度这一页不写数字，以你建好团队后在设置里看到的那一屏为准」
    → 只描述计费维度、不承诺额度数字，且明确把数字推给产品内设置页。判为**合规**，无需改
  '存储' 若干（featuresversions/privacy/terms 等）：均为「对象存储」「存储空间」概念性用法，无 GB 额度数字
  '永久' 3 处（featuresversions）：原文是「立即永久删除 / 自动永久删除」，删除语义，非永久留存承诺
  ```
- 结论：红线守住。两点长期注意：① 「内测期间免费开放」7 次全在首页，若日后取消内测措辞，这 7 处是唯一的批量改动点；② `SoftwareApplication` 里**没有** `offers`（P7），这正是当前合规形态，别为了富结果去加。

### P19 · `/llms.txt` 与 sitemap 不同形（首页地址带尾斜杠、少 2 个页面），且有一句超出事实的自述
**严重度：次要｜谁能修：代码侧**
- 证据：
  ```
  $ 归一化对比 llms.txt 内 URL 集 vs sitemap <loc> 集
    llms 列出 8 个可索引页 + 追加引用 /sitemap.xml、/robots.txt（后两条不该进 sitemap，属预期）
    在 sitemap 但 llms.txt 没有：https://vidx.cn/privacy、https://vidx.cn/terms
    首页写法：llms.txt = https://vidx.cn/ （带尾斜杠）
              sitemap = https://vidx.cn   （不带）
              canonical = https://vidx.cn （不带，与 sitemap 同形）
    → 只有 llms.txt 这一份用了尾斜杠形
  llms.txt 自述原文：「每个页面内联 schema.org 结构化数据」
    实测 /privacy、/terms、/login 的 <script type="application/ld+json"> 数量 = 0（三页均 0 块）
  llms.txt 与实测一致的部分（通过）：6 篇文稿共 28 条 FAQ 问句与线上 FAQPage 逐条对得上；
    「内容页文稿最后核对于 2026-10-03」= sitemap 里 6 条 docs 的 lastmod 2026-10-03T00:00:00.000Z，两边一致
  ```
- 结论：`src/app/page.tsx` 注释自己说过「两边不一致就等于给同一个页面两个地址」——`llms.txt` 是第三个漏网的面。另外那句「每个页面」改成「8 个可索引内容页」即可与事实对齐。

### P20 · 枢纽页 `<title>` 过短，且 7 个 URL 共用同一默认 title/description
**严重度：次要｜谁能修：代码侧**
- 证据（字符数为 Python `len()`，中文按字计）：
  ```
  home                     TITLE 31字 = 逐帧审阅_专业的视频审片与批注协作平台_FrameReview
                           DESC  29字
  /features                TITLE  9字 = 功能 | 逐帧审阅      DESC 34字
  /compare                 TITLE  9字 = 对比 | 逐帧审阅      DESC 38字
  6 篇文稿                 TITLE 11–23字  DESC 51–79字    ← 这六条是全站最健康的
  /privacy /terms          TITLE 11/13字  DESC 23字 = 「面向影视团队的在线审片、版本管理与素材收录平台」
  /login /studio /platform /portal /profile /onboarding   TITLE 全部 = 首页那 31 字，DESC 全部 = 同 23 字
  ```
- 结论：两个枢纽页（`/features`、`/compare` 都在 sitemap 且是导航承重点）9 字 title 信息量偏低；`/privacy`、`/terms` 用默认 description，与 5 个应用页逐字重复。6 篇文稿的 title/description 长度分布合理，不必动。`/login` 等 noindex 页复用默认串无 SEO 代价，不需改。

### P21 · 两条内容页 SSR 明显慢于其余页，且 HTML 因 `no-store` 无任何边缘缓存兜底
**严重度：次要（性能观测）｜谁能修：生产配置侧**
- 证据（同批串行、同 UA、冷取）：
  ```
  /features/versions   1.314s   178939B      /compare/fenzhen   1.286s   181732B
  / （其余 10 页均值）  ~0.24s   151–188B KB  ← 两条是其它页的 5 倍以上
  移动端取 /compare/fenzhen 同样 1.338s → 与 UA 无关，是服务端渲染耗时
  age / x-cache / cf-cache-status 全站 0 命中 → 无中间层缓存可摊薄
  ```
- 结论：这两页正是文稿最长（fenzhen 有 9 处「分秒帧」、含对照表）。`no-store` 对法务/登录面是必要的，但对 6 篇纯静态文稿没必要——它们内容只在发版时变。可考虑给内容页换 `s-maxage` + 边缘缓存，HTML 层缓存问题即消失。列为观测项，不是缺陷。

### P22 · `x-origin-server: tencent` 对外暴露基础设施供应商
**严重度：次要｜谁能修：生产配置侧**
- 证据：`via: 1.1 Caddy` 与 `x-origin-server: tencent` 在 HTML、图标、SEO 文件、`/_next` 静态资源上均出现（79 份头文件里 149 处命中，无一例外）。
- 结论：非敏感信息，不构成风险，只是没必要告诉外头源站在哪家云上。Caddy 里 `header_upstream -X-Origin-Server` 或改站点配置可去掉。顺手项。

---

## 已验通过项（含实测数字，说明覆盖面）

1. **路由矩阵**（本批 38 条，全站累计 63 条不同路径）：12 条营销/法务/CTA 全 200，正文 151,469–188,152 B，耗时 0.21–1.31 s；5 条应用面（`/studio` `/platform` `/portal` `/profile` `/onboarding`）全 200，144,051–145,537 B；6 条 SEO/图标（`/robots.txt` 301 B、`/sitemap.xml` 1,183 B、`/llms.txt` 4,493 B、`/manifest.json` 1,218 B、`/sw.js` 2,975 B、`/favicon.ico` 4,932 B、`/api/branding/favicon` 2,698 B）全 200 且 content-type 正确。
2. **应当 404/跳转的路径行为全对**：9 条未知/大写/交叉 slug 全 404（140,338–147,286 B）；大写路径 `/Features`、`/Features/Frame-Comments`、`/HOME` 均 404 而非 301（无大小写重定向环路）；尾斜杠 4 条全 `308` 且 location 精确回指无斜杠址（`/features/ → /features`、`/login/ → /login`、`/privacy/ → /privacy`、`//` → `/`）；3 个未知短码 `/ABC1234567`、`/abcdef1234`、`/aB3Cd4Ef5G` 全 404，短码查不到时不泄露任何存在性差异。
3. **域名收口方向全对**：`http://vidx.cn`→308→apex、`https://www.vidx.cn`→301→apex、`http://www.vidx.cn`→两跳到 apex（见 P11），5 条代表路径 × 3 源 = 15 条，路径与 query 100% 无损，无环路无跨域跳。
4. **HTML 层安全头满分**：`/`、`/features/versions`、`/login` 三页各 6 项全在——CSP 带 per-request nonce 且 `frame-ancestors 'none'`、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`、`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`、`Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`。
5. **CSP 不是摆设，真在生效且不破功能**：nonce 覆盖实测——首页 5/5 内联脚本带 nonce、`/features/versions` 12/12、`/login` 8/8，**裸内联脚本 0 个**；HTML 里外部 script 主机 0 个，全部走 `static.vidx.cn`（已在 `script-src` 白名单内）。`style-src` 有 `'unsafe-inline'` 但页面 `<style>` 块数为 0（走外联 CSS），不构成额外暴露。
6. **HTML 未被中间层缓存**：`vidx.cn` 全部 63 条不同路径响应中 `age`、`x-cache`、`cf-cache-status`、`x-swift` 命中数为 0（带这两个头的只有 `static.vidx.cn` CDN 上的 3 个资源），配合 `no-store`，确认每请求走真 SSR，不存在「HTML 被缓成过期内容」。
7. **`/_next/static` 缓存策略正确**：JS chunk `public, immutable, max-age=31536000`（241,253 B / 200）、CSS `public, immutable, max-age=31536000`（120,825 B / 200）。
8. **`/robots.txt`、`/sitemap.xml` 不可能被缓成过期内容**：两者均 `public, max-age=0, must-revalidate`；`/llms.txt` 为 `max-age=3600`（1 小时窗口，见 P9/P19）。
9. **`<html lang>` 17/17 全为 `zh`**，无一页缺失或错值。
10. **canonical 9/11 严格自指且与 sitemap `<loc>` 逐字符串同形**（首页两边都不带尾斜杠，形如 `https://vidx.cn`；缺的 2 条即 P2）。`og:url` 与 canonical 在 9 条上逐字 MATCH。
11. **`og:image` 逐条 curl 真能打开**：`https://vidx.cn/og/brand-1200x630.png` → 200 `image/png` 72,825 B，sharp 实测 **1200×630**，与文件名声明尺寸一致。
12. **JSON-LD 全部可解析**：12 页共 44 个 `<script type="application/ld+json">` 块，`python3` 本地解析 **0 失败、0 语法错误**。
13. **JSON-LD 类型组合符合设计**：home = `Organization`+`WebSite`；两枢纽 = 上二者 + `SoftwareApplication`+`BreadcrumbList`；6 篇文稿 = 站点级二件 + `Article`+`FAQPage`；`/privacy`、`/terms`、`/login` 为 0 块（对 noindex/法务页合理）。
14. **`Article` 必填项 6/6 完整**：`headline`（如「意见挂在第几帧，不是"大概三分钟"」）、`datePublished=2026-10-03`、`dateModified=2026-10-03` 均通过 `^\d{4}-\d{2}-\d{2}` ISO8601 校验（**0 条非法日期**）；`author.@id`、`publisher.@id`、`url`、`inLanguage=zh-CN`、`description` 齐；`url` 全部是 `https://vidx.cn/…` 绝对址，**0 条相对址**。
15. **`@id` 引用主体闭合**：`WebSite.publisher.@id`、`Article.author.@id`、`Article.publisher.@id` 三向引用 × 全站 = **0 悬空**（同页确有 `https://vidx.cn/#organization` 节点；唯 `isPartOf` 悬空，已单列 P5）。
16. **`FAQPage` 全部合格**：6 篇各 5/5/5/5/4/4 = **28 条 mainEntity**，每条都有非空 `name` 且 `acceptedAnswer.text` 非空（长度 35–162 字），**0 条缺陷项**；`/llms.txt` 里复述的 28 条问句与线上 FAQ 逐条一致。
17. **`BreadcrumbList` 连续且合法**：`/features` 与 `/compare` 各 2 项，`position` 为 1、2 **无跳号**，`item` 均为绝对址且指向实测 200 的 `/`（`逐帧审阅`）与自身 hub。
18. **死链扫描：0 死链**：8 个营销页抽出同源 `href` 去重得 13 条路径，逐条 GET —— `/`、`/features`、`/compare`、6 篇文稿、`/login`、`/privacy`、`/terms`、`/studio/projects` **13/13 全 200**，无 4xx/5xx。锚点链接单独验：首页 7 个 `#` 片段（`#review` `#versions` `#share` `#collect` `#team` `#workflow` `#platform`）**全部命中真实 id**（首页共 18 个 id），去 fragment 后路径亦 200；其余 8 页无锚点型 `<a>`。
19. **外链如实标注**：仅 2 条，均不判死链——`https://beian.miit.gov.cn/` → **521**（对方 nginx 反爬/源站异常，**不可判定**）；`https://scnqe74t5owc.feishu.cn/wiki/…` → 302 到飞书登录页（站点活着但需登录，已单列 P1）。
20. **图标链 10 个地址全通**：`/favicon.ico` 200 `image/x-icon` 4,932 B（`file` 判合法 MS ICO，含 16×16/32×32/48×48 三幅）；`/api/branding/favicon` 200 `image/svg+xml` 2,698 B；`<head>` 声明 4 条地址全 200；`/manifest.json` 4 条 `src` 全 200。
21. **manifest 声明尺寸与真实像素全部对得上**（本机 `node` + `node_modules/sharp` 只读元数据）：`/brand/logo-192.png` 声明 `192x192` → 实测 **192×192** PNG；`/brand/logo-512.png` 声明 `512x512` → 实测 **512×512** PNG；`/brand/logo-maskable-512.png` 声明 `512x512` → 实测 **512×512** PNG；`/brand/icon.svg` 声明 `any` → SVG 可缩放，判合理。9,566 / 27,992 / 23,626 B，**0 尺寸不符**。
22. **sitemap 11 条全 200、全自指或已单列、全无 noindex**：11/11 状态 200（见 P2 的 2 条缺 canonical 已单列）；11/11 的 robots meta 均为 `index, follow`，**0 条带 noindex**，即「带 noindex 的页混进 sitemap」这种情况为空。
23. **robots `Allow` 精准**：`Allow: /api/branding/favicon` 与 `Disallow: /api/` 并存，实测该图标址返 200 且带 `vary`（无 403），最长前缀匹配生效；`/login` **不在** Disallow 名单（与设计一致，它靠自身 `noindex, nofollow` 生效，实测确认）。
24. **文案红线主结论通过**：我方付费/套餐/激活码/订单/续费/退款字样 **0 命中**；`vitransfer` 在可见正文与 JSON-LD 中 **0 命中**（残留仅在 sw.js 与 payload 键名，见 P15）；`SoftwareApplication` 无 `offers`（无报价暴露）。
25. **移动端通过**：iPhone 17.5 UA + 375×667 取 `/` 与 `/compare/fenzhen`，均 200，下载字节 **188,152 B 与 181,732 B，与桌面版逐字节等长**——完整 SSR 正文而非空壳；剥标签后可见正文 2,098 / 2,670 字，`<h1>/<h2>/<article>` 各 8 个；两页均带 `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">`；`/llms.txt`、图标链在移动 UA 下无差异化退化。

---

## 附：本次扫描的请求构成

| 批次 | 条数 |
|---|---|
| 路由矩阵（营销/法务/CTA 12 + 应用/SEO/图标 12 + 应当 404/跳转 14） | 38 |
| 域名收口（3 源 × 5 路径） | 15 |
| 内链目标与外链（含 Range GET、目录探测） | 9 |
| 图标链（manifest 4 + `/icon.svg` + og + `_next` 静态 2） | 8 |
| robots-Disallow 路径补测（8）+ `/admin*`（2） | 10 |
| 移动端（2）+ 重定向跳数确认（3）+ 连通性预检（1） | 6 |
| 合计 | **~92** |
