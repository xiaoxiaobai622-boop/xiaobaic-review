ALTER TABLE "Video" ADD COLUMN "mpsTaskId" TEXT;
ALTER TABLE "Video" ADD COLUMN "mpsStatus" TEXT;
ALTER TABLE "Video" ADD COLUMN "mpsError" TEXT;
ALTER TABLE "Video" ADD COLUMN "hlsPath" TEXT;

CREATE INDEX "Video_mpsTaskId_idx" ON "Video"("mpsTaskId");
