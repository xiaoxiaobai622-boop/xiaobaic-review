ALTER TABLE "Team"
  ADD COLUMN "subscriptionPlan" TEXT NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "subscriptionStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "subscriptionExpiresAt" TIMESTAMP(3);

ALTER TABLE "Team"
  ALTER COLUMN "subscriptionPlan" SET DEFAULT 'TRIAL';

CREATE TABLE "TeamActivationCard" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "codeLast4" TEXT NOT NULL,
  "planKey" TEXT NOT NULL DEFAULT 'MONTHLY',
  "durationDays" INTEGER NOT NULL DEFAULT 30,
  "maxMembers" INTEGER NOT NULL DEFAULT 10,
  "maxStorageGB" INTEGER NOT NULL DEFAULT 50,
  "maxProjects" INTEGER NOT NULL DEFAULT 0,
  "maxVideos" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
  "redeemedAt" TIMESTAMP(3),
  "redeemedByTeamId" TEXT,
  "redeemedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamActivationCard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamActivationCard_codeHash_key" ON "TeamActivationCard"("codeHash");
CREATE INDEX "TeamActivationCard_status_createdAt_idx" ON "TeamActivationCard"("status", "createdAt");
CREATE INDEX "TeamActivationCard_redeemedByTeamId_idx" ON "TeamActivationCard"("redeemedByTeamId");
