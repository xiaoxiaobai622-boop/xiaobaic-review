ALTER TABLE "Team" ADD COLUMN "shareKey" TEXT;

UPDATE "Team"
SET "shareKey" = "id"
WHERE "shareKey" IS NULL;

ALTER TABLE "Team" ALTER COLUMN "shareKey" SET NOT NULL;

CREATE UNIQUE INDEX "Team_shareKey_key"
ON "Team"("shareKey");

ALTER TABLE "ClientCompany" ADD COLUMN "teamId" TEXT;

UPDATE "ClientCompany" c
SET "teamId" = COALESCE(
  (
    SELECT p."teamId"
    FROM "Project" p
    WHERE p."clientCompanyId" = c.id
    LIMIT 1
  ),
  'team_default'
)
WHERE c."teamId" IS NULL;

ALTER TABLE "ClientCompany" ALTER COLUMN "teamId" SET NOT NULL;

DROP INDEX IF EXISTS "ClientCompany_name_key";

CREATE UNIQUE INDEX "ClientCompany_teamId_name_key"
ON "ClientCompany"("teamId", "name");

CREATE INDEX "ClientCompany_teamId_idx"
ON "ClientCompany"("teamId");

ALTER TABLE "ClientCompany"
ADD CONSTRAINT "ClientCompany_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "Project_projectCode_key";

CREATE UNIQUE INDEX "Project_teamId_projectCode_key"
ON "Project"("teamId", "projectCode");
