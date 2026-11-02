-- Source-quality observability. The uploaded original remains download-only.
ALTER TABLE "Video" ADD COLUMN "sourceQualityBytes" BIGINT;
ALTER TABLE "VideoAnalytics" ADD COLUMN "quality" TEXT;
ALTER TABLE "VideoAnalytics" ADD COLUMN "bytes" BIGINT;
