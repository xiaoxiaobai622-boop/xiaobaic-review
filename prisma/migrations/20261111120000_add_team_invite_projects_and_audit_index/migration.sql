CREATE TABLE "TeamInviteProject" (
  "id" TEXT NOT NULL,
  "inviteId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "role" "ProjectRole" NOT NULL DEFAULT 'REVIEWER',
  CONSTRAINT "TeamInviteProject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamInviteProject_inviteId_projectId_key"
  ON "TeamInviteProject"("inviteId", "projectId");

CREATE INDEX "TeamInviteProject_projectId_idx"
  ON "TeamInviteProject"("projectId");

ALTER TABLE "TeamInviteProject"
  ADD CONSTRAINT "TeamInviteProject_inviteId_fkey"
  FOREIGN KEY ("inviteId") REFERENCES "TeamInvite"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamInviteProject"
  ADD CONSTRAINT "TeamInviteProject_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "TeamAuditEvent_createdAt_idx"
  ON "TeamAuditEvent"("createdAt");
