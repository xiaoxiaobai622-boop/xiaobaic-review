ALTER TABLE "ProjectUpload" ADD COLUMN "transcodeStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "ProjectUpload" ADD COLUMN "transcodeProgress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProjectUpload" ADD COLUMN "transcodeError" TEXT;
ALTER TABLE "ProjectUpload" ADD COLUMN "sourceVideoId" TEXT;

CREATE UNIQUE INDEX "ProjectUpload_sourceVideoId_key" ON "ProjectUpload"("sourceVideoId");

ALTER TABLE "ProjectUpload" ADD CONSTRAINT "ProjectUpload_sourceVideoId_fkey"
FOREIGN KEY ("sourceVideoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;
