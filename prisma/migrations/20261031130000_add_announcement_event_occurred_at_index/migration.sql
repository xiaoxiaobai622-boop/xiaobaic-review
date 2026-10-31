-- Retention prunes by occurredAt alone; the existing compound indexes all
-- start with announcementId/userId, so add a leading-column index for the
-- bounded event cleanup.
CREATE INDEX "AnnouncementEvent_occurredAt_idx" ON "AnnouncementEvent"("occurredAt");
