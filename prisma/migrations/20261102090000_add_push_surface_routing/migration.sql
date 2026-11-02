-- One device belongs to one surface. The support PWA only receives support
-- messages; the main console keeps its own event list.
ALTER TABLE "PushSubscription" ADD COLUMN "surface" TEXT NOT NULL DEFAULT 'main';

CREATE INDEX "PushSubscription_surface_idx" ON "PushSubscription"("surface");

CREATE TABLE "PushDeliveryLog" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "userId" TEXT,
    "deviceName" TEXT,
    "eventType" TEXT NOT NULL,
    "surface" TEXT,
    "projectId" TEXT,
    "teamId" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "statusCode" INTEGER,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDeliveryLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PushDeliveryLog_eventType_sentAt_idx" ON "PushDeliveryLog"("eventType", "sentAt");
CREATE INDEX "PushDeliveryLog_subscriptionId_sentAt_idx" ON "PushDeliveryLog"("subscriptionId", "sentAt");
CREATE INDEX "PushDeliveryLog_success_sentAt_idx" ON "PushDeliveryLog"("success", "sentAt");

-- Historical rows created from the support entry were named 运营 PWA and
-- defaulted to every event. Backfill only those rows; other devices stay as-is.
UPDATE "PushSubscription"
SET "surface" = 'support',
    "subscribedEvents" = ARRAY['SUPPORT_NEW_MESSAGE']
WHERE "deviceName" = '运营 PWA';
