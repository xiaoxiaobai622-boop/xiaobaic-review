-- CreateEnum
CREATE TYPE "SupportConversationStatus" AS ENUM ('OPEN', 'PENDING', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportMessageSenderType" AS ENUM ('VISITOR', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SupportMessageVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- CreateEnum
CREATE TYPE "SupportMessageKind" AS ENUM ('TEXT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SupportParticipantRole" AS ENUM ('VISITOR', 'AGENT');

-- CreateTable
CREATE TABLE "SupportVisitor" (
    "id" TEXT NOT NULL,
    "sessionHash" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'zh',
    "ipHash" TEXT,
    "userAgentHash" TEXT,
    "consentAt" TIMESTAMP(3),
    "consentVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportVisitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportConversation" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "userId" TEXT,
    "teamId" TEXT,
    "projectId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "pagePath" TEXT,
    "referrerHost" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'zh',
    "status" "SupportConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "priority" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessagePreview" TEXT,
    "lastMessageSenderType" "SupportMessageSenderType",
    "unreadForAgent" INTEGER NOT NULL DEFAULT 0,
    "unreadForVisitor" INTEGER NOT NULL DEFAULT 0,
    "firstVisitorMessageAt" TIMESTAMP(3),
    "firstAgentReplyAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedByType" TEXT,
    "closedById" TEXT,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "csatScore" INTEGER,
    "csatComment" TEXT,
    "csatAt" TIMESTAMP(3),
    "retentionUntil" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportParticipant" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "principalKey" TEXT NOT NULL,
    "role" "SupportParticipantRole" NOT NULL,
    "visitorId" TEXT,
    "userId" TEXT,
    "lastReadSeq" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveredSeq" INTEGER NOT NULL DEFAULT 0,
    "lastTypingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "senderType" "SupportMessageSenderType" NOT NULL,
    "senderId" TEXT,
    "clientId" TEXT,
    "body" TEXT NOT NULL,
    "visibility" "SupportMessageVisibility" NOT NULL DEFAULT 'PUBLIC',
    "kind" "SupportMessageKind" NOT NULL DEFAULT 'TEXT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportEvent" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "metadata" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportCannedResponse" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'zh',
    "shortcut" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportCannedResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "businessHours" JSONB NOT NULL DEFAULT '{}',
    "offlineMessage" JSONB NOT NULL DEFAULT '{}',
    "firstResponseTargetMinutes" INTEGER NOT NULL DEFAULT 15,
    "retentionDays" INTEGER NOT NULL DEFAULT 180,
    "csatEnabled" BOOLEAN NOT NULL DEFAULT true,
    "fallbackContacts" JSONB NOT NULL DEFAULT '{}',
    "quietHours" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportNotification" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportVisitor_sessionHash_key" ON "SupportVisitor"("sessionHash");

-- CreateIndex
CREATE INDEX "SupportVisitor_userId_idx" ON "SupportVisitor"("userId");

-- CreateIndex
CREATE INDEX "SupportVisitor_lastSeenAt_idx" ON "SupportVisitor"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportConversation_publicId_key" ON "SupportConversation"("publicId");

-- CreateIndex
CREATE INDEX "SupportConversation_status_lastMessageAt_idx" ON "SupportConversation"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportConversation_assigneeId_status_idx" ON "SupportConversation"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "SupportConversation_visitorId_createdAt_idx" ON "SupportConversation"("visitorId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportConversation_userId_idx" ON "SupportConversation"("userId");

-- CreateIndex
CREATE INDEX "SupportConversation_teamId_idx" ON "SupportConversation"("teamId");

-- CreateIndex
CREATE INDEX "SupportConversation_projectId_idx" ON "SupportConversation"("projectId");

-- CreateIndex
CREATE INDEX "SupportConversation_lastMessageAt_idx" ON "SupportConversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportConversation_retentionUntil_idx" ON "SupportConversation"("retentionUntil");

-- CreateIndex
CREATE INDEX "SupportConversation_deletedAt_idx" ON "SupportConversation"("deletedAt");

-- CreateIndex
CREATE INDEX "SupportConversation_tags_gin" ON "SupportConversation" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "SupportParticipant_conversationId_principalKey_key" ON "SupportParticipant"("conversationId", "principalKey");

-- CreateIndex
CREATE INDEX "SupportParticipant_visitorId_idx" ON "SupportParticipant"("visitorId");

-- CreateIndex
CREATE INDEX "SupportParticipant_userId_idx" ON "SupportParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessage_conversationId_seq_key" ON "SupportMessage"("conversationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessage_conversationId_clientId_key" ON "SupportMessage"("conversationId", "clientId");

-- CreateIndex
CREATE INDEX "SupportMessage_conversationId_createdAt_idx" ON "SupportMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportMessage_conversationId_visibility_seq_idx" ON "SupportMessage"("conversationId", "visibility", "seq");

-- CreateIndex
CREATE INDEX "SupportEvent_conversationId_createdAt_idx" ON "SupportEvent"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportEvent_type_createdAt_idx" ON "SupportEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "SupportCannedResponse_locale_title_idx" ON "SupportCannedResponse"("locale", "title");

-- CreateIndex
CREATE INDEX "SupportCannedResponse_shortcut_idx" ON "SupportCannedResponse"("shortcut");

-- CreateIndex
CREATE UNIQUE INDEX "SupportNotification_messageId_channel_recipientKey_key" ON "SupportNotification"("messageId", "channel", "recipientKey");

-- CreateIndex
CREATE INDEX "SupportNotification_status_createdAt_idx" ON "SupportNotification"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "SupportVisitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportParticipant" ADD CONSTRAINT "SupportParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportEvent" ADD CONSTRAINT "SupportEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportNotification" ADD CONSTRAINT "SupportNotification_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
