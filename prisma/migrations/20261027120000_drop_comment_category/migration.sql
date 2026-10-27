-- Drop the review-comment quick tags (画面 / 声音 / 字幕 / 剪辑 / 其他).
-- The picker under the composer, the header "全部标签" filter and the chip on each posted
-- comment are all removed, so this column has no reader left.
--
-- This destroys values already stored. Before it runs against production, count them:
--   SELECT count(*) FROM "Comment" WHERE "category" IS NOT NULL;
DROP INDEX IF EXISTS "Comment_category_idx";

ALTER TABLE "Comment" DROP COLUMN "category";
