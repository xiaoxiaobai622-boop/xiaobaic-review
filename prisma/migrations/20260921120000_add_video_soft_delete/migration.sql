-- The recycle bin promises a 7-day undo window, so deleting a video must keep the
-- row (and its comments, assets and analytics, which all cascade today) until the
-- item actually expires.
ALTER TABLE "Video" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Video_projectId_deletedAt_idx" ON "Video"("projectId", "deletedAt");
