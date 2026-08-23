CREATE TYPE "VideoReviewStatus" AS ENUM (
  'PENDING_REVIEW',
  'IN_REVIEW',
  'FEEDBACK_COMPLETE',
  'APPROVED'
);

ALTER TABLE "Video"
ADD COLUMN "reviewStatus" "VideoReviewStatus";

UPDATE "Video"
SET "reviewStatus" = 'APPROVED'
WHERE "approved" = true;
