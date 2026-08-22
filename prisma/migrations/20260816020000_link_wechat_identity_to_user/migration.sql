ALTER TABLE "WechatIdentity" ADD COLUMN "userId" TEXT;

CREATE INDEX "WechatIdentity_userId_idx" ON "WechatIdentity"("userId");

ALTER TABLE "WechatIdentity"
ADD CONSTRAINT "WechatIdentity_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
