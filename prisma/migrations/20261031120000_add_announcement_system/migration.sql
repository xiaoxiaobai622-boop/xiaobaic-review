-- Announcement system: extend the existing inbox model in place so legacy rows
-- and read receipts survive. Additive columns only, plus nullable readAt so an
-- impression/dismissal row can exist before the body is read.

ALTER TABLE "User" ADD COLUMN "locale" TEXT;
CREATE INDEX "User_locale_idx" ON "User"("locale");

ALTER TABLE "PlatformAnnouncement"
    ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'zh',
    ADD COLUMN "type" TEXT NOT NULL DEFAULT 'MESSAGE',
    ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "primaryMode" TEXT NOT NULL DEFAULT 'INBOX',
    ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "startAt" TIMESTAMP(3),
    ADD COLUMN "endAt" TIMESTAMP(3),
    ADD COLUMN "ackRequired" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "ctaLabel" TEXT,
    ADD COLUMN "ctaUrl" TEXT,
    ADD COLUMN "imageUrl" TEXT,
    ADD COLUMN "createdBy" TEXT,
    ADD COLUMN "publishedAt" TIMESTAMP(3),
    ADD COLUMN "audienceCount" INTEGER,
    ADD COLUMN "audienceResolvedAt" TIMESTAMP(3),
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "copiedFromId" TEXT,
    ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "archivedAt" TIMESTAMP(3),
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Legacy announcements were live when created; preserve that meaning for the
-- lifecycle sync and for clients that display a publish time.
UPDATE "PlatformAnnouncement"
SET "startAt" = "createdAt", "publishedAt" = "createdAt"
WHERE "startAt" IS NULL AND "publishedAt" IS NULL;

CREATE INDEX "PlatformAnnouncement_status_startAt_endAt_idx" ON "PlatformAnnouncement"("status", "startAt", "endAt");
CREATE INDEX "PlatformAnnouncement_primaryMode_status_idx" ON "PlatformAnnouncement"("primaryMode", "status");
CREATE INDEX "PlatformAnnouncement_type_createdAt_idx" ON "PlatformAnnouncement"("type", "createdAt");
CREATE INDEX "PlatformAnnouncement_copiedFromId_idx" ON "PlatformAnnouncement"("copiedFromId");

ALTER TABLE "PlatformAnnouncement" ADD CONSTRAINT "PlatformAnnouncement_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlatformAnnouncement" ADD CONSTRAINT "PlatformAnnouncement_copiedFromId_fkey"
    FOREIGN KEY ("copiedFromId") REFERENCES "PlatformAnnouncement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlatformAnnouncementRead" ALTER COLUMN "readAt" DROP DEFAULT;
ALTER TABLE "PlatformAnnouncementRead" ALTER COLUMN "readAt" DROP NOT NULL;
ALTER TABLE "PlatformAnnouncementRead"
    ADD COLUMN "acknowledgedAt" TIMESTAMP(3),
    ADD COLUMN "dismissedAt" TIMESTAMP(3),
    ADD COLUMN "lastShownAt" TIMESTAMP(3),
    ADD COLUMN "shownCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "impressionCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastShownSessionId" TEXT,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "PlatformAnnouncementRead_userId_lastShownAt_idx" ON "PlatformAnnouncementRead"("userId", "lastShownAt");

CREATE TABLE "AnnouncementAudienceRule" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'INCLUDE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementAudienceRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnnouncementAudienceRule_announcementId_idx" ON "AnnouncementAudienceRule"("announcementId");
CREATE INDEX "AnnouncementAudienceRule_kind_value_idx" ON "AnnouncementAudienceRule"("kind", "value");

ALTER TABLE "AnnouncementAudienceRule" ADD CONSTRAINT "AnnouncementAudienceRule_announcementId_fkey"
    FOREIGN KEY ("announcementId") REFERENCES "PlatformAnnouncement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AnnouncementEvent" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "beijingDay" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnnouncementEvent_dedupeKey_key" ON "AnnouncementEvent"("dedupeKey");
CREATE INDEX "AnnouncementEvent_announcementId_type_occurredAt_idx" ON "AnnouncementEvent"("announcementId", "type", "occurredAt");
CREATE INDEX "AnnouncementEvent_announcementId_beijingDay_idx" ON "AnnouncementEvent"("announcementId", "beijingDay");
CREATE INDEX "AnnouncementEvent_userId_occurredAt_idx" ON "AnnouncementEvent"("userId", "occurredAt");

ALTER TABLE "AnnouncementEvent" ADD CONSTRAINT "AnnouncementEvent_announcementId_fkey"
    FOREIGN KEY ("announcementId") REFERENCES "PlatformAnnouncement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnnouncementEvent" ADD CONSTRAINT "AnnouncementEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AnnouncementAuditLog" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnnouncementAuditLog_announcementId_createdAt_idx" ON "AnnouncementAuditLog"("announcementId", "createdAt");
CREATE INDEX "AnnouncementAuditLog_actorUserId_createdAt_idx" ON "AnnouncementAuditLog"("actorUserId", "createdAt");

ALTER TABLE "AnnouncementAuditLog" ADD CONSTRAINT "AnnouncementAuditLog_announcementId_fkey"
    FOREIGN KEY ("announcementId") REFERENCES "PlatformAnnouncement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AnnouncementControl" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "bannerModalPaused" BOOLEAN NOT NULL DEFAULT false,
    "modalMaxPerDay" INTEGER NOT NULL DEFAULT 1,
    "modalCooldownMinutes" INTEGER NOT NULL DEFAULT 1440,
    "modalMaxShowsPerUser" INTEGER NOT NULL DEFAULT 3,
    "toastMaxPriority" INTEGER NOT NULL DEFAULT 20,
    "updatedBy" TEXT,
    "updatedByLabel" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementControl_pkey" PRIMARY KEY ("id")
);
