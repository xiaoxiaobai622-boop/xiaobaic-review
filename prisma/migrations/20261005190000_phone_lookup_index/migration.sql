-- Phone numbers are personal data that must stop living in cleartext. Equality lookups
-- (login by phone, "this number is already bound", recipient portals) cannot run against an
-- AES-GCM ciphertext, so the searchable form moves to a keyed digest first. The plaintext
-- column is dropped by a later migration once every row has been backfilled and rewritten.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phoneHash" TEXT;

-- AlterTable
ALTER TABLE "TeamInvite" ADD COLUMN     "phoneHash" TEXT;

-- AlterTable
ALTER TABLE "ProjectRecipient" ADD COLUMN     "phoneHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");

-- CreateIndex
CREATE INDEX "ProjectRecipient_projectId_phoneHash_idx" ON "ProjectRecipient"("projectId", "phoneHash");

-- Backfill is applied by scripts/backfill-phone-hashes.mts before this index is relied on;
-- NULLs do not collide, so rows that have no phone stay untouched.
