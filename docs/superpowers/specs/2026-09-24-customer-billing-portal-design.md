# 逐帧审阅 · 客户自助开通与续费（一期）

日期：2026-09-24　状态：待评审，未实现

> **工作边界（本设计与后续所有改动的硬约束）**：只停留在本地工作区
> `/Users/xiaoxiaobai/code/xiaobaic-review`。**不 `git commit`、不 `git push`、不触发部署、
> 不连生产服务器。** 上线是独立的、需要他明确开口的动作。
> 他本人前台跑着 `next dev`（端口 3000），`npm run build` 会写 `.next` 冲掉这个进程 ——
> 验证门禁只用 `npx tsc --noEmit` + `npx eslint <改动文件>`，需要构建验证时先请他停服务。
> 动态验证只打本地 3000，本地凭据仅限本地，不写进任何文件、日志或提交。

## 1. 定位（已确认的口径）

服务对象是**租户（内容方团队）自己**，不是他内部的运营台。第一期刀口：**开通与续费不再靠人肉**。

三轮问答定下来的三件事，加上他后补的三个事实：

| 已确认 | 含义 |
|---|---|
| 客户自助门户 | 客户在自己登录的 `/studio` 里看套餐、下单、看账单 |
| 收款走微信支付、全自动 | 目标形态，但被下一条挡住 |
| 「我的域名备案还没有下来那些先留着，接口做好先留着」 | 一期**不接任何支付通道**，只把 `PaymentProvider` 接口和 `PaymentAttempt` 表做好；通道下来加一个实现即可 |
| 「我有企业营业执照」 | 微信支付商户号可申请，资质无阻塞，只等备案 |
| 「不用卡密了，那只是之前过度方案」 | **卡密不再是权益落地的目标模型**（本文件第 9 节处理存量） |

一句话：**一期 = 客户自助下单 + 运营点一次「确认到账」→ 权益自动生效**；二期 = 把"点确认"换成微信回调，其余零改动。

**"不再靠人肉"的准确边界**（必须说清，否则会误期待）：没有支付通道时，"钱到账了"这件事总得有人看一眼银行流水。一期消灭的人肉是**手改数据库、手算到期日、手发卡密、手动调额度**；留下来的只有一次点击的确认。二期这次点击也消掉。

## 2. 非目标

- 不接微信支付、不做扫码/JSAPI/H5 任何一条支付链路（备案未下）。接口留形状，实现不写。
- 不做自动续费/委托代扣。即使通道下来，"到期自动扣款"需要单独的签约权限，不属于本期范围。
- 不做优惠券、促销、多币种（`currency` 恒 `'CNY'`）。
- 不做自动开票：只收抬头与税号两个文本，人工开。
- 不做退款流程（`CLOSED` 之外不新增状态，已付款订单要退就走线下 + 平台端手改额度）。
- 不做到期提醒邮件、不引入任何 cron / 定时任务（仓库现在一个都没有）。
- 不动定价策略本身：`Plan` 一期只有 MONTHLY 一条种子。

## 3. 现状事实（证据）

写设计前先盘清"今天到底发生了什么"，四条都有文件行号：

1. **权益落地只有两个写入。** `src/app/api/teams/[id]/activate/route.ts:61-66` 写
   `Team.{status, subscriptionPlan, subscriptionStartedAt, subscriptionExpiresAt}`，
   `:71-86` upsert `TeamQuota` 四个额度字段；续期叠加规则在 `:57-60`（未到期则从现到期日往后加，
   已到期则从"现在"往后加）。本设计的新模型完全复用这段语义。
2. **卡密承担三件事，只有一件是落地**：发卡（`src/app/api/platform/cards/route.ts:53`）、
   人肉把码发给客户、兑码（`src/app/studio/team/page.tsx:98` → 上面的 activate 路由）。
   第 1、2 件是"没有支付通道时把收款信息搬进数据库"的过渡代理 —— 他否掉的正是这两件。
3. **"到期"今天完全不拦任何东西。** `isTeamSubscriptionActive`（`src/lib/platform-access.ts:25`）
   全仓库只在 activate 的响应里被用过一次；访问门禁只有 `Team.status === 'ACTIVE'`
   （`src/lib/team-access.ts:40`、`:48`）。到期团队照样能建项目、上传、邀请成员。
   `subscriptionExpiresAt` 为 `null` 在现有多处渲染里就是"长期有效"
   （`src/components/TeamOverview.tsx:41`、`src/components/TeamSwitcher.tsx:46`、
   `src/app/studio/team/page.tsx:45`）—— 现网团队全在这个状态。
4. **额度只有硬编码 + 手改两条路。** `src/lib/platform-access.ts:14-19` 的 `MONTHLY_QUOTA`
   写死在代码里；运营改额度走 `/platform/teams/[id]` 的四个数字框
   （`src/app/platform/teams/[id]/page.tsx:143-161`）→ PATCH
   `src/app/api/platform/teams/[id]/quota/route.ts:30`，直接 upsert，无金额、无凭据、无留痕。
   卡面上那五个额度字段（`prisma/schema.prisma:171` `TeamActivationCard`）是第二份平行真相。

补充事实：`src/app/platform/cards`、`src/app/api/platform/cards` 之外没有任何支付相关代码；
微信侧只有登录（`WECHAT_WEB_APP_ID/SECRET`、`WECHAT_OAUTH_REDIRECT_URI`），
没有商户号、APIv3 密钥、商户证书。全仓库无 `AuditLog` 类模型。

## 4. 数据模型

一个迁移完成，**纯新增**：新增 4 张表 + `TeamQuota` 两列 + `Settings` 五列（§4.6）。
不删列、不删表、不改任何存量行。

### 4.1 `Plan`（价格表，运营可改，取代代码里的 `MONTHLY_QUOTA` 与卡面字段）

| 字段 | 说明 |
|---|---|
| `key` (unique) | `MONTHLY`；写进 `Team.subscriptionPlan`，沿用现有字符串值，不新造枚举 |
| `name` | 展示名（中文），一期不做套餐名四语翻译，`name` 存原文 |
| `priceCents` / `currency` | 分为单位；`currency` 默认 `CNY` |
| `durationDays` | 一个周期的天数，MONTHLY = 30 |
| `maxMembers` / `maxProjects` / `maxVideos` / `maxStorageGB` | 落进 `TeamQuota`；`0` 或负数=不限（`isUnlimitedQuota`，`platform-access.ts:21`） |
| `active` / `sort` | 门户只列 `active=true`，按 `sort` 排 |

种子：**MONTHLY / 30 天 / 10 人 / 0 项目 / 0 视频 / 50GB**，与 `platform-access.ts:14-19` 逐字段相同。
这条是硬要求：上线那一刻现网额度不能发生任何变化。

### 4.2 `Order`（一笔生意）

`teamId` · `planKey` · `periods` · `amountCents` · `currency` · `reference`（unique，转账备注码） ·
`status` · `createdById` · `reportedAt` · `reportNote` · `paidAt` · `fulfilledAt` · `fulfilledById` ·
`periodStart` · `periodEnd` · `invoiceRequested` · `invoiceTitle` · `invoiceTaxNo` · `closeReason` ·
`createdAt` · `updatedAt`

- `status`：`OPEN` → `REPORTED` → `PAID` → `FULFILLED`，旁支 `CLOSED`。
- `periods`：一次买几个周期，服务端白名单 `1/3/6/12`，**只乘时长不乘额度**，
  `amountCents = priceCents × periods`。留这个字段是因为"客户一次付半年"是真事，
  不留就得下 6 张单、对 6 次账。
- `reference`：形如 `RV-4F2K9C` 的短码，服务端生成、唯一。人工通道的对账全指望它。
- `PAID` 与 `FULFILLED` 不合并。一期人工确认时两者在同一次点击里前后脚写入（`paidAt`、
  `fulfilledAt` 都会填）；二期微信是回调先写 `PAID`、落地作业再写 `FULFILLED`，
  中间失败可以重跑落地而不会重复收款。**这不是为假想需求留字段，是两条通道形状不同。**
- 同团队同一时刻最多一张未终结单（`OPEN`/`REPORTED`）：不用部分唯一索引（Prisma/PG 都行但
  多带一层心智），改为服务端"有则复用"——见 §7.1。

### 4.3 `PaymentAttempt`（通道尝试，"接口先留着"的落点）

`orderId` · `provider`（`manual` | `wechat`） · `outTradeNo`（unique） · `providerRef` ·
`amountCents` · `status`（`CREATED` | `SUCCEEDED` | `FAILED`） · `raw`（Json，回调原文，
**写入前剔除任何密钥类字段**） · `createdAt`

一期每个订单恰好一行 `provider='manual'`。二期加微信：多一行 `provider='wechat'`，
其余表与状态机不动。

### 4.4 `OrderEvent`（钱这条线的留痕）

`orderId` · `actorUserId` · `type`（`CREATED` / `REPORTED` / `CONFIRMED` / `FULFILLED` / `CLOSED`） ·
`note` · `at`

只覆盖订单，不补全局审计。事后要能回答"谁在什么时候给哪个团队延了多少天、按哪张单"。

### 4.5 `TeamQuota` 加两列

`source`（`PLAN` | `MANUAL`） + `sourceOrderId`（可空）。

**默认值必须是 `PLAN`。** 存量 `TeamQuota` 行既可能是 `api/teams/route.ts:118` 程序建的、
也可能是运营手改过的（quota PATCH 自 8 月起就开着，无法回溯区分）。选 `MANUAL` 会让
每一个已有团队在确认到账时都吃一次"将被重置"的假红字，两个月后这条提示就没人看了 ——
假阳性比没有提示更糟。

这列存在的唯一理由：解决"订单落地会把手改额度冲掉"这个冲突，规则见 §8.3。

### 4.6 收款信息放在既有的 `Settings` 表里，不新造 JSON

`Settings`（`prisma/schema.prisma:769`）是**单行表**（`id` 默认 `"default"`、全部是列，不是
key/value），平台配置全在这一行上。加 5 列：
`transferAccountName` / `transferAccountNo` / `transferBank` / `transferNote`（多行说明） /
`transferQrPath`。最后一条沿用同表既有的 `brandingLogoPath`（`:782`）写法 —— 存上传后的路径，
不存二进制。

界面：新增一个 `src/components/settings/TransferSettingsSection.tsx`，挂进
`src/app/platform/settings/page.tsx:11-18` 那一排 section 组件（那里已经是
`AppearanceSection`/`BrandingSection`/… 的同构形状）。

一个必须知道的既有事实：`GET /api/settings`（`src/app/api/settings/route.ts:20`）
用 `{ ...settings }` **整行展开**返回，只对 `smtpPassword` 单独打码
（该文件里的 `// SECURITY: Never send SMTP password in cleartext`）。
收款账户不是密钥 —— 客户就是要往那个账号打钱，所以**不需要掩码**，走整行展开是对的。
真正的约束在另一头：客户读收款信息**不走这个接口**（`/api/settings` 的门禁本来就是
`requirePlatformAdmin`，`route.ts:30`，团队账号调它只会拿到 403），订单的付款说明接口
自己读库、只挑需要的那几列返回。以后若往 `Settings` 加真正密钥类字段，必须显式加进那个打码列表。

## 5. 状态机与唯一落地入口

```
                 ┌────────── CLOSED（运营关单，或续费时惰性判定超 7 天，见 §7.1）
                 │
OPEN（待付款）→ REPORTED（客户点"我已完成付款"）→ PAID → FULFILLED
                                                     └ 同一次点击内完成
```

**全仓库只有一个函数写权益**：`src/lib/billing.ts` 的 `fulfillOrder(orderId, actorUserId, tx)`。
它做四件事：`Order` → `FULFILLED` + `fulfilledAt` + `fulfilledById`；`Team` 续期（叠加规则
逐字照搬 `activate/route.ts:57-60`）+ `status='ACTIVE'` + `subscriptionPlan=planKey`；
`TeamQuota` upsert 成 Plan 额度 + `source='PLAN'` + `sourceOrderId`；写一行 `OrderEvent`。

`src/lib/billing.ts` 对外四个函数：`createOrder` / `reportPaid` / `confirmAndFulfill` / `closeOrder`。
路由层只做鉴权和参数校验，**不许出现第二处 `team.update`**。

## 6. `PaymentProvider` 接口（一期只一个实现）

`src/lib/payment-provider.ts`：

```ts
interface PaymentProvider {
  createIntent(order): Promise<PaymentIntent>      // 一期返回转账说明；二期返回二维码/paySign
  markPaid(orderId, providerRef): Promise<void>    // 一期由运营点击触发；二期由回调触发
  verifyCallback(req): Promise<CallbackResult>     // 一期抛 NotImplemented
  refund(orderId, amountCents): Promise<void>      // 一期抛 NotImplemented
}
```

`PaymentIntent` 是两个分支的联合：
`{ kind: 'instructions', accountName, accountNo, bank, amountCents, reference, note }`
`{ kind: 'native', codeUrl, expiresAt }`（二期）

一期实现 `ManualTransferProvider`（`createIntent` 从 `Settings` 那 5 列拼说明，
`markPaid` = 一次 `confirmAndFulfill`）。二期接微信只做三件事：新增 `WechatPayProvider`、
加三个环境变量 `WECHAT_PAY_MCHID` / `WECHAT_PAY_APIV3_KEY` / `WECHAT_PAY_CERT_SERIAL`
（**走 env 不走 `Settings` 表**：与既有 `WECHAT_WEB_APP_ID/SECRET`、`S3_*` 同一口径，
密钥进 DB 会把"整行展开返回"的 `GET /api/settings` 变成泄漏面）、
前端在付款卡片多一个"扫二维码"分支。**状态机、`fulfillOrder`、门户页面、
平台端队列全部零改动。** 这是本设计唯一承诺的扩展性。

## 7. 客户门户（`/studio`）

### 7.1 下单与查看

- `POST /api/billing/orders`，body 只接 `{ planKey, periods }`（+ 可选发票两项）。
  门禁照 `activate/route.ts:24`：**只有 `role==='OWNER'` 且 membership ACTIVE**。
  金额服务端算，**入参里出现任何金额字段一律丢弃**。
  幂等：该团队已有 `OPEN`/`REPORTED` 单 → 直接返回那张（不新建），否则运营队列里会出现
  5 条一模一样的待确认，且客户看到两个不同的备注码。
  **例外**：那张 `OPEN` 单若已存在超过 7 天，就地 `CLOSED`（理由写"超时"）并新建一张。
    过期判定只发生在这个动作里 —— 一期没有定时任务，所以不存在"后台自动关单"；
  客户不再点续费时，旧单就一直躺在 `OPEN` tab 里，运营想关就手关（§8.2）。
- `GET /api/billing/orders`：本团队订单列表（账单页数据）。
- `GET /api/billing/orders/[id]/intent`：**付款说明只在这个接口里返回**，且仅当订单还是
  `OPEN`（已报付款就不再给账号，避免客户二次打款）。列表接口不带账号信息。

### 7.2 报付款

`POST /api/billing/orders/[id]/report`，body `{ reportNote? }`（付款账户名或流水号后几位，
纯线索，服务端不校验）。实现照搬抢卡语义：
`updateMany({ where: { id, teamId, status: 'OPEN' }, data: { status:'REPORTED', reportedAt } })`，
`count !== 1` 即视为无效返回 409 —— 双击、重放、两个管理员同时点都不会产生第二次状态变更。

### 7.3 页面

新路由 **`/studio/team/billing`**，挂进 `src/components/TeamAdminShell.tsx:18-21`
那排 tab（结构照抄 `{key,label,href,icon}`），标签「套餐与续费」。三块内容：

1. 当前套餐与到期：复用 `src/app/studio/team/page.tsx:42-52` 的 `formatTeamExpiry` /
   `describeSubscriptionPlan`（提成共享函数，不复制粘贴一份）。额度来源标出来：
   「MONTHLY（订单 RV-4F2K9C）」或「手动调整」。
2. 可购套餐：读 `active=true` 的 `Plan`，价格与额度全部来自表，代码里不出现金额字面量。
   周期选择器 1/3/6/12，实时显示合计金额与新到期日预览。
3. 历史订单：时间、套餐 × periods、金额、生效区间、状态、被关单的理由。

改动现有页：`src/app/studio/team/page.tsx` 的卡密输入区（`:98`、`:104`、`:116`）改为主按钮
「续费/升级」+ 页尾一个 `<details>`「我有卡密」折叠；`:233` 停用提示里
「由团队所有者在"团队信息"中输入卡密激活」这句话必须改掉。
`src/components/AdminHeader.tsx:29-30`（已在算剩余天数）在 ≤14 天时追加「续费」链接。

## 8. 平台端（`/platform`）

### 8.1 队列页 `/platform/orders`

`src/app/platform/layout.tsx:22-26` 导航加「订单」（卡密管理保留，见 §9）。
两个 tab：`REPORTED`（等你确认）与 `OPEN`（已下单未付）。行：团队名、`reference`、
套餐 × periods、金额、报付款时间、客户填的付款线索。`reference` 就是你在银行流水里
搜的那串 —— 全链路唯一对得上的东西，所以它在列表里要可选可复制。

### 8.2 确认到账

`POST /api/platform/orders/[id]/confirm`，守卫用 **`requirePlatformAuth`**
（`src/lib/auth.ts:439`；本行原写 `requirePlatformAdmin`，2026-09-25 实施期核码后修订，理由见下）。
一个事务内：`updateMany where status in (OPEN,REPORTED)` 抢单 → `PAID` → `fulfillOrder` →
`FULFILLED`；抢不到返回 409「已由他人处理」。两个运营同时点不会双份加 30 天。

> **2026-09-25 修订（台账裁定 D-17）**：本节与 §11 第 5 条原选 `requirePlatformAdmin`，
> 依据是「quota PATCH 用的 `requirePlatformAuth` 只认『任何平台账号』」——**这个前提是错的**。
> `requirePlatformAuth`（`:439`）走 `getPlatformUserFromRequest`（`:426`），其唯一出口
> `:435` 就是 `return user?.isPlatformAdmin ? … : null`，**管理员判定在这一侧已经做完**。
> 反过来 `requirePlatformAdmin`（`:607`）走 `getConsoleUserFromRequest`，**两套令牌都收**，
> 只在拿到人之后判 `isPlatformAdmin` ⇒ 用它做闸门会让新的 `/api/platform/orders*` 成为
> 该目录下唯一「客户侧团队令牌也能确认到账」的入口（现有 7 个 `/api/platform/**` route
> 全部用 `requirePlatformAuth`）。管理员要求两条都满足，**受众隔离只有 `requirePlatformAuth` 给**。
> 连带口径：无平台会话时是 **401 `Unauthorized`**（`:441` 是该函数唯一的失败出口，内部无 403 分支），
> 不是本节原先隐含的 403。§4.6 里对 `GET /api/settings` 用 `requirePlatformAdmin` 的描述是
> 对既有代码的事实陈述，不受本条修订影响。

**UI 上必须点第二次。** 确认框里摊开后果：到期日 `旧 → 新`、额度 `旧 → 新`，
若 `source='MANUAL'` 额外标红「当前额度为手动调整，将被本套餐重置」。
这一下直接改客户权益，误点代价等同对生产跑 UPDATE，所以把"先列清单再确认"做成产品行为。

`POST /api/platform/orders/[id]/close`：关单，必填理由（客户在账单页看得到）。

### 8.3 手改额度的新规矩

`/platform/teams/[id]` 那四个输入框**保留**（给单个团队开特例是真事），
`api/platform/teams/[id]/quota/route.ts:30` 的 PATCH 顺手把 `source` 写成 `'MANUAL'`
（`sourceOrderId` 留空；额度手改不挂订单，所以不写 `OrderEvent` —— 那张表只管钱）。

规则一句话：**手改 = 本周期内的临时特例，续费落地那一刻按新套餐重置。**
这条规则同时解释了为什么 `fulfillOrder` 可以无条件覆盖额度 —— 覆盖本身就是预期行为，
但界面上必须提前说清（§8.2 的标红）。

## 9. 卡密退役与存量过渡

不加处置就把卡密判死，等于**已发出去、正躺在客户聊天记录里的那些码当场作废**，那是失信。所以：

- `POST /api/teams/[id]/activate` 的**对外契约一字不改**：路由保留、OWNER 校验（`:24`）、
  卡码哈希查卡（`:40-43`）、`updateMany` 抢卡（`:45`）、响应体（`:93-97`）全部原样。
  内部改为：读卡 → 按卡面参数生成一张 `PAID` 的 `Order`（`planKey/durationDays/额度` 抄卡，
  `amountCents` 记 0，`reference` 从卡的 `codeLast4` + 行 id 派生，避免 `codeLast4` 撞车）→
  调 `fulfillOrder`。
  客户侧感受为零 —— 到期叠加规则本来就同源（§3 事实 1）。
- 停止产生新码：`src/app/api/platform/cards/route.ts:53` 的生成动作改为 410 + 说明，
  `/platform/cards` 页面只留列表与 `AVAILABLE` 余量计数，「生成」按钮摘掉。
- `TeamActivationCard` 表**不删、不清空**。等 `AVAILABLE` 归零后，是否下线由下一期决定。

## 10. 到期门禁（独立批次，最高风险）

现状是"到期"纯文案（§3 事实 3）。本期把它接上，但**只拦写、不拦读**：

- 拦：`api/projects/route.ts` POST（`:125`）、`api/videos/route.ts` POST（`:21`）、
  **`api/uploads/s3/presign/route.ts`**（上传的唯一入口，拦住 presign 就拦住了整个上传链路；
  `complete`/`abort` 不拦，已经开出来的上传让它跑完比半路断更干净）、
  `api/projects/[id]/project-uploads/[uploadId]/promote`（收录入库）、
  `api/teams/[id]/invitations/[token]/accept`、`api/teams/[id]/join-requests/[requestId]`。
  统一判据 `isTeamSubscriptionActive`（`platform-access.ts:25`），返回 403 +
  机器可读码 `TEAM_EXPIRED`，前端据此亮出续费入口。
- 不拦：浏览、播放、批注、分享链接、导出、回收站。**已交付给客户的审片不能因为乙方没续费
  而看不见** —— 这是最大失信面，坚决不放。
- **`subscriptionExpiresAt` 为 `null` 继续放行。** 现网 4 个团队全在这个状态
  （§3 事实 3），若不保留这条，上线第二天现网就写不了。迁移与 seed 都不给存量团队塞到期日。
- 提醒一期只做显示（顶栏 + 门户 + 平台端「N 天内到期」），不引入 cron、不发邮件。

## 11. 并发、幂等与安全

1. **幂等**全部走"条件更新 + 数 affected rows"，与 `activate/route.ts:45` 同款：
   抢不到就是无效。不引入分布式锁、不引入 Redis 记账号。
   **已知残留（2026-09-25 实施期补记，台账裁定 D-27）**：这把 CAS 锁的是**订单行**，不是**团队**。
   同一团队上两张可确认的单被两个运营同时点，`fulfillOrder` 会各自从没锁的 `team` 读里拿同一个基数
   （`src/lib/billing.ts:44-50`），两发都回 200，**其中一期天数被静默吞掉**；
   同一形状也体现在确认弹窗上 —— 弹窗里那串「旧 → 新」是**开窗那一刻的快照**，
   从开窗到 POST 之间任何一次落库（另一张单、卡密兑换、手改额度、跨过零点）都会让实际写入日 ≠ 展示日，
   而 `markPaid` 是**覆盖而不是拒绝**。一期接受的边界是「客户自助下单复用活单 ⇒ 一团队通常只有一张可确认单」，
   真正的修法是给 `fulfillOrder` 加团队级行锁（`$queryRaw SELECT id FROM "Team" WHERE id=$1 FOR UPDATE`），
   一处同时解掉两张脸。**不在本期做**，登记为结转编号项等用户点单；
   界面侧已做的兜底：预览没到手之前提交按钮禁用、POST 失败只能关窗重看（不给「拿着旧数字原地重试」留门）。
2. **金额只由服务端算**（`plan.priceCents × periods`）。`planKey` 与 `periods` 都过白名单；
   `periods` 非白名单值直接 400，不做 `clamp`。
3. **收款账号不做掩码，但只在一条响应里出现**：它本来就是要给客户看的打款目标，
   掩它没有意义（§4.6）。约束是**面**：账号只从 `GET /api/billing/orders/[id]/intent`
   流出，订单列表不带；不写进 `logSecurityEvent`、不写进 Next 日志。
   反向约束也在 §4.6 里定了：以后往 `Settings` 加真密钥字段，必须显式补进
   `api/settings/route.ts` 的打码列表，因为那个 GET 是整行展开。
4. **`OrderEvent.raw`/`reportNote` 里可能是银行账号**，日志一律不落。
   （2026-09-25 实施期修订，原写「界面展示时按现有脱敏口径处理」：**这句在本仓库没有可执行的口径** ——
   唯一的掩码函数是 `src/lib/security-events.ts:353` 的 `formatIpAddress`，只对 IP 成立，
   没有任何自由文本掩码工具。原文会让后来人去造一套掩码，而那恰好会毁掉这条链路的用途。）
   现在的规矩按方向分成两半，各自都可执行：
   - **客户写的 → 运营看的**（`reportNote`、`invoiceTitle`、`closeReason`）：**原样展示，不掩码**。
     备注码与客户自述是运营在网银流水里核对这笔钱的凭据，掩掉等于把队列变成瞎子。
     唯一约束是它们**绝不进日志**：`logError(msg, err)` 只输出 `Error.name: Error.message`
     （`src/lib/logging.ts`），四条平台路由从不把请求体或行内容交给它。
   - **平台写的账号（`Settings.transfer*`）→ 任何 note / 事件 / 列表字段**：**一个字符都不许流过去**。
     账号的唯一出口仍是 `GET /api/billing/orders/[id]/intent`（§4.6），平台侧四件套从不读 `@/lib/settings`。
   ⇒ 二期若要防「客户把别人的账号写进备注」，那是内容审核问题，不是掩码问题，另立条目。
5. 平台端所有订单接口先过 `requirePlatformAuth`（2026-09-25 修订，原写 `requirePlatformAdmin`，
   依据 §8.2 的修订说明：管理员判定两条都有，受众隔离只有这条给）；门户所有订单接口先过团队归属
   （`teamId` 一律服务端从 membership 派生，**不接受客户端传 teamId** —— 这是历史上
   P0-4 那类漏洞的同一形状）。
6. i18n：zh/en/de/nl 四语 key 一次补齐。de/nl 历史上就缺过 `dashboard` 那批 key
   （已知问题），本期新增的 key 必须四语同批，并在验收里逐语切一遍页面。
7. 视觉：沿用现有 token 体系与控件尺度（内容控件 `h-9` + `rounded-lg`），不自造一套。
   薄荷主题下套餐卡与状态徽章要实测对比度，选中态沿用已定口径（`text-foreground`，
   不用 `text-primary` on `bg-primary-visible`）。

## 12. 验收（本地 3000，全部要实测数字）

正向链：OWNER 登录 → `/studio/team/billing` 选 MONTHLY × 3 → 拿到金额 = 3×单价与备注码 →
报付款 → 平台端 `REPORTED` 出现该行 → 点确认到账 → 二次确认显示 `旧→新` 到期日 →
提交后顶栏到期日恰好 `+90 天`、`TeamQuota` = Plan 值、`source='PLAN'`、
`OrderEvent` 有 `CONFIRMED`+`FULFILLED` 两行、账单页显示该订单 `FULFILLED`。

负例（每条都要实测状态码）：
1. 非 OWNER（MEMBER/ADMIN）下单 → 403。
2. 已有 `OPEN` 单再下单 → 返回同一张 id，库里不多行。
3. 入参硬塞 `amountCents: 1` → 响应金额仍是服务端算的值，库里 `amountCents` 未被污染。
4. `REPORTED` 的单再点一次报付款 → 409，`reportedAt` 不变。
5. 两个会话同时点确认到账 → 一个 200、一个 409，`subscriptionExpiresAt` 只加一次。
6. 未付款订单被 `close` 后，客户账单页显示状态与理由，`subscriptionExpiresAt` 未被改动。
7. 存量团队（`expiresAt=null`）在门禁上线后仍可建项目/上传（第 10 节最后一条）。
8. 客户端传别人的 `teamId` → 拿不到、改不了别人团队的订单（越权面必测）。
9. 卡密回归：拿一张 `AVAILABLE` 卡走 `activate` → 权益照常生效，且库里生成了一张
   `FULFILLED` 的 `Order`（金额 0）。
10. 四语各切一遍，无缺失 key、无溢出。
11. 团队账号直接请求 `GET /api/settings` → 403（收款信息只能从 intent 接口流出）。
12. 平台账号 `GET /api/settings` → 五个收款字段可见且明文（**这是预期**，§4.6），
    但 `GET /api/billing/orders` 的响应里一个账户字段都没有。

## 13. 分批与回滚

| 批 | 内容 | 可独立验收 |
|---|---|---|
| ① | §4 数据层 + §5 `billing.ts` + §6 provider 接口 + 单测 | 是（无 UI，接口用 curl 验） |
| ② | §7 客户门户 | 是（此时下单只能停在 `OPEN`，需要运营直接查库确认，可接受） |
| ③ | §8 平台端队列与确认 + §9 卡密退役 | 是（②+③ 合起来才是完整闭环） |
| ④ | §10 到期门禁 | **单独一批**，碰全站写路径，风险最高 |

回滚：迁移纯新增（4 张表 + `TeamQuota` 2 列 + `Settings` 5 列），旧代码不读它们 →
回滚镜像不需要回退 schema；
`TeamActivationCard` 未删，②③ 回滚后卡密链路原样可用。④ 回滚 = 摘掉 6 处判据（彼此独立，
可逐处摘）。**注意**：Prisma 迁移在容器启动时由 `docker-entrypoint.sh` 的
`prisma migrate deploy` 自动落地，所以"新迁移必须先在本地库跑过"是硬前置。

## 14. 待你定的（都给了默认值，不回复就按默认）

1. `periods` 1/3/6/12。默认：放开。
2. 到期拦写不拦读（§10）。默认：做。
3. `Settings` 里的微信三项一期就要读，还是等通道真接上再读。默认：**不读**（见 §6）。
4. 「待确认」状态给不给客户看。默认：给。
5. 存量团队的 `source` 标 `PLAN` 还是 `MANUAL`。默认：`PLAN`，理由见 §4.5。
