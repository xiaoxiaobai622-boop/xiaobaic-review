-- CreateTable
CREATE TABLE "DocsSsoCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocsSsoCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocsSsoCode_codeHash_key" ON "DocsSsoCode"("codeHash");

-- CreateIndex
CREATE INDEX "DocsSsoCode_expiresAt_idx" ON "DocsSsoCode"("expiresAt");
