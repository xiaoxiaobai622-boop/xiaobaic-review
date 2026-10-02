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

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_fulfilledById_fkey" FOREIGN KEY ("fulfilledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: 逐字段等于 src/lib/platform-access.ts:14-19 的 MONTHLY_QUOTA，
-- 保证上线那一刻现网额度不变。价格先放 0 分 —— 真实定价由运营在平台设置里填，
-- 不在代码里编一个数。
-- ON CONFLICT ("key") DO NOTHING：运营可能在发布前先手工建过 MONTHLY 行。
-- 容器启动跑的是 prisma migrate deploy，裸 INSERT 撞唯一索引会让整支迁移失败 = 起不来。
INSERT INTO "Plan" ("id","key","name","priceCents","currency","durationDays","maxMembers","maxProjects","maxVideos","maxStorageGB","active","sort","updatedAt")
VALUES ('plan_monthly_seed','MONTHLY','月度',0,'CNY',30,10,0,0,50,true,1,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
