-- Distinguish "the user chose this password" from "the column holds a random placeholder".
-- WeChat mini-program registration and SMS auto-registration both write a randomBytes hash
-- the user never knew; the profile page must offer "set a password" (no current-password
-- field) for those accounts instead of demanding a password nobody has.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "passwordSetAt" TIMESTAMP(3);

-- WeChat placeholder mailboxes are provably random-password accounts: leave them NULL.
-- Everyone else is provisionally marked set at creation time so real password holders keep
-- the current-password check. SMS auto-registered rows (phone.local placeholder mailbox,
-- no username, default name = last 4 phone digits) also carry a random hash, but the phone
-- column is AES-GCM ciphertext, so SQL cannot identify them; scripts/backfill-password-set-at.mts
-- clears those using the app's ENCRYPTION_KEY. Run it right after this migration.
UPDATE "User" SET "passwordSetAt" = "createdAt" WHERE "email" NOT LIKE '%@wechat.local';
