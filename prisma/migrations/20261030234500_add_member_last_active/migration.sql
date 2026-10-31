-- Server-side member heartbeat. Null is "never observed"; do not backfill with updatedAt.
ALTER TABLE "TeamMember" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

CREATE INDEX "TeamMember_teamId_lastActiveAt_idx" ON "TeamMember"("teamId", "lastActiveAt");
CREATE INDEX "Project_teamId_createdAt_idx" ON "Project"("teamId", "createdAt");
CREATE INDEX "Video_projectId_createdAt_idx" ON "Video"("projectId", "createdAt");
CREATE INDEX "Comment_projectId_createdAt_idx" ON "Comment"("projectId", "createdAt");
