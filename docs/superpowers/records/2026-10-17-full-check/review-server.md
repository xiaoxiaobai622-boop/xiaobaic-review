# 后端/数据方向代码评审 — 8aa164a^..327d6c7（2026-10-03 ~ 10-17，73 提交）

评审方式：只读。范围 `src/app/api/**`（`share/**` 仅读，单列）、`src/lib/**`、`src/worker/**`、`src/proxy.ts`、`prisma/**`、`Dockerfile*`、`docker-compose*.yml`、`.github/workflows/*.yml`。未连库、未 SSH、未 build。所有行号按 327d6c7 的工作区文件。

严重度口径：阻断=现在就能造成不可逆损失/大面积失效；重要=可被真实利用或会稳定踩到；次要=理论风险、口径不一致或运维负担。

---

## A. 越权与鉴权

### R1 — 「内部可见」批注对外部分享链接查看者全部泄露（重要）
`src/app/api/comments/route.ts:146-148`
```
const visibleComments = isAdmin || isAuthenticated ? allComments : allComments.filter(c => c.visibility !== 'INTERNAL')
```
现象：`isAuthenticated` 来自 `verifyProjectAccess`，而该函数对**每一条授权成功的分享链接路径都返回 `isAuthenticated: true`**（`src/lib/project-access.ts:311-314` 无密码 NONE 分支、`370-377` share token 分支），只有 401 未授权才是 false。于是 `isAdmin || isAuthenticated` 恒为真，`visibility==='INTERNAL'` 的过滤器是死代码；`sanitizeComment` 也不裁剪 `content`（`src/lib/comment-sanitization.ts:71`）。另外 `replies` 在 `:136-139` 整段 include、只在顶层过滤，公开批注下的内部回复同样漏。
触发路径：拿到一条分享链接（含 `authMode:'NONE'` 的项目，无需任何凭据）→ `GET /api/comments?projectId=…`（前端确实在调：`src/app/studio/projects/[id]/share/page.tsx:290`）→ 看到团队标为「内部」的批注正文。功能本轮才上（`d679fe0` + 迁移 `20261006150000`），写侧守卫是对的（`src/app/api/comments/route.ts:366`），只有读侧失效。
修法：判据换成「是不是这个团队/项目的成员」，即只有 `accessCheck.isAdmin`（走 `canAccessProject`）才不过滤；share token 与 NONE 访客一律过滤 `INTERNAL`，并对 `replies` 递归过滤。
谁能修：后端（1 个函数 + 1 条判据）。

### R2 — 登录后开放重定向：`/\evil.com` 绕过 `startsWith('/') && !startsWith('//')` 守卫（重要）
`src/proxy.ts:14`、`src/app/login/page.tsx:107`、`src/lib/wechat-auth.ts:21`、`src/app/api/auth/wechat/start/route.ts:8-10`、`src/app/api/auth/wechat/callback/route.ts:14`
现象：三处同一套守卫，都没排除反斜杠。WHATWG URL 解析对 special scheme 把 `\` 当 `/`，实测（node）：`new URL('/\\evil.com','https://vidx.cn')` → `https://evil.com/`；`window.location.href='/\evil.com'` 同样跳外站。`wechat/start` 与 `wechat/callback` 是**服务端 302**（`redirectWithResult` 用 `new URL(safeWechatReturnUrl(...), origin)`），最容易用。
触发路径：`https://vidx.cn/api/auth/wechat/start?returnUrl=/\evil.com` → 扫码登录成功 → 302 到 evil.com；或钓鱼邮件 `…/login?returnUrl=/\evil.com`，地址栏先是真域、登录后跳走。
修法：统一走一个 `isSafeInternalPath()`：只允许 `/` 开头、第二位不是 `/` 也不是 `\`、不含 `//`、百分号解码后再判一次；`platform/login/page.tsx:29` 那种 `startsWith('/platform')` 白名单口径更安全，可推广。
谁能修：后端（一处公共 helper）。

### R3 — 客户端可伪造 `cf-connecting-ip`，压过可信的 `X-Real-IP`（重要）
`src/lib/utils.ts:146-151`
现象：只要请求带任意 `cf-ray`，就用 `cf-connecting-ip` 当客户端 IP。这两个头都不是本站 Caddy 产生的，客户端可自带；判据排在 `x-real-ip`（Caddy `header_up` 覆写，真实）之前。返回的 IP 同时是：所有限流键（`src/lib/rate-limit.ts:28-38`）、审计行 `ipAddress`、封禁 IP 名单匹配（`src/lib/video-access.ts:343-362`）、`authMode NONE` 的会话 id（`src/lib/project-access.ts:291`）。
触发路径：`curl -H 'cf-ray: x' -H 'cf-connecting-ip: 1.2.3.4'` → 每条请求换一个 IP → 所有按 IP 的限流（content-stream、SMS 发送、join-requests…）形同不存在，且审计 IP 由攻击者指定。若走 `docker-compose.yml:122` 直接发布的 4321 端口（见 R20），连 `x-real-ip` 都没有，全部落 `'unknown'` 同桶。
修法：删掉 `cf-ray` 分支（本站不经 Cloudflare 回源），或只在本机确实位于 CF 之后时启用；兜底顺序固定为 `x-real-ip` → `x-forwarded-for` 最后一跳；并在 Next 配 `allowedHosts`/Caddy 剥掉 `cf-*`。
谁能修：后端 + 运检（Caddy 头策略）。

### R4 — 登录只按账号限流，没有 IP/全局维度上限（重要）
`src/app/api/auth/login/route.ts:43`、`src/lib/rate-limit.ts:15-25`
现象：`checkRateLimit(request,'login',email)` 的键只哈希账号（`getIdentifier` 传了 customKey 就完全不含 IP），失败由 `:78 incrementRateLimit` 计数，`maxAttempts` 来自 SecuritySettings。没有任何按 IP/按来源的登录总量闸门。
触发路径：(a) 撞库：一个 IP 对 10 万个邮箱各试 4 次，每枚桶都是新的 → 不限速；(b) 反向伤害：任何人可对 `ADMIN_EMAIL` 或平台管理员邮箱刷 5 次错密码 → 该账号 15 分钟不能登录（可反复续期，管理员被永久挡在门外）。Redis 不可用时 `checkRateLimit` 返回 `limited:true, retryAfter:900`（`rate-limit.ts:180-184`）→ 全体登录 429（叠加 R5 会长期不恢复）。
修法：login 同时挂 IP+UA 的通用 `rateLimit()`（如 20 次/5 分钟/IP）；账号侧把「锁定」改成「指数退避 + 只挡该账号但允许正确凭据通过」，或引入验证码；对 `role='ADMIN'`/`isPlatformAdmin` 账号单独收紧。
谁能修：后端。

### R5 — 平台管理令牌族没有服务端空闲超时（次要~重要）
`src/lib/auth.ts:373-385`（`verifyPlatformAccessToken`）对比 `:198-205`（admin 侧调 `recordAdminSessionActivity` 判 idle 并撤会话）
现象：`7331b69` 把「会话空闲超时」只落在了 studio admin 一侧；platform 侧只有 2h access + 12h refresh 的硬 TTL 和吊销表，空闲检查缺失。
触发路径：运营/后台机器上未锁屏的浏览器会话，配置里 `adminSessionTimeout`（最短 1 分钟）到期后 studio 会话被踢，但 `/platform` 控制台靠 refresh 一直续（refresh 走 `refreshPlatformTokens`，同样无 idle 判据，`auth.ts:404-449`）。
修法：platform 侧接 `platform-session-registry` 的活动记录，和 admin 用同一枚 `adminSessionTimeoutSeconds`；把「会话必须被服务端判空闲」写成一条 CI 判据钉住两族。
谁能修：后端。

### R6 — `requireApiUser/requireApiAdmin` 缺 `x-team-id` 时静默回落「最早创建的团队」（次要）
`src/lib/auth.ts:609-622, 662-675`、`src/lib/team-access.ts:44-52`
现象：header 缺失时 `findFirst({ where:{userId,status:'ACTIVE'}, orderBy:{createdAt:'asc'} })`，返回的 `authorizedTeamId` 是那枚最老的团，而 UI 可能显示的是另一个团。`team-access.ts:36-38` 的注释明确说过「Routes must not re-resolve this」，但 `auth.ts` 里就藏着一次自行回落。
触发路径：多团队用户（或客户端某条请求漏带 header）→ 写入落到 A 团队、页面读的是 B 团队；`canAccessProject` 用 `authorizedTeamId` 过滤（`project-access.ts:63`）于是对 B 团队的项目回 403/空列表，表现为「偶发看不到自己的项目」。不会造成跨团越权（header 指定团也校验成员关系），但会造成错误归属与配额错计。
修法：header 缺失就 400 或按当前路径/项目反查团，不要凭 createdAt 猜；给 `requireApiUser` 加一条「必须显式团」的判据。
谁能修：后端。

### R7 — 守卫覆盖面复核结论（无问题，记录）
`src/app/api/platform/**` 全部命中 `requirePlatformAuth`/`requirePlatformAdmin`（`auth/login|logout|refresh` 是登录入口，合理）；`requirePlatformAuth` 虽不做 audience 判定，但 `getPlatformUserFromRequest` 以 `isPlatformAdmin` 收口（`src/lib/auth.ts:457-461`）。`requirePlatformAdmin` 同时接受两族 token 的分支有 `user.isPlatformAdmin` 兜底（`:642-654`），注释也写清了理由，判据成立。新加的 `reveal-phone` 两端（`src/app/api/users/[id]/reveal-phone/route.ts:18`、`src/app/api/projects/[id]/recipients/[rid]/reveal-phone/route.ts:19-32`）归属校验带上了 projectId，配额按操作人计，OK。

---

## B. 注入、输入校验与资源滥用

### R8 — 短信验证码在四条流程间共享同一枚 Redis 键，无用途绑定（重要）
`src/lib/phone-auth.ts:6-8`（`portal_phone_code:${phone}`）、消费方：`src/app/api/auth/sms/verify-code/route.ts:36`、`src/app/api/portal/phone/verify-code/route.ts`、`src/app/api/account/phone/route.ts:46,59,69`、`src/app/api/auth/merge-accounts/route.ts:34`
现象：键只按手机号，不区分「登录 / 换绑 / 收件人门户 / 合并账号」。为 A 目的发出的码可以在 B 目的被消费。
触发路径：外部客户为进收件人门户索取一枚码 → 同一枚码提交 `/api/auth/merge-accounts` 或 `/api/auth/sms/verify-code`，即以「证明持有该手机号」的名义换到 studio 侧 `issueAdminTokens` 的账号令牌或触发账号合并。配合 R9 后果更重。
修法：键里加用途段（`portal_phone_code:${purpose}:${phone}`），发出时写 purpose、消费时强判；`consumeTokenAtomically`（`src/lib/redis.ts:103-126`）已在 account/phone 用了，其余三处仍是 GET+比较+DEL（`sms/verify-code:37-50`、`merge-accounts:35-49`）非原子，顺带统一。
谁能修：后端。

### R9 — 账号合并：一枚 OTP 就硬删目标账号，无二次确认、无审计（重要）
`src/app/api/auth/merge-accounts/route.ts:51-113`
现象：登录后用户 A 用 B 的手机号+OTP 即可把 B 的团队归属（角色取 `higherRole`，可把 A 升成 OWNER，`:62-68`）、项目、订单、微信身份、通行密钥全部转到 A，然后 `tx.user.delete(target)`（`:112`）把 B 永久删除。全程不写 `SecurityEvent`，不给 B 任何通知。
触发路径：中国运营商号码回收是常态 ——  attacker 新办一个曾被 B 使用过的号，收到短信后自助注册（`sms/verify-code` 未注册号码自动建号，`:93-107`），再 merge 掉 B 的老账号；或 B 的两个自有账号误操作后无法回退。属于「可真实利用」而非理论。
修法：合并前把目标账号的关键归属列成清单让**目标侧**再认证一次（目标密码或目标邮箱 OTP）；改成软合并（`mergedIntoUserId` + 停用而不删）；写 `PERSONAL_DATA_REVEALED` 同级别的审计事件；对 `role` 升级禁止跨账号继承 OWNER。
谁能修：后端 + 产品（要定口径）。

### R10 — `POST /api/teams`、join-requests、invitations 完全没有速率限制（重要）
`src/app/api/teams/route.ts:66-123`、`src/app/api/teams/[id]/join-requests/route.ts:33-76`、`src/app/api/teams/[id]/invitations/route.ts:40-73`
现象：三条写路由都没 `rateLimit`（同文件其它写路由普遍有）。
触发路径：一个绑了手机号的账号可 (a) 循环建团队（每次持全局 advisory lock 并全表扫 `Team`，见 R12）→ 直接顶住发号事务；(b) 对 `100000..999999` 号池逐个提交加入申请，每个新团队的管理员都收到一条通知（`:68 notifyTeamAdminsOfJoinRequest`）→ 通知轰炸 + `TeamJoinRequest` 表膨胀；(c) 无限造 invite token（每行一枚 `randomBytes(24)`）。
修法：三条都挂按 `authResult.id` 的 customKey 限流（例如建团 5 次/小时、申请 10 次/小时、邀请 30 次/小时）；`by-slug/[slug]`（`src/app/api/teams/by-slug/[slug]/route.ts:16`）加按团限流以防枚举。
谁能修：后端。

### R11 — `avatarUrl`（团队）无校验入库；`appDomain` 只校 URL 形状（次要）
`src/app/api/teams/[id]/route.ts:152`（`if (typeof body?.avatarUrl === 'string') data.avatarUrl = body.avatarUrl`，无长度/协议白名单）对比同文件 `name` 有 80 字上限；`src/app/api/settings/route.ts:300-312` 只判 `new URL()` + http/https。
触发路径：团队 ADMIN 可存 `data:,…` 或任意外链作团头像 → 全站成员页按该 URL 拉图（第三方可见的追踪像素，`img-src` 允许 `data:`，`src/proxy.ts:96`）；`appDomain` 被改成外域后，所有邮件与 `/login?returnUrl=` 链接（`src/lib/email.ts:371`、`src/lib/notifications.ts:288`、`src/lib/comment-helpers.ts:229`）都指向该域 → 平台管理员被钓鱼的放大器。
修法：`avatarUrl` 收敛成 `/api/**` 前缀白名单（用户头像已经这么做：`src/app/api/users/[id]/route.ts:191-198`）；`appDomain` 与 `NEXT_PUBLIC_APP_URL` 做同域校验或落 allowlist。
谁能修：后端。

### R12 — `settings/security` PATCH：未提交的字段被硬编码默认值覆盖（重要）
`src/app/api/settings/security/route.ts:273-288`
现象：`securityValues` 用 `x ?? 默认` 组装**整行**再 `upsert`。PATCH 只带一个字段（前端就是这么发的）就会把其余全部重置：`ipRateLimit→1000`、`sessionRateLimit→600`、`shareSessionRateLimit→300`、`passwordAttempts→5`、`sessionTimeoutValue/Unit→15 MINUTES`、`adminSessionTimeout→7 DAYS`、`trackAnalytics/trackSecurityLogs→true`、`viewSecurityEvents→false`。
触发路径：运营改一下 hotlink 级别 → 「查看安全事件」开关被关掉（`GET /api/security/events` 立刻 403，`src/app/api/security/events/route.ts:40-45`）、限流阈值被拉回默认；若旧值恰好不等于默认，`hasSessionTimeoutChanged`（`:40-51`）判成"变了"→ `invalidateAllShareSessions()`（`:322-331`）把全体在看片的外链访客踢下线。
修法：只拼提交过的键（`Object.fromEntries(Object.entries(body).filter(k in QUOTA…))`），未提交的列不进 `data`；`viewSecurityEvents`/`trackSecurityLogs` 这类开关不许被"省略"关掉；变更判定基于合并后的终值。
谁能修：后端。

### R13 — 发号在事务里全表扫 + 同一把锁被拿两次（次要）
`src/app/api/teams/route.ts:87-90`、`:22-26`、`src/lib/team-id.ts:60-64`
现象：一个事务里先 `allocateTeamId(tx)`（`findMany({select:{id,slug,shareKey}})` 全表）再 `getNextTeamIdentifier(tx)`（再一次 `findMany({select:{slug}})` 全表 + `pg_advisory_xact_lock(86230402)`）。锁是重入的（同 xact 内二次获取不阻塞），但两次全表扫描 + 串行化把所有建团请求排成一条队。
触发路径：团队数上万后每次建团做两趟全表读；R10 的自动化脚本能把它变成稳定拥塞点。
修法：一次 `findMany` 供两处用；号池改成序列表/`generate_series` + `ON CONFLICT` 认领，避免全表扫。
谁能修：后端。

### R14 — platform grants/quota PATCH：不校验团是否存在、featureKey 是否在册；空数组时 500（次要）
`src/app/api/platform/teams/[id]/grants/route.ts:41-57`、`src/app/api/platform/teams/[id]/quota/route.ts:31-55`
现象：`grants` 过滤后可能为空数组但仍过了 `grants.length===0` 的检查 → `prisma.$transaction([])` 抛 "must contain at least one operation" → 500；`featureKey` 是任意字符串 → 可给任意（含不存在的）`teamId` 造出无限多 grant 行（quota 那侧靠 FK 报错也是 500，不是 400）；quota 数值无上界。
修法：先按在册 `PlatformFeature.key` 过滤、`isTeamId(id)` 校验、过滤后为空直接 400；quota 给个合理上限并区分 404/400。
谁能修：后端。

### R15 — `GET /api/security/events` 分页参数未校验（次要）
`src/app/api/security/events/route.ts:48-54, 68-85`
现象：`parseInt(searchParams.get('limit'))` 不夹范围，`take: limit`；`page=0` → `skip` 为负；`page=abc` → NaN。`limit=100000000` 会把整表事件（含 include project）拉进内存再 JSON 化，且这是**每条都新读**（`stats` 那次 `groupBy` 还是全表聚合，无 where）。
触发路径：平台管理员账号被盗或运营页误操作 → 单请求把 Node 进程打爆。非匿名可达，所以不定为阻断。
修法：`limit = Math.min(Math.max(parsed,1),200)`、`page` 下限 1，NaN 直接 400；`stats` 复用同一个 where。
谁能修：后端。

### R16 — 审计 details 里存了能力型秘密，并原样回给控制台（需业主确认/次要）
`src/app/api/share/[token]/verify/route.ts:137-143, 187-199`（`details.shareToken`）、`src/app/api/security/events/route.ts:68-106`（`details` 原样下发）
现象：分享 token 被当普通字段进了 SecurityEvent 与 Redis 的 recent 列表；`/api/security/events` 把 `details` 整包返回。
触发路径：有控制台读权限的人（平台管理员、被截图的运营）拿到有效 share token 集合；对无密码项目（`authMode NONE`）等价于拿到入口。属 `share/**` 邻域，按禁区规矩单列。
修法：details 里存 token 前缀或哈希；下发时按字段脱敏。
谁能修：后端 + 业主确认口径。

### R17 — 内部错误细节仍然回客户端的两处（次要）
`src/app/api/feishu/push/route.ts:293, 300`（`errorMessage: sendError.message` 入库、`details: sendError.message` 回客户端）、`src/pages/api/uploads/[[...path]].ts:529`（`processingError: error.message` 入库后被前端展示）
现象：`cf661a1`/`08dc1e5` 修掉了通知目的地的 echo，这两条同型问题还在。飞书 API 异常文本会带 app 侧 URL/码，ffmpeg/probe 异常会带内部路径。
修法：只回稳定 code + 人话；详情进日志（`logError` 已有）。
谁能修：后端。

### R18 — `catch {}` 把真实故障伪装成「列不存在」（次要）
`src/app/api/teams/[id]/route.ts:66-109`、`src/app/api/teams/[id]/members/route.ts:41-60`、`src/app/api/branding/favicon/route.ts:46-48`
现象：为兼容「新镜像先于迁移」写的兜底 catch 捕获的是**所有**异常（连接失败、超时、P2002 都算），再跑一次不带新列的查询；两处 fallback 若也失败就抛出未分类错误；favicon 那条把所有存储错误降级成 404。
触发路径：Postgres 抖动 → 团队页慢一倍并且把错误掩盖成 schema 问题，排障方向被带偏。
修法：只在 `error.code === 'P2022'`（列不存在）时降级；其余重抛。迁移上线顺序理顺后把这两段兼容层删掉（见 R24）。
谁能修：后端。

---

## C. 数据一致性、并发与幂等

### R19 — 回收站永久删除：先删对象、后删行，DB 失败留下「没有字节的 tombstone」（重要）
`src/lib/recycle-bin.ts:50-71`、调用侧 `src/app/api/projects/[id]/recycle-bin/purge/route.ts:44`
现象：注释承诺「对象先删，COS 失败就两者都留着重试」，反过来的岔路没管：`purgeFile/purgeDirectory` 成功后 `tx.video.deleteMany + tx.recycleBinItem.delete` 若失败（FK、超时、连接断），条目仍在回收站、`Video` 行仍在，但字节已按 versionId 永久删除（`s3PurgeObject` 绕过版本窗口，`src/lib/s3-storage.ts:477-520`）。此后 `restoreRecycleBinItem`（`:91-111`）会「恢复成功」但播放/下载必坏。
触发路径：清空回收站时事务失败（例如该 video 还挂着 RESTRICT 的 FK）→ 接口按 `purgeRecycleBinItems:129-132` 只回 `DELETE_FAILED`，用户再点恢复 → 得到一个空壳版本。
修法：行删除先行（软删标记 + 记 `purgeStartedAt`），对象删除成功后再物理删行；或给 RecycleBinItem 加 `purgeState` 列，purge 失败可重入且恢复入口按状态禁用。
谁能修：后端。

### R20 — `s3PurgeDirectory(prefix)` 对「文件型 prefix」静默删 0 个对象，purge 后 HEAD 缓存仍说存在（次要）
`src/lib/s3-storage.ts:484-487`（prefix 补 `/` 再 `ListObjectVersions`）、`src/lib/recycle-bin.ts:59-62`、`src/lib/storage.ts:301-307`
现象：若某条 RecycleBinItem 的 `directories` 里塞的是对象键而不是目录前缀，`…/videos/original-x.mp4/` 匹配 0 条 → 一声不响地什么都不删，事务照旧删行 → 对象与版本永久留在桶里继续计费（正是这条链路上游想要「承诺即永久」的反面）。另外 purge 路径不 `invalidateS3FileExistsCache` 被删的每个 key（`s3PurgeObject` 只失效传入的 key），15 秒内 `fileExists` 仍回 true。
修法：`s3PurgeDirectory` 先判该 prefix 是否命中 0 条并回抛/记日志；`directories` 入库前按形状校验（必须 `/` 结尾）；purge 完逐个失效缓存。
谁能修：后端。

### R21 — 上传 finish：对象已进桶但事务失败 → 孤儿对象与配额漂移，无补偿（次要~重要）
`src/pages/api/uploads/[[...path]].ts:308-319, 344-355, 388-398` 与 `src/lib/storage.ts:151-158`
现象：`moveFile`（S3 模式=上传对象+删临时文件）先发生，`prisma.$transaction{ update + recordDurableTask }` 后发生；事务失败时 catch 分支只清 TUS 临时文件（早已被 unlink），桶里的对象没有任何一行数据指着它。`getTeamStorageBreakdown`（`src/lib/platform-access.ts:74-100`）按行了路径统计 → 用量与真实存储长期不符，孤儿只能靠人工。
修法：把「写对象」包进可重试的 durable task（先落 `uploadCompletedAt:null` 的行，再搬运，worker 补 `completedAt`），或失败时 best-effort 删对象并计数。
谁能修：后端 + worker。

### R22 — 加入审批的 TOCTOU：并发双批可超配额并双发通知（次要）
`src/app/api/teams/[id]/join-requests/[requestId]/route.ts:33-77`
现象：读 `status:'PENDING'` 与写 `APPROVED` 不在同一条原子语句里；配额检查 `getTeamUsage` 与 `teamMember.create` 也无锁（对比 `nextProjectCode`/`allocateTeamId` 都上了 advisory lock）。两个管理员同时点通过 → 成员数超 `maxMembers`、申请人收到两条「已通过」。
修法：`updateMany({ where:{id, status:'PENDING'} })` 判 count 作为认领；配额检查进事务并沿用 `(86230401, hashtext(teamId))` 那类 advisory lock；通知改成 durable task 幂等键。
谁能修：后端。

### R23 — 飞书推送：部分失败留下 PENDING 记录与重复送达（次要）
`src/app/api/feishu/push/route.ts:242-308`
现象：先 `create({status:'PENDING'})` 再发；发送成功才 update SENT。进程在两步之间崩 → 行永远 PENDING，而 `:171-191` 的「已推送」过滤只看 `status:'SENT'` → 下次推送把这批评论再发一遍。重试入口 `retryNotificationId` 强制 `rePushAll=true`（`:54`）绕开去重，两次并发点重试 = 同一批意见送达两遍。整段没有速率限制。
修法：加 `SENT_PARTIAL`/按 `dedupeKey=(notificationId, commentId)` 的去重表；重试走幂等键；给该端点按 `user.id` 限流。
谁能修：后端。

### R24 — 建团/迁移与旧镜像的兼容窗口，回滚不回滚 schema（重要）
`prisma/schema.prisma:108-111`（`Team.id` 去掉 `@default(cuid())`）、`prisma/migrations/20261014233000_team_id_numeric_guard/migration.sql:74-87`（命中真实部署会 `RAISE EXCEPTION`）、`docker-entrypoint.sh:241-254`（迁移失败即 `exit 1`）、`.github/workflows/xiaobaic-ci-deploy.yml:406-443, 497`（回滚只回镜像与 `.env`，不回库）
现象：三段耦合的顺序依赖。(a) 迁移带硬闸：库里存在落在旧团号下的对象路径时 `prisma migrate deploy` 主动抛 → app 容器 entrypoint `exit 1` → 站点起不来，靠 CI 48 轮 ×5s 后 `false` 触发 rollback 才拉回旧镜像；(b) 旧镜像（`@default(cuid())`）向新库写团会撞 `Team_id_numeric_shape` CHECK，回滚窗口里任何建团都失败；(c) `20261005190000` 之后 `User.phone` 存的是 AES-GCM 密文，回滚到旧代码后旧代码把密文当明文用（按 `phone` 等值登录、`{phone: usernameOrEmail}` 查号，`src/lib/auth.ts:498-506`）→ 手机号登录与收件人查找整片坏掉，且没有 down migration。
修法：把「先跑 `scripts/migrate-team-ids*.mts --move`」写进部署前置检查而不是靠迁移抛错；迁移与代码上线之间给一个双读窗口（旧代码同时按 `phone`/`phoneHash` 查，本轮 `auth.ts:504` 已经 OR 了摘要，但 `:502` 的明文等值应尽快摘掉）；回滚剧本里明确「schema 不回滚，只回滚兼容代码」并列出这次不兼容的点。
谁能修：后端 + 运检一起。

### R25 — 迁移与运行期的其它一致性缺口（次要）
- `prisma/schema.prisma:14-17`：`phone String? @unique` 保留，但值已是随机 IV 的密文 → 唯一约束对「同一号码」永不生效，真正的唯一性只在 `phoneHash @unique`（`:16`）。并发注册（`src/app/api/auth/sms/verify-code/route.ts:96-117` 已处理 P2002，`src/app/api/users/route.ts:134-172` 未处理 → 撞号变 500 而不是 409）。
- `prisma/migrations/20261005190000_phone_lookup_index/migration.sql:16`：`CREATE UNIQUE INDEX`（非 CONCURRENTLY）在 `User` 上持写锁；且它先于回填脚本落地，回填期间的并发写靠应用层保证。
- `prisma/schema.prisma:975-984` + `migrations/20261004220000_security_audit_hardening/migration.sql:9-11`：注释写「row keeps the id but loses the relation」，实际 `ON DELETE SET NULL` 把 `projectId` 本身置空；`src/app/api/projects/[id]/route.ts:611-624` 又整包替换 `details`。删团后审计既查不到项目也没有细节，只剩 `userId/type/createdAt`。要么承认「匿名留存」并改注释，要么保留一个不可逆的项目哈希列。
- `src/lib/db.ts:130-167`：加解密/软删过滤的唯一实现在 client 扩展里，而仓库里有 20+ 个脚本直接 `new PrismaClient()`（`scripts/update-admin-phone.ts:3,15-18` 最典型：往 `phone` 写明文、不写 `phoneHash`）。这些脚本一旦在生产跑过就产出「查不到的行」。
- `src/lib/db.ts:157` + `src/lib/encryption.ts:174-177`：`decrypt` 抛错，扩展把抛错带进每一次 `User/ProjectRecipient/TeamInvite` 读；换 `ENCRYPTION_KEY` 或一行脏数据 = 相关接口全 500（fail closed 但无降级路径）。建议读侧改成 `readPhone()` 的「认不出来就原样返回」口径（`src/lib/phone-field.ts:88-91` 已有正确实现，扩展里没用）。

---

## D. 失败处理与可观测

### R26 — Redis 客户端在 3 次重试后永久死亡，进程不会自愈（重要）
`src/lib/redis.ts:39-46`（`retryStrategy` 第 4 次返回 `null`）+ 全文件没有 `on('end'/'close')` 复位 `redis`
现象：一次超过 ~600ms 的 Redis 抖动（重启、OOM、网络）后 ioredis 关闭连接且不再重连，`getRedis()` 继续返回这个死实例（`:26`）。`getRedisForQueue` 的 `retryStrategy` 会一直重连（`:78-85`），所以 worker 侧活着、app 侧死。
触发路径：Redis 抖动 → 限流 fail-closed（`src/lib/rate-limit.ts:141-148` 回 503；`:180-184` 直接把登录判成 limited）、`video_access` 读写全失败（`src/lib/video-access.ts:111-120` 抛出）→ 播放与登录一起挂，直到有人重启容器。部署里 app 有 `healthcheck`（`docker-compose.yml:130-135`）但 `/api/health` 是否探 Redis 需确认；若不探，容器保持 healthy、故障不自愈。
修法：`retryStrategy` 不返回 null（用固定退避）；或监听 `end`/`close` 把 `redis=null` 让下次调用重建；`maxRetriesPerRequest` 保持 3 但实例必须能复活。
谁能修：后端（几行）。

### R27 — worker 定时器未兜异常 → unhandled rejection 直接杀进程（重要）
`src/worker/index.ts:224`、`241-244`
现象：`await cleanupOldTempFiles()` 两处都没有 `.catch`（同一函数里 `runCleanup`、`purgeExpiredRecycleBinItems`、`dispatchPendingDurableTasks` 都规规矩矩带了 `.catch`）。Node 24 默认 `--unhandled-rejections=throw` → 一次 EACCES/ENOENT/EPERM 就让 worker 退出；`docker-compose.yml:138-141` 的 `command` 由 `restart: unless-stopped` 拉起，但 CI 的判据里 `worker_restart_count` 必须为 0（`xiaobaic-ci-deploy.yml:449, 455`），意味着一次自发重启会让**下一次部署直接判定失败并回滚**。
修法：给两个 interval 回调加 `.catch(logError)`；把启动路径同样包起来。
谁能修：后端。

### R28 — 客户端摘要邮件：部分成功后重发全量，且邮箱进 `lastError` 和 stdout（重要）
`src/worker/client-notifications.ts:144-193`、`src/worker/notification-helpers.ts:151-156`
现象：`onSuccess` 里逐收件人发邮件，任一失败就 `throw`（`:189`），`sendNotificationsWithRetry` 视为整批失败 → 队列行不置 `sentToClients` → 下一轮把已经送达的前几个收件人再发一遍。没有任何 per-recipient 幂等记录。同时 `:187/:189` 把收件人邮箱打进 stdout，而 `:189` 的 message 作为 `lastError` 落库，会被通知界面读出来。
修法：把「一个 project 的摘要」拆成 (project, recipient) 粒度的行/幂等键；已送达的收件人单独记账；错误只存 code，PII 用 `maskEmail`（`src/lib/utils.ts:137-141` 已有）。
谁能修：后端。

### R29 — PII/凭据泄漏风险点（只报位置与风险，不贴值）（次要）
- `src/lib/video-access.ts:454-457`：`security:events:recent` 落的是**未过 `maskEmailsInDetails` 的原始 params**，DB 侧脱敏、缓存侧不脱敏；`src/app/api/security/events/route.ts` 读的是 DB，所以这条目前只在 Redis 里可见。
- `src/lib/phone-auth.ts:6-8`：Redis 键里是**明文手机号**（库里已加密）；`src/app/api/account/phone/route.ts:31` 的 grant 值里也是明文号。备份/`KEYS *`/监控采样都会带出去。
- `src/lib/feishu.ts:416`、`src/app/api/feishu/push/route.ts:287`：openId 进 stdout。
- `src/lib/rate-limit.ts:19-25`：customKey 只留 16 位十六进制摘要，够用，但 `getRateLimitedEntries()`（`:246-299`）把键交给控制台展示，注意别再往键里塞可读标识。
- `src/app/api/branding/logo/route.ts:24-28`：302 到预签名 URL 且响应带 `Cache-Control: public, max-age=300` → 签名地址可能被中间缓存留住 5 分钟。
- `.github/workflows/xiaobaic-ci-deploy.yml:435-442` + 注释里那条 logrotate 规则：把 app/worker 各 20000 行容器日志落到宿主机文件，长期保留会连带落进日志的任何预签名 URL/PII。

---

## E. 密钥、Cookie 与配置

### R30 — `ENCRYPTION_KEY` 有硬编码兜底值，非 production 静默生效（重要）
`src/lib/encryption.ts:54`（`|| 'DEV_ONLY_INSECURE_KEY_32BYTES!'`）、`:46-52`、`:61-75`
现象：兜底值是仓库里公开的常量；`validateEncryptionKey()` 只在 `NODE_ENV==='production' && SKIP_ENV_VALIDATION!=='1'` 时拦。三个现实缺口：(1) 任何以 `NODE_ENV` 非 production 跑起来的实例（本地调试、灰度容器、CI 起的临时容器）会拿公开常量去加密手机号并进生产库；(2) `SKIP_ENV_VALIDATION=1` 在 `Dockerfile:61` 是构建期 ENV，若被复制到 runner 阶段就整体关掉这道闸；(3) `docker-compose.yml:165` worker 侧是 `${ENCRYPTION_KEY}` 而不是 `:?`（app 侧 `:83` 有 `:?`）→ 漏填时 worker 拿到空串，落到兜底常量。`hmacIndexValue`（`encryption.ts:102-113`）同样直接吃 `ENCRYPTION_KEY` 原串，因此兜底键一旦生效，`phoneHash` 也可被离线复原/枚举。
修法：删掉兜底常量（缺失就 throw，别分级）；`validateEncryptionKey` 改成「只要模块被真正使用就必须过」；compose 给 worker 补 `:?`；构建期的 `SKIP_ENV_VALIDATION` 用 `ARG`+单独 stage 收口，别留成运行期 ENV。
谁能修：后端 + 运检。

### R31 — JWT 密钥族：platform 复用 admin 的密钥，且校验块不管它（次要）
`src/lib/auth.ts:95-99`、`:126-134`
现象：`PLATFORM_JWT_SECRET || JWT_SECRET`、`PLATFORM_REFRESH_SECRET || JWT_REFRESH_SECRET`，而启动校验只强制 `JWT_SECRET/JWT_REFRESH_SECRET/SHARE_TOKEN_SECRET` 三枚。两族令牌靠 `type` claim 区分（`:195, 216, 377, 412`），跨族使用被挡住了，所以不是越权；但「同一个密钥签两套令牌」意味着拿到 `JWT_SECRET` 就等于同时拿到运营控制台的身份，也让「轮换 studio 密钥」这件事必须连 platform 一起转。另外 `SHARE_TOKEN_SECRET` 一身三用：分享 JWT、微信会话 JWT（`src/lib/wechat-auth.ts:14`）、OTP 的 HMAC 键（`src/lib/phone-auth.ts:11`）——轮换任一项会同时打挂另两项，且没有像 `hmacIndexValue` 那样做域分隔。
修法：给 platform 两枚必填、把 `hashPhoneCode`/wechat session 各自加一个 HKDF 域标签（`encryption.ts:102-113` 现成可用）。
谁能修：后端。

### R32 — 微信会话绕过吊销体系；Secure 标志按反代后的协议判（重要）
`src/lib/auth.ts:561-577, 589-601`、`src/lib/wechat-auth.ts:25-46`、`src/app/api/auth/wechat/callback/route.ts:67-70`、`src/app/api/auth/wechat/mini/qr/status/route.ts:66-68`
现象：`getCurrentUserFromRequest` 的第三条通路是 30 天有效的 `vitransfer_wechat_session` cookie，`verifyWechatSession` 只验签名与 `type`，**不查 `isTokenRevoked` / `isUserTokensRevoked` / `isAdminSessionRevoked`**。于是 `users/[id]/PATCH` 的改密与降权（`revokeAllUserTokens`，`src/app/api/users/[id]/route.ts` 尾部）、`settings/security` 的会话失效、平台管理员移除（`:184-195`）都踢不掉微信登录态；「禁用团队成员」（`TeamMember.status='DISABLED'`）在 `requireApiUser` 里能挡住，靠的是每次重查成员行，但账号级吊销挡不住。`secure` 用 `request.nextUrl.protocol==='https:'` 判，Caddy 终止 TLS 后回源是 http → Secure 丢失（同文件的 `feishu/authorize/route.ts:63` 用的是 `NODE_ENV==='production'`，两种口径并存）。
修法：wechat 会话也纳入 session registry（签发时 `registerAdminSession`，验证时 `isAdminSessionRevoked`）；`secure` 统一按 `HTTPS_ENABLED`/`NODE_ENV`；cookie 上加 `path` 与显式 `maxAge`。
谁能修：后端。

### R33 — 域名与回调地址的硬编码（次要）
`src/proxy.ts:5`（CSP `media-src` 写死 `https://vidx.cn`）、`src/lib/deep-link.ts:32`（`|| 'https://vidx.cn'`）、`src/lib/feishu.ts:19`（OAuth 回调默认 `https://vidx.cn/api/auth/feishu/callback`）、`src/app/dl/route.ts:12`、`src/lib/email.ts:675`（`noreply@vidx.cn`）、`src/app/api/auth/feishu/callback/route.ts:16`
现象：站内多处把生产域当默认值。对比 `src/lib/marketing/site-url.ts:12-32` 的正确做法（缺 env 直接 throw，绝不兜底域名）。风险不是被利用，而是这套代码同时作为 ViTransfer 对外发行/多域部署时，邮件与飞书深链会静默指向 vidx.cn。`FEISHU_OAUTH_REDIRECT_URI` 若被 env 覆盖成任意值，仓库里没有再校验（飞书侧白名单兜住）。
修法：这些点全部改走 `getSiteUrl()`；`deep-link` 与 `feishu` 的默认值删除并让缺配置显式失败。
谁能修：后端。

### R34 — 部署侧凭据暴露窗口（重要）
`.github/workflows/xiaobaic-ci-deploy.yml:139-140, 205-207, 406, 420, 437-442`
现象：(a) 生产公网 IP 与「必须以 root SSH」写死在 workflow（`:139` 还把它当校验条件），等于把攻击面坐标放进公开仓库；(b) `sudo mkdir -p "$auth_dir"`（默认 0755）后把 `github.actor:GITHUB_TOKEN` 的 base64 写进 `$auth_dir/config.json`（`:207`，puller 在 `:291` 读它），目录位于 `/tmp` 且只在 trap 里清理 → 部署全程（可达数十分钟）本机任意用户可读；该 token 带 `packages:write`，可读就等于**向生产镜像仓库推包**；(c) `cp .env "$env_backup"` 把全量生产 env 复制进 `/tmp`；(d) 容器日志 20000 行落到 `/var/log`，保留 26 周。SSH 指纹校验（`:148`）和镜像 tag/SHA 校验（`:165-177`）是亮点，但没解决 root。
修法：`auth_dir` 用 `mktemp -d` 并 `chmod 700`，或改用 `crane --docker-config` 的内存形式；`.env` 备份放 `0700` 目录并限定属主；生产 IP 从 secret 取而不是硬编码 + 建立专用部署用户（`sudo` 白名单只放行 docker compose）；容器日志落盘前过一遍脱敏。
谁能修：运检（后端配合）。

### R35 — 应用端口直发 + `Dockerfile` 镜像卫生（次要）
`docker-compose.yml:121-122`（`"${APP_PORT:-4321}:4321"` 绑到 0.0.0.0）、`Dockerfile:86-90`（runner 里再装 python3 + apprise venv，并 `apk del py3-pip`）、`:14-20`（`openssl-dev` 等编译包留在 runner 基础层）、`1a106ca/6a2c9a2`（依赖 CVE 处理）
现象：origin 直暴让 Caddy 的 `X-Real-IP`、TLS、HSTS 全部可被绕过（与 R3 叠加）；生产应绑 `127.0.0.1:4321`。镜像里保留 ffmpeg/python/apprise 扩大 CVE 面（`.github/workflows/test-clean-install.yml` 与 `Dockerfile:37-42` 的 audit 闸是好的，`SKIP_NPM_AUDIT=true` 在 CI 构建里被显式打开（`xiaobaic-ci-deploy.yml:104`），意味着**进生产的那一次构建没跑 audit**，只有 verify job 的 `npm audit --omit=dev`（`:46`）兜着）。
修法：compose 端口改 `127.0.0.1:${APP_PORT}:4321`；生产构建不要 `SKIP_NPM_AUDIT=true`，或把 `2d53668` 的 audit 闸同时作用在 image job。
谁能修：运检 + 后端。

### R36 — worker env 与 app env 不对称（次要）
`docker-compose.yml:149-199` 对比 `:65-120`
现象：worker 缺 `SHARE_TOKEN_SECRET`、`ADMIN_*`、`HTTPS_ENABLED`、`NEXT_PUBLIC_APP_URL`。目前 worker 不 import `auth.ts`，所以 `auth.ts:126-134` 的启动校验没被触发；但 `wechat-auth.ts:14`/`phone-auth.ts:11` 这些同名列一旦进入 worker 的引用链，worker 会在 `main()` 里 throw，被 `:296-299` 打成 `process.exit(1)`，进入 restart 循环 —— 与 CI 的 `worker_restarts=0` 判据（`xiaobaic-ci-deploy.yml:449, 456`）相冲，表现为「部署稳定失败」。
修法：worker 的 env 块要么和 app 对齐，要么显式列出 worker 需要的子集并在文档里钉住；`deep-link.ts`/`email.ts` 用到的 `NEXT_PUBLIC_APP_URL` 目前 worker 缺失 → 飞书/邮件深链回落硬编码域（见 R33）。
谁能修：运检。

---

## F. 迁移、部署与兼容

### R37 — 新列默认值与旧行读取（无问题，记录）
`20261004120000_add_project_restricted`（`NOT NULL DEFAULT false`）、`20261006150000_add_comment_visibility`（`NOT NULL DEFAULT 'PUBLIC'`）、`20261005190000_phone_lookup_index`（可空列，NULL 不撞唯一）、`20261003104910_platform_announcements_feedback`（`userId NOT NULL` + CASCADE，`src/app/api/platform/feedback/route.ts:36-40` 直接 `f.user.id` 因此不会空指针）。这几条形状都对，旧行不会读到 null 崩。

### R38 — 迁移里跑动态 DDL 扫描（次要）
`prisma/migrations/20261014233000_team_id_numeric_guard/migration.sql:57-76`
现象：`DO` 块遍历 `information_schema.columns` 里所有 text 列，对每列 `EXECUTE format('… LIKE %L || m.old_id || %L')`。列名来自系统目录（不可注入），但这段在任何一次迁移回放时都会跑一遍全库列扫描（每列一次全表 count），大库上是一次很长的启动阻塞；异常被 `EXCEPTION WHEN others THEN n := 0` 吞掉，意味着「扫不动」会被当成「没引用」，闸门静默失效。
修法：把这段搬到 `scripts/migrate-team-ids.mts --verify`（已经有类似能力），迁移里只留 CHECK 约束；至少给扫描限定到已知的路径列白名单。
谁能修：后端。

---

## G. 分享短链禁区（只读评审，需业主确认）

### R39 — 需业主确认的三条（均未改）
1. `src/app/api/share/[token]/verify/route.ts:167-169`：`sharePassword` 为空即直接 `{success:true}`。口径是「没设密码=公开」，与 `authMode` 字段并存时以哪个为准值得确认（`src/lib/project-access.ts:289-315` 的 NONE 分支只给 `view`，是对的）。
2. `:137-143, 187-199`：分享 token 明文进审计 details（见 R16）。
3. OTP 键与 studio 登录共用（R8）导致 `/api/share/[token]/send-otp` 发出的码可被 `/api/auth/sms/verify-code` 消费并直接换到 studio 账号令牌 —— 这条从后端侧看是 `phone-auth` 的问题，但影响的入口在禁区内，需要一起定修法。

---

## 扫过但没问题的面

- 原始 SQL：全仓 21 处 `$queryRaw`/`$executeRaw` 全部是 Prisma 标签模板（参数化），包括 `src/lib/platform-access.ts:75-99` 的用量大 SQL、`platform-usage.ts:65-94`、各处 `pg_advisory_xact_lock`；没有一处 `*Unsafe`/字符串拼接。
- 存储路径：所有 `downloadFile/getFilePath/purgeFile` 的路径都来自库里的行（`grep` 全量核过 30 个调用点），没有客户端可控段；`validatePath`（`src/lib/storage.ts:78-101`）覆盖 null 字节、双重解码、反斜杠、`..`、symlink 逃逸，且 S3 模式根本不落本地路径。`/api/content` 的 HLS 清单解析另写了 `normalizeHlsObjectKey`/`resolveHlsObjectKey`（`:41-78`），拒绝绝对 URL 与 `//`，这块处理得比常见水平好。
- CSP/nonce：`src/proxy.ts:33-121` nonce 每次新生、`script-src-attr 'none'`、`object-src 'none'`、`frame-ancestors 'none'`、`form-action 'self'`，`assetPrefix`/CDN/S3 出口用构建期内联值而非运行期 env（`BUILD_ASSET_PREFIX`，`:57-64`），HSTS 只在 HTTPS_ENABLED 下开。`x-nonce` 走请求头传给 SSR 是 Next 16 的正规做法。
- 平台管理接口守卫：`/api/platform/**` 每条都命中平台守卫（脚本核过 13 条，见 R7），`requirePlatformAdmin` 用 `isPlatformAdmin` 而非 `role==='ADMIN'` 判定，注释把理由写清了（`src/lib/auth.ts:637-655`）。
- JWT 校验：所有 `jwt.verify` 都固定 `algorithms:['HS256']`，`type` claim 分族；refresh 轮转 + 重用检测（`auth.ts:286-289`）+ 指纹绑定，`remainingTtl` 走 `jwt.decode` 不泄露。
- bcrypt：`genSalt(14)`、登录时 `DUMMY_BCRYPT_HASH` 抹平时序（`auth.ts:521-523`）、`MAX_PASSWORD_LENGTH` 前置拒绝超长（`encryption.ts:186-206`）。密码策略从 6 位数字换成强度策略（`password-policy.ts`）方向正确。
- 错误回显收敛：`settings`、`settings/notifications`、`users`、`projects/*` 等绝大多数路由把内部异常收成固定文案，本轮 `cf661a1`/`08dc1e5` 修的两处已改对（只回 `ZodError` 的 issue）。
- 飞书/微信 OAuth CSRF：`state` + HttpOnly cookie 双持（`src/app/api/auth/feishu/callback/route.ts:31-37`、`wechat/start`），换到的 user/refresh token 走 `encrypt()` 入库（`:52-53`）。
- 令牌吊销与分享链接吊销：`verifyShareToken` 除了 JWT 本身还查 `isShareSessionRevoked`/`isShareLinkRevoked`（`auth.ts:217-229`），删链接能立刻打掉已发 bearer。
- S3 层：客户端单例 + 缺失 env 直接 throw（`s3-storage.ts:31-71`）、endpoint 协议白名单、HEAD 有 10s `AbortSignal.timeout` 而传输不封顶（取舍有注释）、multipart 分片内存有界（`:256-344`）、`fileExists` 缓存有界 + in-flight 合并 + generation 防回填脏值、版本化桶的真删（`:477-520`，含对 `VersionId='null'` 的实测说明）。
- Redis/BullMQ：连接单例、BullMQ 专用连接按官方要求 `maxRetriesPerRequest:null`（`redis.ts:63-96`）、`consumeTokenAtomically` 的 Lua 认领、durable task 幂等键 + 退避 + 死信日志（`durable-tasks.ts:20-83`）。
- 最小权限 DB 角色：`prisma/roles/app-role.sql` 形状正确（NOSUPERUSER/NOCREATEDB/NOCREATEROLE、只给 DML、`ALTER DEFAULT PRIVILEGES` 兜后续迁移），redis 口令从挂载文件读、不进 argv（`docker-compose.yml:39-49`、`redis.ts:15-19`），`.dockerignore` 排掉 `.env*`、`*.pem/key/crt/p12/pfx`、`certs/`、`uploads/`。
- 限流实现本身：Lua 原子计数（`rate-limit.ts:55-87`）、Redis 故障 fail-closed、`clearAllRateLimits` 用 SCAN 不用 KEYS。问题只在键的维度选择（R3/R4/R10），不在实现。
