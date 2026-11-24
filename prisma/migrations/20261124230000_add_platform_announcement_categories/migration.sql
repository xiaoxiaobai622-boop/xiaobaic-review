-- Additive: old rows keep an empty category list and fall back to product-updates in the UI/API.
ALTER TABLE "PlatformAnnouncement"
ADD COLUMN "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
