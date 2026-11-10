-- A link invite is identified by possession of the token, not by a phone/email.
-- Every pre-existing invite is a phone invite.
CREATE TYPE "InviteMethod" AS ENUM ('PHONE', 'LINK');

ALTER TABLE "TeamInvite"
  ADD COLUMN "method" "InviteMethod" NOT NULL DEFAULT 'PHONE',
  ADD COLUMN "declinedAt" TIMESTAMP(3);

-- The DEFAULT already backfilled every row; keep the intent explicit so the
-- pre-LINK era is documented in the data history as PHONE.
UPDATE "TeamInvite" SET "method" = 'PHONE';

-- Declining is not revoking: DECLINED belongs to the invitee, REVOKED to the team.
ALTER TYPE "InviteStatus" ADD VALUE IF NOT EXISTS 'DECLINED';

CREATE INDEX "TeamInvite_teamId_method_status_idx"
  ON "TeamInvite"("teamId", "method", "status");
