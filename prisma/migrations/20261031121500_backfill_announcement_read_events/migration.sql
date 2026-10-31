-- Reads that predate the announcement system still need to appear in the READ
-- event stats. Backfill one deterministic event per existing read receipt.
INSERT INTO "AnnouncementEvent" (
    "id", "announcementId", "userId", "type", "mode", "beijingDay", "dedupeKey", "occurredAt"
)
SELECT
    'evt_' || md5(r."announcementId" || ':' || r."userId" || ':READ'),
    r."announcementId",
    r."userId",
    'READ',
    'INBOX',
    to_char(r."readAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD'),
    r."announcementId" || ':' || r."userId" || ':READ',
    r."readAt"
FROM "PlatformAnnouncementRead" r
WHERE r."readAt" IS NOT NULL
ON CONFLICT ("dedupeKey") DO NOTHING;
