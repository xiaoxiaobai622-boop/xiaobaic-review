-- Attach every share page visit to the specific ShareLink row it came from.
-- A project can carry several links at once, and without this column the access
-- records of all of them collapse into one project-level pile.
-- Deliberately not a foreign key: deleting a link must not erase its history.
ALTER TABLE "SharePageAccess" ADD COLUMN IF NOT EXISTS "shareLinkId" TEXT;

CREATE INDEX IF NOT EXISTS "SharePageAccess_shareLinkId_createdAt_idx" ON "SharePageAccess"("shareLinkId", "createdAt");
