-- DropForeignKey
ALTER TABLE "ProjectUpload" DROP CONSTRAINT "ProjectUpload_projectId_fkey";

-- DropIndex
DROP INDEX "Project_dueDate_idx";

-- DropIndex
DROP INDEX "Video_mpsTaskId_idx";

-- DropIndex
DROP INDEX "Video_projectId_status_idx";

-- DropIndex
DROP INDEX "Video_status_idx";

-- AlterTable
ALTER TABLE "EmailTemplate" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PasskeyCredential" ALTER COLUMN "transports" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "clientNotificationSchedule" SET DEFAULT 'HOURLY';

-- AlterTable
ALTER TABLE "ProjectUpload" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PushSubscription" ALTER COLUMN "subscribedEvents" SET DEFAULT ARRAY['SHARE_ACCESS', 'ADMIN_ACCESS', 'CLIENT_COMMENT', 'VIDEO_APPROVAL', 'CLIENT_UPLOAD', 'SECURITY_ALERT']::TEXT[];

-- AlterTable
ALTER TABLE "SecuritySettings" ALTER COLUMN "ipRateLimit" SET DEFAULT 1000,
ALTER COLUMN "sessionRateLimit" SET DEFAULT 600;

-- AlterTable
ALTER TABLE "Settings" ALTER COLUMN "adminNotificationSchedule" SET DEFAULT 'HOURLY';

-- AlterTable
ALTER TABLE "Video" ALTER COLUMN "name" DROP DEFAULT;

-- CreateTable
CREATE TABLE "RecycleBinItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "metadata" JSONB,
    "paths" JSONB NOT NULL,
    "directories" JSONB NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecycleBinItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecycleBinItem_projectId_deletedAt_idx" ON "RecycleBinItem"("projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "RecycleBinItem_expiresAt_idx" ON "RecycleBinItem"("expiresAt");

-- AddForeignKey
ALTER TABLE "ProjectUpload" ADD CONSTRAINT "ProjectUpload_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecycleBinItem" ADD CONSTRAINT "RecycleBinItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
