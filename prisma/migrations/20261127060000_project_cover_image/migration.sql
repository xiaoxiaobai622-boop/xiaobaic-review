-- Project cover image (public capability URL managed by project settings).
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "coverImageUrl" TEXT;
