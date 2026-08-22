CREATE TABLE "TeamSettings" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "defaultPreviewResolution" TEXT NOT NULL DEFAULT '720p',
  "defaultSkipTranscoding" BOOLEAN NOT NULL DEFAULT false,
  "defaultWatermarkEnabled" BOOLEAN NOT NULL DEFAULT true,
  "defaultWatermarkText" TEXT,
  "defaultWatermarkPositions" TEXT NOT NULL DEFAULT 'center',
  "defaultWatermarkOpacity" INTEGER NOT NULL DEFAULT 30,
  "defaultWatermarkFontSize" TEXT NOT NULL DEFAULT 'medium',
  "defaultApplyPreviewLut" BOOLEAN NOT NULL DEFAULT true,
  "maxUploadSizeGB" INTEGER NOT NULL DEFAULT 1,
  "defaultTimestampDisplay" TEXT NOT NULL DEFAULT 'TIMECODE',
  "defaultUsePreviewForApprovedPlayback" BOOLEAN NOT NULL DEFAULT false,
  "defaultAllowClientAssetUpload" BOOLEAN NOT NULL DEFAULT false,
  "defaultAllowReverseShare" BOOLEAN NOT NULL DEFAULT true,
  "defaultShowClientTutorial" BOOLEAN NOT NULL DEFAULT true,
  "defaultAllowAssetDownload" BOOLEAN NOT NULL DEFAULT true,
  "defaultClientCanApprove" BOOLEAN NOT NULL DEFAULT true,
  "autoApproveProject" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamSettings_teamId_key"
ON "TeamSettings"("teamId");

INSERT INTO "TeamSettings" (
  "id", "teamId",
  "defaultPreviewResolution", "defaultSkipTranscoding",
  "defaultWatermarkEnabled", "defaultWatermarkText",
  "defaultWatermarkPositions", "defaultWatermarkOpacity",
  "defaultWatermarkFontSize", "defaultApplyPreviewLut",
  "maxUploadSizeGB", "defaultTimestampDisplay",
  "defaultUsePreviewForApprovedPlayback", "defaultAllowClientAssetUpload",
  "defaultAllowReverseShare", "defaultShowClientTutorial",
  "defaultAllowAssetDownload", "defaultClientCanApprove", "autoApproveProject",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  t.id,
  COALESCE(s."defaultPreviewResolution", '720p'),
  COALESCE(s."defaultSkipTranscoding", false),
  COALESCE(s."defaultWatermarkEnabled", true),
  s."defaultWatermarkText",
  COALESCE(s."defaultWatermarkPositions", 'center'),
  COALESCE(s."defaultWatermarkOpacity", 30),
  COALESCE(s."defaultWatermarkFontSize", 'medium'),
  COALESCE(s."defaultApplyPreviewLut", true),
  COALESCE(s."maxUploadSizeGB", 1),
  COALESCE(s."defaultTimestampDisplay", 'TIMECODE'),
  COALESCE(s."defaultUsePreviewForApprovedPlayback", false),
  COALESCE(s."defaultAllowClientAssetUpload", false),
  COALESCE(s."defaultAllowReverseShare", true),
  COALESCE(s."defaultShowClientTutorial", true),
  COALESCE(s."defaultAllowAssetDownload", true),
  COALESCE(s."defaultClientCanApprove", true),
  COALESCE(s."autoApproveProject", true),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Team" t
CROSS JOIN "Settings" s
WHERE s.id = 'default';

ALTER TABLE "TeamSettings"
ADD CONSTRAINT "TeamSettings_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
