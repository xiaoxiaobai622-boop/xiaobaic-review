ALTER TABLE "ProjectUpload" ADD COLUMN "originalFileName" TEXT;

UPDATE "ProjectUpload"
SET "originalFileName" = "fileName"
WHERE "originalFileName" IS NULL;
