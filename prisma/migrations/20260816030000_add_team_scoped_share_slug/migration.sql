ALTER TABLE "Project" ADD COLUMN "shareSlug" TEXT;

UPDATE "Project"
SET "shareSlug" = "slug"
WHERE "shareSlug" IS NULL;

ALTER TABLE "Project" ALTER COLUMN "shareSlug" SET NOT NULL;

CREATE UNIQUE INDEX "Project_teamId_shareSlug_key"
ON "Project"("teamId", "shareSlug");
