CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'REVIEW',
    "scopeType" TEXT NOT NULL DEFAULT 'PROJECT',
    "scopeId" TEXT,
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY['view', 'comment'],
    "authMode" TEXT NOT NULL DEFAULT 'PASSWORD',
    "sharePassword" TEXT,
    "expiresAt" TIMESTAMP(3),
    "maxViews" INTEGER,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");
CREATE INDEX "ShareLink_projectId_status_idx" ON "ShareLink"("projectId", "status");
CREATE INDEX "ShareLink_projectId_createdAt_idx" ON "ShareLink"("projectId", "createdAt");
CREATE INDEX "ShareLink_expiresAt_idx" ON "ShareLink"("expiresAt");
CREATE INDEX "ShareLink_scopeType_scopeId_idx" ON "ShareLink"("scopeType", "scopeId");

ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
