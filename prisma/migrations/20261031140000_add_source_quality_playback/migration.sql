-- Global ops switch, default off.
ALTER TABLE "Settings" ADD COLUMN "enableSourceQualityPlayback" BOOLEAN NOT NULL DEFAULT false;

-- High-bitrate H.264/AAC proxy path. The original stays download-only.
ALTER TABLE "Video" ADD COLUMN "sourceQualityPath" TEXT;
ALTER TABLE "Video" ADD COLUMN "sourceQualityError" TEXT;
