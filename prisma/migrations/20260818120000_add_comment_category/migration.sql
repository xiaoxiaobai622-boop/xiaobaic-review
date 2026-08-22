-- Add quick category tags to review comments.
ALTER TABLE "Comment" ADD COLUMN "category" TEXT;

CREATE INDEX "Comment_category_idx" ON "Comment"("category");
