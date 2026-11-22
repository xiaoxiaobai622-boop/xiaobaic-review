-- Background 1080p MP4 rendition produced by the docs transcode worker.
-- Only new uploads dispatch it: existing rows keep the NONE default, so this is
-- intentionally a plain ADD COLUMN with no backfill.
ALTER TABLE "Video" ADD COLUMN "local1080Status" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Video" ADD COLUMN "local1080Error" TEXT;
