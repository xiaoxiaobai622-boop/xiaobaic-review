ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MEMBER';

CREATE TYPE "ProjectAccessScope" AS ENUM ('ALL_PROJECTS', 'ASSIGNED_ONLY');

ALTER TABLE "User"
ADD COLUMN "projectAccessScope" "ProjectAccessScope" NOT NULL DEFAULT 'ALL_PROJECTS';

ALTER TABLE "Project" ADD COLUMN "projectCode" TEXT;

DO $$
DECLARE
  project_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO project_count FROM "Project";
  IF project_count > 999 THEN
    RAISE EXCEPTION 'Three-digit project IDs support at most 999 projects';
  END IF;
END $$;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt", id) AS row_number
  FROM "Project"
)
UPDATE "Project" AS project
SET "projectCode" = LPAD(numbered.row_number::TEXT, 3, '0')
FROM numbered
WHERE project.id = numbered.id;

ALTER TABLE "Project" ALTER COLUMN "projectCode" SET NOT NULL;
CREATE UNIQUE INDEX "Project_projectCode_key" ON "Project"("projectCode");

CREATE TABLE "ProjectMember" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

ALTER TABLE "ProjectMember"
ADD CONSTRAINT "ProjectMember_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectMember"
ADD CONSTRAINT "ProjectMember_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
