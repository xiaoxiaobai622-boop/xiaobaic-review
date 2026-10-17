# 评审报告：计费面红线（ICP）+ 多租户权限
审计区间：`8aa164a^..327d6c7`（73 个提交，2026-10-03 ～ 10-17）
仓库：`/Users/xiaoxiaobai/code/xiaobaic-review`
角色：安全/合规代码评审｜方式：只读（`git show`/`git diff`/`grep`/全文读）｜产出时间：2026-10-17
本报告不含任何凭据内容；涉及密钥/账号/分享键处只给「文件:行」事实。

---

## 第一部分 覆盖面与「已核对通过」清单

### 1.1 计费面进产物：我逐一排除了 6 条路径

| # | 可能让 `src/disabled-billing/` 回到构建/路由的路径 | 结论 | 证据 |
|---|---|---|---|
| P1 | App Router 路由扫描 | 排除 | Next 只扫 app 根 `src/app`；`next.config.js` 全文（1-52 行）没有 `dir`/`output`/`rewrites`/`redirects`；`ls src/app` 下无 `billing`/`orders`/`pricing` 目录。区间 diff 显示 4 条平台订单路由是真的从 `src/app` 删除（`src/app/api/platform/orders/{route,[id]/route,[id]/close,[id]/confirm}` −72/−73/−45/−71 行） |
| P2 | Pages Router 扫描 | 排除 | `src/pages` 只有 `api/uploads/[[...path]].ts`；`src/disabled-billing/pages` 不存在 |
| P3 | import 图把死代码拖回 bundle | 排除（今天） | `grep -rn "disabled-billing" src/ prisma/ next.config.* tsconfig.json .github/ Dockerfile*`：活代码里对 `@/disabled-billing/*` 的 **import 为 0**，命中只有 3 处注释（`src/app/studio/projects/[id]/page.tsx:276`、`src/app/api/platform/teams/[id]/quota/route.ts:11`、`src/lib/platform-access.ts:14`）+ 目录内自引用 |
| P4 | 构建配置间接触达 | 排除 | `next.config.js:19` `serverExternalPackages: ['ioredis']` 只一枚；无 `outputFileTracing*` 任何键；`src/instrumentation.ts:17-22` 只 `import('./lib/seed')` 与 `('./lib/settings')`；`src/worker/**` 被 `tsconfig.json:27` 排除且 grep 无计费字样；`.github/workflows/*` grep `billing|order|payment` = 0 命中 |
| P5 | `tsconfig` 的 `@/*` 别名（`tsconfig.json:22` `"@/*": ["./src/*"]`） | **可解析但不进产物** | 别名让 `@/disabled-billing/**` 在任何 `src/**` 文件里都能一行 import 成功；`tsconfig.json:26` include `**/*.ts`/`**/*.tsx` 覆盖整个目录（`tsconfig.tsbuildinfo` 里确有该目录条目，证明它参与类型检查）。类型检查≠打包，所以今天仍安全；风险在 P3 没有判据守着 → 见 **B3** |
| P6 | 中间件/闸门改写路径 | 排除 | 无 `src/middleware.ts`；`src/proxy.ts:130-132` matcher 只做头/CSP，不 rewrite；全仓无 `rewrites` |

`tsconfig.tsbuildinfo` 未被 git 跟踪（`.gitignore` 有 `*.tsbuildinfo`），不会随仓库分发。

### 1.2 权限面核对通过项（每条都读了实现）

1. **平台管理端鉴权链完整**：`src/app/api/platform/**` 共 12 个 handler，逐一确认全部第一个动作是 `requirePlatformAuth`；该函数（`src/lib/auth.ts:464-468`）→ `getPlatformUserFromRequest`（`:451-462`）→ 校验 `type === 'platform_access'` + 三重吊销（`:373-385`）→ **回库重读 `isPlatformAdmin`**；`refreshPlatformTokens`（`:428-433`）在重签前再查一次并把会话 revoke。团队 OWNER/ADMIN 角色开不了这些路由，与 `requirePlatformAdmin`（`:637-655`）的注释口径一致。
2. **历史越权点已修**：`GET /api/teams/by-slug/[slug]` 在 `6b0412c` 删掉 `_count { members, projects }` 与 `avatarUrl` 并补 401 门禁（`src/app/api/teams/by-slug/[slug]/route.ts:13-27`，diff 可核对）。
3. **受限项目（`ec0ea73`）的双 OR 处理正确**：`src/lib/project-access.ts:74-91` 把「指派范围」和「restricted」两枚 OR 都放进 `AND` 数组，避开了 JS 对象同名键后者覆盖前者——这正是注释里点名的「403 变 200」缺陷；列表侧 `:26-37` 与详情侧同一谓词。我另外核了 5 个 `projectAccessWhere` 调用点（`comments/for-me:54`、`calendar:45`、`calendar/upcoming:33`、`projects:53`、`analytics:36`）：没有一处在外层再挂同名 `OR` 造成覆盖。
4. **新增 `memberCount` 的门禁顺序正确**：`src/app/api/projects/[id]/route.ts:60-62` 先 `canAccessProject` 拒 403，`:127` 才数人，口径与名单共用 `projectViewersWhere`（受限项目那半不一致，见 **B8**）。
5. **项目成员增删有双重闸门**：`src/app/api/projects/[id]/members/route.ts:129-150`（POST：`canAdministerProject` + `requireProjectWritable` + 只允许本团队 ACTIVE 在册者）与 `members/[userId]/route.ts:35-45`（DELETE 同上，无授权行诚实回 404）。
6. **手机号 PII 链路成立**：`src/lib/phone-field.ts:78-113`（写=加密+keyed 摘要，列表=掩码）、`src/lib/personal-data-reveal.ts:19-38`（展开必记审计，且绕开可被关掉的 `logSecurityEvent` 开关，库里只落掩码）、`.../reveal-phone/route.ts:20-32`（`requireApiAdmin` + `canAccessProject` + 20 次/15 分钟限流 + `no-store`）。`src/lib/user-contact.ts:1-3` 与 `04ed1dd` 一起把 `encryption.ts` 挡在浏览器包外。审计侧 `src/lib/video-access.ts:403-411` 落库前掩掉 details 里的邮箱、`:435-437` 把 actor 归到 `userId` 列。
7. **Feishu push 越权已修（`3409430`）**：`src/app/api/feishu/push/route.ts:63-65` 与 `push/[projectId]/preview/route.ts:48-50` 补 `canAccessProject`；两处把 query 里的 `videoId` 从 `findUnique` 改成 `findFirst({ id, projectId })`，堵掉跨租户取片；`push/[projectId]/route.ts:11-31` 转发到同一枚已加闸 handler，没有旁路。
8. **管理会话闲置超时改成服务端判定（`7331b69`）**：`src/lib/auth.ts:196-205`（access token 校验处）与 `:292-302`（refresh 处）都在发新令牌前判 idle 并 revoke，堵住「闲置超时只告诉浏览器、refresh token 照样活 30 天」。
9. **CSP 没有因为 CDN 改动而放宽**：`src/proxy.ts:91-105` 仍是 nonce `script-src` + `script-src-attr 'none'` + `object-src 'none'` + `frame-ancestors 'none'` + `base-uri 'self'`；`assetOrigin`（`:60-64`）只往 4 条指令追加一个 origin，不引入 `unsafe-*`。`next.config.js:39-51` 的静态头只覆盖 `brand|favicon|manifest|robots|sw`，不与 proxy 冲突。
10. **DB 账号降权（`b583cc9`）**：`prisma/roles/app-role.sql:19-27` `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`、只给 DML；迁移用独立 `MIGRATION_DATABASE_URL`（`docker-entrypoint.sh:243`）。`7ddb00b` 把 redis 口令从 argv 挪到挂载文件。
11. **营销/对外文案干净**：`src/app/(marketing)`、`src/app/page.tsx`、`src/app/home-client.tsx:15`、`src/components/marketing/HubPage.tsx:77-78`（刻意不写 schema `offers`/价格）、`src/app/llms.txt/route.ts`、`src/app/sitemap.ts:19`（只收首页/枢纽/隐私条款/文稿）——无「付费/下单/价格/续费」字样；`content/marketing/compare--fenzhen.md:26` 只谈竞品计费结构且明写「这一页一个数字都不写」。
12. **`/team-id` 号池不打架**：`src/lib/team-id.ts:15-17,46-54,70-84` 把团队 ID / slug / `tm_` 分享键三串收在同一枚 `isTeamId` 判据下，发号前互斥排重；跟踪的迁移脚本里没有硬编码分享键（`scripts/migrate-team-ids*.mts` 里的 `tm_` 全是 `randomBytes` 现场生成），真映射表由 `.gitignore:64-66` 挡在库外。

**覆盖面自陈（没做到的部分）**：本机不许 build，所以「`.next` 里没有计费 chunk」我只能从 P1-P6 的配置侧证明，没有产物级证据；生产站按要求没打。这两件事需要一次 CI/生产侧动作补验，见 B3 与 B6 的「谁能修」。

---

## 第二部分 问题清单

### B1 ｜计费面的「收款通道」整条还在构建、路由与渲染里 — **阻断**
**位置**
- `src/app/platform/settings/page.tsx:19`（import）、`:194`、`:760`（侧栏 `{ id: 'transfer', label: t('transfer.title'), icon: QrCode }`）、`:865`（移动端实例）、`:907-908`（桌面端实例）
- `src/components/settings/TransferSettingsSection.tsx:61,86,119,144,177-193`（读/写收款配置、上传收款码）
- `src/app/api/settings/transfer/route.ts:41-96`（GET/PATCH 收款四要素）、`:98-155`（POST 上传收款码字节）
- `src/app/api/settings/transfer/qr/route.ts:11-36`（发收款码图）
- `src/lib/settings.ts:476-497` `getTransferConfig()`
- `prisma/schema.prisma:809-815`（注释自证「对公转账信息（**一期唯一收款通道**）」，5 枚列）

**现象**：`d494af3`（10-04）搬走的是订单/套餐/支付 provider 那一半，收款这一半一行没动。今天从生产站可以：平台管理员进 `/platform/settings` → 侧栏有「收款信息」→ 填户名/收款账号/开户行 → 上传一张收款二维码 → `GET /api/settings/transfer` 回这套配置。这就是一条能收钱的完整通道。`git log --all -- src/components/settings/TransferSettingsSection.tsx` 只有 `e984ac0` 一条，10-04 之后没人碰过它。
**为什么是问题**：红线 1 明确「支付 provider、「去续费」这类入口，一个都不许出现在会被构建/路由/渲染到的代码里」，且没有 ICP 许可证 ⇒ 任何付费能力都不许进生产。收款账号+收款码是比「下单入口」更硬的付费能力。附带：`src/lib/settings.ts:477` 的注释「它一次下单才被读一次」和 `TransferSettingsSection.tsx` 的文案「客户现在无法下单」都在替这条通道作证。
**修法方向**：把 transfer 三件套（组件 + 2 条 route handler + `getTransferConfig`）整体 `git mv` 进 `src/disabled-billing/`，`Settings` 那 5 枚列保留但活代码不再读写；判据 B3 里补一条「`src/app`、`src/components`、`src/lib` 里不许出现 `settings/transfer`」。若业主认为后台必须留着收款位（等许可证下来就能一键开），那也要把这条事实写进风险台账，而不是让它默默在产物里。
**谁能修**：代码侧我方可做（搬目录+改判据）；**需要业主决策**（内测期到底允不允许存在「能收钱的位置」，以及已收/在途的转账如何清算）。

### B2 ｜付费字样会出现在生产页面 HTML 和一条匿名接口上 — **阻断**
**位置**
- `src/app/layout.tsx:95` `<NextIntlClientProvider messages={messages}>`（`messages` = 整棵 `src/locales/zh.json`，136 KB；`src/i18n/request.ts:4-11` + `src/i18n/locale.ts:69-80` 全树加载、不裁剪）
- `src/locales/zh.json:1390-1411` `settings.transfer.*`：`title`「收款信息」、`description`「客户下单后看到的对公转账说明。」、`notConfigured`「户名和收款账号还没填，客户现在无法下单。」、`accountNo`「收款账号」、`qr`「收款码」；`en.json` 同形（"Payment details" / "The bank-transfer instructions customers see after placing an order." / "so customers cannot place orders yet"）
- `src/locales/zh.json:540` `projects.teamExpired` =「团队已到期，续费后可继续使用」（`en.json` "Your team has expired. Renew to continue."）
- `src/app/api/settings/language/messages/route.ts:12-31`：**无鉴权**公开接口，`?locale=zh` 直接 `NextResponse.json({ locale, messages })` 回整棵树，且带 `Cache-Control: public, max-age=300`

**现象/为什么是问题**：显式把整棵 messages 交给 provider 会让 next-intl 把它序列化进 RSC payload，所以每一个生产页面（包括公开的首页 `/`、`/[shareCode]` 短链、`/login`）的 HTML 里都带「收款信息 / 客户下单后…… / 续费后可继续使用」；`de.json`、`nl.json` 同构。这条不需要访问生产站就能从代码判定，也正是「只许代码侧推断」要求我查的口径。匿名 messages 接口把这批字样进一步变成任何人可枚举的对外文案。红线 1 说的是「不许出现在会被构建/路由/**渲染**到的代码里」，这三处三者都占。
**修法方向**：(a) B1 落地后删掉或一并搬走 `settings.transfer` 这组键（四语一起）；(b) `projects.teamExpired` 改成不含「续费」的说法（见 B11，这枚码在生产已不可达）；(c) messages 接口按分享页实际需要只回 `share`/`common` 那几层，或改成需登录。
**谁能修**：代码侧我方可做；(c) 需要业主决策（确认分享页多语言与老客户端 bundle 不受影响）。

### B3 ｜唯一守着红线的判据既没进 CI，也抓不到 B1/B2 — **阻断**
**位置**：`scripts/check-billing-out-of-build.mts`（整文件）；`package.json:13` `check:static`；`.github/workflows/xiaobaic-ci-deploy.yml`（`npm run check:static` + `npm run build` 两步）
**现象**
1. `check:static` 列的 9 条脚本里没有它；`.github/` 全目录 grep `billing` = 0 命中 ⇒ 这条红线**从来没被自动执行过**，只在有人手动跑本机时存在。
2. 判据自身的盲区：`:133-139` `REF_PATTERNS` 只认 `@/lib/billing`、`@/lib/payment-provider`、`@/components/platform/Order`、`'/api/billing`、`'/api/platform/orders` 五枚模式，**不含 `@/disabled-billing/`**。明天任何人在 `src/app` 里写一行 `import { createOrder } from '@/disabled-billing/lib/billing'`，因为 `tsconfig.json:22` 的 `@/*`→`src/*` 别名这行 import 直接可解析、`npm run build` 直接通过、而这条判据照样 ALL PASS——计费代码当天回到 bundle。
3. `:67-74` `MUST_404` 没有 `/api/settings/transfer`、`:98` 的 `src/app` 路径段正则 `/billing|orders/i` 也抓不到 `settings/transfer` ⇒ 它对 B1 整块完全盲。
4. `:175-179` C1/C2 反过来**断言** `model Plan/Order/OrderEvent` 与 `20260924180000_add_billing_orders` 必须还在——把「付费表留在生产库」写成了不可回退的判据（对照 1.1/P5 的语义：作者要的是「搬≠删」，但判据现在禁掉了将来唯一能真正摘干净的那一步）。
**为什么是问题**：红线的执行机制本身失效。当前「已核对通过」的 1.1 六条全靠人工读配置维持，一次普通 PR 就能破口，而且破口时 CI 是绿的。
**修法方向**：把该脚本改成零凭据零网络的纯静态判据（A 组 + B 组 + 新增：禁止 `@/disabled-billing/` 出现在 `src/app|src/components|src/lib|src/worker|src/pages|src/proxy.ts`、禁止 `settings/transfer` 出现在活代码、禁止活代码 `prisma.order|plan|paymentAttempt|orderEvent|teamActivationCard`），并进 `check:static`；另加一条「生产产物路由清单里不许出现 billing/orders」的判据（读 `.next/app-route-routes`/manifest），这条只能在 CI 里跑。C1/C2 改成信息性输出而不是断言。
**谁能修**：代码侧我方可做；「产物级判据进 CI」需要生产侧动作（CI 能 build，本机不能）。

### B4 ｜计费数据面整体长在镜像和生产库里 — **重要**
**位置**：`prisma/schema.prisma:1284-1307`（`Plan.priceCents/currency/durationDays`）、`:1309-1348`（`Order.amountCents/status/invoiceTitle/invoiceTaxNo`）、`:1350-1363`（`PaymentAttempt.provider/outTradeNo/amountCents/raw`）、`:1365-1377`（`OrderEvent`）、`:189-208`（`TeamActivationCard.codeHash/codeLast4/planKey`，卡密表）、`:169-187`（`TeamQuota.source` 默认 `"PLAN"` + `sourceOrderId`）；迁移 `20260816080000_add_platform_features_quotas`、`20260903090000_add_team_trials_activation_cards`、`20260924180000_add_billing_orders`；`docker-entrypoint.sh:243-249`（开机 `prisma migrate deploy`）；`Dockerfile:107-108`（把 `prisma/` 与整个 `src/` 拷进 runner）。
**现象**：生产库里这 5 张付费/卡密表是真的存在（迁移没撤）；`prisma generate` 出来的 client 带着 `prisma.order`/`prisma.plan` 类型与运行时方法；计费实现源码与计费判据脚本随镜像一起发布。
**为什么是问题**：红线要求的是「不进构建、不参与路由」；今天做到的是「不路由」，**源码和数据模型都在生产**。对合规检查而言，「有 Order/Plan/TeamActivationCard 三张表 + 一套 ¥ 计价代码在容器里」与「已对外收费」之间只差一次人为点击。
**修法方向**：runner 停止 `COPY /app/src`（改成只 COPY 必要目录）或在 `.dockerignore` 里加 `src/disabled-billing`；表要么留（写清台账：无生产者、无路由、无 UI）要么随 B1 一起处理。
**谁能修**：代码侧我方可做（镜像瘦身）；**需要业主决策**（删表不可逆，且现在被 B3 的 C1 判据明令禁止）；需要生产侧动作（重打镜像 + 确认现网镜像里已带这些文件）。

### B5 ｜活代码仍在读写计费表，并对客户说「账单」 — **重要**
**位置**：`src/app/api/teams/[id]/route.ts:175`（`prisma.order.count`）+ `:193-195`（409「该团队已有账单记录，不能删除，请联系平台」）；`src/app/api/users/[id]/route.ts:399-403`（`prisma.order.count` + `prisma.orderEvent.count` +「该用户已有账单记录，不能删除」）；`src/app/api/auth/merge-accounts/route.ts:95-100`（`tx.orderEvent.updateMany` 改写订单审计链）；`src/app/api/platform/teams/[id]/quota/route.ts:54`（写 `source: 'MANUAL', sourceOrderId: null`）；`src/app/api/teams/[id]/route.ts:22-24`（注释「so the owner can view the status and **redeem an activation card**」）。
**为什么是问题**：这四条 route 全在 `src/app` 下、都会进产物，红线 1 的「一个都不许」在字面上已被违反。功能上它们现在是死分支（10-04 起 `Order` 没有任何生产者，`order.count` 恒 0），所以危害不是「多拦了一次删除」，而是**对客户的付费性陈述**（"已有账单记录"）留在了生产响应里，并且 `merge-accounts` 会改写计费审计链——一旦将来 unpark，这条链就成了伪造历史的地方。
**修法方向**：三处 `prisma.order*/orderEvent*` 读写按 B1 的口径一起搬走或注释掉并把 409 文案换成「请联系平台」之外的中性理由；`quota` 那行只留 `source: 'MANUAL'`、`sourceOrderId` 不再出现在活代码里。
**谁能修**：代码侧我方可做。

### B6 ｜生产容器里一条命令就能把计费全链路跑起来 — **重要**
**位置**：`src/disabled-billing/scripts/check-billing-read-routes.mts:70-79`（直接 `import { GET as GET_ORDERS, POST as POST_ORDERS } from '../app/api/billing/orders/route'`、`'../app/api/billing/orders/[id]/intent/route'`、`'../app/api/billing/transfer/qr/route'`，并 import `@/lib/auth`、`@/lib/db`、`@/lib/settings`、`@/lib/encryption`）；`:14` 的用法说明就是 `npx tsx --env-file=.env src/disabled-billing/scripts/...`；`:707` `order.createMany`、`:759,771` `teamQuota.upsert`、`:877` `settings.update`（写假收款账号）、`:347-355` 批量 `deleteMany`（order/plan/teamMember/team/user）；`:38` 自陈「那一行 `Settings` 会暂时冻在脚本自造的假收款账户上」。`Dockerfile:108` 把这些脚本拷进 runner；`package.json` 里 **`tsx` 在 `dependencies`**（不是 devDependencies），runner 有 `node_modules/tsx` + 生成的 prisma client + `.env` 挂载。
**为什么是问题**：「不进构建」实际只挡住了「Next 注册路由」这一件事。计费 handler 在镜像里可 import、可执行，跑一遍就是完整下单→报付款→落额度→写到期日，还会覆盖 B1 那套真在用的收款配置、并按 `:347-355` 删团队/删用户。这不是理论风险：脚本头部就写着怎么跑，`.env` 就在容器工作目录。
**修法方向**：(1) `.dockerignore`/runner 不带 `src/disabled-billing`；(2) 所有 `check-*billing*` 脚本开头加一道数据面守卫（拒绝 `APP_ENV=production` 或 `DATABASE_URL` 主机不在本地白名单）；(3) 把 `tsx` 挪出 `dependencies` 需要单独评估（`package.json:15` 的 `worker` 脚本在用）。
**谁能修**：代码侧我方可做（1、2）；需要生产侧动作（重打镜像并在现网确认目录已消失）；(3) 需要业主决策。

### B7 ｜多团队账号的「当前团队」解析不确定，写侧可能落进另一个团队 — **重要**
**位置**：`src/lib/auth.ts:614-622`（`requireApiAdmin` 无 `X-Team-Id` 时的 `findFirst` fallback）与 `:668-679`（`requireApiUser` 同形 fallback），两处**都没有 `orderBy`**；对照 `src/lib/team-access.ts:34-38` 的注释——「Routes must not re-resolve this themselves: **a looser query can silently pick a team the caller was never authorized for**, so writes land outside the team the UI is showing」，而 `:45-51` 的 `getActiveTeamMembership` 才是带 `orderBy: { createdAt: 'asc' }` 的那一份。触发面：`src/lib/api-client.ts:155` 只在拿到 teamId 时才发头，所以老客户端/桌面端/直连接口会走 fallback；`src/app/api/projects/route.ts:141-147` 明写 `const teamId = admin.authorizedTeamId` 并用它建项目（注释还声称「requireApiAdmin has already picked and validated the acting team」）。
**为什么是问题**：同一账号在 A、B 两队都是管理员时，无头的 `POST /api/projects` 会把项目建到哪一队取决于 Postgres 返回的行序（无 ORDER BY 不保证，UPDATE/VACUUM 后能变）——跨租户落写 + 配额检查（`:153-160` 用同一枚 teamId 查 quota/usage）检查的不是同一个团队。读侧因为 `canAccessProject` 从项目自己所属团队解析（`project-access.ts:115-124`）而安全，所以这是**写侧/可用性**问题，也正是 `team-access.ts` 那份注释禁止的写法。
**修法方向**：两处 fallback 改为调用 `getActiveTeamMembership(user)`，或至少补同一枚 `orderBy: { createdAt: 'asc' }`；`src/app/api/projects/route.ts` 的注释同步改成指向唯一解析处。
**谁能修**：代码侧我方可做。

### B8 ｜受限项目的「谁能打开」人数/名单口径不算 `restricted` — **重要**
**位置**：`src/lib/project-access.ts:103-113` `projectViewersWhere`（三条 OR：角色非 MEMBER / 范围非 ASSIGNED_ONLY / 本项目有授权行——**没有 restricted 分支**），真准入在 `:77-90`（受限项目仅项目成员 + 团队 OWNER/ADMIN）。消费方：`src/app/api/projects/[id]/route.ts:127`（`memberCount`）、`src/app/api/projects/[id]/members/route.ts:37-40`（名单）与 `:60+`（候选池）。
**现象/为什么是问题**：一枚 `restricted: true` 的项目上，函数会那些「普通成员、范围是全部项目、但没被指派进该项目」的人算进「能打开这个项目的人数」并列进名单（还带 email、掩码 phone，`members/route.ts:50-52`），而他们实际拿 403。`project-access.ts:95-102` 与 `projects/[id]/route.ts:119-126` 两段注释都把「人数说能进 == 端点真让进」当成不变量在承诺，判据 `scripts/check-project-member-count.mts:186-192`（B4/B4b）也只钉「三个条件都在」，钉不出「与 restricted 同源」。管理员会因此以为受限项目没生效，或反过来按名单判断「这些人都看到过这份片子」——对内容保密预期是直接误导。
**修法方向**：`projectViewersWhere` 加 `restricted` 分支（受限项目只留 OWNER/ADMIN + 被指派者），判据补一条「restricted 时人数必须与准入 OR 同源」。
**谁能修**：代码侧我方可做。

### B9 ｜`GET /api/settings` 把整行平台配置（含 VAPID 私密密文与收款账号）发给前端 — **重要**
**位置**：`src/app/api/settings/route.ts:40-66`（`:53-59` 注释自称 "SECURITY: Never send SMTP password in cleartext"，但只对 `smtpPassword` 做掩码，其余 `...settings` 全行展开）；涉及列 `prisma/schema.prisma:869` `vapidPrivateKey`、`:868` `vapidPublicKey`、`:811-815` transfer 五列、`:819-822` SMTP 全套。同一形状在 PATCH 响应里再来一次（`:440-445`）。
**为什么是问题**：门禁是 `requirePlatformAdmin`（`:27`）所以不是越权，但「只掩一枚口令」的口径只做了一半：`vapidPrivateKey` 是 `encrypt()` 后的密文（`src/lib/push-notifications.ts:88-92`）却整串交给浏览器——一旦 `ENCRYPTION_KEY` 泄漏，抓包/备份里就是可直接解密的料，而这张表还带 `smtpUsername`、`appDomain`、安全阈值等运营画像。收款账号那 5 列（刻意明文，`schema:809` 注释）本身就该随 B1 一起离开产物。
**修法方向**：GET/PATCH 改 select 白名单（界面要什么给什么），私钥类列一律不出表；掩码占位符只保留给「要回填表单」的口令类字段。
**谁能修**：代码侧我方可做；收款账号是否继续明文存需要业主决策。

### B10 ｜运营后台在替一个不存在续费流程说话 — **次要**
**位置**：`src/app/platform/teams/[id]/page.tsx:254`（注释仍指 `OrderConfirmDialog`，该组件在 `src/disabled-billing/`）、`:259`「额度来源：这里手动改过，**续费时会被套餐重置**」、`:260`「额度来源：**随套餐续费写回来**」；`prisma/schema.prisma:183` `source String @default("PLAN")`，`src/app/api/teams/route.ts:110-114` 新建团队只写 `...BETA_QUOTA`（不写 source）⇒ 落默认 `"PLAN"`。`src/lib/platform-access.ts:44-48` 的 `recorded` 只挡掉了「库里没行」那一档。
**为什么是问题**：每一支 10-04 之后新建的团队，其后台详情页都会显示「额度来源：随套餐续费写回来」，而续费的生产者（`fulfillOrder`）已不在产物里。这既是假话（对照 `bb92845`/`f3235ab`/`6d27802` 这一串「后台不许说不晓得的事」的自我要求），也是对运营的一句付费流程陈述。
**修法方向**：两句话换成「平台默认额度 / 运营手动调整过」；`source` 那档语义留给 unpark 那天。
**谁能修**：代码侧我方可做。

### B11 ｜不可达的「续费」文案仍打进闸门与 bundle — **次要**
**位置**：`src/lib/team-writeable.ts:20-22`（`isTeamSubscriptionActive` 在 `src/lib/platform-access.ts:20-23` 恒 `return true`）→ `TEAM_EXPIRED` 分支永不触发；但 `:34` 那枚 `'团队已到期，续费后可继续使用'` 字面量照样进产物，并经 B2 的两条通道进浏览器（`zh.json:540`/`en.json`）。
**为什么是问题**：这是「行为上已退役、文案上还活着」的典型残留，也正是红线 1 想扫掉的那一类。另外 `team-writeable.ts:6-8` 的注释还在用 `billing-pricing.ts` 的 `BillingErrorCode` 解释词表，而该文件已在 `src/disabled-billing/`。
**修法方向**：闸门里去掉到期分支（或保留分支但把文案换成中性），注释同步指向已存在的活模块。
**谁能修**：代码侧我方可做。

### B12 ｜`POST /api/teams/[id]/activate` 仍是一条注册在生产路由表上的卡密接口 — **次要**
**位置**：`src/app/api/teams/[id]/activate/route.ts:12-17`（无鉴权、恒 410、文案「卡密已下线，内测期无需激活」）。
**为什么是问题**：`:6-11` 的理由（给已发布客户端一句 410 而不是「从来没存在过」）站得住，但副作用是路径留在路由清单里，且这句话公开确认了「曾有卡密收费体系」——卡密表 `TeamActivationCard` 还在生产库（B4）。
**修法方向**：保留 410 就不必再在响应里写「卡密」，改成「此接口已下线」；或随 B1 一起摘掉路由、由桌面端版本判定兜住。
**谁能修**：**需要业主决策**（老客户端兼容承诺优先还是对外口径优先）。

### B13 ｜团队名册把全队邮箱发给任何 ACTIVE 成员，与项目名册口径相反 — **次要**
**位置**：`src/app/api/teams/[id]/route.ts:44-62`（members→user select 含 `email`、`phone`）、`:112-115`（只对 phone 掩码，email 原样）、`:57`（`_count { projects, members }`）、门禁 `:19-27`（任何 ACTIVE 成员即可）；对照 `src/app/api/projects/[id]/members/route.ts:50-52` 明确 `email: canManage ? ... : null`，理由写在 `:51`「普通成员看名单是为了认人，不是拿同事邮箱去群发」。
**为什么是问题**：同一件事（批量名册里的联系方式）两个端点两个口径，`PIPL` 最小必要一侧偏向项目名册那个。另外 `_count` 的暴露与 `6b0412c` 修 `by-slug` 时的判断（成员数/项目数是可枚举的经营信息）相左，差别只在这里要求先登录——同团队成员拿自家数字算不上越权，但两处判据不一致要认。
**修法方向**：团队名册的 `email` 按 `membership.role` 收口，与项目名册共用一份展示规则。
**谁能修**：代码侧我方可做；**需要业主决策**（团队内邮箱是否算共享信息，这是产品口径）。

### B14 ｜`PATCH /api/platform/teams/[id]/quota` 给不存在的团队造额度行，且 0 值即「不限」 — **次要**
**位置**：`src/app/api/platform/teams/[id]/quota/route.ts:41-55`（不校验 `id` 是否存在就 `teamQuota.upsert({ create: { teamId: id, ...BETA_QUOTA, ...data } })`）；`QUOTA_MINIMUMS`（`:12-17`）允许 `maxProjects/maxVideos = 0`，而 `src/lib/platform-access.ts:16-18` `isUnlimitedQuota = value <= 0`。
**为什么是问题**：外键（`schema:186`）会把误拼变成 500 而不是脏行，但错误没被翻译成 404，运营界面上就是一次无名失败；更实际的是「0＝不限」这枚语义：一个输入框里的 0（本意「不给项目」）等于给这支团队解开项目数上限，与 `:49-53` 注释担心的「omitted key 不是 50 videos」是同一族问题。
**修法方向**：先 `team.findUnique` 校验存在性；`maxProjects/maxVideos` 的 0 在界面上明确标成「不限」再让运营确认。
**谁能修**：代码侧我方可做。

### B15 ｜CSP 的 CDN origin 解析失败被静默吞掉 — **次要**
**位置**：`src/proxy.ts:60-64`（`process.env.BUILD_ASSET_PREFIX` → `new URL(prefix).origin`，`catch {}` 空吞）；来源 `next.config.js:9,15-16`（构建期内联）与 `Dockerfile:59-60,72-73`（build/runner 两枚 ARG）。
**为什么是问题**：`ASSET_PREFIX` 被写成相对值、带空格外的非法字符或漏协议时，`assetOrigin` 静默为空串 ⇒ 产物里 CSS/JS 指向 CDN、CSP 的 `script-src`/`style-src`/`font-src` 只放行 `'self'` ⇒ 全站脚本被自己拦死且**日志里一行都没有**。`14dbda7`/`5c221ec` 两个提交处理的正是「半套前缀」这一族，这是它的另一面。
**修法方向**：`catch` 里 `logWarn` 并带上前缀原文（前缀不是凭据）；或在 `next.config.js` 构建期校验非空时必须是绝对 http(s) URL，不合格直接 fail build。
**谁能修**：代码侧我方可做。

---

## 第三部分 复核用的命令与判据落点（可复跑）

```
git diff --stat 8aa164a^..327d6c7                     # 291 文件 / +19862 / -3915
grep -rn "disabled-billing" src/ prisma/ next.config.* tsconfig.json .github/ Dockerfile*
ls src/app | rg -v "^(api|studio|platform|share|...)" # 无 billing/orders/pricing 目录
rg "settings/transfer|getTransferConfig|transferAccount" src/app src/lib src/components
rg "prisma\.(order|orderEvent|paymentAttempt|plan|teamActivationCard)" src/app src/lib src/worker scripts/
rg "billing|disabled|续费|下单|收款" package.json .github/ .dockerignore Dockerfile
```
已知落空的判据：`scripts/check-billing-out-of-build.mts:133-139`（不含 `@/disabled-billing/`）、`:67-74`（`MUST_404` 无 `/api/settings/transfer`）、`:98`（路径段正则抓不到 `settings/transfer`）、`:175-179`（反向断言 Order/Plan 必须在）；`scripts/check-project-member-count.mts:186-192`（钉住三个条件但钉不住 restricted 同源）；`scripts/check-drift-guards.mts`（零条计费判据）。
