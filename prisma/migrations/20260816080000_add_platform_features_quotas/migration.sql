CREATE TABLE "PlatformFeature" (
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "defaultEnabled" BOOLEAN NOT NULL DEFAULT true,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformFeature_pkey" PRIMARY KEY ("key")
);

INSERT INTO "PlatformFeature" ("key", "name", "category", "defaultEnabled", "description", "createdAt", "updatedAt") VALUES
  ('video_1080p', '1080p 预览', '视频处理', true, '允许项目使用 1080p 预览分辨率。', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('video_2160p', '2K/2160p 预览', '视频处理', true, '允许项目使用 2160p 预览分辨率。', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('skip_transcoding', '跳过转码', '视频处理', true, '允许项目直接播放原始兼容文件而不转码。', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('reverse_share', '反向分享上传', '协作', true, '允许客户通过分享页向项目上传文件。', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('photo_albums', '图片相册', '内容管理', true, '允许在项目中创建和管理图片相册。', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('analytics', '项目分析', '数据', true, '允许查看项目访问和下载分析。', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('client_directory', '客户目录', '协作', true, '允许使用客户公司和联系人目录。', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('priority_transcoding', '优先转码', '视频处理', true, '允许优先处理该团队的视频转码任务。', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

CREATE TABLE "TeamFeatureGrant" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "featureKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamFeatureGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamFeatureGrant_teamId_featureKey_key"
ON "TeamFeatureGrant"("teamId", "featureKey");

CREATE INDEX "TeamFeatureGrant_featureKey_idx"
ON "TeamFeatureGrant"("featureKey");

INSERT INTO "TeamFeatureGrant" ("id", "teamId", "featureKey", "enabled", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  t.id,
  f.key,
  f."defaultEnabled",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Team" t
CROSS JOIN "PlatformFeature" f;

ALTER TABLE "TeamFeatureGrant"
ADD CONSTRAINT "TeamFeatureGrant_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamFeatureGrant"
ADD CONSTRAINT "TeamFeatureGrant_featureKey_fkey"
FOREIGN KEY ("featureKey") REFERENCES "PlatformFeature"("key") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TeamQuota" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "maxMembers" INTEGER NOT NULL DEFAULT 10,
  "maxProjects" INTEGER NOT NULL DEFAULT 5,
  "maxVideos" INTEGER NOT NULL DEFAULT 50,
  "maxStorageGB" INTEGER NOT NULL DEFAULT 20,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamQuota_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamQuota_teamId_key"
ON "TeamQuota"("teamId");

INSERT INTO "TeamQuota" ("id", "teamId", "maxMembers", "maxProjects", "maxVideos", "maxStorageGB", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  t.id,
  10,
  5,
  50,
  20,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Team" t;

ALTER TABLE "TeamQuota"
ADD CONSTRAINT "TeamQuota_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
