ALTER TABLE "SecuritySettings"
  ALTER COLUMN "adminSessionTimeoutValue" SET DEFAULT 7,
  ALTER COLUMN "adminSessionTimeoutUnit" SET DEFAULT 'DAYS';

UPDATE "SecuritySettings"
SET "adminSessionTimeoutValue" = 7,
    "adminSessionTimeoutUnit" = 'DAYS'
WHERE "id" = 'default'
  AND "adminSessionTimeoutValue" = 15
  AND "adminSessionTimeoutUnit" = 'MINUTES';
