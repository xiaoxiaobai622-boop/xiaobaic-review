-- Audit rows must outlive the project that produced them, and every event must name its actor.
-- This reverses 20260316120000_security_event_cascade_delete (GDPR): the surviving rows no
-- longer keep the personal payload, because the project delete handler scrubs ipAddress,
-- referer, videoId, sessionId and details before the project row goes away.

-- DropForeignKey
ALTER TABLE "SecurityEvent" DROP CONSTRAINT IF EXISTS "SecurityEvent_projectId_fkey";

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "SecurityEvent" ADD COLUMN IF NOT EXISTS "userId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SecurityEvent_userId_createdAt_idx" ON "SecurityEvent"("userId", "createdAt");
