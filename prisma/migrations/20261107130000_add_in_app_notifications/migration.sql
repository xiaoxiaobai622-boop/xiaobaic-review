-- CreateTable
CREATE TABLE "UserNotification" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "projectId" TEXT,
    "videoId" TEXT,
    "commentId" TEXT,
    "actorUserId" TEXT,
    "actorName" TEXT,
    "recipientUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "deepLink" TEXT,
    "aggregateKey" TEXT,
    "aggregateCount" INTEGER NOT NULL DEFAULT 1,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotificationEvent" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "notificationId" TEXT,
    "eventType" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "projectId" TEXT,
    "recipientUserId" TEXT NOT NULL,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentMention" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "statusCode" INTEGER,
    "error" TEXT,
    "providerId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserNotification_dedupeKey_key" ON "UserNotification"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotification_recipientUserId_aggregateKey_key" ON "UserNotification"("recipientUserId", "aggregateKey");

-- CreateIndex
CREATE INDEX "UserNotification_recipientUserId_teamId_category_readAt_lastEventAt_idx" ON "UserNotification"("recipientUserId", "teamId", "category", "readAt", "lastEventAt");

-- CreateIndex
CREATE INDEX "UserNotification_teamId_lastEventAt_idx" ON "UserNotification"("teamId", "lastEventAt");

-- CreateIndex
CREATE INDEX "UserNotification_projectId_lastEventAt_idx" ON "UserNotification"("projectId", "lastEventAt");

-- CreateIndex
CREATE INDEX "UserNotification_commentId_idx" ON "UserNotification"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotificationEvent_dedupeKey_key" ON "UserNotificationEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "UserNotificationEvent_recipientUserId_createdAt_idx" ON "UserNotificationEvent"("recipientUserId", "createdAt");

-- CreateIndex
CREATE INDEX "UserNotificationEvent_teamId_createdAt_idx" ON "UserNotificationEvent"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "UserNotificationEvent_notificationId_idx" ON "UserNotificationEvent"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "CommentMention_commentId_userId_key" ON "CommentMention"("commentId", "userId");

-- CreateIndex
CREATE INDEX "CommentMention_userId_idx" ON "CommentMention"("userId");

-- CreateIndex
CREATE INDEX "CommentMention_commentId_idx" ON "CommentMention"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotificationDelivery_notificationId_channel_recipient_key" ON "UserNotificationDelivery"("notificationId", "channel", "recipient");

-- CreateIndex
CREATE INDEX "UserNotificationDelivery_channel_sentAt_idx" ON "UserNotificationDelivery"("channel", "sentAt");

-- CreateIndex
CREATE INDEX "UserNotificationDelivery_success_sentAt_idx" ON "UserNotificationDelivery"("success", "sentAt");

-- AddForeignKey
ALTER TABLE "CommentMention" ADD CONSTRAINT "CommentMention_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
