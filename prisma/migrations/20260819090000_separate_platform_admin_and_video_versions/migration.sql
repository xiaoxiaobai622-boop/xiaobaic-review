ALTER TABLE "User"
ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Preserve current platform access during the role split. Platform owners can
-- revoke this flag explicitly after verifying the three existing accounts.
UPDATE "User" SET "isPlatformAdmin" = true WHERE "role" = 'ADMIN';

CREATE UNIQUE INDEX "Video_projectId_name_version_key"
ON "Video"("projectId", "name", "version");
