# 客户自助开通与续费（一期）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让客户在 `/studio` 自己选套餐下单、拿到对公转账说明、点「我已完成付款」，平台运营点一次「确认到账」即自动续期并落地额度；权益落地路径从「激活卡」迁到「订单」，卡密只保留存量兑换。

**Architecture:** 单一落地函数 `fulfillOrder` 是全仓库唯一写 `Team.subscriptionExpiresAt` / `TeamQuota` 权益的地方；钱进来的通道通过 `PaymentProvider` 接口注入，一期只有 `ManualTransferProvider`（服务端拼转账说明 + 运营点击确认），二期加微信只新增一个 provider 实现与一张 `PaymentAttempt` 记录行，状态机与两个前端界面零改动。

**Tech Stack:** Next.js 16 app router（`next dev --webpack`）、React 19、Prisma 6 + PostgreSQL、next-intl（zh/en/de/nl）、Tailwind + shadcn token、zod（`src/lib/validation.ts`）、tsx 断言脚本。

**Spec:** `docs/superpowers/specs/2026-09-24-customer-billing-portal-design.md` —— 执行时**必须同时读 spec**，本计划里的每条判断都以 spec 章节号标注来源（§x.y）。

## Global Constraints

以下是 spec 的项目级硬约束，每个任务的验收都隐含包含它们：

- **不 `git commit`、不 `git push`、不触发任何部署工作流、不连生产服务器。** 全部改动只留在本地工作树。提交/推送只在用户当次明确点名时做，且不构成后续授权。
- **禁用 `npm run build`**（会写 `.next` 冲掉用户前台跑的 `next dev`，端口 3000）。构建门禁由 CI 的 `verify` job 代跑，不由本地任务承担。
- 每只动一个任务，收尾必跑并**贴出实际输出与退出码**：`npx tsc --noEmit`、`npx eslint <本次改动的文件>`。
- **生产数据只读**；本计划所有动态验证只打 `http://localhost:3000`。
- **本地登录凭据一律走环境变量注入，绝不写进本仓库任何文件、日志或报告**：`LOCAL_BILLING_CHECK_EMAIL` / `LOCAL_BILLING_CHECK_PASSWORD`（团队侧账号）、`LOCAL_BILLING_CHECK_MEMBER_EMAIL` / `LOCAL_BILLING_CHECK_MEMBER_PASSWORD`（同团队的 MEMBER 账号，用来验越权）、`LOCAL_PLATFORM_CHECK_EMAIL` / `LOCAL_PLATFORM_CHECK_PASSWORD`（平台管理员账号）。缺哪个就跳过对应断言并在报告里写明「未验证」，不许猜凭据。
- **HTTP 复压用 Bearer token，不用 cookie。** 已核实（读码 + 本地 3000 实测）：`POST /api/auth/login` body `{ email, password }` → 200 `{ success, tokens: { accessToken, … } }`（`src/app/api/auth/login/route.ts:171-189`），团队侧接口经 `getCurrentUserFromRequest` 只认 `Authorization: Bearer <accessToken>` 与微信会话 cookie（`src/lib/auth.ts:518-536`）——**它不读 `admin_access` cookie**，所以从 `Set-Cookie` 抓登录态的写法一律会得到 401。平台侧是另一套令牌：`POST /api/platform/auth/login` → `{ user, tokens }`（`route.ts:30-32`），`getPlatformUserFromRequest` 校 `verifyPlatformAccessToken` 且要求 `user.isPlatformAdmin`（`auth.ts:426-437`）；两者不可互换。
- 数据库迁移只在本地库落地；生产靠容器启动时 `docker-entrypoint.sh` 的 `prisma migrate deploy` 自动应用，所以**迁移一旦进镜像就会生效**，必须先在本地库跑通。
  **但只有 Task 1 用过一次 `npx prisma migrate dev`**（那一次还因撞 `Plan."updatedAt"` NOT NULL 而重跑）。此后各任务一律：
  改 `prisma/schema.prisma` + 手工对本地库执行对应 DDL + 把同一句追加进 `20260924180000_add_billing_orders/migration.sql` + `npx prisma generate`，
  再用**只读**的 `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script` 证明文件↔库↔模型三方一致。
  绝不冉跑 `migrate dev` / `reset` / `deploy` / `db push` / `--force`：库里有一处早于本计划的 drift
  （`schema.prisma` 声明 `FeishuNotification.uploader`，但 110 支迁移从未建过那个 FK），`migrate dev` 每次都会因此挂在
  「Enter a name for the new migration」的交互提示上；而本地库装着用户的真实团队数据。
  副作用（已登记）：改过已应用的迁移文件后，本地 `_prisma_migrations.checksum` 与文件 sha256 不一致。本地 `migrate status` 容忍，
  但若在本地跑 `migrate deploy` 会被拒，届时用 `prisma migrate resolve --applied 20260924180000_add_billing_orders` 解决；生产没见过旧字节，不受影响。
- **不新增任何 npm 依赖**（一期没有支付，用不到 SDK）。
- `tsconfig.json` 的 `include` 只有 `**/*.ts` / `**/*.tsx`，**`**/*.ts` 不匹配 `.mts`** ⇒ `npx tsc --noEmit` 根本不检 `scripts/check-*.mts`，而 `tsx` 只擦类型不校类型。Task 2 已把 `"scripts/**/*.mts"` 加进 `include`（当天全仓库只有 2 支 `.mts`，实测加完 `tsc --noEmit` 仍 exit 0），此后每支断言脚本都自动在类型门内。断言脚本里的类型错误如果漏网，最坏的形态是「断言把 `undefined` 和 `undefined` 比成相等 → 假绿」。
- `status` 类字段一律 `String` + TS 字面量联合 + 常量数组，**不引入 Prisma enum**（与既有 `Team.status`、`TeamActivationCard.status` 同构，`prisma/schema.prisma:108`、`:181`）。
- 所有团队侧接口的 `teamId` **服务端从 membership 派生，绝不接受客户端传入**；`amountCents` 一律服务端算，入参里出现金额字段直接丢弃。
- 内容区控件尺度 `h-9`(36px) + `rounded-lg`(16px)、chrome 顶栏 `h-11`(44px)；颜色一律走现有 token，选中态文字用 `text-foreground`。
- i18n：**新建的 `/studio/team/billing` 页走 `src/locales/*.json` 的 `billing` 命名空间，四语一次补齐**。`/studio/team/page.tsx` 里既有的中文硬编码**不复改**（最小改动），只把本次要点名改掉的那句改掉 —— 这是一处刻意的不一致，被 veto 时按「整文件迁 locales」重做，不做半途而废的混合。

---

## 文件结构总览

**新增（数据层）**
- `prisma/migrations/20260924180000_add_billing_orders/migration.sql` — 4 张新表 + `TeamQuota` 2 列 + `Settings` 5 列 + `Plan` 种子
- `prisma/schema.prisma`（修改）— `Plan` / `Order` / `PaymentAttempt` / `OrderEvent` 四个 model，`Team` 加反向关系，`TeamQuota`/`Settings` 加列

**新增（服务端 lib）**
- `src/lib/billing-pricing.ts` — 纯函数：金额、周期白名单、备注码、到期叠加、额度快照、确认前预览。不碰 DB，所以可断言
- `src/lib/billing.ts` — DB 事务：`createOrder` / `reportOrderPaid` / `confirmAndFulfill` / `closeOrder` / `fulfillOrder`。**全仓库唯一写权益的模块**
- `src/lib/payment-provider.ts` — `PaymentProvider` 接口 + `PaymentIntent` 联合类型 + `ManualTransferProvider` + `getPaymentProvider()`

**新增（接口）**
- `src/app/api/billing/orders/route.ts`（POST 下单 / GET 列表）
- `src/app/api/billing/orders/[id]/intent/route.ts`（GET 转账说明）
- `src/app/api/billing/orders/[id]/report/route.ts`（POST 报付款）
- `src/app/api/platform/orders/route.ts`（GET 队列）
- `src/app/api/platform/orders/[id]/confirm/route.ts`（POST 确认到账）
- `src/app/api/platform/orders/[id]/close/route.ts`（POST 关单）
- `src/app/api/settings/transfer/route.ts`（GET / PATCH 收款信息，含收款码上传）
- `src/lib/team-writeable.ts`（WP6）— `getTeamWriteBlockReason()` + `requireTeamWritable()` + `requireProjectWritable()`

**新增（界面）**
- `src/app/studio/team/billing/page.tsx` — 门户「套餐与续费」页
- `src/components/settings/TransferSettingsSection.tsx` — 平台设置里的收款信息块
- `src/app/platform/orders/page.tsx` — 运营确认队列
- `src/components/platform/OrderConfirmDialog.tsx` — 二次确认框

**新增（脚本，验证用）**
- 断言（`npx tsx` 跑，自建自清）：`scripts/check-billing-pricing.mts`、`check-billing-flow.mts`、`check-payment-provider.mts`、`check-card-contract.mts`、`check-team-writeable.mts`、`check-team-gate.mts`
- HTTP 复压：`scripts/billing-api-check.mjs`（`node` 跑，只用内置 fetch）

**修改（既有文件，逐处）**
- `src/app/api/teams/[id]/activate/route.ts` — 内部改走 Order，对外契约不变（§9）
- `src/app/api/platform/cards/route.ts` — 生成动作 410（§9）
- `src/app/platform/cards/page.tsx` — 摘掉「生成」按钮与表单（§9）
- `src/app/api/platform/teams/[id]/quota/route.ts:30` — PATCH 顺手写 `source='MANUAL'`（§8.3）
- `src/components/TeamAdminShell.tsx:16-23` — `sections` 加一项
- `src/app/studio/team/page.tsx:98-116`、`:233` — 卡密区降级 + 文案（§7.3）
- `src/components/AdminHeader.tsx:13-46` — 既有 `TeamExpiryBadge`：到期态出口改指 `/studio/team/billing`，`days <= 14` 追加「续费」链接（§7.3）
- `src/app/studio/projects/new/page.tsx:84` — 透出服务端错误文案（WP6）
- `src/app/platform/layout.tsx:22-26` — 导航加「订单」
- `src/lib/settings.ts` — `getTransferConfig()`
- `src/locales/{zh,en,de,nl}.json` — `billing` 命名空间
- WP6：`src/lib/s3-upload-auth.ts`（导出 `getUploadTargetProjectId`）+ `src/app/api/projects/route.ts:125`、`src/app/api/videos/route.ts:21`、`src/app/api/uploads/s3/presign/route.ts`、`src/app/api/projects/[id]/project-uploads/[uploadId]/promote/route.ts`、`src/app/api/teams/[id]/invitations/[token]/accept/route.ts`、`src/app/api/teams/[id]/join-requests/[requestId]/route.ts`

---

# WP1 领域与数据（做完 = 权益落地可以从一张订单跑通，无界面）

### Task 1: 数据层 —— 4 张新表 + 2+5 个新列 + Plan 种子

**Files:**
- Modify: `prisma/schema.prisma`（`Team:102-128`、`TeamQuota:158-169`、`Settings:769`，末尾追加 4 个 model）
- Create: `prisma/migrations/20260924180000_add_billing_orders/migration.sql`
- Modify（评审后追加，因为 `Order`→`Team`/`User` 改成 RESTRICT 后这两个动作会撞 FK）: `src/app/api/teams/[id]/route.ts`（DELETE 加「有账单即 409」）、`src/app/api/users/[id]/route.ts`（DELETE 加同样 409，**不做改判**：这里唯一的候选接手人是按删除键的管理员，改判=重写商业署名）、`src/app/api/auth/merge-accounts/route.ts`（合并账号是同人换号，照既有清单补 `order` / `orderEvent` 两行 `updateMany`）
- Test: 迁移在本地库落地即为本任务的测试（无纯逻辑可断言）

**Interfaces:**
- Consumes: 无
- Produces: Prisma 模型 `plan` / `order` / `paymentAttempt` / `orderEvent`；`TeamQuota.source: string`、`TeamQuota.sourceOrderId: string | null`；`Settings.transferAccountName|transferAccountNo|transferBank|transferNote|transferQrPath`（均可空）。`Order.status` 取值 `'OPEN'|'REPORTED'|'PAID'|'FULFILLED'|'CLOSED'`。

- [ ] **Step 1: 先确认迁移目录命名与既有风格一致**

Run: `ls prisma/migrations | tail -5`
Expected: 形如 `20260903090000_add_team_trials_activation_cards`，即 `YYYYMMDDHHMMSS_蛇形名`。

- [ ] **Step 2: 追加 4 个 model 到 `prisma/schema.prisma` 末尾**

```prisma
model Plan {
  id           String   @id @default(cuid())
  key          String   @unique
  name         String
  priceCents   Int
  currency     String   @default("CNY")
  durationDays Int
  maxMembers   Int
  maxProjects  Int
  maxVideos    Int
  maxStorageGB Int
  active       Boolean  @default(true)
  sort         Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  orders Order[]

  @@index([active, sort])
}

/// One commercial transaction. Amounts are stored in cents; the client never
/// supplies them. PAID and FULFILLED stay separate because the manual channel
/// writes both in one click while the wechat callback will only be able to
/// write PAID, leaving fulfilment retryable without double-charging.
model Order {
  id              String    @id @default(cuid())
  teamId          String
  planKey         String
  plan            Plan      @relation(fields: [planKey], references: [key], onDelete: Restrict)
  periods         Int       @default(1)
  amountCents     Int
  currency        String    @default("CNY")
  reference       String    @unique
  status          String    @default("OPEN")
  createdById     String
  reportedAt      DateTime?
  reportNote      String?
  paidAt          DateTime?
  fulfilledAt     DateTime?
  fulfilledById   String?
  periodStart     DateTime?
  periodEnd       DateTime?
  invoiceRequested Boolean   @default(false)
  invoiceTitle    String?
  invoiceTaxNo    String?
  closeReason     String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  team     Team            @relation(fields: [teamId], references: [id], onDelete: Cascade)
  events   OrderEvent[]
  attempts PaymentAttempt[]

  @@index([teamId, status])
  @@index([status, createdAt])
}

/// One attempt through one channel. Phase 1 writes exactly one `manual` row per
/// order; adding wechat later means inserting `wechat` rows, nothing else.
model PaymentAttempt {
  id          String   @id @default(cuid())
  orderId     String
  order       Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  provider    String
  outTradeNo  String   @unique
  providerRef String?
  amountCents Int
  status      String   @default("CREATED")
  raw         Json?
  createdAt   DateTime @default(now())

  @@index([orderId])
}

model OrderEvent {
  id          String   @id @default(cuid())
  orderId     String
  order       Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  actorUserId String
  type        String
  note        String?
  at          DateTime @default(now())

  @@index([orderId, at])
}
```

- [ ] **Step 3: `Team` 加反向关系（`:125` 后一行）**

```prisma
  projectGroups   ProjectGroup[]
  orders          Order[]
```

- [ ] **Step 4: `TeamQuota` 加两列（`:166` 之后，`team Team` 之前）**

```prisma
  // PLAN = written by fulfilOrder from a Plan; MANUAL = ops edited it in the
  // console. Default is PLAN on purpose: the provenance of existing rows is
  // unknowable, and defaulting to MANUAL would show "quota will be reset" for
  // every team on every confirmation until nobody reads it any more.
  // 注意：DEFAULT 同时是**运行时**值。既有 4 个建行点都不传 source，会让新建的
  // 试用团队被误标成 PLAN、运营手工建行被误标成 PLAN —— 所以 Task 3 必须在这三处
  // 显式写 source：src/app/api/teams/route.ts:118、src/lib/platform-access.ts:46-52、
  // src/app/api/platform/teams/[id]/quota/route.ts:46-50；第四处
  // src/app/api/teams/[id]/activate/route.ts:71-77 由 Task 13 负责（它本来就在改这个文件）。
  source         String   @default("PLAN")
  sourceOrderId  String?
```

- [ ] **Step 5: `Settings` 加 5 列（放在 `brandingFaviconPath` 同族附近，`:783` 之后）**

```prisma
  // 对公转账信息（一期唯一收款通道）。刻意不掩码：客户就是往这个账号打钱。
  // 真密钥类字段（微信支付那三项）走 env，不进这张表 —— GET /api/settings 是整行展开。
  transferAccountName String?
  transferAccountNo   String?
  transferBank        String?
  transferNote        String?
  transferQrPath      String?
```

- [ ] **Step 6: 手写迁移 SQL**

`prisma/migrations/20260924180000_add_billing_orders/migration.sql`：

```sql
-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "durationDays" INTEGER NOT NULL,
    "maxMembers" INTEGER NOT NULL,
    "maxProjects" INTEGER NOT NULL,
    "maxVideos" INTEGER NOT NULL,
    "maxStorageGB" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");
CREATE INDEX "Plan_active_sort_idx" ON "Plan"("active", "sort");

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "periods" INTEGER NOT NULL DEFAULT 1,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3),
    "reportNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "fulfilledById" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "invoiceRequested" BOOLEAN NOT NULL DEFAULT false,
    "invoiceTitle" TEXT,
    "invoiceTaxNo" TEXT,
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Order_reference_key" ON "Order"("reference");
CREATE INDEX "Order_teamId_status_idx" ON "Order"("teamId", "status");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "Order_planKey_idx" ON "Order"("planKey");

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "outTradeNo" TEXT NOT NULL,
    "providerRef" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentAttempt_outTradeNo_key" ON "PaymentAttempt"("outTradeNo");
CREATE INDEX "PaymentAttempt_orderId_idx" ON "PaymentAttempt"("orderId");

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderEvent_orderId_at_idx" ON "OrderEvent"("orderId", "at");

-- AlterTable
ALTER TABLE "TeamQuota" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'PLAN';
ALTER TABLE "TeamQuota" ADD COLUMN "sourceOrderId" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "transferAccountName" TEXT;
ALTER TABLE "Settings" ADD COLUMN "transferAccountNo" TEXT;
ALTER TABLE "Settings" ADD COLUMN "transferBank" TEXT;
ALTER TABLE "Settings" ADD COLUMN "transferNote" TEXT;
ALTER TABLE "Settings" ADD COLUMN "transferQrPath" TEXT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_planKey_fkey" FOREIGN KEY ("planKey") REFERENCES "Plan"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: 逐字段等于 src/lib/platform-access.ts:14-19 的 MONTHLY_QUOTA，
-- 保证上线那一刻现网额度不变。价格先放 0 分 —— 真实定价由运营在平台设置里填，
-- 不在代码里编一个数。
-- ON CONFLICT ("key") DO NOTHING：运营可能在发布前先手工建过 MONTHLY 行。
-- 容器启动跑的是 prisma migrate deploy，裸 INSERT 撞唯一索引会让整支迁移失败 = 起不来。
INSERT INTO "Plan" ("id","key","name","priceCents","currency","durationDays","maxMembers","maxProjects","maxVideos","maxStorageGB","active","sort","updatedAt")
VALUES ('plan_monthly_seed','MONTHLY','月度',0,'CNY',30,10,0,0,50,true,1,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
```

- [ ] **Step 7: 落地到本地库**

Run: `npx prisma migrate dev`（**不带 `--name`**：SQL 是 Step 6 手写的，`--name` 是「新建一支迁移」的语义，一旦 Prisma 判定有差就会额外再生成一个目录，出现两份描述同一变更的迁移）
Expected: 打印 `Applying migration 20260924180000_add_billing_orders`、`Generated Prisma Client`，无 drift 提示，且 `ls prisma/migrations` 里**只多出这一支**目录。**若它要求 `--create-only`、又新建了第二支迁移、或报 schema drift，停下来报告，不要 `--force` 重置库**（本地库里有用户的真实数据）。

- [ ] **Step 8: 核对落地结果**

Run: `npx prisma studio` 不便，用一次性脚本：

```bash
npx tsx -e "import {PrismaClient} from '@prisma/client'; const p=new PrismaClient(); (async()=>{ console.log('plans', await p.plan.findMany({select:{key:true,priceCents:true,durationDays:true,maxMembers:true,maxStorageGB:true}})); console.log('quotaCols', await p.teamQuota.findMany({select:{teamId:true,source:true,sourceOrderId:true}})); await p.\$disconnect(); })()"
```
Expected: `plans` 里恰好一条 `MONTHLY / 30 天 / 10 人 / 50GB`；`quotaCols` 里**每一个既有团队的 `source` 都是 `PLAN`**、`sourceOrderId` 全为 `null`。

- [ ] **Step 9: 门禁 + 汇报（不 commit）**

Run: `npx tsc --noEmit` → 退出码 0
Run: `git status --short` → 只列出 `prisma/schema.prisma` 与新迁移目录
贴出三条命令的实际输出。**提醒用户：`prisma generate` 之后他的 dev 会 500，需要他重启一次 —— WP1 里所有任务的客户端类型都依赖这一步。**

---

### Task 2: `billing-pricing.ts` 纯函数（先写失败断言）

**Files:**
- Create: `src/lib/billing-pricing.ts`
- Test: `scripts/check-billing-pricing.mts`
- Modify: `tsconfig.json`（`include` 加 `"scripts/**/*.mts"`，让后续 13 支断言脚本进类型门）

**Interfaces:**
- Consumes: Task 1 的列名（只做类型引用，不查库）
- Produces:
  - `ALLOWED_PERIODS: readonly number[]`、`OPEN_ORDER_TTL_MS: number`
  - `type OrderStatus = 'OPEN'|'REPORTED'|'PAID'|'FULFILLED'|'CLOSED'`、`ORDER_STATUSES: readonly OrderStatus[]`
  - `class BillingError extends Error { code: BillingErrorCode }`，`BillingErrorCode = 'INVALID_PLAN'|'INVALID_PERIODS'|'NO_TRANSFER_CONFIG'|'NOT_IMPLEMENTED'|'STATE_CONFLICT'|'TEAM_EXPIRED'|'UNAUTHORIZED'|'FORBIDDEN'`
  - `isAllowedPeriods(v: unknown): v is number`
  - `computeAmountCents(planPriceCents: number, periods: number): number`
  - `randomReference(rand?: () => number): string`
  - `nextExpiryMs(currentExpiresAt: Date | null, nowMs: number, durationDays: number): number`
  - `quotaForPlan(plan: PlanQuota): PlanQuota`（`PlanQuota = {maxMembers,maxProjects,maxVideos,maxStorageGB}`）
  - `computeFulfillmentPreview(input: PreviewInput): PreviewResult`（确认框要显示的旧→新）

- [ ] **Step 1: 写失败断言脚本**

`scripts/check-billing-pricing.mts`（`expect` 骨架照抄 `scripts/check-dual-video-sync.mts:17-25` 的同名函数，保持仓库内一致的断言风格）：

```ts
import {
  ALLOWED_PERIODS, BillingError, OPEN_ORDER_TTL_MS, ORDER_STATUSES, computeAmountCents,
  computeFulfillmentPreview, isAllowedPeriods, nextExpiryMs, quotaForPlan, randomReference,
} from '../src/lib/billing-pricing'

const DAY = 86_400_000
let passed = 0
const failures: string[] = []
function expect(name: string, actual: unknown, want: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  if (ok) passed += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
}
function expectThrows(name: string, fn: () => unknown, code: string) {
  try { fn(); failures.push(`${name}\n      expected throw ${code}, got none`) }
  catch (e) {
    if (e instanceof BillingError && e.code === code) passed += 1
    else failures.push(`${name}\n      expected BillingError ${code}, got ${String(e)}`)
  }
}

// 状态常量数组必须钉住：Task 3 的状态机、Task 11 的队列筛选都按名字取
expect('order statuses pinned', ORDER_STATUSES, ['OPEN', 'REPORTED', 'PAID', 'FULFILLED', 'CLOSED'])

// 周期白名单
expect('periods 1 allowed', isAllowedPeriods(1), true)
expect('periods 2 rejected', isAllowedPeriods(2), false)
expect('periods "3" rejected (string)', isAllowedPeriods('3'), false)
expect('periods 12 is the max', ALLOWED_PERIODS, [1, 3, 6, 12])

// 金额只由服务端算
expect('amount scales with periods', computeAmountCents(39800, 3), 119400)
expect('free plan prices to 0', computeAmountCents(0, 12), 0)
expectThrows('negative price rejected', () => computeAmountCents(-1, 1), 'INVALID_PLAN')
expectThrows('non-integer price rejected', () => computeAmountCents(1.5, 1), 'INVALID_PLAN')
expectThrows('bad periods rejected', () => computeAmountCents(100, 7), 'INVALID_PERIODS')
// amountCents 落库是 Postgres INT4，超出去就是运行期写入炸
expectThrows('one cent beyond Int4 ceiling rejected', () => computeAmountCents(716_000_000, 3), 'INVALID_PLAN')
expect('exactly at Int4 ceiling still fine', computeAmountCents(2_147_483_647, 1), 2_147_483_647)

// 转账备注码：大写、无易混字符、形如 RV-XXXXXX
const fixedRand = () => 0.999999
const ref = randomReference(fixedRand)
expect('reference shape', /^RV-[A-HJ-NP-Z2-9]{6}$/.test(ref), true)
expect('reference is deterministic given rand', randomReference(fixedRand), ref)
// 逐个索引扫，别只采 6 个点：只采 6 个点时把字母表换回完整 A-Z0-9 也照样全绿（已实测）。
// (k + 0.5) / 32 * 32 下取整正好是 k，所以 32 个位置每个都被命中一次。
const every = Array.from({ length: 32 }, (_, k) => () => (k + 0.5) / 32)
expect('no I/O/0/1 anywhere in the 32-char alphabet',
  every.map(f => randomReference(f)).join('').match(/[IO01]/g), null)
expect('all 32 alphabet positions are distinct',
  new Set(every.map(f => randomReference(f).slice(3)).flat()).size, 32)

// 到期叠加：与 activate/route.ts:57-60 逐字同语义
const now = Date.parse('2026-09-24T00:00:00.000Z')
expect('no expiry starts from now', nextExpiryMs(null, now, 30), now + 30 * DAY)
expect('future expiry stacks', nextExpiryMs(new Date(now + 5 * DAY), now, 30), now + 35 * DAY)
expect('past expiry restarts from now', nextExpiryMs(new Date(now - 40 * DAY), now, 30), now + 30 * DAY)

// 确认前预览（平台端二次确认框的数据源）
const plan = { durationDays: 30, quota: { maxMembers: 10, maxProjects: 0, maxVideos: 0, maxStorageGB: 50 } }
// 注意：预览结果有 6 个字段，别拿 3 个字段的字面量去 JSON 比（永远不等，断言会假失败）。逐字段取。
const p1 = computeFulfillmentPreview({ currentExpiresAt: new Date(now + 10 * DAY), nowMs: now, periods: 3, plan })
expect('preview: unexpired team 旧→新', [p1.fromExpiry, p1.toExpiry, p1.willResetManual, p1.quotaChanged],
  [now + 10 * DAY, now + 100 * DAY, false, true])
expect('preview: toExpiryDate 与 toExpiry 是同一个数', p1.toExpiryDate.getTime(), now + 100 * DAY)
expect('preview: nextQuota 就是套餐额度', p1.nextQuota, plan.quota)
expect('preview: manual quota is flagged',
  computeFulfillmentPreview({
    currentExpiresAt: null, nowMs: now, periods: 1, plan,
    currentQuota: { maxMembers: 99, maxProjects: 0, maxVideos: 0, maxStorageGB: 999 }, quotaSource: 'MANUAL',
  }).willResetManual, true)
// spec §8.2 只看 source==='MANUAL'；这里额外要求额度真的不同才报警（§8.3 的口径）。
// 这条分支是刻意收窄，Task 11 的弹窗按它写，所以必须钉住两侧。
expect('preview: MANUAL quota already equal to plan => no reset warning',
  computeFulfillmentPreview({
    currentExpiresAt: null, nowMs: now, periods: 1, plan,
    currentQuota: plan.quota, quotaSource: 'MANUAL',
  }).willResetManual, false)
expect('preview: identical quota reports no change',
  computeFulfillmentPreview({
    currentExpiresAt: null, nowMs: now, periods: 1, plan,
    currentQuota: plan.quota, quotaSource: 'PLAN',
  }).quotaChanged, false)
expect('quotaForPlan copies only the four allowance columns',
  quotaForPlan({ ...plan.quota, extra: 1 } as never), plan.quota)
expect('OPEN orders live a week', OPEN_ORDER_TTL_MS, 7 * DAY)

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
```

- [ ] **Step 2: 跑起来确认它失败**

Run: `npx tsx scripts/check-billing-pricing.mts`
Expected: 失败，报 `Cannot find module '../src/lib/billing-pricing'`。若这一步"通过"了，说明断言没接上真实现，别往下走。

- [ ] **Step 3: 实现 `src/lib/billing-pricing.ts`**

```ts
export const ALLOWED_PERIODS = [1, 3, 6, 12] as const
export const OPEN_ORDER_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const ORDER_STATUSES = ['OPEN', 'REPORTED', 'PAID', 'FULFILLED', 'CLOSED'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export type BillingErrorCode =
  | 'INVALID_PLAN' | 'INVALID_PERIODS' | 'NO_TRANSFER_CONFIG'
  | 'NOT_IMPLEMENTED' | 'STATE_CONFLICT' | 'TEAM_EXPIRED' | 'UNAUTHORIZED' | 'FORBIDDEN'

export class BillingError extends Error {
  constructor(public code: BillingErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'BillingError'
  }
}

export type PlanQuota = { maxMembers: number; maxProjects: number; maxVideos: number; maxStorageGB: number }
export type FulfillmentPlan = { durationDays: number; quota: PlanQuota }

export function isAllowedPeriods(value: unknown): value is number {
  return typeof value === 'number' && (ALLOWED_PERIODS as readonly number[]).includes(value)
}

// Order.amountCents / Plan.priceCents 都是 Postgres INT4（Prisma 的 `Int`）。
// 超出去要到 INSERT 才炸，等于让客户点一次「下单」看到一次 500。
const MAX_AMOUNT_CENTS = 2_147_483_647

export function computeAmountCents(planPriceCents: number, periods: number): number {
  if (!Number.isInteger(planPriceCents) || planPriceCents < 0) throw new BillingError('INVALID_PLAN')
  if (!isAllowedPeriods(periods)) throw new BillingError('INVALID_PERIODS')
  const amount = planPriceCents * periods
  if (amount > MAX_AMOUNT_CENTS) throw new BillingError('INVALID_PLAN', 'amount exceeds Int4 ceiling')
  return amount
}

// 去掉了 I/O/0/1：转账备注要人手抄进银行界面，易混字符就是坏账的开头。
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function randomReference(rand: () => number = Math.random): string {
  let body = ''
  for (let i = 0; i < 6; i += 1) {
    const index = Math.min(REFERENCE_ALPHABET.length - 1, Math.floor(rand() * REFERENCE_ALPHABET.length))
    body += REFERENCE_ALPHABET[index]
  }
  return `RV-${body}`
}

/** 与 api/teams/[id]/activate/route.ts:56-60 同语义（`const now = new Date()` 在 56）：未到期则从现到期日往后叠，否则从现在起算。 */
export function nextExpiryMs(currentExpiresAt: Date | null, nowMs: number, durationDays: number): number {
  const base = currentExpiresAt && currentExpiresAt.getTime() > nowMs ? currentExpiresAt.getTime() : nowMs
  return base + durationDays * 86_400_000
}

export function quotaForPlan(plan: PlanQuota): PlanQuota {
  return {
    maxMembers: plan.maxMembers,
    maxProjects: plan.maxProjects,
    maxVideos: plan.maxVideos,
    maxStorageGB: plan.maxStorageGB,
  }
}

export type PreviewInput = {
  currentExpiresAt: Date | null
  nowMs: number
  periods: number
  plan: FulfillmentPlan
  currentQuota?: PlanQuota
  quotaSource?: 'PLAN' | 'MANUAL'
}

export type PreviewResult = {
  fromExpiry: number
  toExpiry: number
  toExpiryDate: Date
  willResetManual: boolean
  quotaChanged: boolean
  nextQuota: PlanQuota
}

/** 确认到账弹窗里「旧 → 新」的唯一算式来源；不查库，所以平台端和测试用同一段代码。 */
export function computeFulfillmentPreview(input: PreviewInput): PreviewResult {
  const { currentExpiresAt, nowMs, periods, plan } = input
  const toExpiryMs = nextExpiryMs(currentExpiresAt, nowMs, plan.durationDays * periods)
  const nextQuota = quotaForPlan(plan.quota)
  const current = input.currentQuota ?? null
  return {
    fromExpiry: currentExpiresAt ? currentExpiresAt.getTime() : nowMs,
    toExpiry: toExpiryMs,
    toExpiryDate: new Date(toExpiryMs),
    willResetManual: current !== null && input.quotaSource === 'MANUAL' && !sameQuota(current, nextQuota),
    quotaChanged: current === null ? true : !sameQuota(current, nextQuota),
    nextQuota,
  }
}

function sameQuota(a: PlanQuota, b: PlanQuota): boolean {
  return a.maxMembers === b.maxMembers
    && a.maxProjects === b.maxProjects
    && a.maxVideos === b.maxVideos
    && a.maxStorageGB === b.maxStorageGB
}
```

- [ ] **Step 4: 跑断言到全绿**

Run: `npx tsx scripts/check-billing-pricing.mts`
Expected: `23 passed, 0 failed`（数字以实际为准，但不能有 failed）。

- [ ] **Step 5: 门禁 + 汇报**

Run: `npx tsc --noEmit && npx eslint src/lib/billing-pricing.ts scripts/check-billing-pricing.mts`
Expected: 两条都退出码 0。贴实际输出。不 commit。

---

### Task 3: `billing.ts` —— 唯一权益落地入口

**Files:**
- Create: `src/lib/billing.ts`
- Test: `scripts/check-billing-flow.mts`
- Modify: `src/app/api/teams/route.ts:118`、`src/lib/platform-access.ts:46-52`、`src/app/api/platform/teams/[id]/quota/route.ts:46-50`
  （Task 1 评审 I-1 裁定：`TeamQuota.source` 的三个建行点显式赋值，随本任务一起落地）
- Modify: `prisma/schema.prisma` + `prisma/migrations/20260924180000_add_billing_orders/migration.sql`
  （Task 1 遗留：`Order.fulfilledById` 补 `User` 关系 + RESTRICT FK）
- Modify: `src/app/api/users/[id]/route.ts`、`src/app/api/auth/merge-accounts/route.ts`
  （新 FK 的两条删除链路必须同时认 `fulfilledById`，否则 RESTRICT 变成裸 500）

**Interfaces:**
- Consumes: Task 1 的表、Task 2 的 `computeAmountCents` / `randomReference` / `nextExpiryMs` / `quotaForPlan` / `BillingError`
- Produces（签名固定，后续任务按此调用）:
  - `type Tx = Prisma.TransactionClient`
  - `createOrder(tx, input: { teamId: string; planKey: string; periods: number; actorUserId: string; invoice?: { requested: boolean; title?: string | null; taxNo?: string | null } }): Promise<{ order: Order; reused: boolean }>`
  - `reportOrderPaid(tx, input: { orderId: string; teamId: string; reportNote?: string | null; actorUserId?: string }): Promise<{ ok: boolean; order?: Order }>`（Task 3 评审 I-3：`actorUserId` 是后加的可选参数，缺省才回落 `order.createdById`；Task 8 的路由必须把自己认证到的 `auth.id` 传进来）
  - `confirmAndFulfill(tx, input: { orderId: string; actorUserId: string }): Promise<{ ok: boolean; order?: Order; team?: Team; quota?: TeamQuota }>`
  - `closeOrder(tx, input: { orderId: string; actorUserId: string; reason: string }): Promise<{ ok: boolean }>`
  - `fulfillOrder(tx, orderId: string, actorUserId: string, opts?: { markPaid?: boolean }): Promise<{ team: Team; quota: TeamQuota; order: Order }>`
  - `loadFulfillmentOrder(orderId): Promise<{ order: Order & { plan: Plan; team: Team }; quota: TeamQuota | null } | null>`（给平台端预览用，自己开连接；`quota` 可以为 null —— 新团队还没落过额度）

  `Team` / `TeamQuota` / `Order` / `Plan` 都从 `@prisma/client` 取类型。
  命名对齐：spec §5 把对外四函数写作 `createOrder` / `reportPaid` / `confirmAndFulfill` / `closeOrder`，
  本计划里第二个叫 **`reportOrderPaid`** —— 因为 `report` 既是路由动作又是 HTTP 方法，同名会在
  `api/billing/orders/[id]/report/route.ts` 的 import 里读成两次「report」。**它就是 spec §5 的那个函数，
  不是新增的第五个函数**；对外函数数量仍是四个（`fulfillOrder` 是它们共用的内部落地入口，
  `loadFulfillmentOrder` 只给平台端预览读，不写权益）。

- [ ] **Step 1: 写失败断言脚本（真库，但只碰自建的临时团队）**

`scripts/check-billing-flow.mts` 的关键约定：**脚本自己 `user.create` + `team.create`，`finally` 里按 id 删掉；绝不碰工作区里已有的团队/项目**（本地库里有用户的真实数据）。

```ts
import { PrismaClient } from '@prisma/client'
import { closeOrder, confirmAndFulfill, createOrder, reportOrderPaid } from '../src/lib/billing'
import { BillingError } from '../src/lib/billing-pricing'
import { hashPassword } from '@/lib/encryption'

const prisma = new PrismaClient()
const DAY = 86_400_000
let passed = 0
const failures: string[] = []
function expect(name: string, actual: unknown, want: unknown) {
  const ok = typeof want === 'number' && typeof actual === 'number'
    ? Math.abs(actual - want) < 1e-9
    : actual === want
  if (ok) passed += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
}

async function main() {
  const stamp = Date.now()
  const user = await prisma.user.create({
    // User.password is required and has no default (prisma/schema.prisma:6); the column
    // is named `password`, not `passwordHash`. A throwaway bcrypt value keeps this user
    // un-loggable while satisfying the NOT NULL.
    data: { email: `billing-check-${stamp}@example.invalid`, name: 'billing-check', password: await hashPassword(`billing-check-${stamp}`) },
  })
  const team = await prisma.team.create({
    data: { name: `billing-check-${stamp}`, slug: `billing-check-${stamp}`, shareKey: `bc-${stamp}`, createdById: user.id },
  })
  try {
    const first = await prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 3, actorUserId: user.id }))
    expect('first order opens', first.reused, false)
    // 种子计划是 0 分（spec 禁止编造定价），所以这里 `0 × 3 === 0` 是一条永真断言。
    // 「金额由服务端按 plan 算」的真正证明在下面自建的非 0 价计划上。
    expect('status starts OPEN', first.order.status, 'OPEN')
    const refShape = /^RV-[A-HJ-NP-Z2-9]{6}$/.test(first.order.reference)
    expect('reference shaped', refShape, true)
    expect('manual attempt written', await prisma.paymentAttempt.count({ where: { orderId: first.order.id, provider: 'manual' } }), 1)

    // 幂等：已有 OPEN 单时复用同一张，而不是造第二张
    const again = await prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 3, actorUserId: user.id }))
    expect('reused same order', again.reused, true)
    expect('same id returned', again.order.id, first.order.id)
    expect('still one open order', await prisma.order.count({ where: { teamId: team.id } }), 1)

    // 报付款只允许一次
    const reported = await prisma.$transaction((tx) => reportOrderPaid(tx, { orderId: first.order.id, teamId: team.id, reportNote: '尾号 1234' }))
    expect('report accepted', reported.ok, true)
    const again2 = await prisma.$transaction((tx) => reportOrderPaid(tx, { orderId: first.order.id, teamId: team.id }))
    expect('second report refused', again2.ok, false)
    expect('second report leaves note intact', (await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } })).reportNote, '尾号 1234')
    expect('second report leaves reportedAt intact',
      (await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } })).reportedAt!.getTime(),
      reported.order.reportedAt!.getTime())

    // 报付款不许跨团队
    const crossTeam = await prisma.$transaction((tx) => reportOrderPaid(tx, { orderId: first.order.id, teamId: 'other-team' }))
    expect('cross-team report refused', crossTeam.ok, false)

    // 确认到账 → 权益落地，且恰好 +90 天
    const before = await prisma.team.findUniqueOrThrow({ where: { id: team.id } })
    const confirmed = await prisma.$transaction((tx) => confirmAndFulfill(tx, { orderId: first.order.id, actorUserId: user.id }))
    expect('confirm accepted', confirmed.ok, true)
    const after = await prisma.team.findUniqueOrThrow({ where: { id: team.id } })
    expect('team reactivated', after.status, 'ACTIVE')
    expect('plan written', after.subscriptionPlan, 'MONTHLY')
    const days = after.subscriptionExpiresAt!.getTime() - (before.subscriptionExpiresAt?.getTime() ?? after.subscriptionStartedAt.getTime())
    expect('expiry moved by exactly 90 days', Math.round(days / DAY), 90)
    const quota = await prisma.teamQuota.findUniqueOrThrow({ where: { teamId: team.id } })
    expect('quota members from seed plan', quota.maxMembers, 10)
    expect('quota storage from seed plan', quota.maxStorageGB, 50)
    expect('quota source recorded', quota.source, 'PLAN')
    expect('quota points at the order', quota.sourceOrderId, first.order.id)
    const done = await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } })
    expect('order fulfilled', done.status, 'FULFILLED')
    expect('paidAt and fulfilledAt both set', Boolean(done.paidAt && done.fulfilledAt), true)
    expect('periodEnd equals expiry', done.periodEnd?.getTime(), after.subscriptionExpiresAt!.getTime())
    expect('two events logged', await prisma.orderEvent.count({ where: { orderId: done.id, type: { in: ['CONFIRMED', 'FULFILLED'] } } }), 2)

    // 双点确认：第二次必须失败，且不许再加 90 天
    const second = await prisma.$transaction((tx) => confirmAndFulfill(tx, { orderId: done.id, actorUserId: user.id }))
    expect('second confirm refused', second.ok, false)
    expect('expiry not moved again',
      (await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).subscriptionExpiresAt!.getTime(),
      after.subscriptionExpiresAt!.getTime())

    // 关单：只作用于未终结单，且不许动权益
    const o2 = await prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 1, actorUserId: user.id }))
    const expiryBeforeClose = (await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).subscriptionExpiresAt!.getTime()
    expect('close accepted', (await prisma.$transaction((tx) => closeOrder(tx, { orderId: o2.order.id, actorUserId: user.id, reason: '客户取消' }))).ok, true)
    expect('closed order reason stored', (await prisma.order.findUniqueOrThrow({ where: { id: o2.order.id } })).closeReason, '客户取消')
    expect('close does not touch expiry',
      (await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).subscriptionExpiresAt!.getTime(), expiryBeforeClose)
    expect('closing twice refused',
      (await prisma.$transaction((tx) => closeOrder(tx, { orderId: o2.order.id, actorUserId: user.id, reason: '再点一次' }))).ok, false)
    // 关单之后可以重新下单
    const o3 = await prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 1, actorUserId: user.id }))
    expect('new order after close', o3.reused, false)

    // 超 7 天的 OPEN 单在下次下单时被惰性关掉并新建
    await prisma.order.update({ where: { id: o3.order.id }, data: { createdAt: new Date(Date.now() - 8 * DAY) } })
    const o4 = await prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 1, actorUserId: user.id }))
    expect('stale order not reused', o4.reused, false)
    expect('stale order closed', (await prisma.order.findUniqueOrThrow({ where: { id: o3.order.id } })).status, 'CLOSED')

    // 自建一支非 0 价、非常见天数的计划：证「金额与时长都取自 plan」而不是硬编码
    const pricePlan = await prisma.plan.create({
      data: { key: `BCHECK-${stamp}`, name: 'billing-check', priceCents: 39800, durationDays: 31, maxMembers: 3, maxProjects: 4, maxVideos: 5, maxStorageGB: 6 },
    })
    await prisma.$transaction((tx) => closeOrder(tx, { orderId: o4.order.id, actorUserId: user.id, reason: '切换到自建计划' }))
    const expiryBeforePrice = (await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).subscriptionExpiresAt!.getTime()
    const priced = await prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: pricePlan.key, periods: 6, actorUserId: user.id }))
    expect('amount = plan price × periods', priced.order.amountCents, 39800 * 6)
    expect('currency copied from plan', priced.order.currency, 'CNY')
    const pricedDone = await prisma.$transaction((tx) => confirmAndFulfill(tx, { orderId: priced.order.id, actorUserId: user.id }))
    expect('priced order confirmed', pricedDone.ok, true)
    expect('expiry stacks by plan durationDays',
      (await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).subscriptionExpiresAt!.getTime(),
      expiryBeforePrice + 31 * 6 * DAY)
    const pricedQuota = await prisma.teamQuota.findUniqueOrThrow({ where: { teamId: team.id } })
    expect('quota members from plan', pricedQuota.maxMembers, 3)
    expect('quota storage from plan', pricedQuota.maxStorageGB, 6)

    // 非法入参
    await expectRejects('unknown plan', () => prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'YEARLY', periods: 1, actorUserId: user.id })), 'INVALID_PLAN')
    await expectRejects('periods off whitelist', () => prisma.$transaction((tx) => createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 2, actorUserId: user.id })), 'INVALID_PERIODS')
  } finally {
    // 删除顺序由 FK 决定：Order.teamId / Order.createdById / OrderEvent.actorUserId 都是
    // RESTRICT（Task 1），先删团队或用户会直接被拒。attempts/events 随 Order CASCADE。
    // 这里不吞异常：清不干净就是污染了本地库，必须让它响。
    await prisma.order.deleteMany({ where: { teamId: team.id } })
    await prisma.plan.deleteMany({ where: { key: `BCHECK-${stamp}` } })
    await prisma.team.delete({ where: { id: team.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
}

async function expectRejects(name: string, fn: () => Promise<unknown>, code: string) {
  try { await fn(); failures.push(`${name}\n      expected BillingError ${code}, got none`) }
  catch (e) {
    if (e instanceof BillingError && e.code === code) passed += 1
    else failures.push(`${name}\n      expected ${code}, got ${String(e)}`)
  }
}
main()
```

上面代码块里的 `expect` 是**房内标准骨架**（`scripts/check-dual-video-sync.mts:19-25`：数字走 epsilon，其余走 `===`），
不是 Task 2 那份 `JSON.stringify` 深比版本 —— 那 6 行**不要照抄成 Task 2 的形状**。这直接影响断言怎么写：
`actual === want` 对两个新构造的对象永远为假，所以上面所有额度/形状检查都写成标量断言
（`quota.maxMembers, 10` 而不是 `{ m, g }, { m: 10, g: 50 }`）。仓库里现在有两种骨架，统一留到最终评审再定。

- [ ] **Step 2: 跑起来确认失败**

Run: `npx tsx scripts/check-billing-flow.mts`
Expected: 失败，`Cannot find module '../src/lib/billing'`。

- [ ] **Step 3: 实现 `src/lib/billing.ts`**

```ts
import { randomUUID } from 'crypto'
import type { Order, Plan, Prisma, Team, TeamQuota } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  BillingError, OPEN_ORDER_TTL_MS, computeAmountCents, isAllowedPeriods,
  nextExpiryMs, quotaForPlan, randomReference,
} from '@/lib/billing-pricing'

export type Tx = Prisma.TransactionClient

/**
 * The only place in this codebase allowed to write a team's entitlements
 * (subscription columns + quota). Order fulfilment and activation-card
 * redemption both funnel here, so "what did this purchase buy" has one answer.
 */
export async function fulfillOrder(
  tx: Tx,
  orderId: string,
  actorUserId: string,
  opts: { markPaid?: boolean } = {},
): Promise<{ team: Team; quota: TeamQuota; order: Order }> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { plan: true },
  })
  if (!order) throw new BillingError('STATE_CONFLICT', 'order missing')
  if (order.status === 'FULFILLED') throw new BillingError('STATE_CONFLICT', 'already fulfilled')

  const now = new Date()
  const current = await tx.team.findUniqueOrThrow({
    where: { id: order.teamId },
    select: { subscriptionExpiresAt: true },
  })
  const durationDays = order.plan.durationDays * order.periods
  const expiryMs = nextExpiryMs(current.subscriptionExpiresAt, now.getTime(), durationDays)
  const quotaValues = quotaForPlan(order.plan)

  // Sequential, not Promise.all: an interactive $transaction runs every query on one
  // pooled connection anyway, and the four writes here share the same `now`/`expiryMs`.
  const team = await tx.team.update({
    where: { id: order.teamId },
    data: {
      status: 'ACTIVE',
      subscriptionPlan: order.planKey,
      subscriptionStartedAt: now,
      subscriptionExpiresAt: new Date(expiryMs),
    },
  })
  // `source: 'PLAN'` is written, not defaulted: this function IS the PLAN definition.
  // `sourceOrderId` has no FK and no relation (Task 1 ruling) — it is a human-readable
  // provenance clue, never a join key.
  const quota = await tx.teamQuota.upsert({
    where: { teamId: order.teamId },
    create: { teamId: order.teamId, ...quotaValues, source: 'PLAN', sourceOrderId: order.id },
    update: { ...quotaValues, source: 'PLAN', sourceOrderId: order.id },
  })
  const updated = await tx.order.update({
    where: { id: order.id },
    data: {
      status: 'FULFILLED',
      fulfilledAt: now,
      fulfilledById: actorUserId,
      ...(opts.markPaid ? { paidAt: now } : {}),
      periodStart: now,
      periodEnd: new Date(expiryMs),
    },
  })
  await tx.orderEvent.create({
    data: { orderId: order.id, actorUserId, type: 'FULFILLED', note: `+${durationDays}d` },
  })

  return { team, quota, order: updated }
}
```

同文件其余四个函数（每段都是完整实现，不是摘要）：

```ts
async function findLiveOrder(tx: Tx, teamId: string) {
  return tx.order.findFirst({ where: { teamId, status: { in: ['OPEN', 'REPORTED'] } }, orderBy: { createdAt: 'desc' } })
}

export async function createOrder(
  tx: Tx,
  input: {
    teamId: string
    planKey: string
    periods: number
    actorUserId: string
    invoice?: { requested: boolean; title?: string | null; taxNo?: string | null }
  },
) {
  if (!isAllowedPeriods(input.periods)) throw new BillingError('INVALID_PERIODS')
  const plan = await tx.plan.findUnique({ where: { key: input.planKey } })
  if (!plan || !plan.active) throw new BillingError('INVALID_PLAN')

  // 一期没有定时任务，所以"过期"只在有人来下单这一刻判定一次；没人再点续费的话，
  // 旧单会留在 OPEN 里由运营手关（spec §7.1）。
  const live = await findLiveOrder(tx, input.teamId)
  if (live && live.status === 'OPEN' && Date.now() - live.createdAt.getTime() > OPEN_ORDER_TTL_MS) {
    await tx.order.updateMany({
      where: { id: live.id, status: 'OPEN' },
      data: { status: 'CLOSED', closeReason: '超时未付款，自动关闭' },
    })
  } else if (live) {
    return { order: live, reused: true }
  }

  const amountCents = computeAmountCents(plan.priceCents, input.periods)
  const order = await tx.order.create({
    data: {
      teamId: input.teamId,
      planKey: plan.key,
      periods: input.periods,
      amountCents,
      currency: plan.currency,
      reference: await uniqueReference(tx),
      status: 'OPEN',
      createdById: input.actorUserId,
      invoiceRequested: input.invoice?.requested ?? false,
      invoiceTitle: input.invoice?.title ?? null,
      invoiceTaxNo: input.invoice?.taxNo ?? null,
      attempts: { create: { provider: 'manual', outTradeNo: `MANUAL-${randomUUID()}`, amountCents } },
      events: { create: { actorUserId: input.actorUserId, type: 'CREATED' } },
    },
    include: { plan: true },
  })
  return { order, reused: false }
}

async function uniqueReference(tx: Tx): Promise<string> {
  for (let i = 0; i < 5; i += 1) {
    const candidate = randomReference()
    const hit = await tx.order.findUnique({ where: { reference: candidate }, select: { id: true } })
    if (!hit) return candidate
  }
  return `RV-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`
}

export async function reportOrderPaid(
  tx: Tx,
  input: { orderId: string; teamId: string; reportNote?: string | null },
) {
  const note = typeof input.reportNote === 'string' ? input.reportNote.trim().slice(0, 200) : null
  const claimed = await tx.order.updateMany({
    where: { id: input.orderId, teamId: input.teamId, status: 'OPEN' },
    data: { status: 'REPORTED', reportedAt: new Date(), reportNote: note },
  })
  if (claimed.count !== 1) return { ok: false as const }
  const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } })
  await tx.orderEvent.create({ data: { orderId: order.id, actorUserId: order.createdById, type: 'REPORTED', note } })
  return { ok: true as const, order }
}

export async function confirmAndFulfill(tx: Tx, input: { orderId: string; actorUserId: string }) {
  const claimed = await tx.order.updateMany({
    where: { id: input.orderId, status: { in: ['OPEN', 'REPORTED'] } },
    data: { status: 'PAID', paidAt: new Date() },
  })
  if (claimed.count !== 1) return { ok: false as const }
  await tx.orderEvent.create({ data: { orderId: input.orderId, actorUserId: input.actorUserId, type: 'CONFIRMED' } })
  const result = await fulfillOrder(tx, input.orderId, input.actorUserId, { markPaid: true })
  const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } })
  return { ok: true as const, order, team: result.team, quota: result.quota }
}

export async function closeOrder(tx: Tx, input: { orderId: string; actorUserId: string; reason: string }) {
  const reason = input.reason.trim().slice(0, 200)
  const claimed = await tx.order.updateMany({
    where: { id: input.orderId, status: { in: ['OPEN', 'REPORTED'] } },
    data: { status: 'CLOSED', closeReason: reason },
  })
  if (claimed.count !== 1) return { ok: false as const }
  await tx.orderEvent.create({ data: { orderId: input.orderId, actorUserId: input.actorUserId, type: 'CLOSED', note: reason } })
  return { ok: true as const }
}

/** 平台端预览用：不开放事务，自己读一次。 */
export async function loadFulfillmentOrder(
  orderId: string,
): Promise<{ order: Order & { plan: Plan; team: Team }; quota: TeamQuota | null } | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { plan: true, team: true },
  })
  if (!order) return null
  const quota = await prisma.teamQuota.findUnique({ where: { teamId: order.teamId } })
  return { order, quota }
}
```

`fulfillOrder` 返回最终态的 `order`，是因为 Task 13 的卡密兑换会直接调它并把结果回给前端；`confirmAndFulfill`
自己也重新读一次（它要的是一次带 `paidAt` 的最终行）。两处读取各自有调用方，不是冗余。

`computeFulfillmentPreview` 不在这里调用 —— 它是纯函数，平台端路由（Task 11）拿 `loadFulfillmentOrder`
的结果现算，这样「预览」和「落地」用的天数/额度口径分别由 `fulfillOrder` 与预览各自负责，
两者都从 `nextExpiryMs` / `quotaForPlan` 取值，不会漂。

- [ ] **Step 4: 跑断言到全绿**

Run: `npx tsx scripts/check-billing-flow.mts`
Expected: 全部通过、0 failed；脚本结束时 `team`/`user` 临时行已被 `finally` 删掉。
Run（自证没留垃圾）: `npx tsx -e "import {PrismaClient} from '@prisma/client'; const p=new PrismaClient(); (async()=>{console.log('orders',await p.order.count(),'attempts',await p.paymentAttempt.count(),'events',await p.orderEvent.count(),'teams left',await p.team.count({where:{slug:{startsWith:'billing-check-'}}}),'plans left',await p.plan.count({where:{key:{startsWith:'BCHECK-'}}}));await p.\$disconnect()})()"`
Expected: 三个计数全为 0，`teams left` 与 `plans left` 均为 0 —— **若 `order` 计数不为 0，说明断言脚本污染了本地库，必须先清干净再进下一个任务。**

- [ ] **Step 5: `TeamQuota.source` 的三个建行点显式赋值**

Task 1 评审 I-1 裁定：保留 schema 的 `DEFAULT 'PLAN'`（历史行的来源不可知，默认 MANUAL 会让每一次确认都弹「额度将被重置」直到没人再读它），缺的是建行点把话说清楚。**三处不是同一个值**：

`src/app/api/teams/route.ts:118` —— 新团队的试用额度不是手工调的，写 PLAN：

```ts
    await tx.teamQuota.create({
      data: {
        teamId: created.id,
        ...TRIAL_QUOTA,
        source: 'PLAN',
      },
    })
```

`src/lib/platform-access.ts:54` —— 读操作惰性补一行，同样不是手工值：

```ts
    create: { teamId, ...TRIAL_QUOTA, source: 'PLAN' },
```

`src/app/api/platform/teams/[id]/quota/route.ts:46-50` —— **这一处写 MANUAL**：运营在控制台里改额度就是「手工值」的定义，
也是 `source` 这一列存在的唯一理由。不写它，运营手调过的团队在下次确认时不会报警，而 `fulfillOrder`
会静默把那行覆盖回套餐值：

```ts
  const quota = await prisma.teamQuota.upsert({
    where: { teamId: id },
    // A partial edit must not mint the rest of the row from schema defaults (20 GB etc.);
    // an omitted key means "whatever the team's baseline is", not "50 videos".
    // This IS a hand-edit by definition: source=MANUAL is what makes the next
    // fulfilment confirmation warn that it is about to overwrite these numbers.
    create: { teamId: id, ...TRIAL_QUOTA, ...data, source: 'MANUAL' },
    update: { ...data, source: 'MANUAL' },
  })
```

Run: `npx tsc --noEmit`
Expected: 退出码 0。

- [ ] **Step 6: `Order.fulfilledById` 补 RESTRICT FK（Task 1 遗留）**

现状：`fulfilledById String?` 没有任何关系，而 `users/[id]` 的账单守卫只看 `createdById`、`merge-accounts`
的改判清单也只列这两列。后果：一个确认过到账的平台管理员被删号后，「这笔是谁确认的」永久查不出来。
补 FK 与 `createdById` 同规格（RESTRICT），并让两条链路同时认它。

`prisma/schema.prisma` 的 `Order` model 里，紧跟 `createdBy` 那行加：

```prisma
  fulfilledBy   User?    @relation("OrderFulfiller", fields: [fulfilledById], references: [id], onDelete: Restrict)
```

`User` model 的反关系（`prisma/schema.prisma:42-43`，`ordersCreated` / `orderEventsAsActor` 旁边）加一行，
命名与 `ordersCreated` 对称：

```prisma
  ordersFulfilled             Order[]              @relation("OrderFulfiller")
```

迁移 SQL：**不要再跑 `migrate dev`**（仓库有早于本计划的 `FeishuNotification` drift，它会挂在「Enter a name for
the new migration」交互提示上）。改用与已应用迁移一致的增量手法 —— 手工对本地库执行这一条 DDL，
再把同一行追加进 `prisma/migrations/20260924180000_add_billing_orders/migration.sql` 的 FK 段落末尾：

```sql
-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_fulfilledById_fkey" FOREIGN KEY ("fulfilledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

然后跑 `npx prisma generate`（只 generate），并用**只读**的 diff 证明文件↔库↔模型三方一致：

Run: `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script`
Expected: 只剩那条早于本任务的 `FeishuNotification_uploaderId_fkey` 语句（Task 1 已登记的 drift），
且**不出现** `Order_fulfilledById_fkey`。若它出现，说明库或文件少了一边。

`src/app/api/users/[id]/route.ts` 的账单守卫加第三项（`Promise.all` 里）：

```ts
      prisma.order.count({ where: { OR: [{ createdById: id }, { fulfilledById: id }] } }),
```

（`orderEventCount` 保持原样；把 order 那一项的 `where` 换成 OR，让「确认人」也被同一个 409 挡住。）

`src/app/api/auth/merge-accounts/route.ts` 的改判清单里，把 `order.updateMany` 一行改成同样认识确认人：

```ts
    await tx.order.updateMany({ where: { createdById: target.id }, data: { createdById: currentUser.id } })
    await tx.order.updateMany({ where: { fulfilledById: target.id }, data: { fulfilledById: currentUser.id } })
```

（两行分开写，不用 OR：一个账号既可能是下单人也可能是确认人，两行各自幂等，语义比一条 OR 更准。）

- [ ] **Step 7: 门禁 + 汇报**

Run: `npx tsc --noEmit && npx eslint src/lib/billing.ts src/lib/billing-pricing.ts scripts/check-billing-flow.mts`
Expected: 退出码 0。贴实际输出。不 commit。
Run（回归）: `npx tsx scripts/check-billing-pricing.mts`
Expected: 仍然全绿 —— Step 5/6 不许动到纯函数。

> **落地差异（评审 round 1 已修，重新生成本 brief 时不要回退）**：
> `fulfillOrder` 的状态白名单只收 `PAID`（不收 `FULFILLED`，幂等由 `confirmAndFulfill` 的 `updateMany` 承担）；
> `createOrder` 复用已有 OPEN 单时，若本次带 `invoice` 则把三列写进那张单再返回 `reused: true`；
> `reportOrderPaid` / `closeOrder` / `confirmAndFulfill` 的 `actorUserId` 是**可选**参数，缺省回落到 `order.createdById`；
> `reference` 唯一性在建单前重试采样，P2002 由 `uniqueReference` 内部消化；
> 新增导出 `loadFulfillmentOrder(orderId)` 供平台侧读单。
> 遗留：`OrderEvent.actorUserId` 是否改可空（台账 T3-R2）、`uniqueReference` 5 次采样在极端碰撞下仍可能抛 P2002（台账 T3-R1）。

---

### Task 4: `payment-provider.ts` 接口 + 一期唯一实现

**Files:**
- Create: `src/lib/payment-provider.ts`
- Modify: `src/lib/settings.ts`（加 `getTransferConfig()`）
- Test: `scripts/check-payment-provider.mts`

**Interfaces:**
- Consumes: `Settings` 的 5 个 `transfer*` 列（Task 1）、`BillingError`（Task 2）
- Produces:
  - `type PaymentIntent = { kind: 'instructions'; accountName: string; accountNo: string; bank: string | null; amountCents: number; currency: string; reference: string; note: string | null; qrPath: string | null } | { kind: 'native'; codeUrl: string; expiresAt: string }`
  - `type ConfirmResult = { ok: true; order: Order; team: Team; quota: TeamQuota } | { ok: false }`（与 Task 3 的 `confirmAndFulfill` 返回同形：判别式联合，`ok: true` 分支上三个字段必在）
  - `interface PaymentProvider { readonly key: PaymentProviderKey; createIntent(order: OrderLike): Promise<PaymentIntent>; markPaid(input: { orderId: string; actorUserId: string }): Promise<ConfirmResult>; verifyCallback(req: Request): Promise<never>; refund(input: { orderId: string; amountCents: number }): Promise<never> }`
  - `getPaymentProvider(key?: 'manual' | 'wechat'): PaymentProvider`
  - `getTransferConfig(): Promise<{ accountName: string | null; accountNo: string | null; bank: string | null; note: string | null; qrPath: string | null; configured: boolean }>`

- [ ] **Step 1: `src/lib/settings.ts` 末尾加读取函数**

```ts
/**
 * 对公转账信息。刻意不带缓存：它一次下单才被读一次，缓存换来的
 * 是运营改完账号后客户还拿到旧账号的那几分钟。
 */
export async function getTransferConfig() {
  const row = await prisma.settings.findUnique({
    where: { id: 'default' },
    select: {
      transferAccountName: true, transferAccountNo: true, transferBank: true,
      transferNote: true, transferQrPath: true,
    },
  })
  const accountName = row?.transferAccountName?.trim() || null
  const accountNo = row?.transferAccountNo?.trim() || null
  return {
    accountName,
    accountNo,
    bank: row?.transferBank?.trim() || null,
    note: row?.transferNote ?? null,
    qrPath: row?.transferQrPath || null,
    configured: Boolean(accountName && accountNo),
  }
}
```

- [ ] **Step 2: 写失败断言**

`scripts/check-payment-provider.mts`（骨架照抄 `scripts/check-dual-video-sync.mts:19-25`，**完整写出来，不留注释占位**）：

```ts
import { getPaymentProvider } from '../src/lib/payment-provider'
import { getTransferConfig } from '../src/lib/settings'
import { createOrder } from '../src/lib/billing'
import { BillingError } from '../src/lib/billing-pricing'
import { hashPassword } from '@/lib/encryption'
import { prisma } from '../src/lib/db'

let passed = 0
const failures: string[] = []
function expect(name: string, actual: unknown, want: unknown) {
  const ok = typeof want === 'number' && typeof actual === 'number'
    ? Math.abs(actual - want) < 1e-9
    : actual === want
  if (ok) passed += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
}
async function expectCode(name: string, fn: () => Promise<unknown>, code: string) {
  try { await fn(); failures.push(`${name}\n      expected ${code}, got none`) }
  catch (e) {
    if (e instanceof BillingError && e.code === code) passed += 1
    else failures.push(`${name}\n      expected ${code}, got ${String(e)}`)
  }
}

const p = getPaymentProvider()
expect('phase 1 default provider is manual', p.key, 'manual')
await expectCode('verifyCallback is not implemented', () => p.verifyCallback(new Request('http://x')), 'NOT_IMPLEMENTED')
await expectCode('refund is not implemented', () => p.refund({ orderId: 'o', amountCents: 1 }), 'NOT_IMPLEMENTED')
await expectCode('wechat is not registered yet', () => Promise.resolve().then(() => getPaymentProvider('wechat')), 'NOT_IMPLEMENTED')

const intentInput = { id: 'i-1', reference: 'RV-AB23DE', amountCents: 123_400, currency: 'CNY' }

// 只读：绝不写 Settings —— 那是他本地真实的运营配置行，所以两条分支都必须走得通。
const cfg = await getTransferConfig()
expect('transfer config exposes exactly six keys', Object.keys(cfg).sort().join(','),
  'accountName,accountNo,bank,configured,note,qrPath')
if (cfg.configured) {
  // 钉的是「钱由订单决定，不由收款配置决定」：转账说明里的金额和汇款备注必须
  // 原样是传进来的那一单的值，而不是 provider 回头重算的。
  const intent = await p.createIntent(intentInput)
  expect('instructions echo the order amount', intent.kind === 'instructions' && intent.amountCents, 123_400)
  expect('instructions echo the order reference', intent.kind === 'instructions' && intent.reference, 'RV-AB23DE')
} else {
  await expectCode('an unconfigured transfer account blocks the intent',
    () => p.createIntent(intentInput), 'NO_TRANSFER_CONFIG')
}

// `markPaid` 的两条规则必须真跑一遍，而不是靠读：抢到状态迁移的那次点击给
// PaymentAttempt 落章，抢不到的那次不许改章（那等于上报一笔这次点击没完成的付款）。
// 清场手法照抄 scripts/check-billing-flow.mts 的 finally：自建一次性用户/团队/订单，
// 按 FK 顺序删，且不吞异常 —— 他的本地库里装着真实团队数据。
const stamp = Date.now()
const actor = await prisma.user.create({
  data: { email: `pp-check-${stamp}@example.invalid`, name: 'pp-check', password: await hashPassword(`pp-check-${stamp}`) },
})
// 两个身份：只有一个 actor 时 `confirmed:${actorUserId}` 分不出是谁落的章，
// 「败者不许改章」那条断言就成了永真。
// `actor` 建完立刻进 try（同 check-billing-flow.mts 的 M-7）：建第二个身份时一旦抛了，
// 第一个身份也必须被清掉 —— 这个库里装着真实团队数据。
let otherId: string | null = null
let teamId: string | null = null
try {
  const other = await prisma.user.create({
    data: { email: `pp-check2-${stamp}@example.invalid`, name: 'pp-check2', password: await hashPassword(`pp-check2-${stamp}`) },
  })
  otherId = other.id
  const team = await prisma.team.create({
    data: { name: `pp-check-${stamp}`, slug: `pp-check-${stamp}`, shareKey: `pc-${stamp}`, createdById: actor.id },
  })
  teamId = team.id
  const { order } = await prisma.$transaction((tx) =>
    createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 1, actorUserId: actor.id }))
  const attempt = () => prisma.paymentAttempt.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } })

  const won = await p.markPaid({ orderId: order.id, actorUserId: actor.id })
  expect('winning click confirms the order', won.ok, true)
  expect('winning click settles the attempt', (await attempt())?.status, 'SUCCEEDED')
  expect('the stamp names the winning actor', (await attempt())?.providerRef, `confirmed:${actor.id}`)

  const lost = await p.markPaid({ orderId: order.id, actorUserId: other.id })
  expect('losing click reports the conflict', lost.ok, false)
  expect('losing click leaves the stamp alone', (await attempt())?.providerRef, `confirmed:${actor.id}`)
} finally {
  // Order.teamId / Order.createdById 是 RESTRICT，attempts/events 随 Order CASCADE。
  if (teamId) await prisma.order.deleteMany({ where: { teamId } })
  if (teamId) await prisma.team.delete({ where: { id: teamId } })
  if (otherId) await prisma.user.delete({ where: { id: otherId } })
  await prisma.user.delete({ where: { id: actor.id } })
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) console.log(failures.join('\n'))
// 必须断链：src/lib/db.ts 导出的是进程级单例，连接池不放手这个脚本就永远不退出。
await prisma.$disconnect()
process.exit(failures.length ? 1 : 0)
```

Run: `npx tsx scripts/check-payment-provider.mts` → Expected: `Cannot find module '../src/lib/payment-provider'`。

- [ ] **Step 3: 实现 `src/lib/payment-provider.ts`**

```ts
import type { Order, Team, TeamQuota } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getTransferConfig } from '@/lib/settings'
import { BillingError } from '@/lib/billing-pricing'
import { confirmAndFulfill } from '@/lib/billing'

export type PaymentProviderKey = 'manual' | 'wechat'

export type OrderLike = {
  id: string
  reference: string
  amountCents: number
  currency: string
}

export type PaymentIntent =
  | {
      kind: 'instructions'
      accountName: string
      accountNo: string
      bank: string | null
      amountCents: number
      currency: string
      reference: string
      note: string | null
      qrPath: string | null
    }
  | { kind: 'native'; codeUrl: string; expiresAt: string }

/**
 * `markPaid` returns the confirmation outcome rather than `void` (spec §6 sketches
 * `Promise<void>`): "someone already confirmed this order" is the one failure the ops
 * button must show, and a void return forces the route to guess. Discriminated exactly
 * like `confirmAndFulfill` — an `ok: true` caller gets the order without a `!`, and a
 * future provider that answers `ok: true` with no payload does not compile.
 */
export type ConfirmResult =
  | { ok: true; order: Order; team: Team; quota: TeamQuota }
  | { ok: false }

/**
 * Two channels have different shapes, which is why PAID and FULFILLED are
 * separate states: the manual provider settles both in one click, a wechat
 * callback can only write PAID and leaves fulfilment retryable without
 * charging twice. Phase 1 ships `manual` only; `verifyCallback`/`refund`
 * stay declared so adding wechat is a new class, not an interface change.
 */
export interface PaymentProvider {
  readonly key: PaymentProviderKey
  createIntent(order: OrderLike): Promise<PaymentIntent>
  markPaid(input: { orderId: string; actorUserId: string }): Promise<ConfirmResult>
  verifyCallback(request: Request): Promise<never>
  refund(input: { orderId: string; amountCents: number }): Promise<never>
}

class ManualTransferProvider implements PaymentProvider {
  readonly key = 'manual' as const

  async createIntent(order: OrderLike): Promise<PaymentIntent> {
    const config = await getTransferConfig()
    if (!config.configured) throw new BillingError('NO_TRANSFER_CONFIG')
    return {
      kind: 'instructions',
      accountName: config.accountName!,
      accountNo: config.accountNo!,
      bank: config.bank,
      amountCents: order.amountCents,
      currency: order.currency,
      reference: order.reference,
      note: config.note,
      qrPath: config.qrPath,
    }
  }

  async markPaid({ orderId, actorUserId }: { orderId: string; actorUserId: string }): Promise<ConfirmResult> {
    // 两次写必须在同一个事务里。落章是「这次点击」的审计记录，而败者的点击永远进不了
    // 下面的分支 —— 所以一旦订单先提交、落章后失败，那张单就再也无人能把它盖成
    // SUCCEEDED（后续点击全部 CAS 失败），钱账对不上且不可恢复。
    return prisma.$transaction(async (tx) => {
      const result = await confirmAndFulfill(tx, { orderId, actorUserId })
      // Only a won race settles the attempt: stamping SUCCEEDED on a losing click would
      // report a payment this click never made.
      if (result.ok) {
        await tx.paymentAttempt.updateMany({
          where: { orderId, provider: this.key, status: 'CREATED' },
          data: { status: 'SUCCEEDED', providerRef: `confirmed:${actorUserId}` },
        })
      }
      return result
    })
  }

  async verifyCallback(): Promise<never> {
    throw new BillingError('NOT_IMPLEMENTED')
  }

  async refund(): Promise<never> {
    throw new BillingError('NOT_IMPLEMENTED')
  }
}

const providers: Record<PaymentProviderKey, PaymentProvider | null> = { manual: new ManualTransferProvider(), wechat: null }

export function getPaymentProvider(key: PaymentProviderKey = 'manual'): PaymentProvider {
  const provider = providers[key]
  if (!provider) throw new BillingError('NOT_IMPLEMENTED', `provider ${key} is not configured`)
  return provider
}
```

- [ ] **Step 4: 跑断言到全绿**

Run: `npx tsx scripts/check-payment-provider.mts` → Expected: 11 passed（本地 `Settings` 已填收款账户时 12 passed）/ **0 failed**，且进程要自己退出（挂着不动就是漏了 `$disconnect`），输出干净无告警。

- [ ] **Step 5: 门禁 + 汇报**

Run: `npx tsc --noEmit && npx eslint src/lib/payment-provider.ts src/lib/settings.ts scripts/check-payment-provider.mts`
Expected: 退出码 0。**WP1 结束**：向用户报告「三个断言脚本（pricing / billing-flow / payment-provider）的实际输出 + 一次重启 dev 的窗口约定」，等他说继续。

---

# WP2 平台配置（做完 = 运营能自己填收款账户）

### Task 5: 收款信息读写接口 + 平台设置里的新区块

**Files:**
- Create: `src/app/api/settings/transfer/route.ts`
- Create: `src/app/api/settings/transfer/qr/route.ts`
- Create: `src/components/settings/TransferSettingsSection.tsx`
- Modify: `src/app/platform/settings/page.tsx` —— 四个插入点，缺一处界面就是半残的（见 Step 3 的行号）
- Modify: `src/locales/zh.json`、`src/locales/en.json`、`src/locales/de.json`、`src/locales/nl.json`（`settings.transfer.*`，四语一次补齐）
- Test: `scripts/billing-api-check.mjs` 的一部分（Task 8 汇总），本任务用 curl

**Interfaces:**
- Consumes: `requirePlatformAdmin`（`src/lib/auth.ts:607`，返回 `AuthUser | Response`，内部走 `getConsoleUserFromRequest`）、`uploadFile(path, stream|Buffer, size, contentType)`（`src/lib/storage.ts:101`）、`initStorage`（`:95`）、`deleteFile`（`:206`）、`downloadFile`（`:182`，读取存储对象用它的 local/S3 两分支）、`validateRequest`（`src/lib/validation.ts:586`）+ `safeParseBodyTolerant`（`:531`）+ zod 3.25、`apiFetch` / `apiPatch` / `apiPost`（`src/lib/api-client.ts:12/90/74`）
- Produces: `GET /api/settings/transfer` → `{ accountName, accountNo, bank, note, qrPath, configured, qrUrl }`（`getTransferConfig()` 的六个键 + `qrUrl`）；`PATCH` 同形状，且**只写请求体里出现过的键**（缺席=保留原值，显式 `null` 或空串=清空）。`qrUrl` 是那条受平台令牌保护的读路由地址，**不能直接塞进 `<img src>`**（图片请求带不上 `Authorization`），界面要按 Step 2 那样取字节再 `createObjectURL`。

**已实测的房内事实（本任务按此写，别另外发明）：**
- `src/components/settings/` 里**每一个** section 都用 `useTranslations('settings')`；「平台控制台不走 locales」是错的。
- `CollapsibleSection` 的 props（`src/components/ui/collapsible-section.tsx:9-22`）是
  `{ title, description?, open, onOpenChange, children, className?, headerClassName?, contentClassName?, iconClassName?, collapsible? }`
  —— `title`/`open`/`onOpenChange`/`children` 必填，其余可选。
- 本目录有两种并存骨架：受控型（`BrandingSection` 等 8 个，全部状态从页面 props 灌进来）与自取型（`WebPushSection`、`ExternalNotificationsSection`，自己 fetch）。收款信息走**自取型**：它有独立接口和独立保存动作，塞进那个 967 行页面就要多挂 6 个 state + 3 个 handler + 1 个 `brandingProps` 式的 props 包，而页面顶部那个「一键保存全部」会把对公账号和别的选择混成一次 PATCH —— 两个理由都指向不搭车。
- `withAuthHeader`（`api-client.ts:123`）不设 `Content-Type`，且在 `/platform` 页面下自动改用平台令牌（`:133`）⇒ 上传用 `apiFetch(url, { method:'POST', body: formData })`，**不要**用 `apiPost`（它硬编 `application/json`，multipart 会坏）。
- `apiPatch`/`apiPost` 在非 2xx 时 `throw new Error(响应里的 error 字段)`（`:62-68`）⇒ 服务端那句「收款账号只能包含数字、字母和连字符」会原样到达界面。

- [ ] **Step 1: 新接口**

`src/app/api/settings/transfer/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requirePlatformAdmin } from '@/lib/auth'
import { uploadFile } from '@/lib/storage'
import { validateRequest, safeParseBodyTolerant } from '@/lib/validation'
import { getTransferConfig } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 收款码的对象键不写死：后缀必须由**上传字节本身**决定（PNG 魔数 / JPEG SOI），
// 写死 `.png` 会让 JPEG 存进 `.png` 键、读接口再把它的字节标成 `image/png`；
// 只信 `file.type` 也不够，那是客户端自报的。换格式时旧键要删掉。
const QR_KEY = 'branding/transfer-qr'
type QrFormat = { extension: string; contentType: string }
const QR_FORMATS: Record<'png' | 'jpeg', QrFormat> = {
  png: { extension: '.png', contentType: 'image/png' },
  jpeg: { extension: '.jpg', contentType: 'image/jpeg' },
}
const MAX_QR_BYTES = 2 * 1024 * 1024

// PNG 的签名是固定的头 8 字节；JPEG 是 FF D8 再加下一个标记段的开头（FF）。
// 只认签名的开头就足够把这两类分开：真正的解码交给浏览器，这里只决定「存进哪个键、标成哪种类型」。
function sniffQrFormat(buffer: Buffer): QrFormat | null {
  const isPng =
    buffer.length >= 8 &&
    buffer.readUInt32BE(0) === 0x89504e47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  if (isPng) return QR_FORMATS.png
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (isJpeg) return QR_FORMATS.jpeg
  return null
}

const transferSchema = z.object({
  accountName: z.string().trim().max(80).nullish(),
  accountNo: z.string().trim().max(64).nullish(),
  bank: z.string().trim().max(80).nullish(),
  note: z.string().max(2000).nullish(),
})

export async function GET(request: NextRequest) {
  const auth = await requirePlatformAdmin(request)
  if (auth instanceof Response) return auth
  const config = await getTransferConfig()
  return NextResponse.json({ ...config, qrUrl: config.qrPath ? `/api/settings/transfer/qr` : null })
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePlatformAdmin(request)
  if (auth instanceof Response) return auth
  const parsed = await safeParseBodyTolerant(request)
  if (!parsed.success) return parsed.response
  const validation = validateRequest(transferSchema, parsed.data)
  if (!validation.success) {
    return NextResponse.json({ error: validation.error, details: validation.details }, { status: 400 })
  }
  const { accountName, accountNo, bank, note } = validation.data

  // 账号要留空格以外的一切：企业网银账号里出现空格是常见输入习惯，
  // 但带空格的账号抄进转账界面会被银行拒。undefined/null 原样透传（下面区分「没发」与「发 null」）。
  const normalizedNo = typeof accountNo === 'string' ? accountNo.replace(/\s+/g, '') : accountNo
  if (normalizedNo && !/^[0-9A-Za-z-]{6,64}$/.test(normalizedNo)) {
    return NextResponse.json({ error: '收款账号只能包含数字、字母和连字符' }, { status: 400 })
  }

  // 只写请求体里真的出现过的键：zod 对缺席的 nullish 输入键不给输出属性，所以 `!== undefined`
  // 就是「这次没提到这一项」。这是一条 PATCH 不是 PUT —— 缺席就留原值，显式 null 或空串才清空。
  // 那五列是运营唯一的一份收款配置，被一次半截请求抹掉等于全站客户当场无法下单；界面四个键全发，
  // 所以这条只挡住误用和未来的局部调用。
  const fields: {
    transferAccountName?: string | null
    transferAccountNo?: string | null
    transferBank?: string | null
    transferNote?: string | null
  } = {}
  if (accountName !== undefined) fields.transferAccountName = accountName?.trim() || null
  if (normalizedNo !== undefined) fields.transferAccountNo = normalizedNo || null
  if (bank !== undefined) fields.transferBank = bank?.trim() || null
  if (note !== undefined) fields.transferNote = note || null
  if (Object.keys(fields).length > 0) {
    await prisma.settings.upsert({
      where: { id: 'default' },
      update: fields,
      create: { id: 'default', ...fields },
    })
  }
  const config = await getTransferConfig()
  return NextResponse.json({ ...config, qrUrl: config.qrPath ? `/api/settings/transfer/qr` : null })
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformAdmin(request)
  if (auth instanceof Response) return auth
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: '缺少图片' }, { status: 400 })
  if (file.size > MAX_QR_BYTES) {
    return NextResponse.json({ error: '收款码图片不得超过 2MB' }, { status: 400 })
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  const format = sniffQrFormat(buffer)
  if (!format) {
    return NextResponse.json({ error: '收款码只支持 PNG 或 JPEG' }, { status: 400 })
  }
  const qrPath = `${QR_KEY}${format.extension}`
  // 先单独把库里当前指向的键读出来：它只服务后面的清理判断。跟上传塞进同一个 try 的话，一次
  // 读库抖动会被记成「upload failed」，把第一起真实事故带偏。读失败就直接中止而不是当作 null ——
  // 拿不准 previousPath 就往下走，同格式换码写库失败时会删掉正被客户看着的那张码。
  let previousPath: string | null = null
  try {
    previousPath =
      (await prisma.settings.findUnique({ where: { id: 'default' }, select: { transferQrPath: true } }))?.transferQrPath ?? null
  } catch (error) {
    logError('[SETTINGS:TRANSFER_QR] previous key read failed', error)
    return NextResponse.json({ error: '收款码保存失败，请重试' }, { status: 500 })
  }
  try {
    await initStorage()
    await uploadFile(qrPath, buffer, buffer.byteLength, format.contentType)
  } catch (error) {
    logError('[SETTINGS:TRANSFER_QR] upload failed', error)
    return NextResponse.json({ error: '收款码保存失败，请重试' }, { status: 500 })
  }
  try {
    await prisma.settings.upsert({
      where: { id: 'default' },
      update: { transferQrPath: qrPath },
      create: { id: 'default', transferQrPath: qrPath },
    })
  } catch (error) {
    // 写库失败就把刚上传的对象删掉：留着一个没人指向的文件，下次换码时既不会被覆盖也不会有人知道它存在。
    // 但同格式换码时它覆盖的正是当前生效的那张 —— 库里指的还是同一个键，删掉会让客户当场看到 404。
    if (qrPath !== previousPath) {
      await deleteFile(qrPath).catch((cleanup) => logError('[SETTINGS:TRANSFER_QR] orphan cleanup failed', cleanup))
    } else {
      // 这条分支故意留着新字节：代价是界面报「保存失败」而客户看到的码其实已经换了。
      // 不留一行日志的话，这个「报的状态和发的图不一致」永远查不出来。
      logError(`[SETTINGS:TRANSFER_QR] settings write failed, live key ${qrPath} bytes already replaced`, error)
    }
    logError('[SETTINGS:TRANSFER_QR] settings write failed', error)
    return NextResponse.json({ error: '收款码保存失败，请重试' }, { status: 500 })
  }
  // 换格式后旧键不再有人指向，顺手清掉；删失败只留一个孤儿对象，不影响新码生效。
  if (previousPath && previousPath !== qrPath) {
    await deleteFile(previousPath).catch((cleanup) => logError('[SETTINGS:TRANSFER_QR] previous qr cleanup failed', cleanup))
  }
  return NextResponse.json({ ok: true })
}
```

顶部 import 里除 `uploadFile` 还要 `initStorage` 与 `deleteFile`（`src/app/api/settings/logo/route.ts:3` 同一行就这三个），
外加 `import { logError } from '@/lib/logging'`。这两步不是可选的：房内所有平台侧上传都先 `initStorage()` 再
`uploadFile()`（`settings/logo/route.ts:113-115`），少了它 COS/S3 模式下拿不到 client；失败回滚同样是那条路由的做法。
`rateLimit` 这里刻意不接 —— 调用方只有平台管理员本人，且这张图一年换不了几次，加限流只会在运营手滑时被误伤。

收款码的读接口 `src/app/api/settings/transfer/qr/route.ts` **不给团队端用**（客户侧看收款码走 WP3 的 intent 接口，
由它自己决定要不要带图）。**不要照邻居 `src/app/api/branding/logo/route.ts:17-19` 的读法** —— 它用
`fs.readFile(getFilePath(...))`，而 `getFilePath` 只是 `validatePath`（`src/lib/storage.ts:228`），只在
`STORAGE_PROVIDER=local` 下指向真文件；生产跑的是 S3 兼容对象存储（`isS3Mode()`，`src/lib/storage.ts:11-13`），
那样读等于收款码一上线就 404。房内把存储对象回吐给 HTTP 的口径是 `downloadFile()`（`storage.ts:182` 自己在
local/S3 之间分流）+ `Readable.toWeb(stream)`，见 `src/app/api/users/[id]/avatar/route.ts:118-127`。

```ts
import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'stream'
import { requirePlatformAdmin } from '@/lib/auth'
import { downloadFile, fileExists } from '@/lib/storage'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await requirePlatformAdmin(request)
  if (auth instanceof Response) return auth
  // 路径从库里读而不是写死常量：库里存的是当前生效的那张，写死会在换码后继续发旧图。
  const row = await prisma.settings.findUnique({ where: { id: 'default' }, select: { transferQrPath: true } })
  const stored = row?.transferQrPath
  if (!stored) return NextResponse.json({ error: '未上传收款码' }, { status: 404 })
  // 必须先问一次存在性：local 模式下 `downloadFile()` 只是 `fs.createReadStream()`，文件不存在时它
  // 照样 resolve，ENOENT 要等流被读时才冒出来 —— 那时 200 已经发出去了，下面的 catch 根本拦不住，
  // 客户界面上是一个永远转圈的图片而不是「这张单没有图」。S3 模式才会同步抛。
  if (!(await fileExists(stored))) return NextResponse.json({ error: '未上传收款码' }, { status: 404 })
  try {
    const stream = await downloadFile(stored)
    return new NextResponse(Readable.toWeb(stream) as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': stored.endsWith('.png') ? 'image/png' : 'image/jpeg',
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      },
    })
  } catch {
    return NextResponse.json({ error: '收款码文件读取失败' }, { status: 404 })
  }
}
```

`brandingLogoPath` 存的是一个 URL（`/api/branding/logo`），`transferQrPath` 存的是存储键（`branding/transfer-qr` + 真实格式的后缀）
—— 这是刻意的：客户侧的 intent 接口要自己决定内联还是给地址，所以库里存的必须是可以再解析一次的键。
评审若指此处「与邻居不一致」，是已知取舍：不一致的是**存什么**（键 vs URL）与**读取原语**（`downloadFile` vs
`fs.readFile`），后者是修邻居的坑而不是复制它。

- [ ] **Step 2: 新区块组件 + 四语文案**

`src/components/settings/TransferSettingsSection.tsx` —— 自取型骨架（`CollapsibleSection` 外壳 +
`useTranslations('settings')` 与邻居一致；数据自己 GET/PATCH，因为它是独立接口、独立保存动作，
理由见本任务开头的「已实测的房内事实」）。字段为「户名 / 账号 / 开户行 / 补充说明」+ 一个收款码上传。

**控件尺度（这里刻意不套 Global Constraints 那条 `h-9`）**：`src/components/ui/input.tsx:17` 的默认就是
`h-10 rounded-lg`，本页面 8 个邻居区块全都直接用裸 `<Input>`，没有任何一个覆盖高度。把这一个区块改成 36px
会让同一页出现两种输入框高度 —— 那条 `h-9` _floor_ 讲的是 `/studio` 内容区，`/platform/settings` 的既有尺度是 40px。
保存按钮用 `Button size="sm"`。

```tsx
'use client'

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useTranslations } from 'next-intl'
import { QrCode, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { apiFetch, apiPatch } from '@/lib/api-client'

type TransferResponse = {
  accountName: string | null
  accountNo: string | null
  bank: string | null
  note: string | null
  qrPath: string | null
  configured: boolean
  qrUrl: string | null
}

type Form = { accountName: string; accountNo: string; bank: string; note: string }
type Feedback = { kind: 'ok' | 'error'; text: string } | null

export function TransferSettingsSection({
  show,
  setShow,
  collapsible = true,
}: {
  show: boolean
  setShow: (value: boolean) => void
  collapsible?: boolean
}) {
  const t = useTranslations('settings')
  const [form, setForm] = useState<Form>({ accountName: '', accountNo: '', bank: '', note: '' })
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [hasQr, setHasQr] = useState(false)
  const [qrRev, setQrRev] = useState(0)
  const [qrSrc, setQrSrc] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 收款码必须走字节而不是 <img src>：那个路由要平台 Bearer，而 <img> 请求带不上
  // Authorization 头（房内 /api/branding/logo 能用 <img> 是因为它根本没鉴权）。
  // 取一次字节顺带解决了换码后的缓存问题，不需要给地址拼版本号。
  useEffect(() => {
    if (!hasQr) {
      setQrSrc(null)
      return
    }
    let url: string | null = null
    let alive = true
    apiFetch('/api/settings/transfer/qr')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (!alive) return
        url = URL.createObjectURL(blob)
        setQrSrc(url)
      })
      .catch(() => {
        if (alive) setFeedback({ kind: 'error', text: t('transfer.qrLoadFailed') })
      })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [hasQr, qrRev, t])

  useEffect(() => {
    let alive = true
    apiFetch('/api/settings/transfer')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as TransferResponse
      })
      .then((cfg) => {
        if (!alive) return
        setForm({
          accountName: cfg.accountName ?? '',
          accountNo: cfg.accountNo ?? '',
          bank: cfg.bank ?? '',
          note: cfg.note ?? '',
        })
        setConfigured(cfg.configured)
        setHasQr(Boolean(cfg.qrUrl))
        setLoaded(true)
      })
      .catch(() => {
        if (alive) setFeedback({ kind: 'error', text: t('transfer.loadFailed') })
      })
    return () => {
      alive = false
    }
  }, [t])

  const setField =
    (key: keyof Form) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }))

  const save = useCallback(async () => {
    setSaving(true)
    setFeedback(null)
    try {
      const cfg = await apiPatch<TransferResponse>('/api/settings/transfer', form)
      setConfigured(cfg.configured)
      setHasQr(Boolean(cfg.qrUrl))
      setFeedback({ kind: 'ok', text: t('transfer.saved') })
    } catch (error) {
      // apiPatch 在非 2xx 时抛的就是响应里的 error 字段（api-client.ts:62-68），
      // 所以服务端那句「收款账号只能包含数字、字母和连字符」要原样给运营看到，不翻译、不裹一层。
      setFeedback({
        kind: 'error',
        text: error instanceof Error && error.message ? error.message : t('transfer.saveFailed'),
      })
    } finally {
      setSaving(false)
    }
  }, [form, t])

  const uploadQr = useCallback(
    async (file: File) => {
      setUploading(true)
      setFeedback(null)
      const body = new FormData()
      body.set('file', file)
      try {
        // 走 apiFetch 而不是 apiPost：后者硬编 Content-Type: application/json，
        // multipart 必须让浏览器自己带上 boundary。
        const res = await apiFetch('/api/settings/transfer', { method: 'POST', body })
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`)
        // 只刷收款码、不回填那四个框：运营可能有还没保存的编辑，这次上传不该把它们冲掉。
        setHasQr(true)
        setQrRev((v) => v + 1)
        setFeedback({ kind: 'ok', text: t('transfer.qrSaved') })
      } catch (error) {
        setFeedback({
          kind: 'error',
          text: error instanceof Error && error.message ? error.message : t('transfer.qrSaveFailed'),
        })
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [t],
  )

  return (
    <CollapsibleSection
      className="border-border"
      title={t('transfer.title')}
      description={t('transfer.description')}
      open={show}
      onOpenChange={setShow}
      collapsible={collapsible}
      contentClassName="space-y-4 border-t pt-4"
    >
      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="transferAccountName">{t('transfer.accountName')}</Label>
            <Input
              id="transferAccountName"
              value={form.accountName}
              onChange={setField('accountName')}
              maxLength={80}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="transferBank">{t('transfer.bank')}</Label>
            <Input id="transferBank" value={form.bank} onChange={setField('bank')} maxLength={80} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="transferAccountNo">{t('transfer.accountNo')}</Label>
          <Input
            id="transferAccountNo"
            value={form.accountNo}
            onChange={setField('accountNo')}
            maxLength={64}
            inputMode="numeric"
          />
          <p className="text-xs text-muted-foreground">{t('transfer.accountNoHint')}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="transferNote">{t('transfer.note')}</Label>
          <Textarea id="transferNote" rows={3} value={form.note} onChange={setField('note')} maxLength={2000} />
        </div>
        {configured === false && (
          <p className="text-xs font-medium text-destructive">{t('transfer.notConfigured')}</p>
        )}
      </div>

      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
        <Label>{t('transfer.qr')}</Label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void uploadQr(file)
            event.target.value = ''
          }}
        />
        <div className="flex items-center gap-4">
          <div className="w-24 h-24 rounded-xl border border-border bg-card flex items-center justify-center overflow-hidden">
            {qrSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrSrc} alt={t('transfer.qr')} className="w-full h-full object-contain" />
            ) : (
              <QrCode className="w-6 h-6 text-muted-foreground" />
            )}
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card text-sm hover:border-primary/60 hover:text-primary transition-colors disabled:opacity-50"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="w-4 h-4" />
            {uploading ? t('transfer.qrUploading') : hasQr ? t('transfer.qrReplace') : t('transfer.qrUpload')}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t('transfer.qrHint')}</p>
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => void save()} disabled={!loaded || saving || uploading}>
          {saving ? t('transfer.saving') : t('transfer.save')}
        </Button>
        {feedback && (
          <p
            role={feedback.kind === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={
              feedback.kind === 'error'
                ? 'text-xs font-medium text-destructive'
                : 'text-xs font-medium text-success'
            }
          >
            {feedback.text}
          </p>
        )}
      </div>
    </CollapsibleSection>
  )
}
```

四语文案：往 `src/locales/zh.json` / `en.json` / `de.json` / `nl.json` 的 `settings` 对象里插一个
`transfer` 子对象（四个文件都要有，键完全一致 —— 少一个键在该语言下会直接抛 `MISSING_MESSAGE`）。
这里只有界面标签与提示，没有任何虚构的客户名、日期或价格：

```json
{
  "title": "收款信息",
  "description": "客户下单后看到的对公转账说明。",
  "accountName": "户名",
  "accountNo": "收款账号",
  "accountNoHint": "只允许数字、字母和连字符；空格会被自动去掉。",
  "bank": "开户行",
  "note": "补充说明",
  "notConfigured": "户名和收款账号还没填，客户现在无法下单。",
  "qr": "收款码",
  "qrHint": "支持 PNG 或 JPEG，不超过 2MB。",
  "qrUpload": "上传收款码",
  "qrReplace": "替换收款码",
  "qrUploading": "上传中…",
  "qrSaved": "收款码已更新。",
  "qrSaveFailed": "收款码保存失败，请重试。",
  "qrLoadFailed": "收款码读取失败。",
  "save": "保存",
  "saving": "保存中…",
  "saved": "已保存。",
  "saveFailed": "保存失败，请重试。",
  "loadFailed": "收款信息读取失败。"
}
```

对应译文（键同上，逐语言照抄）：
`en` = `Payment details` / `The bank-transfer instructions customers see after placing an order.` /
`Account name` / `Account number` / `Digits, letters and hyphens only; spaces are removed automatically.` /
`Bank` / `Note` / `Account name and account number are empty, so customers cannot place orders yet.` /
`QR code` / `PNG or JPEG, up to 2 MB.` / `Upload QR code` / `Replace QR code` / `Uploading…` /
`QR code updated.` / `Could not save the QR code. Please try again.` / `Could not load the QR code.` /
`Save` / `Saving…` / `Saved.` /
`Could not save. Please try again.` / `Could not load payment details.`
`de` = `Zahlungsdaten` / `Die Überweisungsinformationen, die Kunden nach der Bestellung sehen.` /
`Kontoinhaber` / `Kontonummer` / `Nur Ziffern, Buchstaben und Bindestriche; Leerzeichen werden entfernt.` /
`Bank` / `Hinweis` / `Kontoinhaber und Kontonummer sind leer, Kunden können noch keine Bestellungen aufgeben.` /
`QR-Code` / `PNG oder JPEG, bis zu 2 MB.` / `QR-Code hochladen` / `QR-Code ersetzen` / `Hochladen…` /
`QR-Code aktualisiert.` / `QR-Code konnte nicht gespeichert werden. Bitte erneut versuchen.` /
`QR-Code konnte nicht geladen werden.` /
`Speichern` / `Speichern…` / `Gespeichert.` / `Speichern fehlgeschlagen. Bitte erneut versuchen.` /
`Zahlungsdaten konnten nicht geladen werden.`
`nl` = `Betaalgegevens` / `De overmaakgegevens die klanten na hun bestelling zien.` /
`Rekeningnaam` / `Rekeningnummer` / `Alleen cijfers, letters en koppeltekens; spaties worden verwijderd.` /
`Bank` / `Opmerking` / `Rekeningnaam en rekeningnummer zijn leeg, klanten kunnen nog niet bestellen.` /
`QR-code` / `PNG of JPEG, tot 2 MB.` / `QR-code uploaden` / `QR-code vervangen` / `Uploaden…` /
`QR-code bijgewerkt.` / `QR-code kon niet worden opgeslagen. Probeer opnieuw.` /
`QR-code kon niet worden geladen.` /
`Opslaan` / `Bezig met opslaan…` / `Opgeslagen.` / `Opslaan mislukt. Probeer opnieuw.` /
`Betaalgegevens konden niet worden geladen.`

补齐后自证（`settings.transfer` 四语必须各 21 键且键集完全相同 —— 少一个键在该语言下渲染就抛
`MISSING_MESSAGE`，多拼一个键评审会当成死文案）：

```bash
python3 -c "
import json
ks=[set(json.load(open(f'src/locales/{l}.json'))['settings']['transfer']) for l in ('zh','en','de','nl')]
print(len(ks[0]), all(k==ks[0] for k in ks))"
```
Expected: `21 True`。

- [ ] **Step 3: 挂进平台设置页（四个插入点，缺一处界面就是半残的）**

`src/app/platform/settings/page.tsx` 有两套渲染面：移动端是堆叠的可折叠卡片，桌面端是左侧 nav + 右侧单块面板。
**只加其中一个的后果**：只加移动端 ⇒ 桌面端根本看不到；只加 nav ⇒ 点了没内容。四处依次是：

1. `:8` lucide 那一行 import 里加 `QrCode`；`:17`（`BlocklistSection` 那行）之后、`:18` 的
   `import { apiPatch, apiPost, apiFetch } from '@/lib/api-client'` 之前加
   `import { TransferSettingsSection } from '@/components/settings/TransferSettingsSection'`。
2. `:202`（`const [showBlocklist, setShowBlocklist] = useState(false)`）之后加
   `const [showTransfer, setShowTransfer] = useState(false)`。`activeSection` 是
   `useState('appearance')` 推出来的 `string`（`:204`），没有联合类型要改。
3. `:775-784` 的 `settingSections` 数组里，`branding` 那项之后插
   `{ id: 'transfer', label: t('transfer.title'), icon: QrCode },`；
   `:895` 的 `<BrandingSection …/>` 之后插
   `<TransferSettingsSection show={showTransfer} setShow={setShowTransfer} />`。
4. `:934-936` 的 `{activeSection === 'branding' && (…)}` 块之后插
   ```tsx
   {activeSection === 'transfer' && (
     <TransferSettingsSection show={showTransfer} setShow={setShowTransfer} collapsible={false} />
   )}
   ```

`showTransfer` 在桌面端不参与显隐（面板自己按 `activeSection` 判断），但 `CollapsibleSection` 的
`open` 是必填 prop，所以照邻居一样把 state 传进去；`collapsible={false}` 时它恒展开（`collapsible-section.tsx:32` 的
`isOpen = collapsible ? open : true`）。
本区块自己取数，**不要**往那个 967 行页面里加第 6 个 state、也不要接进页面顶部那个「一键保存全部」。

- [ ] **Step 4: curl 验证（平台管理员身份 —— 这一步写的是他本地那行真实 `Settings`，必须先存档后恢复）**

平台侧要 `POST /api/platform/auth/login` 换 Bearer，不是 cookie（见 Global Constraints）。
`LOCAL_PLATFORM_CHECK_EMAIL` / `LOCAL_PLATFORM_CHECK_PASSWORD` 缺任何一个 ⇒ **整个 Step 4 跳过**，
汇报里写「未验证」，不许猜凭据、不许改用团队端令牌凑。顺序固定：存档 → 测 → 恢复 → 读回核对。

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/platform/auth/login \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$LOCAL_PLATFORM_CHECK_EMAIL\",\"password\":\"$LOCAL_PLATFORM_CHECK_PASSWORD\"}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).tokens.accessToken))')
echo "长度 ${#TOKEN}"   # 只验证拿到了，绝不 echo 令牌本身

# 4a 存档。以读到的为准，不要假设它是 null（他可能已经填过真账号）。
curl -s localhost:3000/api/settings/transfer -H "authorization: Bearer $TOKEN" | tee /tmp/transfer-before.json
```

4b 全量写入 + 空格归一：

```bash
curl -s -X PATCH localhost:3000/api/settings/transfer \
  -H "content-type: application/json" -H "authorization: Bearer $TOKEN" \
  -d '{"accountName":"示例影视有限公司","accountNo":"6222 0200 1111 2222 333","bank":"招商银行","note":"备注必填订单号"}'
```
Expected: 200，响应体恰好这 7 个键，且账号里的空格被吃掉：
`{"accountName":"示例影视有限公司","accountNo":"6222020011112222333","bank":"招商银行","note":"备注必填订单号","qrPath":null,"configured":true,"qrUrl":null}`
（`qrPath`/`qrUrl` 必须与 4a 读到的值一致 —— 本步骤不传图，谁都不许动它。）

4c **真 PATCH 的回归**：只发一个键，其余三项必须原样留着。这是 Step 1 那句「只写请求体里出现过的键」
唯一的证明机会；缺了它，一次半截请求抹掉运营收款配置（= 全站客户当场无法下单）就没人拦得住。

```bash
curl -s -X PATCH localhost:3000/api/settings/transfer \
  -H "content-type: application/json" -H "authorization: Bearer $TOKEN" -d '{"bank":"工商银行"}'
```
Expected: 200，`accountName`/`accountNo`/`note` 与 4b 完全一致，只有 `bank` 变成 `工商银行`。

4d 非法账号要 400 **且不落库**：

```bash
curl -s -X PATCH localhost:3000/api/settings/transfer \
  -H "content-type: application/json" -H "authorization: Bearer $TOKEN" -d '{"accountNo":"!!!"}'
curl -s localhost:3000/api/settings/transfer -H "authorization: Bearer $TOKEN"
```
Expected: 前者 400 `收款账号只能包含数字、字母和连字符`；后者 `accountNo` 仍是 `6222020011112222333`。

4e 不带令牌（去掉 `-H authorization`）→ Expected: 401 `Unauthorized`。
（`requirePlatformAdmin` 走 `getConsoleUserFromRequest`（`src/lib/auth.ts:607-623`）；本地那条登录若回 401，
说明这个账号 `isPlatformAdmin` 为 false，换 `LOCAL_PLATFORM_CHECK_*` 指向的账号，不要改用团队端令牌凑。）

4f **恢复原样并核对**（`transferQrPath` 不归 PATCH 管，所以只需回写这四个键）：

```bash
python3 -c "
import json; c=json.load(open('/tmp/transfer-before.json'))
print(json.dumps({k: c[k] for k in ('accountName','accountNo','bank','note')}))" > /tmp/transfer-restore.json
curl -s -X PATCH localhost:3000/api/settings/transfer \
  -H "content-type: application/json" -H "authorization: Bearer $TOKEN" -d @/tmp/transfer-restore.json
curl -s localhost:3000/api/settings/transfer -H "authorization: Bearer $TOKEN"
```
Expected: 最后一条输出与 4a 存档逐字段一致。唯一的容许差异：库里原本若是空串 `''`，读接口会归一成 `null`
（`getTransferConfig` 的 `?.trim() || null`），写回后仍是「未填」语义、`configured` 不变 —— 这是已知且刻意的。
**4f 没做完就不许进 Step 5。**

**「团队端令牌请求 `GET /api/settings` 与 `GET /api/settings/transfer` 都得 403」这条不在这里验**：它需要第二枚令牌（团队端的），Task 8 的 `billing-api-check.mjs` 一次性覆盖（spec §12 负例 11）。

- [ ] **Step 5: 门禁 + 汇报**

Run: `npx tsc --noEmit && npx eslint src/app/api/settings/transfer src/components/settings/TransferSettingsSection.tsx src/app/platform/settings/page.tsx`
Expected: 退出码 0。不 commit。

---

# WP3 门户接口（做完 = 客户可以下单/报付款，运营查库也能确认）

### Task 6: `POST /api/billing/orders`

**Files:**
- Create: `src/app/api/billing/orders/route.ts`
- Test: curl（Task 8 汇总成脚本）

**Interfaces:**
- Consumes: `getCurrentUserFromRequest`（`src/lib/auth.ts:518`，返回 `AuthUser | null`）、`getActiveTeamMembership` + `getRequestedTeamId`（`src/lib/team-access.ts:37/28`）、`createOrder`（Task 3）
- Produces: `POST /api/billing/orders` body `{ planKey, periods, invoice? }` → 200 `{ order: OrderDto, reused: boolean }`。**全站所有 billing 响应都用这一个 `OrderDto`**，字段以 Step 1 的定义为准（含发票三列，客户回显与运营队列都要读）。`planName` 不在 DTO 里：套餐名由 Task 6 的套餐列表接口和 Task 10 的平台队列接口各自附带。

- [ ] **Step 1: 先抽 `src/lib/billing-dto.ts`**

```ts
import type { Order } from '@prisma/client'

export type OrderDto = {
  id: string
  reference: string
  planKey: string
  periods: number
  amountCents: number
  currency: string
  status: string
  createdAt: string
  reportedAt: string | null
  paidAt: string | null
  fulfilledAt: string | null
  periodEnd: string | null
  closeReason: string | null
  reportNote: string | null
  invoiceRequested: boolean
  invoiceTitle: string | null
  invoiceTaxNo: string | null
}

/** Deliberately no account fields: transfer instructions only come from the intent route. */
export function toOrderDto(order: Order): OrderDto {
  return {
    id: order.id,
    reference: order.reference,
    planKey: order.planKey,
    periods: order.periods,
    amountCents: order.amountCents,
    currency: order.currency,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    reportedAt: order.reportedAt?.toISOString() ?? null,
    paidAt: order.paidAt?.toISOString() ?? null,
    fulfilledAt: order.fulfilledAt?.toISOString() ?? null,
    periodEnd: order.periodEnd?.toISOString() ?? null,
    closeReason: order.closeReason,
    reportNote: order.reportNote,
    invoiceRequested: order.invoiceRequested,
    invoiceTitle: order.invoiceTitle,
    invoiceTaxNo: order.invoiceTaxNo,
  }
}
```

- [ ] **Step 2: 路由实现（OWNER 门禁 + teamId 服务端派生）**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import type { AuthUser } from '@/lib/auth'
import { getActiveTeamMembership, getRequestedTeamId } from '@/lib/team-access'
import { validateRequest, safeParseBodyTolerant } from '@/lib/validation'
import { createOrder } from '@/lib/billing'
import { BillingError, isAllowedPeriods } from '@/lib/billing-pricing'
import { toOrderDto } from '@/lib/billing-dto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  planKey: z.string().trim().min(1).max(40),
  periods: z.number().int(),
  invoice: z.object({
    requested: z.boolean(),
    title: z.string().trim().max(80).nullish(),
    taxNo: z.string().trim().max(40).nullish(),
  }).optional(),
})

// 只有团队所有者能花钱。用房内解析器而不是自己比对 membership：团队会被平台置成
// DISABLED（platform/teams/[id]/route.ts:18），届时这条链路上就不该再产生新订单 ——
// `team-access.ts:33-35` 的注释正是在拦「路由自己重新解析、判得更松」。
async function ownerTeam(request: NextRequest, user: AuthUser) {
  const membership = await getActiveTeamMembership(user, getRequestedTeamId(request))
  if (!membership || membership.role !== 'OWNER') return null
  return membership.teamId
}
```

`getActiveTeamMembership` 已经查过 `membership.status === 'ACTIVE'` 与 `team.status === 'ACTIVE'`，所以这里只补角色那一刀。它读的是 `x-team-id` 请求头（`getRequestedTeamId`），没有 `?teamId=` 兜底 —— `/studio` 下的 `apiFetch` 恒带这个头，缺头时房内解析器回落到本人第一张 ACTIVE 团队，两者都在授权范围内。**teamId 只从 membership 取，请求头只是"想进哪个团队"的意图，不是授权来源。**

不用零调用方的 `requireTeamOwner()`（`team-access.ts:78`）：它的 403 是通用英文 `Insufficient team permissions`，而这一族接口的拒答文案要跟 `activate/route.ts:25` 的中文同族。

`POST` 主体的解析口径与 Task 5 完全同一套（`validateRequest` 的实参顺序是 `(schema, data)`，返回的是结果对象不是 Response，必须自己转成 400）：

```ts
  const parsed = await safeParseBodyTolerant(request)
  if (!parsed.success) return parsed.response
  const validation = validateRequest(bodySchema, parsed.data)
  if (!validation.success) {
    return NextResponse.json({ error: validation.error, details: validation.details }, { status: 400 })
  }
  const { planKey, periods, invoice } = validation.data
```

随后：`createOrder` 包在 `prisma.$transaction` 里 → `BillingError` 映射：`INVALID_PLAN`/`INVALID_PERIODS` → 400，其余 → 500；成功 → `{ order: toOrderDto(order), reused }`。`periods` 必须在进 `createOrder` 前用 `isAllowedPeriods` 挡一次（返回 400 而不是 500）——`bodySchema` 里写 `periods: z.number().int()` 拦不住 `2`，只有白名单拦得住。

`Order.reference` 是 `@unique`，Task 3 已落地的 `uniqueReference(tx)` 会在建行前查 5 次，所以剩下的窗口只有「两个人同一毫秒撞出同一个码」：外层再捕一次 `error.code === 'P2002'` → 500 `{ error: '下单失败，请重试' }`，**不要把 Prisma 原文吐给客户端**（同类「裸 500 + 界面说谎」缺陷在后台体检里记过）。

**未定价套餐必须在这里挡住。** Task 1 的迁移只 seed 一档（`MONTHLY`，`priceCents` 写成 0 分，不编造定价），而 `computeAmountCents` 只拒负数 —— 也就是说客户端现在能对 `MONTHLY` 下出一张 0 元单，运营手一抖就白续一年。但**不能改 `createOrder`**：Task 13 的卡密兑换正是用 `priceCents: 0` 的 Plan 行走同一条路（plan 里 `:2411`）。所以在路由里先查一次：

```ts
const plan = await prisma.plan.findUnique({ where: { key: planKey }, select: { active: true, priceCents: true } })
if (!plan || !plan.active || plan.priceCents <= 0) {
  return NextResponse.json({ error: '该套餐尚未开放，请联系运营' }, { status: 400 })
}
```

（这次读不代替 `createOrder` 内部的校验，只是把「不可售」在边界上变成一个能读懂的 400。）

已登记的接受风险，路由层不用管、评审若再报按已知取舍处理（台账 `T3-R1`）：`createOrder` 复用分支写发票三列时没有状态谓词，理论上可把需求写到一张同一毫秒被他人关掉的单上；不伤权益、金额与审计签名。

- [ ] **Step 3: 正例 + 负例（这一步只跑「一个 OWNER 账号就能打完」的六条；MEMBER 403 与越权面要第二枚令牌，在 Task 8 的脚本里一次性覆盖）**

**先造一张有价的测试套餐。** 迁移 seed 的那一档（`MONTHLY`）`priceCents` 是 0（不编造定价），所以它在本地这一步是**负例**而不是正例；下单正例必须用自己造的 `BCHECK-HTTP` 行（照 Task 3 断言脚本 `:752` 同一手法），用完删掉：

```bash
npx tsx -e '(async () => { const { PrismaClient } = await import("@prisma/client"); const p = new PrismaClient()
  await p.plan.upsert({ where: { key: "BCHECK-HTTP" }, update: { priceCents: 39800, active: true },
    create: { key: "BCHECK-HTTP", name: "billing-check", priceCents: 39800, currency: "CNY", durationDays: 31,
      maxMembers: 3, maxProjects: 4, maxVideos: 5, maxStorageGB: 6, active: true } })
  console.log("plan ready") ; await p.$disconnect() })()'
```

```bash
OWNER_BEARER=$(curl -s -X POST localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$LOCAL_BILLING_CHECK_EMAIL\",\"password\":\"$LOCAL_BILLING_CHECK_PASSWORD\"}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).tokens.accessToken))')
BILL='curl -s -X POST localhost:3000/api/billing/orders -H content-type:application/json -H "authorization: Bearer '"$OWNER_BEARER"'" -d'
$BILL '{"planKey":"BCHECK-HTTP","periods":3}'                  → 200，amountCents === 119400
$BILL '{"planKey":"BCHECK-HTTP","periods":3,"amountCents":1}'  → 200，amountCents 仍是 119400（入参金额被丢弃）
$BILL '{"planKey":"BCHECK-HTTP","periods":2}'                  → 400
$BILL '{"planKey":"NOPE","periods":1}'                         → 400
$BILL '{"planKey":"MONTHLY","periods":1}'                      → 400 且文案是「该套餐尚未开放，请联系运营」（0 价种子行不可售）
$BILL '{"planKey":"BCHECK-HTTP","periods":3}'                  → 200 且 order.id 与第一次相同、reused:true
```

库里核对（`npx tsx -e` 走 CJS 输出，**不支持顶层 await**，所以必须是 async IIFE + 动态 import —— 已本地实测 exit 0）：

```bash
npx tsx -e '(async () => { const { PrismaClient } = await import("@prisma/client"); const p = new PrismaClient()
  console.table(await p.order.findMany({ where: { planKey: "BCHECK-HTTP" }, select: { id: true, reference: true, amountCents: true, status: true } }))
  console.log("本次造的终结单数", await p.order.count({ where: { planKey: "BCHECK-HTTP", status: { not: "OPEN" } } }))
  await p.$disconnect() })()'
```
Expected: 恰好 1 行、`status` 为 `OPEN`（幂等生效，不是 2 行），`amountCents` = 119400，`reference` 形如 `RV-XXXXXX`，终结单数 0。
按 `planKey` 过滤而不是数全局：库里可能留着别人/别的任务造的单，全局计数会在下次复跑时假失败。

**收尾（必做）**：`BCHECK-HTTP` 是 `active=true` 的行，留着它会在 Task 9 的套餐列表里多出一张客户看得见的假套餐。把这一步造的订单（按 `planKey='BCHECK-HTTP'`）和这张 plan 一起删掉，顺序是先删 Order（`Plan` 被 `Order.planKey` 以 `Restrict` 锁住，Task 1 已坐实），再删 Plan；Task 8 的脚本自带它那一套建/删，不依赖这里。

- [ ] **Step 4: 门禁 + 汇报**（`npx tsc --noEmit && npx eslint src/app/api/billing src/lib/billing-dto.ts`，退出码 0）

---

### Task 7: `GET /api/billing/orders` 与 `GET …/[id]/intent`

**Files:**
- Modify: `src/app/api/billing/orders/route.ts`（加 `GET`）
- Create: `src/app/api/billing/orders/[id]/intent/route.ts`
- Create: `src/app/api/billing/transfer/qr/route.ts`

**Interfaces:**
- Consumes: `toOrderDto`（Task 6）、`getPaymentProvider`（Task 4）
- Produces:
  - `GET /api/billing/orders` → `{ orders: OrderDto[], plan: PlanCard[], team: { plan, expiresAt } }`；`PlanCard = { key, name, priceCents, currency, durationDays, quota }`，只含 `active=true` **且 `priceCents > 0`**，按 `sort` 排。
  - `GET /api/billing/orders/[id]/intent` → `PaymentIntent`（`instructions` 分支）；`NO_TRANSFER_CONFIG` → 503 + `{ error: '平台尚未配置收款账户，请联系运营' }`。
  - `GET /api/billing/transfer/qr` → 收款码图片字节（`Content-Type` 按后缀，`Cache-Control: no-store, no-cache, must-revalidate, private`（房内多数写法，`auth/session/route.ts:17`、`teams/[id]/route.ts:111`）—— 收款码 URL 是常量，任何 `max-age` 都会把「换码后立刻发新图」这件事交给浏览器缓存去否决）；未配置 → 404 `{ error: '平台尚未上传收款码' }`。**Task 5 那个 `/api/settings/transfer/qr` 要平台管理员令牌，团队端用不了**（`<img src>` 带不上 `Authorization`），而 `PaymentIntent.qrPath` 是存储键、不是 URL —— 所以客户侧看码必须有这一个团队侧读接口，否则 Task 5 的上传功能没人能看见（写而不读）。

- [ ] **Step 1: 列表 GET**（同文件加导出）：`getActiveTeamMembership(user, getRequestedTeamId(request))` 取 teamId（任意 ACTIVE 成员都能看账单，与 `/studio/team` 现状一致，不需要 OWNER；但**这道门禁和 Task 6 一样要连 `team.status === 'ACTIVE'` 一起判**，被平台停掉的团队不该再有一条能读写的账单面），`prisma.order.findMany({ where: { teamId }, orderBy: { createdAt: 'desc' }, take: 50 })` + `plan.findMany({ where: { active: true, priceCents: { gt: 0 } }, orderBy: { sort: 'asc' } })` + team 的 `subscriptionPlan/subscriptionExpiresAt`。**响应里绝不出现任何 `transfer*` 字段。**

  `priceCents: { gt: 0 }` 不是可有可无的过滤：Task 1 只 seed 了一档 `MONTHLY` 且价格是 0 分（不编造定价，Task 6 的下单接口会拒），如果这里把它列出来，客户看到的是一张 `¥0` 的卡片、点一次失败一次 —— 这正是后台体检里反复记过的「界面说的和服务端做的不一致」。运营填了真实价格后卡片自然回来。**推论（本地验证要知道）：现在这张列表就是空的**，Task 8/9 要看到卡片必须自己 upsert 一张有价测试套餐（同 Task 6 Step 3 的 `BCHECK-HTTP` 手法），跑完删掉。

- [ ] **Step 2: intent 路由**

```ts
// 全局约束「`status` 用 String + TS 字面量联合 + 常量数组」的房规读法写在 `src/lib/billing.ts:13-16`：
// Prisma 把状态字面量放宽成 `string`，裸写 `'OPEN'` 连 `'REPORTT ED'` 都能编译过去。所以这里
// `import { type OrderStatus } from '@/lib/billing-pricing'`（`billing-pricing.ts:5` 导出），用常量比较。
const OPEN: OrderStatus = 'OPEN'
const order = await prisma.order.findFirst({ where: { id, teamId } })
if (!order) return NextResponse.json({ error: '订单不存在' }, { status: 404 })
if (order.status !== OPEN) return NextResponse.json({ error: '该订单已不需要付款' }, { status: 409 })
const intent = await getPaymentProvider().createIntent(order)
return NextResponse.json(intent)
```

- [ ] **Step 3: 团队侧收款码读接口**

`src/app/api/billing/transfer/qr/route.ts` —— 门禁与 Step 1 完全一致（任意 ACTIVE 成员可看，`getActiveTeamMembership` 只用来确认「这个人属于某个 ACTIVE 团队、且团队没被平台停用」，不查 Order）；文件路径从库里读而不是写死常量（同 Task 5 的理由：换码后必须立刻发新图）：

```ts
import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'stream'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { getActiveTeamMembership, getRequestedTeamId } from '@/lib/team-access'
import { downloadFile, fileExists } from '@/lib/storage'
import { getTransferConfig } from '@/lib/settings'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (!(await getActiveTeamMembership(user, getRequestedTeamId(request)))) {
    return NextResponse.json({ error: '无权访问' }, { status: 403 })
  }

  const config = await getTransferConfig()
  if (!config.qrPath) return NextResponse.json({ error: '平台尚未上传收款码' }, { status: 404 })
  // 与 Task 5 的读接口同一刀：local 模式下 `downloadFile()` 对不存在的文件不抛错，200 已经发出去才 ENOENT。
  if (!(await fileExists(config.qrPath))) return NextResponse.json({ error: '平台尚未上传收款码' }, { status: 404 })
  try {
    const stream = await downloadFile(config.qrPath)
    return new NextResponse(Readable.toWeb(stream) as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': config.qrPath.endsWith('.png') ? 'image/png' : 'image/jpeg',
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      },
    })
  } catch (error) {
    // 文件读不出来时给 404 而不是 500：客户界面上「这张单没有图」比「下单失败」更接近真相。
    logError('[BILLING:TRANSFER_QR] read failed', error)
    return NextResponse.json({ error: '平台尚未上传收款码' }, { status: 404 })
  }
}
```

`getCurrentUserFromRequest` / `getActiveTeamMembership` 的取法照 Task 6 Step 2 的 `ownerTeam` 同形，**唯一差别是这里不要求 `role === 'OWNER'`** —— 看账单/看收款码不需要花钱的权限，与 Step 1 的口径一致；`.png/.jpeg` 二选一够用是因为 Task 5 的上传键后缀由**字节 sniff**（PNG 魔数 / JPEG SOI）决定，落到库里的只有这两种后缀。

读取原语必须是 `downloadFile()`（`src/lib/storage.ts:182`，内部在 local 与 S3 之间分流）而不是
`fs.readFile(getFilePath(...))`：后者只在 `STORAGE_PROVIDER=local` 下指向真文件，生产跑 S3 兼容存储 ⇒ 客户界面上
收款码**永远 404**，而这条路径是 Task 9 那个转账块的图。与 Task 5 的 `/api/settings/transfer/qr` 同一个口径、
同一句理由，两处一起改（`branding/logo`、`branding/favicon` 两条老路由仍用 `fs.readFile`，属存量缺陷、不在本计划面）。


- [ ] **Step 4: curl 验证**
- `GET /api/billing/orders` → 200，`orders.length` 与库内计数一致，`grep -i "accountNo\|transferAccount"` 响应体 → 无命中。
- 非本团队的 `orderId` 打 intent → 404（**不许是 403 带出存在性**，用 `findFirst({where:{id,teamId}})` 天然如此）。
- `REPORTED` 单打 intent → 409。
- 未配置账户时 → 503。
- `GET /api/billing/transfer/qr`：无令牌 → 401；运营已传码 → 200 且 `content-type` 与文件后缀一致；库里 `transferQrPath` 为 null → 404。

- [ ] **Step 5: 门禁 + 汇报**

---

### Task 8: `POST …/[id]/report` + 一条命令跑完的 HTTP 复压脚本

**Files:**
- Create: `src/app/api/billing/orders/[id]/report/route.ts`
- Create: `scripts/billing-api-check.mjs`

**Interfaces:**
- Consumes: `reportOrderPaid`（Task 3）、`toOrderDto`
- Produces: `POST /api/billing/orders/:id/report` body `{ reportNote? }` → 200 `{ order: OrderDto }`；抢不到单 → 409 `{ error: '该订单当前状态无法报付款' }`

- [ ] **Step 1: 路由**：门禁用 Task 6 Step 2 同一个 `getActiveTeamMembership(user, getRequestedTeamId(request))`（任意 ACTIVE 成员可报，看得到账单就能报，只是**不查 `role === 'OWNER'`**；`teamId` 同样只能从 membership 取），`prisma.$transaction((tx) => reportOrderPaid(tx, { orderId, teamId, reportNote, actorUserId: auth.id }))`，`ok:false` → 409。`actorUserId` 必传（Task 3 评审 I-3）：这张单据的审计意义就是「谁替团队说的」，缺了它会回落到下单人，而下单人和报付款的人可以不是同一个。**这个值只能取自会话（`auth.id`），绝不允许出现在请求体里** —— `reportOrderPaid` 不校验 `actorUserId` 是否属于 `teamId`（Task 3 fix round 1 的 T3-R2 交接项），一旦从 body 取值，审计轨迹就变成客户可写。

- [ ] **Step 2: `scripts/billing-api-check.mjs`**

这是本次交付的"一次点击跑完"验收工具，只用内置 `fetch`（**不新增 npm 依赖**；`@prisma/client` 是仓库既有依赖，脚本用它是为了自建自清测试套餐，Task 3 的 `check-billing-flow.mts` 已经是这个做法）。凭据只从环境读：

**下单正例不能用 `MONTHLY`。** Task 1 的三档种子行 `priceCents = 0`，而 Task 6 的路由会拒未定价套餐（0 元单等于白续一年），所以脚本必须自己 upsert 一张 `BCHECK-RPT`（`priceCents: 39800`，`durationDays: 31`）当作可购套餐，跑完按 **PaymentAttempt / OrderEvent → Order → Plan** 的 FK 顺序清掉（`Order.plan` 是 `Restrict`，先删 Plan 必失败）。清场走 `finish()`，**包括 `makeAccount()` 登录失败那处 `exit 2`** —— 漏一次就在他的本地库里留一张客户可见的假套餐。

> **键名为什么是 `BCHECK-RPT` 而不是沿用 `BCHECK-HTTP`（Task 6 复审后的修订，台账 `Ruling T8-1`）**：
> `BCHECK-HTTP` 是 Task 6 断言脚本自己拥有的行，它的 `sweepDbFootprint()` 按**精确 key** 删套餐、按
> `planKey` 删单（`scripts/check-billing-orders-route.mts:57,278,285`）。两只脚本共用一个键 = 互相
> 接走对方的数据，红的时候没人知道是谁干的。账号/团队前缀同理另起一套（`billing-report-check-`，
> 与 Task 6 的 `billing-orders-check-`、Task 7 的 `billing-orders-list-check-` 都不构成前缀关系）。

**身份必须自建，绝不打他的账号（台账 `Ruling T8-2`，这条是本步骤的硬门禁）**：脚本原来打算用
`LOCAL_BILLING_CHECK_*` 登既有账号 —— 那个账号在 studio 会话注册表里**已经占满 3/3**，
`registerAdminSession` 每次签发都会把最旧的一枚驱逐掉（`src/lib/studio-session-registry.ts:4,55-60`；
平台侧 `MAX_ACTIVE_DEVICES` 同样是 3，TTL 12h，`src/lib/platform-session-registry.ts:4,49-53`）。
也就是说：**脚本每跑一次，他自己浏览器里那一次登录就掉一次线。** 台账的硬规则是「绝不为验证给已有
用户铸会话」，改法：脚本自己 `prisma.user.create` + `prisma.team.create` 造一次性身份，口令用
`bcrypt.hash(pw, 14)`（与 `src/lib/encryption.ts:162-169` 同参数，实测 cost 14 单次 902ms，四个账号约
3.6s，可接受），再走**真实** `POST /api/auth/login` 换令牌 —— 这一步本来就是验登录链，绕过去自己铸令牌
反而丢掉覆盖。收尾对每枚令牌登出，让应用自己的 `revokePresentedTokens` 清 Redis
（**两套令牌要分开打**：团队令牌 `POST /api/auth/logout`，平台令牌 `POST /api/platform/auth/logout` ——
团队那个只认自己那套会话键，拿平台 accessToken 去打它会**静默 no-op**（`src/lib/auth.ts:457-470`），
平台会话留在 Redis 里当孤儿键；Task 8 是脚本第一次同时持有两套令牌，必须按来源选端点）
（它会删 session、zrem 会话表、删 device 指针，只留一枚 30 天 TTL 的 `blacklist:admin_session:<sid>`
孤儿键 —— 那是正常登出的既有行为，**不要**断言「Redis 零新增键」）。**副作用：Task 8 不再需要任何凭据
环境变量**，`LOCAL_BILLING_CHECK_*` / `LOCAL_PLATFORM_CHECK_*` 在这只脚本里全部作废，缺凭据跳过的分支
一并删掉 —— 这条验收命令对他才真的是「一次点击跑完」。

```js
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BILLING_CHECK_BASE || 'http://localhost:3000'
const PLAN_KEY = 'BCHECK-RPT'
const PRICE_CENTS = 39800
const USER_PREFIX = 'billing-report-check-'
const USER_DOMAIN = '@example.invalid'      // 保留 TLD：真账号不可能长这样 ⇒ 删除语句够不到 admin@example.com
const STAMP = Date.now().toString(36)
const prisma = new PrismaClient()
const failures = []
const created = { userIds: [], teamIds: [], tokens: [] }

// FK 顺序由 Task 1 坐实：Order 对 Team/User/Plan 全是 Restrict ⇒ 单必须先删，Plan/Team/User 后删。
// 一次跑动唯一的清扫实现：`finish()` 和「接走上一次崩溃残留」都调它，不写两遍。
async function purge({ userIds, teamIds }) {
  const ids = (await prisma.order.findMany({
    where: { OR: [{ planKey: PLAN_KEY }, { teamId: { in: teamIds } }] }, select: { id: true },
  })).map(o => o.id)
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } })
  await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: ids } } })
  await prisma.order.deleteMany({ where: { id: { in: ids } } })
  await prisma.plan.deleteMany({ where: { key: PLAN_KEY } })
  await prisma.teamMember.deleteMany({ where: { OR: [{ teamId: { in: teamIds } }, { userId: { in: userIds } }] } })
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
}

// 唯一出口：先登出（走应用自己的 revokePresentedTokens 清会话）再清库。`process.exit` 只出现在这里。
// **端点必须按令牌来源选**：`/api/auth/logout` 只解团队那套会话键，拿平台 accessToken 去打它会
// 静默 no-op（`src/lib/auth.ts:457-470`）—— 于是平台会话以孤儿键留在 Redis 里，脚本自称「清干净了」是假的。
async function finish(code) {
  for (const { token, isPlatform } of created.tokens) {
    await fetch(`${BASE}${isPlatform ? '/api/platform/auth/logout' : '/api/auth/logout'}`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => null)
  }
  try {
    await purge(created)
    // 收尾自查（不是装饰）：删完再读一次库。留着行 = 客户门户列表里多一张假套餐 / 多一个能登进去的账号，
    // 光靠「我调了 deleteMany」是看不出来的。读回非零就把退出码抬成 1，留人手工处理。
    const left = {
      plan: await prisma.plan.count({ where: { key: PLAN_KEY } }),
      order: await prisma.order.count({ where: { planKey: PLAN_KEY } }),
      user: await prisma.user.count({ where: { email: { startsWith: USER_PREFIX, endsWith: USER_DOMAIN } } }),
      team: await prisma.team.count({ where: { slug: { startsWith: USER_PREFIX } } }),
    }
    if (left.plan || left.order || left.user || left.team) {
      console.error('清场后仍有残留：', left)
      code = code || 1
    }
  } catch (error) {
    console.error(`清理失败，请手工删除 planKey=${PLAN_KEY} 的行与 ${USER_PREFIX}*${USER_DOMAIN} 账号/团队：`, error?.message)
    code = code || 1
  } finally {
    await prisma.$disconnect()
  }
  process.exit(code)
}

async function setupPlan() {
  await prisma.plan.upsert({
    where: { key: PLAN_KEY },
    update: { priceCents: PRICE_CENTS, active: true },
    create: {
      key: PLAN_KEY, name: 'billing-check', priceCents: PRICE_CENTS, currency: 'CNY', durationDays: 31,
      maxMembers: 3, maxProjects: 4, maxVideos: 5, maxStorageGB: 6, active: true,
    },
  })
}

async function call(method, path, { body, token, teamId, want } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  if (teamId) headers['x-team-id'] = teamId          // src/lib/team-access.ts:5 TEAM_HEADER
  const res = await fetch(`${BASE}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* 非 JSON 也照原样进 failures */ }
  const ok = res.status === want
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path} → ${res.status} (want ${want})`)
  if (!ok) failures.push(`${method} ${path}: ${text.slice(0, 200)}`)
  return json
}

// 一次性身份：建号 → 建团队 → 走**真实**登录端点换令牌。
// 两个登录端点的字段名不一样，发错必 400：`/api/auth/login` 收 `email`（`src/lib/validation.ts:243`
// 的 `loginSchema`，`verifyCredentials` 对 email/手机号/用户名三选一匹配），
// `/api/platform/auth/login` 收 `identifier` 且只认 `isPlatformAdmin`（该路由 `:17,24`）。
// 返回体两边都是 `{ …, tokens: { accessToken } }`（团队侧另带 `success`），**令牌在响应体里、登录态不走 cookie**。
async function makeAccount({ tag, teams = [], platformAdmin = false }) {
  const password = randomBytes(24).toString('hex')
  const user = await prisma.user.create({
    data: {
      email: `${USER_PREFIX}${tag}-${STAMP}${USER_DOMAIN}`,
      name: `billing-report-check-${tag}`,
      password: await bcrypt.hash(password, 14),        // 与 hashPassword 同参数，否则 verifyCredentials 认不出
      ...(platformAdmin ? { isPlatformAdmin: true } : {}),
    },
  })
  created.userIds.push(user.id)
  const teamIds = []
  for (const [i, role] of teams.entries()) {
    const slug = `${USER_PREFIX}${tag}-${i}-${STAMP}`
    const t = await prisma.team.create({ data: { name: slug, slug, shareKey: `br${STAMP}${tag}${i}`, createdById: user.id, status: 'ACTIVE' } })
    created.teamIds.push(t.id)
    teamIds.push(t.id)
    await prisma.teamMember.create({ data: { teamId: t.id, userId: user.id, role } })
  }
  const isPlatform = platformAdmin
  const res = await fetch(`${BASE}${isPlatform ? '/api/platform/auth/login' : '/api/auth/login'}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(isPlatform ? { identifier: user.email, password } : { email: user.email, password }),
  })
  const json = await res.json().catch(() => null)
  const token = json?.tokens?.accessToken
  if (!token) {
    // 不重试：登录失败会写安全事件并入队一次外部通知（`api/auth/login/route.ts:81-131`）。
    console.error(`${tag} 登录失败 ${res.status}：${JSON.stringify(json)?.slice(0, 200)}`)
    await finish(2)
  }
  created.tokens.push({ token, isPlatform })
  return { userId: user.id, token, teamIds }
}

// 上一次崩在中途的残留先接走：不清掉的话，本轮「跑完不留一行」就是假的。
const stale = await prisma.user.findMany({
  where: { email: { startsWith: USER_PREFIX, endsWith: USER_DOMAIN } }, select: { id: true },
})
if (stale.length) {
  const staleIds = stale.map(u => u.id)
  const staleTeams = await prisma.team.findMany({
    where: { OR: [{ createdById: { in: staleIds } }, { slug: { startsWith: USER_PREFIX } }] }, select: { id: true },
  })
  await purge({ userIds: staleIds, teamIds: staleTeams.map(t => t.id) })
  console.log(`接走上一轮残留：User ${staleIds.length} / Team ${staleTeams.length}`)
}

await setupPlan()

// 收款配置**只读**（Task 8 绝不写 `Settings`，那行是真实运营数据）：intent 的期望状态码由它决定。
const transferRow = await prisma.settings.findUnique({
  where: { id: 'default' }, select: { transferAccountName: true, transferAccountNo: true },
})
const transferConfigured = Boolean(transferRow?.transferAccountName?.trim() && transferRow?.transferAccountNo?.trim())
console.log(`当前收款账户配置：${transferConfigured ? '已配置 ⇒ intent 正例要 200 并带账号' : '未配置 ⇒ intent 正例只能走 503 分支（200 那一侧由 Task 7 的 B 段覆盖）'}`)

// OWNER：团队侧主角（teams: ['OWNER'] = 给它建一支自己是 OWNER 的 ACTIVE 团队）
const ownerAccount = await makeAccount({ tag: 'owner', teams: ['OWNER'] })
const owner = ownerAccount.token
const team = { id: ownerAccount.teamIds[0] }
console.log(`OWNER 一次性团队 ${team.id}`)

// MEMBER：对照账号要同时满足两件事 —— 在主角团队里是 MEMBER（下单必须 403），
// 并且自己另有一支 ACTIVE 团队（跨团队越权才测得出来；同一支团队里换个人测不到这条）。
const memberAccount = await makeAccount({ tag: 'member', teams: ['OWNER'] })
await prisma.teamMember.create({ data: { teamId: team.id, userId: memberAccount.userId, role: 'MEMBER' } })
const member = memberAccount.token
const memberOwnTeam = { id: memberAccount.teamIds[0] }

const post = (body, want) => call('POST', '/api/billing/orders', { token: owner, teamId: team.id, body, want })
const a = await post({ planKey: PLAN_KEY, periods: 3 }, 200)
if (a?.order?.amountCents !== PRICE_CENTS * 3) failures.push(`金额不是服务端算的 3 倍价：${a?.order?.amountCents} ≠ ${PRICE_CENTS * 3}`)
const polluted = await post({ planKey: PLAN_KEY, periods: 3, amountCents: 1 }, 200)
if (polluted?.order?.amountCents !== a?.order?.amountCents) failures.push(`客户端塞 amountCents:1 影响了结果：${polluted?.order?.amountCents} vs ${a?.order?.amountCents}`)
await post({ planKey: PLAN_KEY, periods: 2 }, 400)          // 非白名单 periods
await post({ planKey: 'NOPE', periods: 1 }, 400)           // 不存在的套餐
await post({ planKey: 'MONTHLY', periods: 1 }, 400)        // 未定价的种子行不可售（Task 6 的守卫）
const b = await post({ planKey: PLAN_KEY, periods: 3 }, 200)
if (a?.order?.id !== b?.order?.id) failures.push(`幂等失效：${a?.order?.id} vs ${b?.order?.id}`)
if (b?.reused !== true) failures.push('复用已有单时 reused 应为 true')
// Task 3 评审 I-2：复用分支上的开票需求不能静默丢掉（写侧），下面这行同时验证读侧把它带回响应。
const withInvoice = await post({ planKey: PLAN_KEY, periods: 3, invoice: { requested: true, title: '测试工作室', taxNo: '91310000MA1TEST0' } }, 200)
if (withInvoice?.order?.invoiceRequested !== true || withInvoice?.order?.invoiceTitle !== '测试工作室') {
  failures.push(`复用分支丢了开票需求：${JSON.stringify({ r: withInvoice?.order?.invoiceRequested, t: withInvoice?.order?.invoiceTitle })}`)
}

const list = await call('GET', '/api/billing/orders', { token: owner, teamId: team.id, want: 200 })
const hasAccount = JSON.stringify(list).match(/accountNo|accountName|transferAccount/i)
if (hasAccount) failures.push(`订单列表接口泄漏收款字段：${hasAccount[0]}`)   // spec §11.3：账号只从 intent 流出
if ((list?.plan ?? []).some(p => p.priceCents <= 0)) failures.push('未定价套餐出现在门户套餐列表里（界面会给出点了必失败的卡片）')
// 收款码的团队侧读接口（Task 7 Step 3）：没登录必须 401，绝不能是公开可读
await call('GET', '/api/billing/transfer/qr', { want: 401 })

const oid = a.order.id
// intent 是收款字段的**唯一**出口（spec §11.3），期望值跟着服务端配置走：本地 `Settings` 的五列 `transfer*`
// 实测全为 NULL（09-25 只读核实），所以现在的真实答案是 503；**写死 503 会在 Task 11 运营填了真账号之后
// 永久变红**，所以这里读一次配置再分叉。两个分支都必须能变红：
const intent = await call('GET', `/api/billing/orders/${oid}/intent`, { token: owner, teamId: team.id, want: transferConfigured ? 200 : 503 })
if (transferConfigured) {
  if (!intent?.accountNo || !intent?.accountName
    || intent?.amountCents !== a?.order?.amountCents || intent?.reference !== a?.order?.reference) {
    failures.push(`收款账户已配置，intent 却没把账号/金额/备注完整带回来：${JSON.stringify(intent)?.slice(0, 200)}`)
  }
} else if (intent?.error !== '平台尚未配置收款账户，请联系运营') {
  failures.push(`未配置收款账户时 intent 的 503 文案不是那句能照着做的话：${JSON.stringify(intent)?.slice(0, 200)}`)
}
await call('POST', `/api/billing/orders/${oid}/intent`, { token: owner, teamId: team.id, want: 405 })
await call('POST', '/api/billing/orders', { token: member, teamId: team.id, body: { planKey: PLAN_KEY, periods: 1 }, want: 403 })
// 越权面（spec §12.8）：MEMBER 带着自己那支团队的 teamId 去打别人团队的订单。
// 单订单 GET 路由本计划不建，所以越权用「列表面不到 + 动作改不动」两条来证。
const foreign = await call('GET', '/api/billing/orders', { token: member, teamId: memberOwnTeam.id, want: 200 })
if ((foreign?.orders ?? []).some(o => o.id === oid)) failures.push('越权：别人团队的订单出现在了这个团队的账单列表里')
await call('POST', `/api/billing/orders/${oid}/report`, { token: member, teamId: memberOwnTeam.id, body: {}, want: 409 })
await call('POST', `/api/billing/orders/${oid}/report`, { token: owner, teamId: team.id, body: { reportNote: '自动检查' }, want: 200 })
await call('POST', `/api/billing/orders/${oid}/report`, { token: owner, teamId: team.id, body: {}, want: 409 })
await call('GET', `/api/billing/orders/${oid}/intent`, { token: owner, teamId: team.id, want: 409 })   // 已报付款不再给账号

// 收款信息的门禁面（spec §12 负例 11、12）
await call('GET', '/api/settings', { token: owner, teamId: team.id, want: 403 })
// 平台腿同样用一次性身份：`isPlatformAdmin: true` 就够（该路由只判这一个字段，不判 role）。
// 登他的平台账号会在平台会话表里挤掉他浏览器里那一枚，跟团队侧同一个道理。
const platformAccount = await makeAccount({ tag: 'platform', platformAdmin: true })
const platform = platformAccount.token
const s = await call('GET', '/api/settings', { token: platform, want: 200 })
const got = ['transferAccountName', 'transferAccountNo', 'transferBank', 'transferNote', 'transferQrPath'].filter(k => k in (s ?? {}))
if (got.length !== 5) failures.push(`平台 GET /api/settings 收款列不全：${got.join(',')}（整行展开是预期，见 spec §4.6）`)
await call('GET', '/api/settings/transfer', { token: platform, want: 200 })

// 三个身份 + 一张测试套餐的足迹由 `finish()` 负责清干净，它自己会读回核对（见上面的 `left`）。
console.log(`\n${failures.length ? failures.join('\n') : '全部通过'}`)
await finish(failures.length ? 1 : 0)
```

登录契约已核实（读码，不用再查）：`POST /api/auth/login` body `{ email, password }`（`src/lib/validation.ts:243` 的 `loginSchema`，字段名叫 `email` 但也可填手机号/用户名，`verifyCredentials` 三选一匹配，`auth.ts:471-489`），无 CSRF；返回 `{ success, user, tokens: { accessToken, … } }`（`api/auth/login/route.ts:171-189`）—— **令牌在响应体里，登录态不走 cookie**，所以 `call()` 必须带 `Authorization: Bearer`。限速按 email 计数、成功登录即清零（`:139`），一次跑完不会 429；但密码错一次会写 `ADMIN_PASSWORD_LOGIN_FAILED` 并入队一次外部通知（`:81-131`），所以 `makeAccount()` 登录失败直接 `await finish(2)` 而不重试（`finish()` 负责清场，`process.exit` 只出现在它里面）。平台侧 `POST /api/platform/auth/login` 的字段名是 `identifier` 不是 `email`（该路由 `:17`），返回 `{ user, tokens }`（无 `success`），并且只认 `isPlatformAdmin`（`:24`）。
**脚本跑完不留任何行**：`finish()` 会把自己造的 Order/OrderEvent/PaymentAttempt/Plan/Team/TeamMember/User 全删掉，并读回核对（他的本地库里有真实团队数据，测试行必须自建自清）。登出走 `POST /api/auth/logout`（团队令牌）/ `POST /api/platform/auth/logout`（平台令牌，**别打错端点**：打错是静默 no-op，会话变孤儿键），让应用自己的 `revokePresentedTokens` 清 Redis 会话；跑完 Redis 里只会多一枚 30 天 TTL 的 `blacklist:admin_session:<sid>` 孤儿键 —— 那是正常登出的既有行为，**不要**为它写断言。因此 Task 11 **不能**依赖这里留下的 `REPORTED` 单 —— Task 11 自己造一次性团队和订单，理由见 Task 11 Step 4 的「确认到账会写 Team 行」。

- [ ] **Step 3: 跑**

Run: `BILLING_CHECK_BASE=http://localhost:3000 node --env-file=.env scripts/billing-api-check.mjs`
Expected: 逐行 `PASS`，末行 `全部通过`，退出码 0。**这条命令不需要任何凭据**（身份是脚本自己造的），
但需要 `--env-file=.env`：`new PrismaClient()` 读 `DATABASE_URL`。跑完用只读 SQL 自查
`select count(*) from "Plan" where key='BCHECK-RPT'` 与 `select count(*) from "User" where email like 'billing-report-check-%'` 都是 0。

- [ ] **Step 4: 门禁 + 汇报**。**WP3 结束**：此时客户能下单/报付款，运营确认还要查库 —— 明确告诉他这一半还不能自助闭环，等 WP5。

---

# WP4 门户界面（做完 = 客户全程不必问你）

### Task 9: `/studio/team/billing` 页

**Files:**
- Create: `src/app/studio/team/billing/page.tsx`
- Modify: `src/components/TeamAdminShell.tsx`（`:6` 的 `lucide-react` import、`:15-21` 的 `sections` 数组；`storage` 那行在 `:18`）
- Modify: `src/locales/zh.json`、`en.json`、`de.json`、`nl.json`（新增顶层 `billing`）
- Modify: `src/app/api/billing/orders/route.ts`（列表 GET 的 `team` 对象补 `quota: { source, reference }` —— 见 Step 2 第 1 条，**这是本任务唯一允许动的接口文件**）
- Modify: `scripts/check-billing-read-routes.mts`（给上面那两枚新字段补断言；`plan`/`PlanCard` 那三条断言**不许改**）

**Interfaces:**
- Consumes: Task 6/7/8 的四个端点、`apiFetch`（`src/lib/api-client.ts:12`）、`useTranslations`（同 `src/components/projects/ProjectsDashboard.tsx` 的用法）、`import type { PlanCard } from '@/lib/billing-dto'`（Task 7 修复轮 B2 之后类型住在这里，**不要再从路由文件 import**）
- Produces: 路由 `/studio/team/billing`；tab key `billing`

- [ ] **Step 1: 加 tab**

`src/components/TeamAdminShell.tsx` 的 `sections` 数组里，在 `{ key: 'storage', … }` 之后插一行：

```tsx
  { key: 'billing', label: '套餐与续费', href: '/studio/team/billing', icon: CreditCard },
```

并在文件首的 `lucide-react` import 里加 `CreditCard`（`:6`）。同时检查该文件的 active 判定逻辑：若它按 `pathname.startsWith('/studio/team/xxx')` 前缀匹配，新前缀不需要额外改动；若有 `auxiliaryPage` 白名单（`:64`），**不要把 billing 加进去**（它是主 tab）。

- [ ] **Step 2: 页面结构（三块，自上而下）**

`'use client'`。用 `apiFetch` 拉 `GET /api/billing/orders`，失败时显示可重试的错误块，**不许把请求失败伪装成空态**（后台体检里报过的同类缺陷）。

1. **当前套餐**：`t('currentPlan')` + `subscriptionPlan` + 到期日（`null` → `t('longTerm')`「长期有效」）+ **额度来源行**（分支见下）。剩余 ≤14 天时整块左侧描 `border-primary`。

   **额度来源的数据现在不在响应里，本任务先补读面再画这一行（Ruling D-6）。** 来历：`TeamQuota` 有
   `source` / `sourceOrderId` 两列（`prisma/schema.prisma:162-178`），但 Task 7 已批准的列表 GET 只回
   `team: { plan, expiresAt }`。Task 7 没做错 —— 它那一版的需求里没有这一行；改读面的动作归本任务，
   所以 Files 里多了 `src/app/api/billing/orders/route.ts`。**先改路由、补断言，再写页面。**

   两个查实的前提，别凭直觉写：
   - `source` 的取值是 **`'PLAN'` / `'MANUAL'`**，**没有 `'ORDER'`**（schema `:166-172` 的注释定了默认 `PLAN`
     的理由：存量行的来历不可知）。写成 `source === 'ORDER'` 会是一根永不成立的分支。
   - `TeamQuota` 与 `Order` **没有关系定义**（`TeamQuota` 身上只有 `team` 一条 relation），
     所以 `reference` 必须显式二次查询，`include` 拿不到。

   路由改法（GET 里 `Promise.all` 的第三项，以及 `Promise.all` 之后、`return` 之前）：

```ts
      prisma.team.findUnique({
        where: { id: teamId },
        select: {
          subscriptionPlan: true, subscriptionExpiresAt: true,
          quota: { select: { source: true, sourceOrderId: true } },
        },
      }),
    ])
    // 落地单的备注码。存量团队（本计划之前建的）的 TeamQuota 是 source='PLAN' + sourceOrderId=null，
    // 所以「PLAN 但没有单」是**多数派**，不是异常路径。
    const sourceOrderId = team?.quota?.sourceOrderId ?? null
    const quotaReference = sourceOrderId
      ? (await prisma.order.findUnique({ where: { id: sourceOrderId }, select: { reference: true } }))?.reference ?? null
      : null
```

   响应体的 `team` 对象加一段（其余键一字不动，`orders` / `plan` 两枚一字不动）：

```ts
        quota: {
          source: team?.quota?.source ?? null,
          reference: quotaReference,
        },
```

   页面那行的分支**不许写成两分支三元**（`quotaFromManual` / `quotaFromOrder` 二选一会在
   `PLAN` + 无单的团队上渲染出「额度来自订单 」这种半句话）：

```tsx
{quota?.source === 'MANUAL' && <p>{t('quotaFromManual')}</p>}
{quota?.source === 'PLAN' && quota.reference && <p>{t('quotaFromOrder', { reference: quota.reference })}</p>}
```

   `PLAN` 且无 `reference`、或 `source === null`（团队还没有 `TeamQuota` 行）⇒ **整行不渲染**。
   理由：上方「当前套餐」已经把「你现在是什么档」说完了，没有备注码可指的「额度来自订单」是重复且空转的话。
   本地库里这就是绝大多数团队的真实状态，所以这不是兜底分支，是常态分支 —— 要有意识地不渲染。

   断言（`scripts/check-billing-read-routes.mts` 的列表段，紧邻 `:717-718` 那两枚；`:712-714` 的
   `PlanCard` 三条**一字不许改**）：
   - 列表 `team.quota` 键集断言 = `['reference', 'source']`（防未来有人往里塞 `maxStorageGB` 之类的额度实值：
     这一行是来历说明，不是权益表）。
   - 脚本**自己那支**团队在无 `TeamQuota` 行时 ⇒ `{ source: null, reference: null }`。
   - 用 `prisma.teamQuota.upsert` 给**脚本自己的**团队造 `source: 'MANUAL'` → 读回 `MANUAL` 且 `reference` 为 `null`；
     再造 `source: 'PLAN'` + `sourceOrderId: orderId`（`orderId` 是脚本本轮已经建好的那枚 OPEN 单）→
     读回 `reference` 等于那张单的 `reference`。**绝不 `update` 既有团队的 `TeamQuota` 行**；
     收尾不必手工删（`TeamQuota.teamId` 是 `onDelete: Cascade`，脚本删自己那支团队就带走了）。
2. **可购套餐**：`plan.map()` 渲卡片，卡内价格 `¥{(priceCents/100).toLocaleString('zh-CN')}`、`durationDays` 与四项额度（`0` → `t('unlimited')`）；周期选择器用分段按钮 `1/3/6/12`（外层 `h-9 rounded-lg`，内层比外层低一档 `h-[30px] rounded-md`）；选中后底部实时显示「合计 `¥{price×periods}` ｜ 到期日将变为 `YYYY-MM-DD`」（预览直接用 `plan.durationDays × periods` 从当前到期日叠，逻辑与 `nextExpiryMs` 一致）+ 主按钮 `t('orderNow')`「立即下单」→ `POST /api/billing/orders`。下单成功后就地拉一次列表并展开转账块。

   **开票需求（spec §7.1 的「可选发票两项」）**：下单按钮上方一个 `<label><input type="checkbox" /> t('invoiceNeed')</label>`，勾选后才展开「发票抬头」「纳税人识别号」两个 `Input`（`maxWidth` 与 schema 的 80/40 对齐，`required` 只在勾选时生效）。未勾选 → 请求体里**不带** `invoice` 字段（不要发 `{ requested: false }`，`createOrder` 的复用分支靠 `input.invoice` 是否存在决定要不要动那三列）；勾选 → `{ invoice: { requested: true, title, taxNo } }`。**不做自动开票、不做发票下载** —— 一期这里只是把需求登记到订单上，运营在队列里看得见（Task 12）。
3. **转账块**（仅当存在 `OPEN` 单）：`GET …/intent` → 户名/账号/开户行/金额/**备注码** + 「复制备注码」+ 可选收款码图 + 运营填的补充说明（`intent.note`，多行、`whitespace-pre-line`，这是文案而不是 key —— 别给它建 `t()`）+ 「我已付款」按钮（`POST …/report`，可填 `reportNote`）。`reused === true` 时顶部提示「你有一张未完成的订单，已为你继续」。**已有 `REPORTED` 单** → 显示 `t('awaitingConfirm')`「已提交，等待运营确认（通常 1 个工作日内）」，不显示账号。

   收款码：`PaymentIntent.qrPath` 是**存储键不是 URL**，只当「有没有图」的布尔用；图本身用 `apiFetch('/api/billing/transfer/qr')` 取字节 → `URL.createObjectURL(blob)` → `<img src>`，卸载时 `revokeObjectURL`（**与 Task 5 组件里那套完全同一个写法，照抄别重写** —— 实现在 `src/components/settings/TransferSettingsSection.tsx:49-78`（注释块 `:49-53`，`useEffect` `:54-78`，2026-09-25 逐行数过），那份代码还解决了一个本任务同样会撞上的问题：**`if (!active || !hasQr)` 先决定要不要取字节，cleanup 里 `alive = false` + 一定 `URL.revokeObjectURL(url)`**，失败时走 `t('transfer.qrLoadFailed')` 而不是静默；`<img src="/api/settings/transfer/qr">` 一定坏，那条路由要平台令牌而图片带不上 `Authorization`）。取字节失败时不渲染图片块，也不要报错打断下单流程。
4. **历史订单**：表格 `下单时间 | 套餐 | 金额 | 生效至 | 状态 | 备注`，`CLOSED` 行把 `closeReason` 直接显示在状态列下面。

**卡密入口**：页尾 `<details>` 折叠「我有卡密」，把 `src/app/studio/team/page.tsx` 的那套整体搬过来 ——
state 在 `:66`（`cardCode`）、`:67`（`activating`）、`:68`（`activationMessage`）—— 三枚连着写，**别错拿 `:64-65`，那两枚是 `copied`/`copiedId`，属于复制按钮**；`activate()` 处理函数在
`:93-106`（走 `apiPost('/api/teams/${team.id}/activate', { code })`，成功后 `window.location.reload()`），
JSX 是 `:116` 那枚 Card 里 `{role === 'OWNER' && …}` 起的输入框 + 按钮那一段，以及紧随其后的
`{activationMessage && <p role="status">…}`。原页面删掉这几处，`lucide-react` 的 `KeyRound` import
若因此不再被使用也要一起删（`npx eslint` 会报未用 import）。

   **搬的时候必须拆开的那半**：`:116` 这枚 Card 的 `CardContent` 里除了卡密输入框，还塞着一块硬编码的
   套餐说明横幅（`describeSubscriptionPlan(team)` + 「月卡：30 天、10 名成员、50 GB 存储，项目和视频数量不限。」）。
   那句中文硬编码在新页面上是**第二套定价口径**：同一屏上方就是服务端下发的 `plan[]` 卡片（价格、天数、四项额度），
   运营一改 `Plan` 行，横幅就成了后台体检反复记过的「界面说的和服务端做的不一致」。**裁定：横幅不进 billing 页，
   留在 `/studio/team` 原地**（它描述的是「当前团队是什么」，属于概览信息；Task 13 卡密退役时再一起处置）。
   ⇒ 动作是**把 `:116` 这一整行拆开**（它是一行写完的 JSX）：输入框/按钮/结果三件搬进 `<details>`，
   标题用 `t('haveCardCode')`；横幅留在原地，那枚 Card 的标题从「卡密激活」改成「当前套餐」，
   `KeyRound` 图标随之去掉（它是卡密语义，留着会继续说谎）。

- [ ] **Step 3: 四语 key**

`src/locales/zh.json` 顶层加 `"billing"`；en/de/nl 同步。键集合（一次给全，别分批）：

```
currentPlan, longTerm, unlimited, quotaFromOrder, quotaFromManual, remainingDays,
choosePeriod, orderTotal, expiryWillBe, orderNow, transferTitle, accountName, accountNo,
bank, amount, reference, copyReference, copied, iHavePaid, reportNotePlaceholder,
invoiceNeed, invoiceTitleLabel, invoiceTaxNoLabel,
awaitingConfirm, resumeNotice, historyTitle, colCreated, colPlan, colAmount, colValidUntil,
colStatus, colNote, haveCardCode, cardCodePlaceholder, redeem, redeemed,
statusOPEN, statusREPORTED, statusFULFILLED, statusCLOSED, orderFailed, loadFailed, retry
```

值以 zh 为准（例：`"awaitingConfirm": "已提交，等待运营确认（通常 1 个工作日内）"`）；en/de/nl 给出同义翻译（例 de `"Nach Zahlungseingang aktiv, in der Regel innerhalb eines Werktags"`）。**不许出现"自动扣款""立即到账"这类与人工确认通道不符的话术。**

- [ ] **Step 4: 先确认 locale 是整体透传还是按命名空间白名单加载**

已核实（09-25 读码，不用再查）：`src/i18n/request.ts:6` 调 `loadLocaleMessages(locale)`，实现在
`src/i18n/locale.ts:78-89` —— **整份 JSON 直接返回，没有 namespace 白名单**，所以顶层加 `billing` 即可生效。
但同一份实现里有一个对本任务有实际影响的细节：`locale === 'en'` 时**只返回 `en.json`**，
其余语言是 `deepMerge(english, localized)` ⇒ **`en.json` 是合并基座**。因此：
- 缺 `en` 的 key ⇒ 英文站直接显示 missing-key（没有别的文件兜它）；zh/de/nl 缺 key 会静默回落成英文，
  不报错、看起来「像好了」⇒ 四语必须一次给全，Step 3 的键集一个都不能少。
- 检查方式（本地起来时）：`curl -s localhost:3000/api/billing/orders` 之外，直接在浏览器切四种语言看
  `t('billing.awaitingConfirm')` 一类的文案有没有出现；或者 `node -e` 读四份 JSON 比对 key 集合，
  这比人眼可靠。

- [ ] **Step 5: 浏览器复压（他本人参与）**

请他在自己已登录的 Chrome 里走一遍：下单 → 看到备注码 → 复制 → 点「我已付款」→ 刷新看到「等待运营确认」→ 折叠里输一张 `AVAILABLE` 卡仍生效。逐条要截图或 DOM 数值（到期日、金额、合计）。四语各切一次（平台设置里改语言）确认无缺 key。

- [ ] **Step 6: 门禁 + 汇报**

---

### Task 10: 到期续费 CTA 与停用文案

**Files:**
- Modify: `src/components/AdminHeader.tsx`（有效期计算在 `:24-39`，徽标 JSX 在 `:45`）
- Modify: `src/app/studio/team/page.tsx`（那句卡密话术 09-25 实测已漂移到现在文件的 `:215`，写计划时的 `:233` 作废 ⇒ 仍按文案定位，见 Step 2）

**Interfaces:** Consumes `/studio/team/billing` 路由（Task 9）；Produces 无

- [ ] **Step 1: 顶栏加续费入口**

已核读（09-25 二次实测，别再当未知项查）：`:24-39` 算出 `next`（文案）与 `isDanger`，其中天数分支在 `:32-36`
（`days = Math.ceil(remaining/(24*60*60*1000))`、`next = \`${days} 天后到期\``、`isDanger = days <= 3`），
结果经 `setLabel`/`setDanger` 落到 `:45` 那枚徽标。**`:45` 已经是一个 `<Link>`**，
`className` 里已带 `hidden h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium sm:inline-flex`，
`href` 现在恒为 `/studio/team?tab=team`，`title="查看团队有效期"`。

⇒ **不要在里面再套一个 `<Link>`**（`<a>` 嵌 `<a>` 是非法 HTML，React 水合会报 DOM 嵌套警告，
点击行为也未定义）。要做的是**把这枚既有 Link 的 `href` 与文案按剩余天数分叉**：

1. 多存一个 state（`const [renewCta, setRenewCta] = useState(false)`），在下面三档置真：
   `days <= 14`、`已到期`（`remaining <= 0`）、`等待激活`（`subscriptionPlan === 'UNACTIVATED'`）；
   **`已停用`（`status === 'DISABLED'` 那一档必须排除** —— 停用团队走 `/studio/team/billing` 只会拿到 403：
   计费页的 teamId 由 membership 派生，而 `src/lib/team-access.ts:40/48` 两处都要求 `team.status === 'ACTIVE'`）。
   这三档的行号 09-25 二次实测（文件自 BASE 未改动，`git diff --numstat 36d8338 -- src/components/AdminHeader.tsx` 为空）：
   `:27` DISABLED、`:28` UNACTIVATED、`:31` 已到期（`remaining <= 0`）、`:32-36` 天数分支
   （`:33` `days`、`:34` `next`、`:35` `isDanger`）、`:38-39` `setLabel`/`setDanger`、`:44` `if (!label) return null`、
   `:45` 那枚 `<Link>`；**日期算法本身一个字都不改**（`Math.ceil` 的口径与 `/studio/team/billing`
   页里的预览必须继续一致）。
   **裁定 D-10：Task 15 Step 1 第 1 点（到期两档也改指 billing）并入本任务一次做完，
   第 2 点（徽标后再套一枚「续费」`<Link>` + 新 `nav:renewNow` key）作废** ——
   嵌套 `<a>` 是本任务 Step 1 开头就禁止的非法 HTML，而 i18n 那一条与本文件「硬编码中文」的现状冲突
   （见下面第 2 点的括注）。Task 15 因此不再动 `AdminHeader.tsx`。
2. `:45` 的 `href` 改成 `renewCta ? '/studio/team/billing' : '/studio/team?tab=team'`，
   文案在 `renewCta` 时**追加**一截（保持这个文件现状：**硬编码中文，不进 locales** ——
   全局约束只要求 `/studio/team/billing` 走 `billing` 命名空间四语，顶栏这枚徽标不在范围内）。
   追加而不是替换，且必须看清 `:45` 现在的渲染是 `团队 {label}`：`label` 本身已经是
   「7 天后到期」这类完整句子，前面还挂着 `团队 ` 一词，所以写成 `${next} · 续费` 之外的
   任何**带「天」字前缀**的拼法都会渲染成「团队 天 7 天后到期…」。**裁定：`团队 {label} · 去续费`**
   （即 `{renewCta ? ' · 去续费' : ''}` 追加在现有文本节点之后，`label`/`next` 的算式一个字节不动）。
   09-25 读码核过 `:45` 现值：
   `return <Link href="/studio/team?tab=team" className={...} title="查看团队有效期"><Clock3 .../>团队 {label}</Link>`。
3. `title` 同步改成能说明「点它会去续费」的话术。
4. **尺度不许动**：`h-11 rounded-lg px-3` 是它与同排 `ThemeToggle`(`:116`)、右侧两个 `h-11 w-11`
   按钮(`:121`、`:130`) 对齐的既有值；改动只发生在 `href` 与文字，不新增包裹元素、不改 class。
   复压要 `getBoundingClientRect().height === 44` 且同排控件仍等高。

- [ ] **Step 2: 改掉卡密话术**

`src/app/studio/team/page.tsx` 里那句话（写计划时在 `:233`；09-25 实测 Task 9 落地后已经漂到 **`:215`**，
**按文案定位，别按行号**：`grep -n "输入卡密激活" src/app/studio/team/page.tsx`）。
原文用的是**中文弯引号**，照抄时不要换成直引号，否则精确匹配会落空：

`请联系平台运营启用团队，或由团队所有者在“团队信息”中输入卡密激活。`
改为
`请联系平台运营启用团队。`

**裁定 D-12（09-25，本计划原文写的是「改为 …前往「套餐与续费」完成续费」，那一版作废）**：
后半句**整段删掉，不换成指向 billing 的说法**。三条实测依据：
1. 这枚横幅的门是 `team && team.status !== 'ACTIVE'`（`:215`），而 `/studio/team/billing` 的读面
   `src/app/api/billing/orders/route.ts:112-113` 走 `getActiveTeamMembership`，后者在
   `src/lib/team-access.ts:40`（带 header：`membership.team?.status !== 'ACTIVE'` ⇒ `null`）与
   `:48`（不带 header：`team: { status: 'ACTIVE' }` 谓词）两处都要求团队 ACTIVE
   ⇒ 停用团队点进去只会看到「加载失败 ／ 无权访问」。**那是一枚死胡同 CTA，比现在这句话更坏。**
2. 「由团队所有者在“团队信息”中输入卡密激活」这半句**在 Task 9 落地后已经自己变成谎话**：
   卡密输入框连同三枚 state 与 `activate()` 一起从 `studio/team/page.tsx` 搬进了 billing 页的
   `<details>`（评审 F-8/Step 2 已确认），团队信息 tab 里再也没有那个入口。
3. 复活停用团队的**唯一现存入口**是平台端 `PATCH /api/platform/teams/[id]`（`:18` 只认 `ACTIVE`/`DISABLED`，
   `:24` 直接写 `status`），也就是文案前半句说的「联系平台运营」。

（该文件其余中文硬编码不动 —— 见 Global Constraints 最后一条。）

> **必须写进报告的遗留事实（不改代码）**：`POST /api/teams/[id]/activate` 用的是 `getTeamMember`
> （`src/app/api/teams/[id]/activate/route.ts:23-26`，**不**校验 `team.status`），成功后 `:64` 写 `status: 'ACTIVE'`
> ⇒ **接口侧「停用团队拿存量卡密自救」这条路今天还通**，但 UI 侧因为上面第 2、1 两条已经不存在了。
> 本轮裁定按文案跟随现实（停用 ⇒ 走运营），并把「要不要给停用团队保留一个不依赖 billing 读面的卡密入口」
> 记进编号清单等他点单（Task 13 让新生成侧返 410，卡密本来就是退役中的通道）。

- [ ] **Step 3: 复压 + 门禁**：顶栏在本地实际显示（DOM 量一次 `getBoundingClientRect().height` 应为 44，与同排其它控件一致）；`npx tsc --noEmit && npx eslint src/components/AdminHeader.tsx src/app/studio/team/page.tsx`。

---

# WP5 平台端（做完 = 闭环，不再查库）

### Task 11: `api/platform/orders` 三件套

**Files:**
- Create: `src/app/api/platform/orders/route.ts`
- Create: `src/app/api/platform/orders/[id]/route.ts` ← **Step 3 的预览路由，09-25 补进 Files（原文漏了，但 Interfaces 与 Step 3 都要求它）**
- Create: `src/app/api/platform/orders/[id]/confirm/route.ts`
- Create: `src/app/api/platform/orders/[id]/close/route.ts`
- Create: `scripts/check-platform-orders.mjs` ← **裁定 D-16：Step 4 的交付物是可重跑的断言脚本，不是命令历史**

**Interfaces:**
- Consumes: **`requirePlatformAuth`**（`src/lib/auth.ts:439`，不是 `requirePlatformAdmin` —— 理由见 Step 0）、
  `confirmAndFulfill` / `closeOrder` / `loadFulfillmentOrder`（Task 3）、`computeFulfillmentPreview`（Task 2）、`getPaymentProvider().markPaid`（Task 4）
- Produces:
  - `GET /api/platform/orders?status=REPORTED|OPEN|ALL` → `{ orders: (OrderDto & { teamName: string; planName: string })[], counts: Record<string, number> }`
  - `GET /api/platform/orders/[id]` → `{ order, preview: PreviewResult }`
  - `POST /api/platform/orders/[id]/confirm` → 200 `{ ok: true, team, quota }`；抢不到 → 409 `{ error: '该订单已被处理' }`
  - `POST /api/platform/orders/[id]/close` body `{ reason }` → 200 / 400（reason 空白）/ 409

- [ ] **Step 0: 鉴权用 `requirePlatformAuth`，不用 `requirePlatformAdmin`（控制者核码后的裁定）**

两枚都存在、返回值都是 `AuthUser | Response`（都要写 `if (auth instanceof Response) return auth`），
但**它们不是一回事**，选错是一处真实的鉴权放宽：

- `requirePlatformAdmin`（`:607`）走 `getConsoleUserFromRequest` —— **两套令牌都收**，再判 `user.isPlatformAdmin`。
  它的注释自己写了存在理由：给「平台管理员用、但住在 `/api/platform/` 之外」的路由用
  （`/api/settings/*` 那一族，实测 29 个文件用它）。
- `requirePlatformAuth`（`:439`）走 `getPlatformUserFromRequest`（`:426`）—— 只接**平台令牌受众**
  （`:348-360`：独立的 `PLATFORM_ACCESS_SECRET` + `decoded.type !== 'platform_access'` 即拒），
  并且在那一侧就判 `isPlatformAdmin`（`:436` `return user?.isPlatformAdmin ? { ...user, sessionId } : null`）。
  实测 `/api/platform/**` 下现有 7 个 route 全部用它（`platform/cards`、`platform/teams`、
  `platform/teams/[id]`、`platform/teams/[id]/quota`、`platform/teams/[id]/grants`、`platform/features`、
  `platform/auth/session`）。

⇒ 新的 `/api/platform/orders*` 住在这个目录里，**必须跟邻居同一枚**，否则它会成为该目录下唯一
「拿团队令牌也能确认到账」的入口 —— 团队令牌是给客户侧用的，那正是这个闸门要挡的东西。
连带的响应形状：**没有平台会话时是 401 `Unauthorized`，不是 403**（`Step 4` 的期望值按这个写）。
不要为了「补一层 `isPlatformAdmin` 断言」再套 `requirePlatformAdmin`：受众判在它内部已经做完了。

- [ ] **Step 1: 列表**

`requirePlatformAuth` 先行（09-25 修正：原文这里误写 `requirePlatformAdmin`，与 Step 0 的裁定自相矛盾 ⇒ **裁定 D-9**）；
`status` 白名单 `['REPORTED','OPEN','ALL']`，非法值按 `REPORTED` 处理（**不 500**，同类缺陷在后台体检里记过）；`take: 100`；`counts` 单独一次 `groupBy({ by: ['status'], _count: true })`。

- [ ] **Step 2: confirm 必须走 provider，不直接调 confirmAndFulfill**

```ts
const result = await getPaymentProvider().markPaid({ orderId: id, actorUserId: auth.id })
```

理由：二期换通道时"钱怎么算到账"只有 provider 知道；平台端路由不该关心。`markPaid` 内部即 `confirmAndFulfill`（Task 4 已实现），409 由 `ok:false` 映射。
`closeOrder` 的 `reason` 必填（空 → 400，`t('reasonRequired')` 不适用：平台控制台中文硬编码）。

**事务归谁（09-25 读码坐实，别再自己套一层）**：`markPaid`（`src/lib/payment-provider.ts:75-89`）
自己开 `prisma.$transaction(async (tx) => …)`，在里面调 `confirmAndFulfill(tx, …)` 并只在 `result.ok` 时
把 `PaymentAttempt` 盖成 `SUCCEEDED` ⇒ **confirm 路由绝不再包 `$transaction`、绝不直接 import `confirmAndFulfill`**
（那是 Task 3 的入口，绕过 provider 就等于把二期的通道逻辑写回控制器）。
反过来 `closeOrder(tx, …)`（`src/lib/billing.ts:204`）吃的是外部 `tx`，所以 **close 路由自己开事务**：
`await prisma.$transaction((tx) => closeOrder(tx, { orderId, actorUserId, reason }))`。
两枚签名都是 `(tx, input)` 形状但事务归属相反，这是本任务最容易写反的一处。

- [ ] **Step 3: 预览路由**

`GET /api/platform/orders/[id]` 里用 `loadFulfillmentOrder` + `computeFulfillmentPreview({ currentExpiresAt: team.subscriptionExpiresAt, nowMs: Date.now(), periods, plan: { durationDays, quota }, currentQuota, quotaSource })`。这是弹窗里「旧 → 新」的数据源，与 Task 3 落地走同一个算式 —— **两处不一致就会骗人**。

- [ ] **Step 4: curl 验证**

**裁定 D-16（09-25，派发前自查）**：原文这一节只有三行期望值，没给「身份从哪来、库里的账谁清」。
本任务的四枚端点是**全站唯一会真改团队权益的写入口**（`confirm` 直接前移 `subscriptionExpiresAt` 并加
`TeamQuota`），拿它做验证如果随手写几条 curl，就会踩到两条硬红线：
① 给既有账号铸令牌 ⇒ 会话注册表 `MAX_ACTIVE_DEVICES = 3`，他本地那个真账号**正好 3/3**，
脚本一登录就挤掉他浏览器正在用的那一枚（`src/lib/studio-session-registry.ts:4,55-60`）；
② 造出来的 `Order` / `TeamQuota` / `Team` 留在库里 ⇒ 后续所有断言脚本的红绿都不再可信。
所以本步骤的交付物是**一枚可重跑的断言脚本** `scripts/check-platform-orders.mjs`（进 Files 段），
不是命令历史。三行期望值仍然有效，但都变成脚本里的断言。

**先读再写（不可跳）**：`scripts/billing-api-check.mjs` 的头注释块与它的 `finish()` 清扫实现。
新脚本**照抄它的身份法**，一字不改精神：

- 三个身份全部 `prisma.user.create` 现造，邮箱 `${前缀}${tag}-${STAMP}@example.invalid`
  （保留 TLD ⇒ 清扫语句在结构上够不到 `admin@example.com`），口令 `randomBytes` 运行时生成、**永不打印**。
- 令牌**只**从真实登录端点换：团队侧 `POST /api/auth/login`，平台侧 `POST /api/platform/auth/login`
  （收 `identifier`，只判 `isPlatformAdmin`，见 `billing-api-check.mjs:162`）。
  **绝不自铸 JWT、绝不给任何既有用户铸令牌、绝不吊销/改动既有会话。**
- 收尾两族各自 logout（走各自的撤销链），再按 FK 顺序
  （`PaymentAttempt` / `OrderEvent` → `Order` → `Plan`；`Order.team` 是 Restrict）删干净并**读回核对计数为 0**。
- 命名空间自成一套且与三只既有脚本互不构成前缀关系：`plan.key = 'BCHECK-PORDER'`、
  user/team 前缀 `platform-orders-check-`。（既有：`BCHECK-RPT` / `BCHECK-HTTP` / `BCHECK-LIST` / `-LIST9` / `-LIST0` / `-LISTOFF`；
  各脚本清扫都用**精确 key 或自己的前缀**，不扫 `BCHECK-` 通配，所以只要新名字不是任何旧名字的前缀就互不吞。）

**必须覆盖的断言**（逐条打印实际状态码与关键 body 字段，红了就红）：

1. 无令牌 → 四枚端点全 **401**。
2. **团队令牌**打到四枚端点 → 全 **401**（不是 403：`requirePlatformAuth` 在 `src/lib/auth.ts:440-442`
   唯一出口就是 `{ error: 'Unauthorized' } / 401`（401 那行实测在 `:441`），内部没有 403 分支；团队令牌进 `verifyPlatformAccessToken`
   要么签名验证抛错走 `catch` 返回 null（`:358-360`），要么 `decoded.type !== 'platform_access'` 直接 null（`:352`），
   两条都落到同一个 401。**期望值写错会让实施者去「修」一个本来就对的行为**）。
3. 平台登录但 `isPlatformAdmin: false` 的账号 → 同样 **401**（`auth.ts:436` 判的就是这枚字段）；
   这条和上一枚一起才证住「受众闸门 + 管理员闸门都没放宽」。
4. 列表：`?status=BOGUS` → **200** 且与 `?status=REPORTED` 同形（**不许 500**）；
   `counts` 与脚本自己 `prisma.order.groupBy({ by: ['status'], _count: true })` 的复算逐 status 相等。
5. 预览端点的 `preview` 与**直调** `computeFulfillmentPreview`（同一组入参）逐字段相同
   —— 这是 Step 3「两处不一致就会骗人」唯一能落地的证据，别只断言它 200。
6. `confirm` 并发：`Promise.all` 两次 POST → **恰好一 200 一 409**；
   库里 `subscriptionExpiresAt` 前后**只前移一次**（对比毫秒值，别比字符串），
   且 `TeamQuota.count({ sourceOrderId: 该单 })` 恰为 1（加两次就是双花）。
7. 对 `FULFILLED` 单再 `close` → **409**；`reason` 为 `''` 与 `'   '` → 都是 **400**。

**跑法**：`cd /Users/xiaoxiaobai/code/xiaobaic-review && BILLING_CHECK_BASE=http://localhost:3000 node --env-file=.env scripts/check-platform-orders.mjs`
（纯 `node`：只用内置 `fetch` + 既有依赖，**不引新依赖、不用 tsx**）。
跑之前 `ps -eo pid,etime,command | grep -E "check-.*\.(mjs|mts)"` 确认没有别的断言在飞（台账硬规则：
可能碰 `Settings` 的脚本同一时刻只允许一枚）。**绝不写 `Settings` 那五列**；
需要收款信息才能走的分支照 `billing-api-check.mjs` 的手法先只读一次配置再决定期望值。
3000 上是用户自己起的 `next dev`：脚本只发请求；**第一发 `fetch` 抛 `ECONNREFUSED` 就报 BLOCKED，绝不自己起服务、绝不重启它。**

- [ ] **Step 5: 门禁 + 汇报**

---

### Task 12: `/platform/orders` 队列页 + 二次确认框 + 导航

**Files:**
- Create: `src/app/platform/orders/page.tsx`
- Create: `src/components/platform/OrderConfirmDialog.tsx`
- Modify: `src/app/platform/layout.tsx:22-26`
- Modify: `src/app/api/platform/orders/route.ts` —— **控制者点单的跨任务改动（裁定 D-18）**：列表契约加 `total`。
  本任务的包 header 必须写明这一处是 Task 12 名下动的，否则评审会按 scope creep 记。
- Modify: `scripts/check-platform-orders.mjs` —— 同上，给 `total` 补断言。

**Interfaces:** Consumes Task 11 三个端点；Produces 路由 `/platform/orders`

- [ ] **Step 0: 已实测的现状（09-25 核过，别再当未知项查）**

- 导航：`src/app/platform/layout.tsx` 的 `<nav>` 在 `:22`，**「团队管理」在 `:23`、「卡密管理」在 `:24`**，
  两者的 `className` 都是 `text-muted-foreground hover:text-foreground` ⇒ 新条目照这个类串插在那两行之间。
- 弹窗现状：全站**没有**共用 Modal 组件，四处 `role="dialog"` 各自实现。可直接照抄的形状是
  `src/components/ReviewLoginActions.tsx:322`：`fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]`
  + `role="dialog" aria-modal="true" aria-labelledby=…` + `onMouseDown` 判 `event.target === event.currentTarget` 关窗
  + `:130` 的 `Escape` 键处理。**这三件事缺一件就是「关不掉的二次确认框」**，比没有确认框更坏。
- 复制：用现成的 `copyTextToClipboard(text): Promise<boolean>`（`src/lib/clipboard.ts:9`，
  非安全上下文走 `execCommand` 兜底，返回假/真 ⇒ **必须按返回值给反馈**，不能假定成功）。
  平台端已有先例：`src/app/platform/cards/page.tsx`。
- `bg-primary-visible` 是真的工具类（`tailwind.config.ts:54` → `--primary-visible`，
  浅色 `globals.css:23`、深色 `:102`），选中态沿用它 + `text-foreground` 是本计划已定口径。
- 列表行形状 = `OrderDto` 的 19 列（`src/lib/billing-dto.ts:4-24`）**再加 `teamName` / `planName`**（Task 11）。
  要用的列名逐枚对上：`reference`、`planKey`、`periods`、`amountCents`、`currency`、`status`、
  `createdAt`、`reportedAt`、`reportNote`、`invoiceRequested`、`invoiceTitle`、`invoiceTaxNo`、`closeReason`。
  **`amountCents` 旁边永远带 `currency`**（本任务只可能拿到 `CNY`，但界面写死「¥」是把两件事混成一个）。
- **confirm 的 200 回显里 `team` 只有四列**（`{id, name, status, subscriptionExpiresAt}`，Task 11 评审 m-6
  收窄过）⇒ 弹窗**不要**指望从响应里读 `subscriptionPlan`；套餐名取列表行 / 详情行的 `planName`。

- [ ] **Step 1: 导航**

`layout.tsx` 的 nav 里，在「团队管理」和「卡密管理」之间插：

```tsx
<Link href="/platform/orders" className="text-muted-foreground hover:text-foreground">订单</Link>
```

- [ ] **Step 2: 队列页**

两个 tab（`REPORTED` 默认 / `OPEN`），tab 按钮沿用平台端既有形状（`h-9 rounded-lg`，选中 `bg-primary-visible text-foreground`）。列：团队名、**备注码（`select-all` + 一键复制）**、套餐 × periods、金额（`¥{amountCents/100}`）、报付款时间、`reportNote`。`REPORTED` 行右侧「确认到账」，`OPEN` 行右侧「关单」（prompt 输理由，必填）。**每行都要能点开详情**（`GET /api/platform/orders/[id]`）。请求失败显示错误块并可重试，不伪装成空队列。

**开票需求要看得见**：`invoiceRequested === true` 的行在套餐列后加一个「需开票」小标记，详情里显示 `invoiceTitle` 与 `invoiceTaxNo`（`OrderDto` 已含这三列，Task 6）。客户填了开票信息而运营队列里没有任何痕迹，等于这条请求被收走又丢掉 —— 这正是 Task 3 评审 I-2 的读侧，别只落地写侧。

**四枚从 Task 11 结转的硬义务（控制者裁定 D-18 / m-5 / m-9，缺一条就是界面在说谎）**：

1. **`total` 与「只显示最近 100 条」（D-18）**。列表路由现在只回 `{ orders, counts }`，
   `orders` 是**当前筛选下最新 ≤100 行**、`counts` 是**全库不限行**的按状态计数 ⇒ 两个口径迟早对不上，
   而且被截掉的单子在控制台里**没有发现途径**（`[id]`/confirm/close 都按 orderId 走，技术上够得着，
   但列表是唯一给运营看 id 的地方）。本任务把契约补成 `{ orders, counts, total }`，
   其中 `total` = **与当前 `status` 筛选同谓词的行数**（`prisma.order.count({ where })`，
   加进 `orders/route.ts:38` 那个 `Promise.all` 里，**不是**把 `counts` 各值求和 —— 那是全状态合计，
   跟筛选后的列表对不上）。界面：`total > orders.length` 时在表格上方显示一行
   「共 {total} 条，仅显示最近 100 条」（中文硬编码，平台控制台不进 locales），
   真分页（`skip`/`page`）留二期，本期只要求**可见**。
2. **徽标一律 `counts?.[status] ?? 0`**。`groupBy` 对零计数的状态**压根不出行**
   （`orders/route.ts:48-49`；Task 11 复跑实测键集只有 `[OPEN,REPORTED]`）⇒ 直接写 `counts.REPORTED`
   会渲染出 `undefined`。这一条要在界面上真跑一次零计数状态（本地 `ALL` 之外的空 tab）才算证过。
3. **终态单不画预览箭头（m-5）**。`GET /api/platform/orders/[id]` **没有状态闸门**（详情可看历史是刻意的），
   所以对 `FULFILLED` 单它会回一个「今天再 +93 天」的 `preview`，对 `CLOSED` 同理 —— 那串数字永不发生。
   详情面板照常开，但 `order.status` 不属于 `OPEN`/`REPORTED` 时**不渲染「旧 → 新」那一行**，
   改为显示既有状态（`order.status` 就在同一个响应体里，够判）。判定用状态，不要用 `preview` 的字段空不空。
4. **`status` 参数只发常量（m-9）**。白名单 `['REPORTED','OPEN','ALL']` 大小写敏感，
   `?status=all` 会被当非法值**静默降级成 REPORTED 队列**（不报错、响应里也不说）。
   tab 状态一律用 TS 字面量常量拼 URL，不接受任何用户输入或大小写归一后的字符串。

- [ ] **Step 3: `OrderConfirmDialog`（必须点第二次）**

`role="dialog"`，内容四行：
1. `到期日 2026-10-24 → 2026-11-23`（`preview.fromExpiry` / `preview.toExpiryDate`）
   —— **两半类型不一样**：`PreviewResult.fromExpiry` 是**毫秒数**（`src/lib/billing-pricing.ts:74`，`currentExpiresAt` 为空时它就是 `nowMs`），`toExpiryDate` 才是 `Date`（`:76`）。两边都要过同一个 `YYYY-MM-DD` 格式化（`new Date(fromExpiry)`），直接把 `fromExpiry` 插进 JSX 会在弹窗里显示一串 13 位纪元数字。
2. `额度 10 人 / 50GB → 10 人 / 50GB`（`quotaChanged` 为 false 时写作"不变"）
3. `willResetManual` 为 true → 一行 `text-destructive`：「当前额度是手动调整的，将被本套餐重置」
4. 备注码 + 金额，和一行提示「请先在网银流水里核对这笔到账」

按钮：**「确认已到账」= 打开这个弹窗**（第一次点击只开窗，**不发写请求** —— 裁定 D-23：那四行只能来自
`GET /api/platform/orders/[id]`，所以第一次点击允许且只允许发那一发**只读** GET；要「一个请求都不发」
就得把 preview 塞进列表契约，那是跨任务改接口，本任务无授权）；弹窗里的**「确认到账」才 POST**。
兜法要求：`preview === null`（GET 在飞或失败）时提交按钮必须禁用，不给「没有数字却能提交」留一帧。
关窗后队列与团队到期日都要重取。

- [ ] **Step 4: 复压（分两半，本任务只做第一半）**

**裁定 D-22：「请他在 Chrome 里点一次完整流程」整条挪到 Task 15**（那里本来就欠一份完整浏览器清单，
且 Task 14/15 会改到期门禁 —— 现在点一轮，Task 15 之后还要再点一轮）。理由与本任务的实际障碍：
本地库里没有 REPORTED 单，而为了点界面去造单 ⇒ 要么动他真实团队的权益（confirm 一发就把到期日推前 30 天，
不可逆地污染他正在用的本地数据），要么留一批一次性 Order/Team 在库里（违反台账的验证身份法：
后续每一只断言脚本的红绿都不再可信）。两条都不接受。

**本任务要做的第一半（不留库内足迹的渲染证明）**：建一枚一次性页面路由
`src/app/platform/tmp-order-render/page.tsx`，**直接挂真组件**并用桩数据驱动三种状态
（`REPORTED` 行含 `invoiceRequested: true`、`FULFILLED` 行验「不画预览箭头」、`total > orders.length`
验「只显示最近 100 条」那一行），`curl http://localhost:3000/platform/tmp-order-render` 取回 HTML
证明编译过 + 桩数据渲染出了那三处文案，然后**删掉这枚临时路由**并用
`git status --porcelain` 证明它不在了（一次性路由的先例：Task 5 用 `src/app/api/settings/tmp-probe/` 用完即删，
见台账 `:493`）。**不许为了渲染而调任何写接口、不许新建任何 Order/Team/User 行。**

**第二半（转 Task 15 的浏览器清单，登记在此以免丢失）**：下单 → 复制备注码 → 点「我已付款」→
刷新看「等待运营确认」→ 在 `/platform/orders` 点「确认到账」第一次只开窗、第二次才 POST →
核对弹窗目标日 = `/studio/team/billing` 显示的到期日（同一个数）→ 故意关一单（必填理由，客户侧可见）→
折叠里输一张 `AVAILABLE` 卡仍生效 → 四语各切一次。

- [ ] **Step 5: 门禁 + 汇报**

---

### Task 13: 卡密退役 —— 生成关掉、存量照兑、额度手改打标

**Files:**
- Create: `src/lib/card-redeem.ts`（Step 3 从 `activate` 路由里抽出来的 `redeemCard(tx, { teamId, code, actorUserId })`）
- Modify: `src/app/api/platform/cards/route.ts:45-66`（09-25 实测：`POST` 函数在 `:42`，鉴权两行 `:43-44` **保留**，
  要整体换掉的是 `:45-66` 这段主体；写计划时标的 `:53` 落在 `prisma.teamActivationCard.create` 内部，不够准）
- Modify: `src/app/platform/cards/page.tsx`
- Modify: `src/app/api/teams/[id]/activate/route.ts:32-100`
- Modify: `src/lib/billing.ts:96-134`（给 `createOrder` 加可选 `noReuse?: boolean`，只包住 `:119-120`
  那一格复用 return —— 默认 `false`，其余调用点一字不动。见 Step 3 的 D-37）
- **不改**：`src/app/api/platform/teams/[id]/quota/route.ts`（09-25 实测服务端两半都已经在位，见 Step 4）

**Interfaces:** Consumes `createOrder`/`fulfillOrder`（Task 3）；Produces 无新对外形状 —— **`activate` 的请求/响应体一字不改**
（`team` 仍只有三枚字段，见 D-32），`GET /api/platform/cards` **新增** `availableCount`（唯一消费者是
`/platform/cards` 这一枚页面），`createOrder` 的 `input` **新增可选** `noReuse`（不传即今天的语义）。

- [ ] **Step 1: 断言先写（把契约钉住）**

`scripts/check-card-contract.mts`：自建一次性团队 + **三张** `AVAILABLE` 卡（**code 必须自己按 `createCardCode()` 那套格式生成、哈希必须用 `api/teams/[id]/activate/route.ts:11-13` 那一份归一化写法**，理由见下；生成入口本任务就要关掉，所以卡是 `prisma.teamActivationCard.create` 直插，不走 POST），直接调 `prisma.$transaction(tx => redeemCard(tx, { teamId, code, actorUserId }))`（Step 3 抽出的函数），断言：

**两枚 `hashCardCode()` 长得不一样，fixture 必须照兑换那一侧。** 查实（09-25 读码）：
生产创建侧 `src/app/api/platform/cards/route.ts:10-12` 是 `sha256(code)` **裸哈希**，
兑换侧 `src/app/api/teams/[id]/activate/route.ts:11-13` 是 `sha256(code.trim().toUpperCase())`，
而 `:29` 还会先把入参 `.trim().toUpperCase()`。两者今天能对上是**巧合**：
`createCardCode()`（`:14-17`）产出 `VB-` + 20 位大写 hex 切成四段（`randomBytes(10).toString('hex').toUpperCase()` 再 `slice`），而 `POST /api/platform/cards`
只走 `:52` 自己生成的 code（grep 过：`code` 从无客户端传入路径）。
⇒ 后果：脚本若自己手写一枚小写或带空格的 code 再套创建侧的裸哈希，卡**永远兑不上**，
而失败长得像「兑换逻辑坏了」而不是「fixture 错了」。顺带这是一条**存量隐患**（运营若能手工灌入
小写 code 就会留下废卡），归入给用户点单的编号清单，本任务不修。

```
到期日恰好 +30 天（卡的 durationDays）
quota = 卡面四个值
卡状态变 REDEEMED 且 redeemedByTeamId 正确
重复兑换同一张卡 → 返回 invalid
库里新增一张 status:'FULFILLED' 且 amountCents:0 的 Order
Order.reference 含卡的 codeLast4
```
跑一次确认失败（`redeemCard` 还不存在）。

**fixture 至少三张卡，不是一张（D-34）**：上面「重复兑换同一张卡 → invalid」与下面 Step 3 的
「同一枚 code 的大小写两种写法都必须能兑」在一张卡上互斥。
- A：用原始大写兑换 → 成功；
- B：用「小写 + 前后空格」兑换 → 成功（证明起作用的是兑换侧那把归一化的尺子）；
- C：先兑一次，再用同形式兑第二次 → 第二次 `invalid`，且**库里权益没有被改两次**
  （回读 `subscriptionExpiresAt` 与 `TeamQuota.sourceOrderId` 与第一次一致）。

**三条本任务真正要防的回归（09-25 复测后补进断言，缺一条就是白跑）**：
1. `Object.keys(result.team)` 恰等于 `['subscriptionPlan','subscriptionStartedAt','subscriptionExpiresAt']`
   —— D-32 的响应投影本身就是被测对象；不投影就会把 `slug`/`shareKey`/`createdById` 一起透出
   （`fulfillOrder` 的 `tx.team.update` 在 `billing.ts:57-65` **没有 select**）。
2. **兑换不得改动该团队已存在的 OPEN 单**：先给一次性团队留一枚 OPEN 单，再兑卡，回读它的
   `status`/`reference`/`createdAt` 三枚值必须一字不变（D-37）。
3. 不存在的团队 → `kind:'missing'`，路由落成 404「团队不存在」，与今天同形（D-31）。

- [ ] **Step 2: 关生成**

`api/platform/cards/route.ts` 的 POST 主体换成：

```ts
return NextResponse.json(
  { error: '卡密已停用，请改用「套餐与续费」下单。已发出的码仍可正常兑换。' },
  { status: 410 },
)
```

保留文件上方的鉴权与 GET 列表逻辑不动（`/platform/cards` 还要看余量）。`src/app/platform/cards/page.tsx` 摘掉生成表单与按钮，列表保留，并在标题下加一行中文说明「卡密已停用，剩余 N 个可用码仍可兑换」。

**N 必须来自服务端计数（D-36）**：`GET` 现在是 `findMany(take: 200, orderBy createdAt desc)`（`:23-38`），
在前端 `filter(status==='AVAILABLE').length` 会在卡多于 200 张时**说谎**（与 #57、D-18 同族）。
⇒ `GET` 响应加 `availableCount: await prisma.teamActivationCard.count({ where: { status: 'AVAILABLE' } })`，
页面显示它。该响应的唯一消费者就是这一枚页面（grep `'/api/platform/cards'`），加字段无破坏面。

**import 清理（D-33）**：POST 主体换成 410 之后，`hashCardCode`（`:10-12`）、`createCardCode`（`:14-17`）
与 `MONTHLY_QUOTA`（`:5`，只被 `:59` 用）都失去产品侧调用者，`createHash`/`randomBytes`（`:1`）变未使用 import
⇒ 全部删净；**不要**留一句「从 `@/lib/card-redeem` import」——那在这里必然是未使用 import，eslint 直接判错。
`hashCardCode` 归一化那一版搬进 `card-redeem.ts` 并**导出**（兑换函数与断言 fixture 共用同一把尺子）；
`createCardCode` 的格式只在断言脚本里自带一份，产品代码不留死码。

- [ ] **Step 3: `activate` 内部改走 Order**

把 `:32-100` 的 try 块主体抽成 `src/lib/card-redeem.ts` 的 `redeemCard(tx, { teamId, code, actorUserId })`，实现：

```ts
import { createHash, randomUUID } from 'crypto'
import { createOrder, fulfillOrder, type Tx } from '@/lib/billing'
import { MONTHLY_PLAN } from '@/lib/platform-access'

/** The one authoritative card-code hash. Normalising here is what keeps lower-case input working. */
export function hashCardCode(code: string) {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
}

export async function redeemCard(tx: Tx, input: { teamId: string; code: string; actorUserId: string }) {
  const team = await tx.team.findUnique({
    where: { id: input.teamId },
    select: { subscriptionPlan: true, subscriptionExpiresAt: true },
  })
  if (!team) return { kind: 'missing' as const }

  const card = await tx.teamActivationCard.findUnique({ where: { codeHash: hashCardCode(input.code) } })
  if (!card || card.status !== 'AVAILABLE') return { kind: 'invalid' as const }

  const claimed = await tx.teamActivationCard.updateMany({
    where: { id: card.id, status: 'AVAILABLE' },
    data: { status: 'REDEEMED', redeemedAt: new Date(), redeemedByTeamId: input.teamId, redeemedByUserId: input.actorUserId },
  })
  if (claimed.count !== 1) return { kind: 'invalid' as const }

  // 卡面落成一条已付订单，权益只经 fulfillOrder 落地（spec §9）。noReuse 是这条路径的命门：
  // 客户可能已经有一枚照银行转账在等的 OPEN 单，复用它会把那枚单静默盖章成 PAID 并换掉 reference。
  const order = await createOrder(tx, {
    teamId: input.teamId, planKey: card.planKey || MONTHLY_PLAN, periods: 1,
    actorUserId: input.actorUserId, noReuse: true,
  })
  await tx.order.update({
    where: { id: order.order.id },
    data: { status: 'PAID', paidAt: new Date(), amountCents: 0, reference: `CD-${card.codeLast4}-${randomUUID().slice(0, 8).toUpperCase()}` },
  })
  const result = await fulfillOrder(tx, order.order.id, input.actorUserId, { markPaid: true })
  // fulfillOrder returns the whole Team row (billing.ts:57-65 has no select); the activate route's
  // response body has always carried three fields, so project them back — never pass the row through.
  return {
    kind: 'activated' as const,
    team: {
      subscriptionPlan: result.team.subscriptionPlan,
      subscriptionStartedAt: result.team.subscriptionStartedAt,
      subscriptionExpiresAt: result.team.subscriptionExpiresAt,
    },
    quota: result.quota,
  }
}
```

细节以 Step 1 的断言为准

**哈希只能有一份（09-25 读码核实，这条是抽函数的真正理由）**：`api/teams/[id]/activate/route.ts:11-12` 用的是
`sha256(code.trim().toUpperCase())`，而生成侧 `api/platform/cards/route.ts:10-11` 用的是 `sha256(code)`。
今天两者**恰好等价**，因为 `createCardCode()`（`:14-17`）产出的是 `VB-` + `randomBytes(10).toString('hex').toUpperCase()`
—— 本来就全大写、无空白。也就是说「客户输入小写能兑换、生成侧存原样」这件事一直靠字母表巧合成立。
⇒ Step 3 抽出的 `hashCardCode` 是**唯一权威**（带归一化那版）；生成侧那份函数按 Step 2（D-33）删净，
**不是**换成 import 过来用 —— POST 变 410 之后该文件没有任何代码需要它。
断言脚本 Step 1 要显式覆盖这个归一化：见上面「三张卡」的 B 卡（小写 + 空格必须兑换成功）。

**不建计划、不改计划（D-30，写计划时这一格是错的）**：原本这里让 `redeemCard` 先 `tx.plan.upsert` 一条
`active: false` 的卡密计划。两处实测把它否掉了：
1. `createOrder` 在 `billing.ts:107-108` 要求 `plan && plan.active` ⇒ `active:false` 的新计划必被
   判 `INVALID_PLAN`，路由落成 500，这张卡**永远兑不上**；
2. `update: {}` 意味着 `planKey='MONTHLY'` 时那行已存在的种子计划**根本不会被改** —— 而种子与卡面
   **逐字段相同**：`migration.sql:109` = `('plan_monthly_seed','MONTHLY','月度',0,'CNY',30,10,0,0,50,true,1)`，
   卡面 = `cards/route.ts:57-59` 硬编码的 `MONTHLY` / `30` / `MONTHLY_QUOTA`（`platform-access.ts:14-19`
   = 10 人 / 0 项目 / 0 视频 / 50 GB）。
再核两条等价性：`nextExpiryMs`（`billing-pricing.ts:50-53`）与 `activate:56-60` 的到期日算法**同式**，
`quotaForPlan`（`:55-62`）返回的正是卡面那四枚字段 ⇒ 走 `fulfillOrder` 在数值上与今天等价。
⇒ 结论：**一行 `Plan` 都不新增、不修改**（改 `MONTHLY` 等于改客户可见定价，那是钱的路径）。
**代价必须写进报告**：若某张存量卡的 `planKey` 指向不存在的计划、或卡面天数/额度偏离种子，
兑换会得到 500「激活失败，请稍后重试」而不是今天按卡面给权益 —— **故意 fail-closed**，
宁可拒绝也不给错权益。要定量需要一次生产存量卡种类只读盘点（本任务不碰生产），登记给用户点单。

**`noReuse` 是本步真正的命门（D-37）**：`createOrder` 有复用分支（`billing.ts:112-120`，
`if (live && !input.invoice) return { order: live, reused: true }`）。卡密路径拿到返回值后立刻
`order.update({ status:'PAID', reference:'CD-…' })` ⇒ 客户刚生成、**已经照着那枚 `reference` 去银行填备注**
的 OPEN 单会被静默盖章成 PAID→FULFILLED 并换掉 reference，运营队列里这一单凭空消失。
⇒ 给 `createOrder` 的 `input` 加可选 `noReuse?: boolean`（默认 `false`），**只**包住 `:119-120` 那一格 return；
卡密路径传 `true`。`:113-118` 的超时清扫保持原样。
**不选「卡密自己 `order.create` 一枚」**：`createOrder` 是唯一的建单入口（`attempts` / `events` /
`uniqueReference()` 三族不变量都在它手里，schema 侧 `PaymentAttempt.outTradeNo @unique`、
`OrderEvent.actorUserId` NOT NULL + FK），复制一份就是造第二个真值来源。
`reference` 尾段取 8 位而不是 4 位：`Order.reference` 是 `@unique`，而 4 位 hex 只有 65536 个取值、
`codeLast4` 又只有 4 位，撞上就是裸 500；8 位仍满足「含 `codeLast4`」。
**副作用要说清（并登记，别自己发明闸门）**：兑换后该团队可能同时存在「已 FULFILLED 的卡密单 +
客户原来那枚 OPEN 单」，运营再确认原单 = 同一笔月费两次权益。**今天也是两次**（而且今天原单会被直接吃掉）。
本任务只把「静默吃单」改成「两单各自存在」；「兑卡期间是否禁止下单」spec 未答 ⇒ 编号清单新条目 (l)。

路由 `activate/route.ts` 改为：门禁与 code 校验不动（`:19-30`），`prisma.$transaction(tx => redeemCard(tx, …))`，
`kind:'missing'` → 404 `团队不存在`、`kind:'invalid'` → 400 `卡密无效、已使用或已停用`（两支映射都在今天的 `:91-92`），
成功 → 与今天同一份响应体（`:93-97`，`active` 仍由 `isTeamSubscriptionActive(result.team)` 算，
`team` 用 `redeemCard` 投影过的三字段对象，**不要**透出整行 —— D-32）。

- [ ] **Step 4: 额度手改打标（09-25 实测：服务端两半都已经在位，只剩界面）**

原计划这里让 PATCH 补 `source: 'MANUAL'` / `sourceOrderId: null`、让 GET 带出这两枚字段。
**都已成立，不要重做，也不要「顺手统一」**：`api/platform/teams/[id]/quota/route.ts:52` 是
`create: { teamId, ...TRIAL_QUOTA, ...data, source: 'MANUAL' }`、`:53` 是
`update: { ...data, source: 'MANUAL', sourceOrderId: null }`（Task 11 的 D-4 / #57 落地）；
GET 走 `getTeamQuota`（`platform-access.ts:45-55`）是 `upsert` 返回**整行** ⇒ 两枚字段已在响应里。
顺带看见 `platform-access.ts:52` 的读接口建行写的是 `source: 'PLAN'` —— 那是既有的「读会建行」，
**本任务不动、不解释成 bug**。

实活只剩界面那一行：`src/app/platform/teams/[id]/page.tsx` 的 `type Quota`（`:20-25`）补
`source` / `sourceOrderId`，在四枚 input 那一排（`:143-166`）旁加来源说明
（`MANUAL` → 「手动调整，续费时会被套餐重置」，`PLAN` → 「随套餐续费」；平台控制台中文硬编码，不进 locales）。
注意 `saveQuota`（`:94-105`）是把整个 `quota` 对象 PATCH 回去的 ⇒ 加了字段就会把 `source` 一起发出去；
服务端白名单（`:11-16`）会丢掉它，不会写错，但**请求体只发四枚数值键**（最小改动，别改服务端）。

- [ ] **Step 5: 跑断言到全绿 + 回归**

Run: `npx tsx scripts/check-card-contract.mts`（脚本自己建卡、自己删卡与临时团队，`finally` 清理，并像 Task 3 那样自证库里没留订单）
Run: `npx tsx scripts/check-billing-flow.mts` 与 `scripts/billing-api-check.mjs` 再各跑一次 → 三个都必须全绿。

**清理顺序有硬约束（D-35）**：`Order.team` 与 `Order.createdBy` 都是 `onDelete: Restrict`
（`prisma/schema.prisma:1306-1307`）⇒ 先删 `Order`（`events`/`attempts` 无 onDelete ⇒ Prisma 默认 Cascade，跟着走），
再删一次性团队，最后删一次性用户；三张卡自己删。自证要回读三枚计数并打进结论行：
该团队的 `order.count`、三张卡的 `teamActivationCard.count`、一次性 user 计数，全部为 0。
一次性身份一律 `@example.invalid`；**绝不给任何已有用户铸令牌、吊销会话或改会话**；不碰 `Settings` 表。
**同一时刻只允许一个断言脚本在跑**（台账红线）⇒ 跑之前 `ps | grep -i "tsx\|check-"` 确认没有别的在跑。
`billing-api-check.mjs` 需要真实本地凭据；环境里没有 `LOCAL_*_CHECK_*` 时按「跳过 + 报告写明未验证」处理，
**不许猜凭据**（本会话已实测三组变量全空，见 D-38）。

- [ ] **Step 6: 门禁 + 汇报**。**WP5 结束 = 完整闭环**，向他报告「一期人工通道已可端到端跑通」并列仍缺的东西（支付通道等备案）。

**Task 13 的「未验证」清单（必须原样进报告，别当成通过）**：
`/api/teams/[id]/activate` 的 **HTTP 层**未复压 —— 门禁与入参校验（`:19-30`）本任务一字未改，
路由内剩下的部分就是 `redeemCard` 那份代码，已由脚本在事务层覆盖；补 HTTP 需要给真实账号铸令牌或改会话，
那是红线（D-38）。同理，`/platform/cards` 页面与 `/platform/teams/[id]` 那行来源说明是**纯界面**改动，
浏览器走查欠到 Task 15 的清单里，不在本任务声称已完成。

---

# WP6 到期门禁（做完 = 到期真的挡写；风险最高，可整包不点）

### Task 14: `requireTeamWritable()` + 六处写路径接线

**Files:**
- Create: `src/lib/team-writeable.ts`
- Modify: `src/lib/s3-upload-auth.ts`（导出 `getUploadTargetProjectId`，见 Step 3）
- Modify: `src/app/api/projects/route.ts:125`、`src/app/api/videos/route.ts:21`、`src/app/api/uploads/s3/presign/route.ts`、`src/app/api/projects/[id]/project-uploads/[uploadId]/promote/route.ts`、`src/app/api/teams/[id]/invitations/[token]/accept/route.ts`、`src/app/api/teams/[id]/join-requests/[requestId]/route.ts`

**Interfaces:**
- Consumes: `isTeamSubscriptionActive`（`src/lib/platform-access.ts:25`，**不改它**）、membership 里的 `team`
- Produces:
  - `getTeamWriteBlockReason(team: { status: string; subscriptionPlan: string; subscriptionExpiresAt: Date | null } | null): 'TEAM_DISABLED' | 'TEAM_EXPIRED' | null`
  - `requireTeamWritable(teamId: string): Promise<NextResponse | null>`（返回 Response 就直接吐出去；`null` = 放行）
  - `requireProjectWritable(projectId: string): Promise<NextResponse | null>`（先查项目的 `teamId` 再走上面那个；`src/lib/team-writeable.ts` 一并导出）

- [ ] **Step 1: 断言**

`scripts/check-team-writeable.mts`（`expect` 骨架同 Task 2；`DAY = 86_400_000`，`now = Date.now()`）：

```ts
import { getTeamWriteBlockReason } from '../src/lib/team-writeable'

const DAY = 86_400_000
const now = Date.now()
const t = (status: string, expiresAt: Date | null, subscriptionPlan = 'MONTHLY') => ({ status, subscriptionPlan, subscriptionExpiresAt: expiresAt })

expect('null expiry = 长期有效，放行', getTeamWriteBlockReason(t('ACTIVE', null)), null)
expect('未来到期放行', getTeamWriteBlockReason(t('ACTIVE', new Date(now + 30 * DAY))), null)
expect('过去到期拦写', getTeamWriteBlockReason(t('ACTIVE', new Date(now - DAY))), 'TEAM_EXPIRED')
expect('到期边界（1 秒前）仍拦', getTeamWriteBlockReason(t('ACTIVE', new Date(now - 1000))), 'TEAM_EXPIRED')
expect('UNACTIVATED 且无到期日仍拦（沿用 isTeamSubscriptionActive 语义）', getTeamWriteBlockReason(t('ACTIVE', null, 'UNACTIVATED')), 'TEAM_EXPIRED')
expect('SUSPENDED 优先于到期判断', getTeamWriteBlockReason(t('SUSPENDED', null)), 'TEAM_DISABLED')
expect('team 为 null', getTeamWriteBlockReason(null), 'TEAM_DISABLED')
```

**`expiresAt === now` 这一格故意不测**：`isTeamSubscriptionActive` 用的是 `> Date.now()`（`platform-access.ts:27`），实现方不许为了通过断言去改它 —— 判据只有这一个来源。

- [ ] **Step 2: 实现**

```ts
import { isTeamSubscriptionActive } from '@/lib/platform-access'

/**
 * Expiry blocks writes, never reads: a client must still be able to watch and
 * annotate what was already delivered to them even if the team stopped paying.
 * A null expiry stays "long term" because that is what every existing team has
 * (spec §10) — defaulting the other way would freeze production on deploy day.
 */
export function getTeamWriteBlockReason(team: { status: string; subscriptionPlan: string; subscriptionExpiresAt: Date | null } | null) {
  if (!team || team.status !== 'ACTIVE') return 'TEAM_DISABLED' as const
  if (!isTeamSubscriptionActive(team)) return 'TEAM_EXPIRED' as const
  return null
}
```

`requireTeamWritable` 自己读那三个字段 —— 不要复用 `getTeamMember()`：它的 `TEAM_MEMBERSHIP_SELECT`（`src/lib/team-access.ts:12-19`）只带了 `team.status`，拿不到 `subscriptionPlan`/`subscriptionExpiresAt`，用它得到的永远是「没到期」。`userId` 也不接：调用点各自已经过自己的 membership 鉴权，多接一个参数就是 eslint 的 unused。

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/** Returns a ready-to-send 403, or null when the team may write. */
export async function requireTeamWritable(teamId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { status: true, subscriptionPlan: true, subscriptionExpiresAt: true },
  })
  const reason = getTeamWriteBlockReason(team)
  if (!reason) return null
  return NextResponse.json(
    {
      error: reason === 'TEAM_EXPIRED' ? '团队已到期，续费后可继续使用' : '团队已停用，请联系运营',
      code: reason,
    },
    { status: 403 },
  )
}

/**
 * Three of the six write paths key off a project in the request body, not off the
 * acting team: `authorizedTeamId` is only read by `projects/route.ts`,
 * `projects/[id]/route.ts` and `studio/project-groups/*` (`grep -rln authorizedTeamId src/app/api`),
 * while `videos`/`promote`/`presign` authorize through `canAccessProject`, which resolves
 * membership from the project's own team (`src/lib/project-access.ts:63-72`).
 * Gating those on the acting team would let a user with two teams write into the expired one.
 */
export async function requireProjectWritable(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { teamId: true } })
  return project ? requireTeamWritable(project.teamId) : null
}
```

未知 `projectId` 返回 `null`（放行）是对的：三个调用点在更早处已经自己拒过不可访问的项目，这里再补一个 404 只会把「无权限」说成「不存在」。

- [ ] **Step 3: 六处接线**

每处只在**已过自身鉴权之后、第一次写库之前**插两行。**读路径、分享链接、下载、批注一律不碰。** 六个插入点逐条钉死（行号按当前 HEAD `36d8338`，实现时以相邻代码为准，不要只信行号）：

| 路由 | 插在哪 | 用哪个函数 / 团队 id 来源 | 为什么是这个位置 |
|---|---|---|---|
| `api/projects` POST | `route.ts:143`（`if (!teamId) …403` 之后）、**`:145` 的 `Promise.all([getTeamQuota, getTeamUsage])` 之前** | `requireTeamWritable(teamId)`，`teamId = admin.authorizedTeamId`（`:139-141` 注释明确不许二次解析） | 配额满也是 403，但那个响应没有 `code`；拦在配额之前，到期团队拿到的才是 `TEAM_EXPIRED` 而不是「配额上限」 |
| `api/videos` POST | `route.ts:44`（`canAccessProject` 那个 `if` 之后）、`:46` 的 `name` 校验之前 | `requireProjectWritable(projectId)` | 该路由不读 `authorizedTeamId`，团队归属由项目的 team 决定（`project-access.ts:63-72`） |
| `api/uploads/s3/presign` POST | `route.ts:65`（`if (authResult.errorResponse) return …` 那一行之后）、`:68` 的 `rateLimit(request, …)` 之前 | `requireProjectWritable(projectId)`，`projectId` 由新导出的 `getUploadTargetProjectId(target)` 给出 | 见下面的 presign 说明 —— 这一处是六处里唯一要动第二个文件的 |
| `api/projects/[id]/project-uploads/[uploadId]/promote` POST | `route.ts:35`（`canAccessProject` 那个 `if` 之后）、`:37` 的 `request.json()` 之前 | `requireProjectWritable(projectId)`，`projectId` 就是解出来的 `id` | 同上，且必须在 `moveStorageFile` 之前 |
| `api/teams/[id]/invitations/[token]/accept` POST | `route.ts:22`（`invite` 的 404 判断之后）、`:24` 的 `invite.expiresAt` 分支之前 | `requireTeamWritable(invite.teamId)` | `:25` 那行 `teamInvite.update(...EXPIRED)` 是这条路由的第一个写库动作，必须落在它前面 |
| `api/teams/[id]/join-requests/[requestId]` PATCH | `route.ts:22`（`request.json()` 那一行）**之前**、`:19` 的 OWNER/ADMIN 403 之后 | `requireTeamWritable(id)`，`id` 是路径上的 teamId，且刚被 membership 校验过 | 该处已有 membership 门禁，团队 id 无需再解析 |

`projects`/`videos`/`promote` 三处的 `teamId` 口径不同不是随手选的：`grep -rln authorizedTeamId src/app/api` 只有 `projects/route.ts`、`projects/[id]/route.ts`、`studio/project-groups/*` 四个文件命中，视频链路根本不携带 acting team，只能按项目所属团队判。

**09-25 在当前工作树上逐条重核过六处锚点**（表里的行号是按 `36d8338` 写的，其中四处已漂移；下表是「插在哪两行之间」的实测答案，冲突时以此为准）：
`projects` ✅ 仍是 `:141-143` 之后、`:145` `Promise.all` 之前；
`videos` ⚠️ `canAccessProject` 的 `if` 实为 `:43-45`，`name` 校验在 `:47-48` ⇒ 插在 **`:45` 与 `:47` 之间**；
`presign` ✅ `:65` 之后、`:68` 之前；
`promote` ⚠️ `if` 实为 `:35-37`、`request.json()` 实为 `:38` ⇒ 插在 **`:37` 与 `:38` 之间**（仍在 `try {` 内）；
`accept` ⚠️ invite 的 404 `if` 实为 `:21-23`、`invite.expiresAt` 分支在 `:24` ⇒ 插在 **`:23` 与 `:24` 之间**；
`join-requests` ⚠️ OWNER/ADMIN 的 403 `if` 实为 `:18-20`、`request.json()` 实为 `:22` ⇒ 插在 **`:20` 与 `:22` 之间**。
另核 `isTeamSubscriptionActive`（`platform-access.ts:25`）签名只吃 `{ subscriptionPlan, subscriptionExpiresAt }`，
三字段对象结构化兼容 ⇒ **不给它加 `status`，也不改它的语义**；`s3-upload-auth.ts:5` 的 `S3UploadTarget` 确认没有 `export`（保持），`resolveProjectId` 确认在 `:32`。

**presign 这一处要单独说清三件事：**

1. 它不走 `requireApiAdmin`，走的是 `verifyS3UploadAccess(request, { videoId, assetId, projectUploadId, photoId }, { requireUploadPermission: true })`，返回值只有 `{ isAdmin, s3Key }`（`src/lib/s3-upload-auth.ts:12-27`）—— **路由里没有任何现成的 teamId 变量**，第一个 DB 读就发生在 auth helper 内部。
2. 所以只在 `authResult.isAdmin === true` 时拦。`isAdmin === false` 那条是**客户拿分享链接反向提交文件**，属于 spec §10「已交付给客户的链路不能因为乙方没续费而断」的保护面：拦它 = 惩罚租户的客户，而不是惩罚没续费的租户。
3. 项目 id 从 target 反查，复用 helper 里已有的 `resolveProjectId`（`s3-upload-auth.ts:32`，四个分支各查一次表），把它提为导出函数而不另写一份：

```ts
/** Target → owning project. Kept next to the existing resolution so the two can't drift. */
export async function getUploadTargetProjectId(target: S3UploadTarget): Promise<string | null> {
  return resolveProjectId(target)
}
```

   签名里的 `S3UploadTarget` **本身没有 `export`**（`:5` 就是一个裸 `interface`）—— 保持原样，
   别为了这一枚函数去导出它：presign 调用点传的是对象字面量 `{ videoId, assetId, projectUploadId, photoId }`，
   结构化匹配就够，`tsc` 不会因为类型没名字而报错，导出反而多给外面一个可以写错的东西。

presign 侧就是：

```ts
if (authResult.isAdmin) {
  const projectId = await getUploadTargetProjectId({ videoId, assetId, projectUploadId, photoId })
  const blocked = projectId ? await requireProjectWritable(projectId) : null
  if (blocked) return blocked
}
```

**本地测不到 presign（写进汇报，别当成通过）**：`route.ts:41` 第一件事就是 `if (!isS3Mode()) return badRequest('S3 storage is not enabled')`，而 `isS3Mode()` 读 `process.env.STORAGE_PROVIDER === 's3'`（`src/lib/storage.ts:11-13`），本地 `.env` 是 `STORAGE_PROVIDER=local` ⇒ 任何请求在鉴权之前就 400。presign 没有 S3 凭据也起不来，所以这一处和 `promote` 一样走 diff 评审。

**spec §10 那句「拦住 presign 就拦住了整个上传链路」的适用边界**（读码得到，别照抄进汇报）：上传有两种搬运方式 —— S3 模式走 presign，本地模式走 TUS（`src/pages/api/uploads/[[...path]].ts`，`:162-167` 明确写着「S3 模式下视频上传必须走 presign，TUS 只服务本地磁盘」）。TUS 这条路**不在六处里**，但它要求一条已存在、状态为 `UPLOADING` 的 `video` 记录，而那条记录只能由已拦的 `POST /api/videos` 建出来 ⇒ 到期团队在本地模式下也上传不了视频。真正**未纳入一期拦截**的是挂在已有记录下面的追加写：`POST /api/videos/[id]/assets`（给已存在视频补素材）与收录文件建行接口 `POST /api/projects/[id]/project-uploads`。**这两条只在 WP6 汇报里作为编号项登记，不动手**（spec §10 的清单是与他逐条确认过的，扩面要重新点单）。

- [ ] **Step 4: 复压（关键：现网不能被冻住）**

不碰他本地库里的真实团队：`scripts/check-team-gate.mts` 自建临时 OWNER + 临时团队（`expiresAt` 先为 `null`），先证明**可写**，再把到期日翻到过去证明**拦得住**，`finally` 里整套删掉。

写脚本前必须知道的六条真实合同（都已实测/读码确认，别按直觉写）：

1. `POST /api/projects` 成功是 **200 + 裸 project 行**（`route.ts` 结尾 `return NextResponse.json(project)`，没有 `status: 201`，也不包 `{ project }`）⇒ 取 id 用 `json.id`。
2. 该项目接口要求 `title`，且 `authMode` 缺省是 `PASSWORD`，此时没有 `sharePassword` 会 400（`route.ts:205-213`）⇒ 探针传 `{ title, authMode: 'NONE' }`。
3. `requireApiAdmin` 在 membership 校验后还要求 `user.phone`（`src/lib/auth.ts:601-604` → 403 `PHONE_REQUIRED`），`accept` 路由同样有这道（`accept/route.ts:14-16`）⇒ 临时用户**必须**带手机号，且 `User.phone` 是 `@unique`，两个用户要两个不同号码。
4. 临时团队的创建者关系会挡住删除：`Project.team` 是 `onDelete: Restrict`（`schema.prisma` 里 `team Team @relation(... onDelete: Restrict)`），`Project.createdBy` 也没配 Cascade ⇒ 清理顺序必须**先删项目、再删团队、最后删用户**，`team.delete()` 单飞会直接抛。
5. presign 本地测不到（Step 3 末尾那条：`STORAGE_PROVIDER=local` ⇒ 鉴权前就 400）⇒ 脚本对它只报 SKIP，不许把 SKIP 算成 PASS。
6. 登录态**不在 Postgres 里**：`POST /api/auth/login` 铸的令牌把会话写在 Redis（`*:sessions:* / *:session:* / *:device:*`，TTL 12h），删掉 User 行不会带走它们。
   所以下面脚本里 `login()` 把令牌收进 `tokens[]`，`finally` **先登出再清库**，并在删完后 `count()` 读回来自查 ——
   上一轮 `scripts/billing-api-check.mjs:59-95` 就是靠这两招把「跑完不留任何行」做实了的，别再退回「我调了 deleteMany 就算清场」。

```ts
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'   // 相对路径，与 scripts/check-dual-video-sync.mts 同一口径

const BASE = process.env.BILLING_CHECK_BASE || 'http://localhost:3000'
const prisma = new PrismaClient()
const DAY = 86_400_000
const stamp = Date.now()
const pw = `gate-${stamp}`
const failures: string[] = []
const skips: string[] = []
const tokens: string[] = []   // 09-25 加：登录态在 Redis（TTL 12h），不登出就给已删掉的一次性账号留活会话壳子

async function hit(method: string, path: string, token: string, body: unknown, want: number, label: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => null)
  // 403 必须同时是门禁给的 403：配额、手机号、权限都是 403，只有门禁带 code
  const ok = res.status === want && (want !== 403 || json?.code === 'TEAM_EXPIRED')
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${method} ${path} → ${res.status} code=${json?.code ?? '-'}`)
  if (!ok) failures.push(`${label} ${method} ${path}: ${JSON.stringify(json)?.slice(0, 160)}`)
  return json
}

async function login(email: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  })
  const json = await res.json().catch(() => null)
  const token = json?.tokens?.accessToken
  if (!token) { console.error(`FAIL 登录 ${email} → ${res.status} ${JSON.stringify(json)?.slice(0, 200)}`); process.exit(2) }
  tokens.push(token)
  return token as string
}

// 令牌族要各归各的撤销端点：这里只有团队侧令牌，全部走 /api/auth/logout。
async function logout(token: string) {
  await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => null)
}

const user = await prisma.user.create({ data: { email: `gate-${stamp}@example.invalid`, name: 'gate', password: await hashPassword(pw), phone: `139${String(stamp).slice(-8)}` } })
const second = await prisma.user.create({ data: { email: `gate2-${stamp}@example.invalid`, name: 'gate2', password: await hashPassword(pw), phone: `138${String(stamp).slice(-8)}` } })
const team = await prisma.team.create({
  data: {
    name: `gate-${stamp}`, slug: `gate-${stamp}`, shareKey: `gate-${stamp}`,
    createdById: user.id, subscriptionPlan: 'MONTHLY', subscriptionExpiresAt: null,
    members: { create: { userId: user.id, role: 'OWNER', status: 'ACTIVE' } },
  },
})
const invite = await prisma.teamInvite.create({ data: { teamId: team.id, token: `gate-${stamp}`, createdById: user.id, expiresAt: new Date(Date.now() + DAY) } })
const join = await prisma.teamJoinRequest.create({ data: { teamId: team.id, userId: second.id, status: 'PENDING' } })

try {
  const owner = await login(user.email)
  const guest = await login(second.email)

  // A) 到期日为 null = 长期有效，必须放行（这一条挡住「上线第二天现网写不了」）
  const created = await hit('POST', '/api/projects', owner, { title: `gate-${stamp}`, authMode: 'NONE' }, 200, 'null 到期可建项目')
  const projectId: string | undefined = created?.id
  if (!projectId) { console.error('拿不到 projectId，后面的用例判不了'); process.exit(1) }

  // B) 翻成「昨天」：可脚本验证的四条写路径应全部 403 + code=TEAM_EXPIRED
  await prisma.team.update({ where: { id: team.id }, data: { subscriptionExpiresAt: new Date(Date.now() - DAY) } })
  await hit('POST', '/api/projects', owner, { title: 'x', authMode: 'NONE' }, 403, '建项目被拦')
  await hit('POST', '/api/videos', owner, { projectId, name: 'gate' }, 403, '建视频被拦')
  await hit('POST', `/api/teams/${team.id}/invitations/${invite.token}/accept`, guest, {}, 403, '接受邀请被拦')
  await hit('PATCH', `/api/teams/${team.id}/join-requests/${join.id}`, owner, { status: 'APPROVED' }, 403, '审批入队被拦')
  skips.push('presign：本地 STORAGE_PROVIDER=local，鉴权前就 400，未走 HTTP 验证 → diff 评审')
  skips.push('promote：需要一条真实 ProjectUpload（`uploadCompletedAt` 非空、文件已在存储上），伪造口径不稳 → diff 评审')

  // C) 翻成未来：恢复可写
  await prisma.team.update({ where: { id: team.id }, data: { subscriptionExpiresAt: new Date(Date.now() + 30 * DAY) } })
  await hit('POST', '/api/projects', owner, { title: `gate-ok-${stamp}`, authMode: 'NONE' }, 200, '未来到期可建项目')
} finally {
  // 先登出再清库：Redis 里的 `*:sessions:* / *:session:* / *:device:*`（TTL 12h）不会跟着行一起消失。
  for (const t of tokens) await logout(t)
  try {
    await prisma.project.deleteMany({ where: { teamId: team.id } })
    await prisma.team.delete({ where: { id: team.id } })   // members/invites/joinRequests/quota 随 Cascade 走
    await prisma.user.deleteMany({ where: { id: { in: [user.id, second.id] } } })
  } catch (err) {
    console.error(`LEAK 临时数据没删干净，手工清：team=${team.id} users=${user.id},${second.id}`, err)
    failures.push('清场抛错')
  }
  // 删完读回来自查（09-25 加）：`Project.createdBy` / `Team.createdBy`（TeamCreator）都是 onDelete: Restrict
  // （前者干脆没写 onDelete，Prisma 默认即 Restrict），漏掉任何一条依赖就是一次 LEAK。
  const left = {
    team: await prisma.team.count({ where: { id: team.id } }),
    users: await prisma.user.count({ where: { id: { in: [user.id, second.id] } } }),
    projects: await prisma.project.count({ where: { teamId: team.id } }),
  }
  if (left.team + left.users + left.projects > 0) {
    console.error(`LEAK 读回来还有行：${JSON.stringify(left)} team=${team.id}`)
    failures.push('清场后仍有残留')
  }
  await prisma.$disconnect()
}

for (const s of skips) console.log(`SKIP ${s}`)
if (failures.length) { console.error(`\n${failures.length} 条失败：\n` + failures.join('\n')); process.exit(1) }
console.log('\n全部断言通过（presign/promote 见上面 SKIP，按 diff 评审）')
```

Run: `npx tsx scripts/check-team-gate.mts` → 期望逐行 PASS、两条 SKIP、退出码 0。脚本要能读到 `@/lib/encryption` 与本地库，靠的是 tsx 走 tsconfig 的 `paths`，以及 `.env` 里的 `DATABASE_URL`；**Qoder 的 shell 不会自动灌 `.env`**，所以跑法与 worker 一样：`(set -a; . ./.env; set +a; npx tsx scripts/check-team-gate.mts)`。

**六处里脚本证四处，`presign` 与 `promote` 证 diff。** 这两处的 diff 要单独贴进汇报：`presign` 重点看「只在 `authResult.isAdmin` 时拦」那行（反向提交必须放行），`promote` 重点看插在了 `moveStorageFile` 之前。

**还有一处「按 diff 评审」的，别在汇报里声称脚本证明了它**：Step 3 表格给 `api/projects` 的理由是「拦在配额之前，到期团队拿到的才是 `TEAM_EXPIRED` 而不是配额上限」。
临时团队**没有 `TeamQuota` 行** ⇒ `getTeamQuota`（`platform-access.ts:45-55`）按 `TRIAL_QUOTA` upsert，而 `TRIAL_QUOTA.maxProjects = 0`、
`isUnlimitedQuota` 把 `<= 0` 判成无限 ⇒ 这条路由在脚本里**永远走不到** `:149-151` 的配额 403，「先门禁后配额」的顺序在 HTTP 层观测不到。
不要为了让它可见就给临时团队塞一条 `maxProjects: 1` 的 quota —— 那会让 case A 直接 403，把「到期不冻现网」这条主断言搞糊。
汇报口径写清：`check-team-gate.mts` 证明的是「null 到期放行 / 过去到期拦写 / 未来到期恢复可写」四条路由的**结果**，顺序只按 diff 评审。

收尾再跑一次 `node scripts/billing-api-check.mjs` 确认 WP3/WP5 没被这波改动打断。

- [ ] **Step 5: 门禁 + 汇报**

1. `npx tsc --noEmit` → 0；`npx eslint src/lib/team-writeable.ts src/lib/s3-upload-auth.ts src/app/api/uploads/s3/presign/route.ts src/app/api/projects/route.ts src/app/api/videos/route.ts "src/app/api/projects/[id]/project-uploads/[uploadId]/promote/route.ts" "src/app/api/teams/[id]/invitations/[token]/accept/route.ts" "src/app/api/teams/[id]/join-requests/[requestId]/route.ts"` → 无新 error。
   （`s3-upload-auth.ts` 必须在名单里：Step 3 的第三件事就是改这个文件导出 `getUploadTargetProjectId`，漏了它等于这次改动的一整块没人 lint。）
2. `npx tsx scripts/check-team-writeable.mts` 全绿；`npx tsx scripts/check-team-gate.mts` 按 Step 4 口径输出。
3. 汇报里必须原样带上六处 diff 中的两处（`presign`、`promote`）与三个「本地测不到」的原因（presign 的 `STORAGE_PROVIDER=local`、promote 需要真实 `ProjectUpload`、`check-billing-flow.mts` 不覆盖门禁）。
4. **明确写出未做的事**：本批没有加任何到期提醒邮件、没有 cron、没有改 `isTeamSubscriptionActive` 的语义（spec §2、§10）。

**不 commit、不 push、不部署**（全局约束）。

---

### Task 15: `TEAM_EXPIRED` 的前端表达 + 全量回归

**Files:**
- ~~Modify: `src/components/AdminHeader.tsx`~~ → **Step 1 只核对不改（D-10，改动已归 Task 10）**
- Modify: `/studio/team/billing` 页（Task 9 那个）
- Modify: `src/locales/{zh,en,de,nl}.json`（只加 `billing.expiredBanner` 一枚键，四本同步 —— 见 Step 2 / D-14）
- Modify: `src/app/studio/projects/new/page.tsx:84`（唯一一处把服务端原因吞掉的入口）

**Interfaces:** Consumes Task 14 的 403 `error` 文案；`code` 字段只给脚本断言用，前端不读

为什么不需要「按 `code` 分支」的前端改造 —— 三个实测事实：

1. `apiJson`（`src/lib/api-client.ts:56-71`）在非 2xx 时抛的是 `new Error(error.error)`，也就是**服务端那两句人话本身就会顺着 `error.message` 到前端**，不需要新通道。
2. `grep -rn "TEAM_EXPIRED\|TEAM_DISABLED" src` 在本次改动前零命中，全站本来就没有按 `code` 分支的先例；为这一个场景新造一套 `ApiError` 要动 `api-client` 的抛出类型，波及所有调用点。
3. 六个写路径的前端落点逐个看过，五处已经在显示 `error.message`：`studio/projects/page.tsx:388`（`setFormError(error.message || …)`）、`studio/team/invite/[token]/page.tsx:53`、`studio/team/members/page.tsx:77`、`components/VideoUpload.tsx` 与 `components/VideoUploadModal.tsx`（上传队列 `onError` 里 `setError(err.message)`）。只有 `studio/projects/new/page.tsx:84` 是 `catch { appAlert(t('failedToCreateProject')) }`，把原因丢了 —— 改这一处，对齐同族页面的写法：

```ts
} catch (error) {
  appAlert(error instanceof Error && error.message ? error.message : t('failedToCreateProject'))
}
```

续费入口由顶栏常驻徽标（Step 1）和 billing 页横幅（Step 2）承担，不在每个报错点塞链接。

- [ ] **Step 1: 顶栏到期态 —— 本任务不改代码，只做核对（裁定 D-10）**

`src/components/AdminHeader.tsx:13-46` 的 `TeamExpiryBadge` 自己打 `GET /api/team-center`，按 `status==='DISABLED'` → 「已停用」、`subscriptionPlan==='UNACTIVATED'` → 「等待激活」、`subscriptionExpiresAt` 已过 → 「已到期」（`danger = true`），否则「N 天后到期」（`danger` 阈值是 `days <= 3`）。

**这一段的全部改动已在 Task 10 Step 1 做完**（`renewCta` 覆盖 `days <= 14` / `已到期` / `等待激活` 三档，
`href` 分叉与 ` · 去续费` 追加式文案都在那一版里，`已停用` 那档故意排除，理由见 Task 10 Step 1）。
本任务这里只核对三件事，不改文件：

1. `已到期` 与 `等待激活` 两档的 `href` 确实是 `/studio/team/billing`，`已停用` 确实不是（防回归）。
2. 现有 `days <= 3` 的红色判定没被动过。
3. **原文在这里要求的「再追加一枚 `text-xs underline` 的『续费』`<Link>`」作废**：那是往 `:45` 那枚
   已经是 `<Link>` 的元素里再套一枚 `<a>`，Task 10 开头就判为非法 HTML（水合告警 + 点击行为未定义），
   而它想表达的入口由追加式文案已经承担了。
   **`nav:renewNow` 这个 key 也不再需要**：顶栏徽标整个文件是硬编码中文（全局约束只要求
   `/studio/team/billing` 走 `billing` 命名空间四语），为一枚徽标新起四语 key 反而打破该文件一致性。
   如果 Task 10 的实现里已经落了 `nav.renewNow`，那是一处多余的国际化，按最小改动纪律**登记为编号项、不回改**。

- [ ] **Step 2: billing 页横幅**

`/studio/team/billing` 在到期态顶部加一条 `role="alert"` 横幅。落点：内容区 fragment 的第一枚子元素之前
（`grep -n 'loadError === null && data' src/app/studio/team/billing/page.tsx` 定位那扇门，横幅紧跟其后、
「当前套餐」`<Card>` 之前；根 `<div className="space-y-5">` 负责间距，别自己加 `mt-*`）。

判定用 `currentExpiry && currentExpiry.getTime() <= nowMs`。**不要用 `remainingDays` 判到期** —— 那枚值在
到期分支就是 `null`（`:113-115` 的三元只在天数 > 0 时给数），拿它当到期条件等于把到期态筛没了。

**文案（裁定 D-14，原文两句都作废）**：原写的是
`团队已到期，续费后立即可用；客户的观看与批注不受影响。`，实测有两处硬伤：

1. **「立即可用」是假承诺。** 一期没有支付通道：客户点「我已完成付款」之后，权益要等运营在
   `/platform/orders` 点一次确认才落地（Task 11/12），页面自己就在 `billing.awaitingConfirm`
   里写着「已提交，等待运营确认（通常 1 个工作日内）」（`src/locales/zh.json`）。
   同一屏上下两句互相打脸，且落在 Global Constraints 禁的那一族话术旁边
   （`自动扣款｜立即到账｜自动续费｜即时到账｜自动扣｜马上到账`）。
2. **硬编码中文出现在全站唯一必须走 `billing` 命名空间四语的页面上**（Global Constraints：
   「`/studio/team/billing` 走 locales `billing` 命名空间四语一次补齐」）。中英德荷四本
   `50` 键集当前完全对齐（实测 `python3` 读四份 JSON 取 `['billing']` 长度，四本都是 50），
   在这里塞一句字面量中文，英文站会看到半中半英的横幅。

⇒ 动作是**新增一枚键**并四处同步（`zh` / `en` / `de` / `nl` 一次给全，缺 `en` 英文站直接显示 missing-key）：

| key | zh | en |
| --- | --- | --- |
| `expiredBanner` | 团队已到期，续费后可继续使用；客户的观看与批注不受影响。 | Your team has expired. Renew to continue — client viewing and annotations are unaffected. |

| de | nl |
| --- | --- |
| Ihr Team ist abgelaufen. Verlängern Sie es, um fortzufahren — Ansicht und Kommentare Ihrer Kunden bleiben unberührt. | Uw team is verlopen. Vernieuw om verder te gaan — bekijken en annoteren door uw klanten blijft gewoon mogelijk. |

「续费后可继续使用」对两条路径都成立（转账续费要运营确认、卡密兑换即时生效），既不承诺时点也不否认时点；
后半句是事实陈述：到期只拦写不拦读，spec §10 + Task 14。四语文案里不许出现任何「自动/auto/automatisch」词族
（一期没有扣款通道）。

**Files 段补一行**：`src/locales/{zh,en,de,nl}.json`（只加 `billing.expiredBanner` 一枚键，四本同处插入，
其余键一个都不动）。

- [ ] **Step 3: 建项目页透出服务端原因**

`src/app/studio/projects/new/page.tsx:84-86` 按上面 Files 段那一行改掉（把 `error.message` 透出），与 `src/app/studio/projects/page.tsx:388` 的写法对齐。

界面这一处**不做脚本级验证**：要看到到期态的 alert，得有一个已到期且已登录的团队，而造这个状态只能改他本地库里的真实团队 —— 那是他的数据，由他自己动手（Step 5 给了两条可直接粘贴的命令）。`check-team-gate.mts` 已经证明接口返回的就是那句人话，这里只剩「这句话出现在弹窗里」这一步。

- [ ] **Step 4: 全量回归**

依次跑，逐条贴实际输出：
1. `npx tsc --noEmit` → 0
2. `npx eslint src` → 只看本次新引入的 error（既有告警数记下对比，不顺手修别的）
3. `npx tsx scripts/check-billing-pricing.mts`、`check-billing-flow.mts`、`check-payment-provider.mts`、`check-card-contract.mts`、`check-team-writeable.mts` → 全绿
4. `node scripts/billing-api-check.mjs`（**用 node，不是 tsx**：它是 `.mjs` 且只用内置 fetch）与 `npx tsx scripts/check-team-gate.mts` → 全通过，SKIP 条目原样转述
5. 全部脚本跑完后再查一次库：`order`/`paymentAttempt`/`orderEvent` 计数为 0、`slug startsWith 'billing-check-'` 或 `startsWith 'gate-'` 的团队为 0

- [ ] **Step 5: 请他点验**

请他在本地 Chrome 已登录会话里走：正常团队 → 下单 → 报付款 → 平台端确认 → 到期日变 +90 天；到期团队 → 新建项目被拦住、页面上能看到「团队已到期，续费后可继续使用」这句话（就是 Step 2 那枚 `billing.expiredBanner` 的 zh 值开头，不是另一份文案）、顶栏徽标可点到 `/studio/team/billing`、而浏览/播放/批注照常。

第二步需要一个到期态团队。他自己在终端跑这两条（`<SLUG>` 换成他本地那个测试团队的 slug，跑完务必执行第二条恢复）：

```bash
# 造到期态（只改这一行的一个字段）
npx tsx -e '(async () => { const { PrismaClient } = await import("@prisma/client"); const p = new PrismaClient()
  console.log(await p.team.update({ where: { slug: "<SLUG>" }, data: { subscriptionExpiresAt: new Date(Date.now() - 86400000) }, select: { name: true, subscriptionExpiresAt: true } }))
  await p.$disconnect() })()'

# 点验完恢复"长期有效"——现网所有团队本来就是 null，别留在到期态
npx tsx -e '(async () => { const { PrismaClient } = await import("@prisma/client"); const p = new PrismaClient()
  console.log(await p.team.update({ where: { slug: "<SLUG>" }, data: { subscriptionExpiresAt: null }, select: { name: true, subscriptionExpiresAt: true } }))
  await p.$disconnect() })()'
```

`npx tsx -e` 必须是 async IIFE（CJS 输出不支持顶层 await，已实测），且**在他的终端里跑** —— Qoder 的 shell 不灌 `.env`，DATABASE_URL 拿不到。

- [ ] **Step 6: 汇报（不 commit）**

产出：改动文件清单（`git status --short` 原样贴）、五个断言脚本与 HTTP 复压的实际输出、四语截图或 DOM 数值、以及**仍开着的口子**：一期没有支付通道，客户打款后仍需运营点一次确认；微信二期改动点见 spec §6。

---

## 二期接微信时的改动面（本计划不实施，只为验证一期接口够不够）

1. `npm i` 什么都不加：用微信支付的 HTTP 签名 + `node:crypto` 自签（或他指定的最小 SDK，需单独批准）。
2. 新增 `src/lib/wechat-pay-provider.ts` 实现 `PaymentProvider`，在 `providers` 里把 `wechat` 从 `null` 换成实例。
3. env 加 `WECHAT_PAY_MCHID` / `WECHAT_PAY_APIV3_KEY` / `WECHAT_PAY_CERT_SERIAL`。
4. 新增 `POST /api/billing/callback` → `provider.verifyCallback(req)` → 写 `PaymentAttempt(provider:'wechat')` → `Order` 推到 `PAID` → `fulfillOrder`。
5. `src/app/studio/team/billing/page.tsx` 转账块加一个 `kind === 'native'` 分支渲染二维码。
6. 平台端队列与确认框**不改**：`REPORTED` tab 在自动通道下自然变空，可以留作人工兜底。

状态机、`fulfillOrder`、`OrderEvent`、账单页、门禁（WP6）全部零改动 —— 这就是 §6 承诺的那一件事。
