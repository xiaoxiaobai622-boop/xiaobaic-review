# 逐帧审阅 · 营销内容页设计（一期）

日期：2026-09-20　状态：待评审，未实现

> **工作边界（本次任务的硬约束）**：本设计与后续所有改动**只停留在本地工作区**
> `/Users/xiaoxiaobai/code/xiaobaic-review`。**不 `git commit`、不 `git push`、不触发任何
> 部署工作流、不连生产服务器。** 上线是独立的、需要他明确开口的动作。
> 另外：他本人前台跑着 `next dev --hostname 127.0.0.1 --port 3000`，`npm run build` 会写
> `.next` 冲掉这个进程 —— 任何需要构建验证的步骤，先请他停服务。

## 1. 定位（已确认的口径）

- 目标：**拉自然注册的使用者**。不做销售转化，不卖部署、不卖托管。
- 语言与市场：简体中文；国内影视/短视频/政企/工作室团队都覆盖，但选题以"使用者场景"而非"采购决策"组织。
- CTA 统一指向 `/login`，卖点话术是「不用装、不用部署，手机号验证码登录就能用」。

**已作废的中间答案**（留此免得复议）：他先答"国内影视团队，卖部署或托管"，随后明确纠正为"不卖部署或托管"；"客户画像=全部"是在错误框架下给出的，因此一期不按画像切页，按**搜索意图**切页。

## 2. 非目标

- 不做英文内容页。站点语言是**全局 DB 设置**（`src/i18n/locale.ts` 的 `getConfiguredLocale`，`SUPPORTED_LOCALES = zh/en/nl/de`），一个 URL 只服务一种语言，没有 `/zh/` 前缀可言，也没有并行语言版本可做。
- 不做 CMS/后台编辑。
- 一期不做场景页、文档中心、指南（见 §9）。
- 不做付费/询价/留电话表单。

## 3. 域名迁移硬约束

新域名 ICP 备案已在办（2026-09-20），`mle6.cn` 会被替换。因此：

1. 所有绝对 URL（`metadataBase`、`canonical`、`sitemap.xml`、`og:image`、`robots.txt` 的 `Sitemap:` 行）**从单一配置派生**。
2. **禁止域名字面量兜底**。现存写法 `process.env.NEXT_PUBLIC_APP_URL || 'https://mle6.cn'`（`src/lib/deep-link.ts:32`、`src/app/api/auth/feishu/callback/route.ts:16`）在环境变量漏配时不报错、静默指向旧域名。本期新增代码采用 `getSiteUrl()`：缺失即**抛错**，让它在本地第一时间暴露，而不是在线上生成一批 canonical 指向废弃域名的页面。
   - 现存那两处**本期不动**（属于运行时链接行为，改它会牵连邮件/深链与飞书回调的验证），只登记为待办，避免一期范围膨胀。
3. 内容页路径不含域名，换域名时代码零改动。

## 4. 承载方案：选 A

| 方案 | 取舍 |
|---|---|
| **A. `content/marketing/*.md` + 动态路由（选它）** | 文案与代码分离、可 review、`generateStaticParams` 能静态枚举、sitemap/canonical 从同一份 frontmatter 派生（单一事实源）。代价是改文案要发版——单人开发本来每次改动都发版，代价≈0 |
| B. 内容进 DB + 后台编辑 | 与现有 `Settings`/`platform` 后台风格一致，但要新做鉴权、预览、富文本净化面；内容页没有"运营者"这个角色，多出来的面积无人使用 |
| C. 每页硬编码一个 `page.tsx` | 首页那种写法照搬到 8 页会把重复的 meta/CTA/FAQ 结构复制 8 遍 |

## 5. 路由与文件结构

```
content/marketing/
  compare--netdisk-wechat.md
  compare--fenzhen.md
  compare--frame-io.md
  features--frame-comments.md
  features--versions.md
  features--share-link.md
  index--features.md
  index--compare.md
src/lib/marketing/content.ts      # 读文件、解析 frontmatter、类型校验、slug 白名单
src/lib/marketing/site-url.ts     # getSiteUrl()，缺失抛错
src/app/(marketing)/layout.tsx    # 对外页头/页脚 + footer 全内链
src/app/(marketing)/page.tsx      # 现首页迁入（见下注）
src/app/(marketing)/[group]/page.tsx        # /features /compare 枢纽页
src/app/(marketing)/[group]/[slug]/page.tsx # 内容页（本期不静态化，见下）
src/app/robots.ts                 # 由静态 public/robots.txt 改为 route handler（见 §8）
src/app/sitemap.ts                # 只枚举 (marketing) 组 + /privacy + /terms
```

**首页迁入的确切范围**：`src/app/page.tsx`、`src/app/home-client.tsx`、`src/app/home.module.css` 三个文件移进 `(marketing)`，`src/app/layout.tsx` 留在根上不动。要注意 `(marketing)` 会继承根 layout 的全部 Provider（`NextIntlClientProvider`、`StorageConfigProvider`、`AppDialogProvider`、`AccentColorProvider`、`ServiceWorkerProvider`、`GlobalActivityTracker`）——实现时逐个确认它们在**无会话**访问下不发请求、不报错；对外页脚本来就不该有埋点报错。

**`force-dynamic` 本期不动（2026-09-20 他选 B）**：`src/app/layout.tsx:14` 的 `export const dynamic = 'force-dynamic'` 保留在根 layout，内容页因此仍是每次请求现场渲染，拿不到静态化的 TTFB 收益。换来的是**零回归风险**——不需要把这句禁令往应用路由组里搬，也就不会误让 `/studio`、`/share/xxx` 这类带鉴权页面进入可缓存状态（那属于权限泄漏面，不只是显示问题）。

由此带来的两条实现约束：
1. **不发 `generateStaticParams`**。内容页在 `force-dynamic` 下静态参数不生效，未知 slug 由 loader 直接 `notFound()` 拦掉，404 行为照样可测。
2. **loader 必须自带进程内缓存**。markdown 文件在模块加载时读一次、解析一次并缓存，不能每次请求重读重解析——现在每个页面请求已经要为根 layout 里那次 favicon 查询走一遍数据库，没理由再加一层文件 IO。

静态化留作**二期一次独立、可单独回滚的改动**（下移到 `(app)` 组），且要等一期确认选题有效才值得动。

**两个待实现时核实的技术点**（不是待定需求，是要动手验的）：
- `src/proxy.ts` 给所有非静态路径下发 nonce CSP。JSON-LD 的 `<script type="application/ld+json">` 属内联脚本，需要带 nonce，否则会被 CSP 拦掉——实现时先确认 `script-src` 的构成。
- MDX/Markdown 渲染若要插图片，统一走 `next/image` 或 `/og` 生成路由，不接受正文里写死绝对图片地址（同上域名约束）。

## 6. 一期页面清单与大纲

每页固定骨架：**H1 → 3 段以内导语 → 分节正文（H2 数 ≤6）→ 一条 CTA → FAQ（3–5 问，同时出 JSON-LD `FAQPage`）→ 内链到同组另两页 + 首页**。正文目标 900–1400 字，不写空话段落；每页一个 `canonical`、一个 `title`、一个 `description`，由 frontmatter 提供。

### `/compare/netdisk-wechat` — 别再用网盘和微信审片了
- 吃这些搜索意图：视频太大 微信传不了 / 网盘链接 已过期、被和谐 / 客户反馈 对不上时间点 / 片子 最终版7 到底哪版
- H1：`用网盘和微信审片，卡在哪三个地方`
- 章节：① 链接会过期、文件会被限，客户看不到 ② 意见是"3分20秒那里有点问题"，你要回看半小时才知道哪儿 ③ 版本靠文件名，谁都不知道哪一版算定稿 ④ 一条带密码和有效期的链接能替掉这一整套 ⑤ 客户什么都不用装：打开就是播放器 ⑥ 常见顾虑（素材放哪、谁能看见、不想要了怎么撤）
- CTA：`用手机号验证码登录，建一个项目传一条片子试`
- 内链：`/features/share-link`、`/features/frame-comments`
- **本页预期转化最高**，因为读者的现状就是它。

### `/compare/frame-io` — Frame.io 的中文可用替代
- 意图：frame.io 中文 / frame.io 替代 / frame.io 价格 / 国内访问 frame.io
- H1：`Frame.io 在国内用起来别扭的地方`
- 章节：① 访问与上传带宽 ② 登录方式（微信/手机号验证码，不需要邮箱密码那套）③ 界面、批注与邮件提醒全中文 ④ 批注落点：逐帧而不是时间轴大概位置 ⑤ **什么时候仍该选 Frame.io**（AE/Premiere 生态回挂、海外团队协作、企业已有 Adobe 合同）⑥ 数据放在哪、能不能自持
- 第 ⑤ 节是硬性要求：不写"对方哪里不行"的对比页不可信。
- 待他提供：Frame.io 现价页链接（见 §10 阻塞项）

### `/compare/fenzhen` — 与分秒帧的差异
- 意图：分秒帧 替代 / 分秒帧 收费 / 分秒帧 价格 / 分秒帧 私有化
- H1：`逐帧审阅与分秒帧：数据归属与席位口径的差别`（原为「三处实质差异」——2026-09-20 事实核查后改：能同时拿到双方证据的实质差异只有两处，见 §13）
- 章节：① 计费模型（按席位/按空间 vs 不限，写清"我这边免费公测"的口径与边界）② 数据归属：AGPL-3.0 开源、可自持 ③ 功能对照表（逐帧批注 / 画笔 / 版本记录 / 客户门户 / 大文件断点续传 / 微信小程序登录）④ **什么时候选分秒帧**（要成品模板、要生态与素材库、不想自己管任何事）⑤ 从分秒帧迁过来要动哪些东西
- 阻塞：对照表两列都必须以对方公开页面为准，每页脚注「信息核实于 <日期>」。

### `/features/frame-comments` — 逐帧批注
- 意图：视频 时间点 评论 / 逐帧 批注 / 视频 画笔 标注 / 客户 意见 定位
- 章节：① 意见挂在**第几帧**，不是"大概 3 分多" ② 画笔圈画与文字意见合并成一条（`controls.showDrawingTools`、`strokeThickness`、`opacity`）③ 回复串、解决状态、驳回 ④ 客户不注册也能留意见（`share/[teamSlug]`）⑤ 意见**邮件汇总与留档**（事实核查：全仓无 CSV/Excel/PDF 导出，只有按项目节奏投递的汇总邮件；素材 ZIP 打包不含意见，不得暗示）⑥ 移动端看片批注

### `/features/versions` — 版本与定稿记录
- 意图：视频 版本管理 / 定稿 确认 记录 / 修改意见 对应版本 / 多版本 对比
- 章节：① 每次上传自动成版本，版本号与上传者时间 ② 意见挂在具体版本上，新版本的意见不会串台 ③ **通过与定稿留痕**（`VideoReviewStatus` 只有 `PENDING_REVIEW/IN_REVIEW/FEEDBACK_COMPLETE/APPROVED`，**没有 reject/驳回**；撤销叫「取消通过」`unapprove`）④ 旧版本与回收站不静默删除（`RecycleBinItem`）⑤ "只允许下载已批准版本"这类约束（`restrictedToLatest`）

### `/features/share-link` — 带密码和有效期的审片链接
- 意图：视频 加密 链接 发给客户 / 带密码 审片链接 / 分享 有效期 / 审片 链接 到期
- 章节：① 链接 + 密码 + 有效期 + 一次性验证码（`passwordPrompt`、`otpPrompt`，`shareOtpEmail` 模板已有）② 谁打开过有记录（`analytics` 的 `link/guest/password/otp` 维度、`SecurityEvent`）③ 客户能顺着同一条链接把修改后的原片回传（`clientUploadTitle`、`/studio/projects/[id]/share`）④ 微信内打开与手机体验 ⑤ 撤回与失效

### 枢纽页 `/features`、`/compare`
各 3 张卡片 + 一段定位说明，不做正文。存在意义是把三页互链成簇、给首页让出一条导航入口。

## 7. 首页与导航改写（一期必做，不然内容页是孤儿）

- 现在首页只有 3 个 capability 卡片，没有任何异议处理。改为：一句定位（中文，"逐帧审阅"）→ 三个崩点（对应 `/compare/netdisk-wechat`）→ 功能三条 → 一段"不用装不用部署，手机号验证码登录" → 页脚把 `/features`、`/compare`、`/privacy`、`/terms` 全列上。
- `<title>` 用 `title.template`：`%s | 逐帧审阅`，根 metadata 补 `metadataBase`、`openGraph`、`twitter`、`robots: { index: true }`。品牌口径默认**「逐帧审阅」为中文主名，`FrameReview` 作英文括注**（站内现存 4 套名字，他换域名时是唯一的收敛窗口）。
- **落地体验要与话术对齐**：`src/app/onboarding/page.tsx` 的默认去向是 `/studio/team?welcome=1`，即自注册的人第一步是**建团队**，不是马上看片。所以 CTA 不能写"30 秒开始审片"，写"登录后按引导建一个团队"或把这段引导文案与之一致。这点是读代码得到的，不是猜的。

## 8. 抓取与索引配套（一次做完，属一期）

- `src/app/sitemap.ts`：枚举 `(marketing)` 全量 + `/`、`/privacy`、`/terms`；绝对 URL 走 `getSiteUrl()`。
- `src/app/robots.ts`：`Sitemap:` 那行必须是绝对 URL，静态 `public/robots.txt` 做不到，所以**改成 route handler 并删掉 `public/robots.txt`**（Next 官方文档未定义两者同名共存时的优先级，实现时要 `curl http://127.0.0.1:3000/robots.txt` 确认输出确实带新的 Disallow 与 `Sitemap:` 行，不能靠猜）。内容：`Allow: /` + `Disallow:` 掉 `/studio/ /platform/ /portal/ /profile/ /device/ /onboarding/ /login /forgot-password /reset-password /wechat-mini-login /unsubscribe /api/ /share/`，加 `Sitemap: ${getSiteUrl()}/sitemap.xml`。现状是只 Disallow 了 `/admin/`（**该路由不存在**）和 `/api/`。
  - `/share/` 要不要 Disallow 是一项产品决定：里面是客户片子，默认 **Disallow + noindex**；若他想让被审团队能搜到落地页，再单独放开。
- 全站 `X-Robots-Tag` 复查：`src/proxy.ts` 目前没下发 noindex（已确认），登录后页面主要靠 robots + 不进 sitemap 控制，双保险给 `/studio` 等加 `robots: noindex`。
- JSON-LD：内容页出 `FAQPage`，枢纽页出 `SoftwareApplication` + `BreadcrumbList`。

## 9. 二期候选（明确先不做）

场景页 3 个（影视后期 / 短视频 MCN / 政企内网"数据不出内网"）、`/docs/*`（把 `docs/wiki/` 那 15 篇英文文档改写 6 篇：安装、配置要点、故障排查、客户使用指南、术语、安全）、`/guide/review-workflow`（审片流程 SOP）、`/about`（现在导航有"关于 / GitHub 源码 / Docker Hub"三个文案键，但**没有 `/about` 路由**，公开可达页只有 11 个）、`/compare/yueliu`、照片相册页。
触发条件：一期发布满一个月、看到实际收录与注册来源之后，再挑。

## 10. 需要他给的输入（一期上线的阻塞项）

1. 分秒帧与 Frame.io 的**现价页/功能页链接**，或由我抓一次并在页面注明抓取日期。对比页我不编对方数据。
2. 品牌确认：默认按中文主名「逐帧审阅」+ 英文括注 `FrameReview` 写（与现有 `<title>` 一致）。这是一处**单一常量**，他日后改口只动一个值，不阻塞开工。
3. 新域名（或至少"等备案下来再说"）——决定内容页何时**发布**，不决定何时**写**。
4. `/share/` 是否允许被索引（§8）。默认 Disallow。
5. ~~免费公测还是邀请制~~ **已降级为非阻塞**：所有 CTA 只写已核实的机制——手机号验证码登录即建号（`src/app/api/auth/sms/verify-code/route.ts:69`，无注册开关、无白名单），这句话在公测或邀请制下都成立。**只有当某页要提"免费/价格"时才需要他给口径**，一期正文里不出现价格段即可。

## 11. 本地验证方式（不部署）

1. 用他已在跑的 dev 进程：`curl -s -A "Mozilla/5.0 (compatible; Baiduspider/2.0)" http://127.0.0.1:3000/compare/netdisk-wechat`，断言 `<title>`/`description`/`canonical`/OG/JSON-LD/正文文字**都在首屏 HTML 里**，不依赖 JS——首页那类 `'use client'` 写法能 SSR 出文字，但内容页一律用 Server Component 直出。
2. `/sitemap.xml`、`/robots.txt` 同法拉一遍，检查绝对 URL 是否随 `NEXT_PUBLIC_APP_URL` 变化（改 env 重启一次即可验，不用真换域名）。
3. slug 未命中要 404（由 loader 的 `notFound()` 保证，见 §5），不能空渲染成白页——空页被收录会直接构成薄内容。
4. 新增路由组的旁证检查：本期不动 `force-dynamic`，所以只需抽查 `(marketing)` 组插入后原行为未变——`/studio`、`/share/<teamSlug>`、`/login` 三处 branding 与语言切换仍即时生效，且 `/` 迁入后首页无渲染差异（对比迁入前后同一爬虫 UA 的 HTML）。
5. Lighthouse SEO 项只作参考，真正门槛是第 1 条那个爬虫 UA 的 HTML。

## 12. 成功标准与风险（不粉饰）

- 一期成功的可验证标志**不是排名**：① 8 个页面在 Google/百度都查得到（`site:` 或站长平台收录数）；② 微信里发对比链接有卡片和配图；③ 注册来源里能看到内容页的直接进入。
- **这些词的搜索量很小。**「审片」不是「网盘」，中文这块是千位级别月搜索量的游戏。真正带人的是精准长尾与对比页在微信/群里的转发，不是大词。别按"SEO 起量"排任何时间表。
- 维护风险：一期铺 8 页而不是 19 页，就是为了避免"写完了没人改"。对比页带核实日期脚注，过期一眼可见。
- 品牌风险：仓库是 ViTransfer 的 fork（上游 MansiVisuals，有自己的 vitransfer.com 与 /docs）。**任何带 `vitransfer` 字样的内容页，搜索红利都归上游**，一期一个都不写。
- 合规：AGPL-3.0 下重命名分发需保留许可证与源码可获得性；`/about`（二期）里把上游与许可证写清，既是合规也是可信度。

## 13. 事实核查对 §6 的修正（2026-09-20，写稿前必读）

两份事实报告（`.sdd/facts-product.md` 22 条带 `file:line`、`.sdd/facts-competitors.md` 带 URL 与核实日期）推翻了 §6 里的几处假设。§6 的文字保留原样作为历史，以本节为准：

1. **「不限席位」是假的。** `src/lib/platform-access.ts:8-20` 的 `TRIAL_QUOTA = { maxMembers: 2, maxStorageGB: 1 }`、`MONTHLY_QUOTA = { maxMembers: 10, maxStorageGB: 50 }` 在 `invitations/[token]/accept/route.ts:45`、`join-requests/[requestId]/route.ts:44`、`videos/route.ts:71` 真实拦截。首个团队建号即 TRIAL、`subscriptionExpiresAt` 为 3 天。**能写的只有**：客户方看片/写意见的人数不占席位（`ShareLink` 访客不是 `TeamMember`）；团队席位按套餐计。§6 里「写清我这边免费公测的口径与边界」按此改写，"无限"这个词整站不许出现。
2. **「驳回」不存在。** `VideoReviewStatus` 无 `REJECTED`，只有 `APPROVED` 与撤销（`unapprove`）。→ `/features/versions` 的 H2 从「通过与驳回」改为「通过与定稿留痕」。
3. **意见没有任何文件导出。** 只有 `src/worker/client-notifications.ts` 按 IMMEDIATE/HOURLY/DAILY/WEEKLY 投递的汇总邮件。→ `/features/frame-comments` 的 H2 从「导出与留档」改为「邮件汇总与留档」。
4. **逐帧批注不是我们的独占能力。** 分秒帧官方页自述"精确到帧"、Frame.io 价格页自述 "Frame-accurate & range-based comments"。→ `/compare/frame-io` 的「批注落点」一节与 `/compare/fenzhen` 的「功能对照」表**不得把逐帧当成差异点**，只能作为共同前提。
5. **Frame.io 有简体中文站。** → 「中文界面与中文通知」一节不得写"对方没有中文"；有证据的是登录方式（无微信、无手机号验证码）与价格结构（按人按月、美元、含税、Free 档 2GB/2 项目）。
6. **分秒帧的标价数字拿不到**（`/pricing` 与首页是 JS 渲染，重试 403）。→ 「计费模型」只能引 `https://mediatrack.cn/strategy` 原句「每年收费 ______ 元，开放 ______ 个席位，______ 空间，项目数不限」来立"按年 + 按席位 + 按存储"这个模型，一个数字都不许编。
7. **OTP 是项目级邮箱验证码**（`src/lib/otp.ts:190-214`），不是每条链接的选项；建链对话框只有密码/免密二选一（`CreateShareDialog.tsx:79`）。也不许说成"短信验证码"（短信是另一套未默认开启的阿里云 `phone-auth.ts`）。
8. **微信小程序登录是 PARTIAL**：代码齐、挂在 `/login` 与 `/profile`（管理端），`WECHAT_MINI_APP_ID/SECRET` 在 `.env.example:64-65` 全为注释 → 不得写成客户看片入口，也不得写成当前一定可用。
9. **存储只有本地磁盘 + 任意 S3 协议**（无 OSS/COS 原生驱动）；腾讯云 MPS/CDN 是可开的转码/加速通道。→ §6「素材放在你自己的存储里——本地磁盘或你配置的 S3/OSS 桶」里的 **OSS 二字删掉**，改成"你配置的 S3 兼容桶"。
10. **旧版本"不静默消失"要加边界**：回收站 7 天后会自动清理，不是永久保留。
