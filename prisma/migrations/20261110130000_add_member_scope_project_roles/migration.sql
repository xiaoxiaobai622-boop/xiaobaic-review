-- Project roles are fixed. Team OWNER/ADMIN stay implicit PROJECT_ADMIN.
CREATE TYPE "ProjectRole" AS ENUM ('PROJECT_ADMIN', 'EDITOR', 'REVIEWER');

-- Runtime project scope moves from User (account default) to TeamMember (per team).
ALTER TABLE "TeamMember"
  ADD COLUMN "projectAccessScope" "ProjectAccessScope" NOT NULL DEFAULT 'ALL_PROJECTS',
  ADD COLUMN "defaultProjectRole" "ProjectRole" NOT NULL DEFAULT 'REVIEWER';

ALTER TABLE "ProjectMember"
  ADD COLUMN "role" "ProjectRole" NOT NULL DEFAULT 'REVIEWER';

ALTER TABLE "TeamInvite"
  ADD COLUMN "projectAccessScope" "ProjectAccessScope" NOT NULL DEFAULT 'ALL_PROJECTS',
  ADD COLUMN "defaultProjectRole" "ProjectRole" NOT NULL DEFAULT 'REVIEWER';

-- Preserve today's visibility exactly: each membership inherits the account's
-- current scope once, then becomes independent per team.
UPDATE "TeamMember" tm
SET "projectAccessScope" = u."projectAccessScope"
FROM "User" u
WHERE tm."userId" = u."id";

-- Existing ProjectMember rows were visibility grants only; REVIEWER keeps their
-- current read/comment/download behaviour and does not grant upload.
-- Project creators who are plain members keep their approval ability.
INSERT INTO "ProjectMember" ("id", "projectId", "userId", "role", "createdAt")
SELECT
  'pm_' || md5(p."id" || ':' || p."createdById"),
  p."id",
  p."createdById",
  'PROJECT_ADMIN',
  CURRENT_TIMESTAMP
FROM "Project" p
JOIN "TeamMember" tm
  ON tm."teamId" = p."teamId"
 AND tm."userId" = p."createdById"
WHERE tm."status" = 'ACTIVE'
  AND tm."role" = 'MEMBER'
  AND NOT EXISTS (
    SELECT 1 FROM "ProjectMember" pm
    WHERE pm."projectId" = p."id" AND pm."userId" = p."createdById"
  );

CREATE INDEX "TeamMember_teamId_projectAccessScope_idx"
  ON "TeamMember"("teamId", "projectAccessScope");

CREATE INDEX "ProjectMember_projectId_role_idx"
  ON "ProjectMember"("projectId", "role");

CREATE TABLE "TeamAuditEvent" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "targetUserId" TEXT,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeamAuditEvent_teamId_createdAt_idx"
  ON "TeamAuditEvent"("teamId", "createdAt");

CREATE INDEX "TeamAuditEvent_teamId_action_idx"
  ON "TeamAuditEvent"("teamId", "action");

CREATE INDEX "TeamAuditEvent_targetUserId_createdAt_idx"
  ON "TeamAuditEvent"("targetUserId", "createdAt");

ALTER TABLE "TeamAuditEvent"
  ADD CONSTRAINT "TeamAuditEvent_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
