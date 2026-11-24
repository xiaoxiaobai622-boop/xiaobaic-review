-- Additive, nullable: old announcements keep their plain-text content and
-- render as paragraphs; only RELEASE articles read the rich HTML column.
ALTER TABLE "PlatformAnnouncement" ADD COLUMN "contentHtml" TEXT;