CREATE TABLE "WechatIdentity" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'WEB',
    "openId" TEXT NOT NULL,
    "unionId" TEXT,
    "nickname" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WechatIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WechatIdentity_platform_openId_key" ON "WechatIdentity"("platform", "openId");
CREATE INDEX "WechatIdentity_unionId_idx" ON "WechatIdentity"("unionId");
