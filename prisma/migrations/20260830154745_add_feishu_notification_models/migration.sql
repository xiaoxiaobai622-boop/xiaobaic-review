-- CreateTable
CREATE TABLE "FeishuBinding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "unionId" TEXT,
    "tenantKey" TEXT,
    "nickname" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeishuBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeishuNotification" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "videoId" TEXT,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "commentIds" TEXT[],
    "uploaderId" TEXT NOT NULL,
    "uploaderOpenId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "feishuMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeishuNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeishuBinding_userId_key" ON "FeishuBinding"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FeishuBinding_openId_key" ON "FeishuBinding"("openId");

-- CreateIndex
CREATE INDEX "FeishuBinding_openId_idx" ON "FeishuBinding"("openId");

-- CreateIndex
CREATE INDEX "FeishuBinding_unionId_idx" ON "FeishuBinding"("unionId");

-- CreateIndex
CREATE INDEX "FeishuNotification_projectId_idx" ON "FeishuNotification"("projectId");

-- CreateIndex
CREATE INDEX "FeishuNotification_videoId_idx" ON "FeishuNotification"("videoId");

-- CreateIndex
CREATE INDEX "FeishuNotification_uploaderId_idx" ON "FeishuNotification"("uploaderId");

-- CreateIndex
CREATE INDEX "FeishuNotification_status_idx" ON "FeishuNotification"("status");

-- CreateIndex
CREATE INDEX "FeishuNotification_createdAt_idx" ON "FeishuNotification"("createdAt");

-- AddForeignKey
ALTER TABLE "FeishuBinding" ADD CONSTRAINT "FeishuBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeishuNotification" ADD CONSTRAINT "FeishuNotification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeishuNotification" ADD CONSTRAINT "FeishuNotification_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeishuNotification" ADD CONSTRAINT "FeishuNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
