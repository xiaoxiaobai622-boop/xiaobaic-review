ALTER TABLE "FeishuBinding"
  ADD COLUMN "userAccessTokenEncrypted" TEXT,
  ADD COLUMN "refreshTokenEncrypted" TEXT,
  ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);
