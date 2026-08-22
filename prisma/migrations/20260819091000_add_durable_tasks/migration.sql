CREATE TABLE "DurableTask" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DurableTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DurableTask_dedupeKey_key" ON "DurableTask"("dedupeKey");
CREATE INDEX "DurableTask_availableAt_createdAt_idx" ON "DurableTask"("availableAt", "createdAt");
