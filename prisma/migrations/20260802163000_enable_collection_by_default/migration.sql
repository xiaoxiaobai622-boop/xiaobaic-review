ALTER TABLE "Project" ALTER COLUMN "allowReverseShare" SET DEFAULT true;
ALTER TABLE "Settings" ALTER COLUMN "defaultAllowReverseShare" SET DEFAULT true;

UPDATE "Project" SET "allowReverseShare" = true WHERE "allowReverseShare" = false;
UPDATE "Settings" SET "defaultAllowReverseShare" = true WHERE "defaultAllowReverseShare" = false;
