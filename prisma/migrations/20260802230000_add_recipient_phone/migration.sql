ALTER TABLE "ProjectRecipient" ADD COLUMN "phone" TEXT;
CREATE INDEX "ProjectRecipient_projectId_phone_idx" ON "ProjectRecipient"("projectId", "phone");
