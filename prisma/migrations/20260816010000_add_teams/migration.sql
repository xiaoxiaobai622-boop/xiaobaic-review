CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "TeamMemberStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "Team" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");
CREATE INDEX "Team_createdById_idx" ON "Team"("createdById");

INSERT INTO "Team" ("id", "name", "slug", "createdById", "createdAt", "updatedAt")
SELECT
  'team_default',
  'My Team',
  'default-team',
  u.id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u.role = 'ADMIN'
ORDER BY u."createdAt" ASC, u.id ASC
LIMIT 1;

ALTER TABLE "Team"
ADD CONSTRAINT "Team_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Project" ADD COLUMN "teamId" TEXT;

UPDATE "Project" SET "teamId" = 'team_default' WHERE "teamId" IS NULL;

ALTER TABLE "Project" ALTER COLUMN "teamId" SET NOT NULL;

CREATE INDEX "Project_teamId_idx" ON "Project"("teamId");

ALTER TABLE "Project"
ADD CONSTRAINT "Project_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TeamMember" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
  "status" "TeamMemberStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

ALTER TABLE "TeamMember"
ADD CONSTRAINT "TeamMember_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamMember"
ADD CONSTRAINT "TeamMember_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "TeamMember" ("id", "teamId", "userId", "role", "status", "createdAt", "updatedAt")
SELECT
  'tm_' || u.id,
  'team_default',
  u.id,
  CASE
    WHEN u.id = (
      SELECT owner.id
      FROM "User" owner
      WHERE owner.role = 'ADMIN'
      ORDER BY owner."createdAt" ASC, owner.id ASC
      LIMIT 1
    ) THEN 'OWNER'
    WHEN u.role = 'ADMIN' THEN 'ADMIN'
    ELSE 'MEMBER'
  END::"TeamRole",
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u;

CREATE TABLE "TeamInvite" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
  "token" TEXT NOT NULL,
  "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
  "createdById" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamInvite_token_key" ON "TeamInvite"("token");
CREATE INDEX "TeamInvite_teamId_status_idx" ON "TeamInvite"("teamId", "status");
CREATE INDEX "TeamInvite_createdById_idx" ON "TeamInvite"("createdById");
CREATE INDEX "TeamInvite_expiresAt_idx" ON "TeamInvite"("expiresAt");

ALTER TABLE "TeamInvite"
ADD CONSTRAINT "TeamInvite_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TeamJoinRequest" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "message" TEXT,
  "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamJoinRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamJoinRequest_teamId_userId_status_key" ON "TeamJoinRequest"("teamId", "userId", "status");
CREATE INDEX "TeamJoinRequest_userId_idx" ON "TeamJoinRequest"("userId");

ALTER TABLE "TeamJoinRequest"
ADD CONSTRAINT "TeamJoinRequest_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamJoinRequest"
ADD CONSTRAINT "TeamJoinRequest_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
