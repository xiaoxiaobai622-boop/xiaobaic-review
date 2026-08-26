CREATE TABLE "ProjectFolder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFolder_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Video" ADD COLUMN "folderId" TEXT;

CREATE UNIQUE INDEX "ProjectFolder_projectId_name_key" ON "ProjectFolder"("projectId", "name");
CREATE INDEX "ProjectFolder_projectId_idx" ON "ProjectFolder"("projectId");
CREATE INDEX "Video_folderId_idx" ON "Video"("folderId");

ALTER TABLE "ProjectFolder" ADD CONSTRAINT "ProjectFolder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Video" ADD CONSTRAINT "Video_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "ProjectFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
