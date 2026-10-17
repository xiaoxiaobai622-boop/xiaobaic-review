# 全面检查台账 · 2026-10-17（代码检查 + 功能检查 + 真人点击）

对象：`~/code/xiaobaic-review` @ `327d6c7`（= 今天 09:25 部署上线的那版，工作树与提交态零差异）。
方法：五路并行 —— ① 仓库自带静态判据全量（提交态副本 + 工作树各一遍）② 生产站只读巡检（~92 条 GET）③ 近两周 73 个提交分三域评审（计费与权限 / 用户面 / 服务端与数据）④ 依赖漏洞离线复算 ⑤ 无头 Chrome 真人点击（生产公开面 + 本地 dev 访客侧）+ 生产 Caddy 访问日志取证。
原始报告：`./2026-10-17-full-check/`（五份，共 1384 行）。本文件是**合并去重后的可点单清单**。

标记：**[已复核]** = 我今天自己跑过命令、贴得出原文证据；**[代理报告]** = 评审代理给的行号，我未逐行重读，点单后需先复核再动手。

---

## 一、安全与合规（先看这一组）

| # | 问题 | 证据 | 谁能修 |
|---|---|---|---|
| 1 | **「内部可见」批注会泄漏给分享链接持有者**：`verifyProjectAccess` 对分享链接那条分支无条件回 `isAuthenticated: true`，而读侧过滤器是 `isAdmin \|\| isAuthenticated ? allComments : 过滤 INTERNAL` ⇒ 过滤器是死代码，`replies` 还整段不过滤 | [已复核] `src/lib/project-access.ts:307-313`、`src/app/api/comments/route.ts:146-149` 原文已读 | 代码侧 |
| 2 | **`returnUrl` 开放重定向**：谓词 `startsWith('/') && !startsWith('//')` 放行 `/\evil.com`，`new URL('/\\evil.com','https://vidx.cn')` 实测解析为 `https://evil.com/`；三处同一谓词 | [已复核] node 实测 + `src/proxy.ts:13`、`src/app/login/page.tsx:107`、`src/lib/wechat-auth.ts:21` | 代码侧 |
| 3 | **收款/转账配置面整条还在产物与线上**（合规红线：无 ICP 许可证）：`/platform/settings` 挂 `TransferSettingsSection`、`/api/settings/transfer(+/qr)`、`getTransferConfig`；10-04 那次搬走的是订单那一半，收款这一半没动 | [已复核] `git grep 327d6c7` 命中 8 处；线上 `GET /api/settings/transfer` 回 **401**（说明路由存在且只受鉴权保护） | **需业主决策**（内测期是否允许存在"能收钱的位置"） |
| 4 | **付费字样进了生产 HTML**：根 layout 把整棵 zh 字典序列化进每一页，含「收款信息／客户下单后…／现在无法下单／续费后可继续使用」；`GET /api/settings/language/messages` 还**匿名公开**回整棵树 | [已复核] `curl https://vidx.cn/` 里「收款信息」命中 2 次、「续费后可继续使用」1 次；messages 接口匿名 200 / 119081 B | 代码侧（可见性判断：这些是内部键值不是渲染文案，但对外可 grep 到） |
| 5 | **唯一那条"计费面不许进构建"的判据没进 CI**，且它的 `REF_PATTERNS` 不含 `@/disabled-billing/` ⇒ 明天一行 import 破口，判据仍然绿 | [代理报告] `check-billing-out-of-build.mts` 不在 `package.json:13` 的 `check:static` 链里；CI grep billing 零命中 | 代码侧 + CI |
| 6 | **短信验证码不绑用途**：一枚门户/换绑码可在四条流程间流用；**合并账号只要一枚 OTP 就把目标账号连团队 OWNER 一起吞并并硬删**，无二次确认、无审计 | [代理报告] `src/lib/phone-auth.ts:6-8`、`api/auth/merge-accounts:51-113` | 代码侧（高危，建议优先复核） |
| 7 | **登录只按账号哈希限流、没有 IP 维度** ⇒ 可无限速撞库；反向也可把平台管理员邮箱永久锁死（DoS 掉自己的门） | [代理报告] `src/app/api/auth/login/route.ts:43` | 代码侧 |
| 8 | **安全设置 PATCH 会把未提交的字段按硬编码默认整行覆盖**：改一项顺手关掉「查看安全事件」、复位限流阈值，并可能误触发 `invalidateAllShareSessions()` 踢掉全体外链观众 | [代理报告] `src/app/api/settings/security/route.ts:273-288` | 代码侧 |
| 9 | **永久删除先删对象存储、后删库行**：事务失败留下"回收站显示可恢复、字节已不可逆"的空壳版本 | [代理报告] `src/lib/recycle-bin.ts:50-71` | 代码侧 |
| 10 | **Redis 抖一次后 app 侧客户端永久死亡**（限流 fail-closed ⇒ 登录与播放一起挂，不自愈）；worker 两处 `await` 无 `.catch` ⇒ unhandled rejection 杀进程，还会让下次部署的 `worker_restarts=0` 判据失败触发回滚 | [代理报告] `src/lib/redis.ts:39-46`、`src/worker/index.ts:224,241-244` | 代码侧 |
| 11 | **`ENCRYPTION_KEY` 仍有兜底常量**（worker 侧 compose 少 `:?`）；**微信会话 30 天 JWT 完全绕过 `revokeAllUserTokens`/改密/降权**，`secure` 还按反代后的 http 判 | [代理报告] `src/lib/encryption.ts:54`、`src/lib/wechat-auth.ts:25-46` | 代码侧 |
| 12 | **CI 把带 `packages:write` 的 GITHUB_TOKEN 落进 `/tmp` 下 0755 目录数十分钟**；生产 IP 与 root SSH 目标写死在公开 workflow 里 | [代理报告] | CI 侧 |
| 13 | IP 取自客户端可伪造的 `cf-ray`/`cf-connecting-ip`，且排在真实 `x-real-ip` 之前 ⇒ 限流键/审计 IP/封禁可被牵着走 | [已复核] `src/lib/utils.ts:143-155` 原文（注释自己承认前提）；**但生产主机 `ss -lntp` 没有 3000/4321 监听 ⇒ 外网走不到源站**，按纵深防御定级，不按可真实利用定级 | 代码侧 |
| 14 | **推送通知点开后是 404**：`public/sw.js` 的落点表还停在迁移前的 `/admin`、`/admin/projects/<id>`、`/admin/security`，本仓库无 `admin` 路由；只有 3 个发送点带 `data.url`，其余类型必落默认值 | [已复核] `grep public/sw.js` 命中 `:57,68,73,76,85`；线上 `GET /admin` → **404** | 代码侧 |

---

## 二、功能与正确性（用户点得到的）

| # | 问题 | 证据 | 谁能修 |
|---|---|---|---|
| 15 | **首页在 ≤960px 下整条导航消失，且没有汉堡替代** —— 手机上看不到「功能/怎么选/资源」任何一项，只剩登录与 CTA（营销页自己的 header 不受影响，两处实现不一致） | [已复核] `@media (max-width:960px){.home_headerNav,.home_promoBar{display:none}}`；375px 仿真下 `nav` computed `display:none`、header 内只剩 3 个可见控件 | 代码侧 |
| 16 | 语言按浏览器自动选中后**既不 dispatch 也不写 localStorage**，而消费方只认这两条 ⇒ 下拉显示 Nederlands、正文仍中文，要手动再选一次 | [代理报告] `LanguageToggle.tsx:41-61` vs `ShareLocaleProvider.tsx:33-48` | 代码侧 |
| 17 | 建团队按钮无 in-flight 禁用，`Team.name` 不唯一、POST 无幂等 ⇒ 连点两下建出两个同名团队 | [代理报告] `TeamSwitcher.tsx:103-120,274-283` | 代码侧 |
| 18 | **404 页一个链接都没有**（无「返回首页」），客户拿到失效短链只能按浏览器后退 | [已复核] 浏览器实测 `/zzz9` → `a[href]` 数量 0，正文只有「链接不存在 / 请联系分享链接给你的人」 | 代码侧 |
| 19 | `/privacy`、`/terms` 在 sitemap 里但**没有 canonical**（其余 9 条都有） | [已复核] curl 两页 grep 无 `<link rel="canonical">`，`/features` 有 | 代码侧 |
| 20 | 六篇 `Article.isPartOf` 指向 `<site>/compare#hub`，而 `/compare` 上只声明了 `#organization`/`#website`/`#logo` ⇒ 跨页引用不闭合 | [已复核] 两页 JSON-LD 的 `@id` 清单实测对不上 | 代码侧 |
| 21 | **全站唯一的「帮助文档 / 联系我们」指向私有飞书 wiki，匿名 302 进飞书登录页** | [已复核] curl 该 wiki → `302 → accounts.feishu.cn/.../login` | **只有业主能做**（改飞书可见范围，或换成公开页/邮箱） |
| 22 | 被 robots 显式放行的图标接口**零安全头**（CSP/HSTS/nosniff 全无）且回 SVG；同时 CSP 的 `frame-src` 还预留着 ko-fi、`script-src` 预留 cloudflareinsights/cloudfront，全站 0 引用 | [已复核] `curl -I` 图标接口命中 0 条安全头；首页 CSP 原文含这三家 | 代码侧 |
| 23 | 内容不可变的 `/favicon.ico`、`/og/brand-1200x630.png` 用 `max-age=0`；`/llms.txt` 反而是全站唯一带 TTL 的 SEO 文件 | [已复核] 四条 `cache-control` 实测原文 | 代码侧 |
| 24 | robots 与应用页 meta 互相抵消：`/studio`、`/platform`、`/device`、`/forgot-password`、`/reset-password` 被 Disallow 却仍声明 `index, follow`；其中 `/forgot-password` 被 `/login`（可抓）外链 ⇒ 正是 `robots.ts` 注释里为 `/login` 论证过要避开的那个坑 | [已复核] 五页 meta 实测 + `robots.txt` Disallow 清单 | 代码侧 |
| 25 | 所有 404 同时输出 `noindex, follow` 与 `noindex` 两条矛盾 meta | [已复核] `/zzz9` 实测两条 | 代码侧 |
| 26 | `/llms.txt` 首页那条带尾斜杠（与 canonical 不同形）、少收 2 个页面，且里面「每个页面都有 schema」这句不属实 | [代理报告] | 代码侧 |
| 27 | **营销文稿写死我方额度/时限**：`单个文件默认 1 GB`、`回收站留 7 天`、`10~500`、`5 层` —— 同页另一句又写「具体额度这一页不写数字」，自相矛盾；平台设置一改就变假承诺 | [已复核] `git grep 327d6c7 -- content/marketing/` 命中 `compare--fenzhen.md:64`、`compare--frame-io.md:25`、`compare--netdisk-wechat.md:61` | 代码侧（删数字） |
| 28 | 首页 5 处「免费加入内测 / 内测期间免费开放 / 所有功能免费使用」—— 与项目既定红线「营销这条线不写我方价格与额度承诺（含『免费内测』）」冲突；但代码注释写着这是有意决定 | [已复核] `home-client.tsx:16,368,421,425,687` + 线上首页渲染实测 | **需业主定一句** |
| 29 | 首页「素材收录」板块标题/alt/图注说「不注册也能传」，同板块的代码注释说要先登录 | [代理报告] `home-client.tsx:61-64`；**涉 `src/app/api/share/**` 禁区** | 需业主确认后只改文案 |
| 30 | 站内路由用裸 `<a>` 导致整页刷新丢状态：`home-client.tsx:369,485,585`、`profile/page.tsx:500`、`ReviewLoginActions.tsx:420`（最后这处是 `npm run lint` 唯一那条真红） | [已复核] lint 提交态与工作树都红同一条；其余行号 [代理报告] | 代码侧 |
| 31 | 可达性一组：登录弹窗无焦点陷阱（同仓 `ProjectOverlay.tsx:28-30` 自己立过四条约定）、头像菜单点空白与按 Esc 都关不掉、`role="tablist"` 缺 `role=tab`/`aria-selected`、重置页两枚眼睛按钮无可访问名且 `tabIndex=-1`、头像上传无可访问名且 28px | [代理报告] | 代码侧 |
| 32 | 登录密码框 `autoComplete="new-password"` ⇒ 挡住正常自动填充（这是注册语义） | [代理报告] `ReviewLoginActions`/login 表单 | 代码侧 |
| 33 | 重置密码页/忘记密码页硬编码中文，而 `profile.passwordRuleUnmet` 等 key 四语已存在 ⇒ 同一事实两份口径 | [代理报告] | 代码侧 |
| 34 | 成功态 `setTimeout` 无清理 ⇒ 用户后退之后仍被强推回 `/login` | [代理报告] | 代码侧 |
| 35 | 个人中心 300ms 永久轮询 + 每轮强制布局读取 | [代理报告] `profile/page.tsx` | 代码侧 |
| 36 | 项目设置内容挂两遍 ⇒ `RecipientManager` 双份请求 + 窄屏展开后 DOM id 重复 | [代理报告] `ProjectSettingsPanel.tsx` | 代码侧 |
| 37 | 「长期有效/已停用」这类状态文案在 7 个文件各抄一份 | [代理报告] | 代码侧 |
| 38 | 用 `window.confirm` 做危险确认 ⇒ 在飞书/微信内置浏览器里被静默吞掉（点了没反应） | [代理报告] | 代码侧 |
| 39 | 移动端触控目标普遍偏小：内容页可见交互元素 **10/10 全部小于 44×44**；首页 header 的「登录」实测 27×20 | [已复核] 375px 仿真下量 rect | 代码侧 |
| 40 | 访客侧分享页在本地 dev 复现不了：两条不同短码（REVIEW 与 COLLECT）都停在「正在加载…」，路由 chunk 已加载（水合完成）但**零数据请求** | [已复核] CDP 实测；**判为 dev 环境而非产品缺陷**：该进程已连续跑 22 小时，且 `node_modules` 与锁不一致（见 #52）——重启 dev 后必须复测，我不拿它当线上结论 | 需业主复测 |

---

## 三、门禁与工程（这些决定"下次还会不会漏"）

| # | 问题 | 证据 | 谁能修 |
|---|---|---|---|
| 41 | `npm run lint` 没进 CI，且 Next 16.3.8 的 `build` 已不再跑 ESLint ⇒ 唯一那条真红（#30）拦不住任何上线 | [代理报告] `.github/workflows/` 无 lint 步骤 | CI |
| 42 | **29 支判据脚本里 20 支是孤儿**（无聚合器/hook/CI 引用），含那支 787 行的首页判据 ⇒ 写完就没人再跑 | [代理报告] | 代码侧 + CI |
| 43 | `check:static` 用 `&&` 串 9 支 ⇒ 第一支红则后 8 支根本不跑（今天就是这样掩盖过一次） | [代理报告] `package.json:13` | 代码侧 |
| 44 | "门禁的门禁"只钉 9 枚里的 7 枚；`check-team-numeric-id` 在 CI 只跑 `--static` 子集，C 组与全库扫描永不自动跑 | [代理报告] | 代码侧 |
| 45 | `seo-check.mjs`（207 断言）也是孤儿，且此前从未对生产跑过 —— 我今天跑了，线上 4 条红已修并复跑绿 | [已复核] 本次实测 | 代码侧 |
| 46 | `prisma validate` / `migrate status` 全仓零命中 ⇒ schema 漂移没有闸口 | [代理报告] | 代码侧 + CI |
| 47 | `src/worker` 被 tsconfig 排除 ⇒ tsc 与 build 双盲（今天去排除后实测 0 错，属潜在盲区） | [代理报告] | 代码侧 |
| 48 | **生产镜像带着 416 个 dev 包**（`npm ci` 不 `--omit=dev`、Dockerfile 无 `npm prune`），而 CI 只审 `--omit=dev` ⇒ 镜像里那枚 `braces@3.0.3`（HIGH，CVE-2026-93687，**上游无修复版本**）今天没有任何一道审计看得见它 | [代理报告] `Dockerfile:27-41` + 三条独立审计通路复算 | 代码侧（改 Dockerfile） |
| 49 | 镜像内那道全树审计被 `SKIP_NPM_AUDIT=true` 显式关掉；唯一会跑全树审计的编排文件触发条件是 `push: branches:[dev]`，**而 origin 上没有 dev 分支** | [代理报告] | CI |
| 50 | 生产闭包 0 漏洞这件事**完全靠 `package.json` 里 8 条手写 `overrides` 撑着**（`deepmerge-ts: 8.0.1` 是保命的那条：`html-to-text` 声明的 `^7.1.5` 永远够不到 8.x）；而 overrides 不进 lock，没有任何判据能证明它还在生效；`glob: 11.1.0` 已是死配置（锁里没有 glob） | [代理报告] | 代码侧 |
| 51 | 4 个 workflow 永不触发（无 dev 分支、0 个 tag）；`post-commit`/`post-checkout` 是 10 字节空壳 ⇒ 本地零拦截 | [代理报告] | CI |
| 52 | **本机 `node_modules` 与锁不一致**：sharp 实装 0.35.4（锁 0.35.5）、`@img/sharp-libvips-darwin-arm64` 1.3.3（vips 8.18.6/rsvg 2.62.91，正落在 `GHSA-wq5f-xc86-pv6w` HIGH 区间）；CI/Docker 走 `npm ci` 拿的是干净的 0.35.5 ⇒ 任何基于 `node_modules` 的扫描都会报出生产不存在的假阳性，而**开发机自己确实在受影响版本上** | [代理报告] | **只有业主能做**（重启 dev + 按锁重装） |
| 53 | eslint 会扫别的会话在 `.superpowers/` 里的 65 个草稿 ⇒ 规范门禁跨会话不可复现 | [代理报告] | 代码侧（ignore 配置） |
| 54 | `package.json` 的 `name` 仍是 `vitransfer`，每条门禁横幅都打旧品牌名；`sw.js:1` 缓存名同样残留 | [代理报告] + [已复核] 线上 HTML 里 `vitransfer` 仅 i18n 键名与 sw 缓存名 | 代码侧 |

---

## 四、性能与暴露面

| # | 问题 | 证据 | 谁能修 |
|---|---|---|---|
| 55 | **首页 HTML 190,826 字节里 137,470 字节（72%）是整棵字典的 RSC 载荷**，付费字样就在这一坨里（见 #4） | [已复核] 逐 script 块字节实测 | 代码侧（按需裁剪字典） |
| 56 | 落地页一次触发 **25 条 `_rsc` 预取**（41 KB）——量不大但请求数在移动网络上是实打实的往返 | [已复核] 浏览器实测 | 代码侧（`prefetch={false}`） |
| 57 | 首屏资源偏重且源站慢：`hero.mp4` 1,202,719 B / 2.60s、`_next/image` 两张产品图各 1.2–1.8s、`/compare/fenzhen` 与 `/features/versions` SSR 1.1–1.3s，HTML 无边缘缓存兜底 | [已复核] 生产日志 `.duration` 数值排序 + curl 计时 | 代码侧 + 生产配置侧（CDN 缓存 HTML 或预热） |
| 58 | `srcset` 向 1400px 宽的源图要 `w=3840` ⇒ 优化器只能原样回，白挂一档 | [已复核] 源图 `identify` 1400×940 / 1400×1040，`w=1920` 与 `w=3840` 返回字节完全相同 | 代码侧 |
| 59 | **AI 抓取器在要 `/ai.txt`，我们 404**（今天 3 次，SEOJuice-SearchBot）；我们只发 `/llms.txt` | [已复核] Caddy 日志 404 明细 | 代码侧（一条 rewrite 或 route） |
| 60 | 匿名访客每次进页面产生 3 个 401（`/api/auth/session`、`/api/comments/for-me`、`/api/announcements`，近一天 45/10/10 次），浏览器控制台直接报错 | [已复核] 生产日志 + 无头 Chrome console 实测 | 代码侧（未登录时不发或回 204） |
| 61 | `x-origin-server: tencent` 全站暴露供应商；`http://www` 到 apex 要两跳（308→301，1.6s vs 0.33s） | [已复核] 跳转链实测 | 生产配置侧（Caddy） |
| 62 | `apple-touch-icon` 指向的接口回的是 184×190 的 SVG（iOS 要 PNG） | [代理报告] | 代码侧 |
| 63 | 扫描器今天大量探针（`/.npmrc`、`/Dockerfile`、`/docker-compose.yml`、`/database.sql`、`/credentials`、wp 系）**全部 404**，近一天 **0 条 5xx** | [已复核] 日志实测 —— 这是通过项，记在这里当基线 | — |

---

## 五、需要业主定一句的（我不自己拍）

1. **#3 收款配置面**：无 ICP 许可证期间，`/platform/settings` 里那半张"能填收款账号"的表单要不要一起搬进 `src/disabled-billing/`？（搬 = 少一条合规口实；不搬 = 保持现状，只有平台管理员看得见）
2. **#28 首页「免费内测」口径**：删掉"免费"字样，还是承认这条红线只约束价格/额度数字？
3. **#21 帮助文档/联系我们**：改飞书 wiki 为公开可读，还是换成邮箱/表单？
4. **#52 开发机依赖漂移**：要不要现在重启你的 dev 并按锁重装（这是唯一能同时修好 #40 复测条件与开发机 sharp 落在 HIGH 区间的动作）？
5. **#48 镜像瘦身**：`npm ci --omit=dev` + runner 只拷生产闭包，会改变部署产物结构，要不要做？

---

## 六、本轮没覆盖到的（别当成"已验通过"）

- **生产访客侧分享页**：我手上没有可用真短链，也不该去翻客户数据 ⇒ 只测了本地 dev（见 #40）。要验需你给一条自己的测试链接。
- **登录后的应用面点击**（工作室、项目设置、上传、转码、批注提交）：需要真实会话，本轮全部未点。
- **真机 iOS Safari / Android / 微信与飞书内置浏览器**：只用 Chrome 的移动端仿真，`window.confirm` 被吞（#38）这类只能真机验。
- **Google/Bing 侧的图标缓存**：这台机直连 `google.com/s2/favicons` 返回 000（网络不通），引擎那份缓存我测不到。
- **GSC 的点击/展示/索引数**：仍要面板里开一个可见标签页才读得到。
- **Windows 客户端与 mac 客户端**：与本轮无关，未动。
