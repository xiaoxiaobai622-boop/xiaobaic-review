-- Give every project's own address a real ShareLink row so it can live at the
-- root of the domain (`https://vidx.cn/<code>`) the way a per-link address
-- already does, and so the 项目主链接 row in 分享记录 gains the same expiry,
-- revocation and access records as any created link.
--
-- Only the master row sets `masterOfProjectId`; ordinary links keep it NULL, and
-- Postgres treats NULLs as distinct, so one unique index is the whole
-- "at most one master link per project" rule.
--
-- No backfill INSERT here on purpose: the container runs `prisma migrate deploy`
-- at startup, so a bare INSERT that ever failed would keep the app from booting.
-- The row is created by `ensureProjectMasterLink()` the first time a project's
-- address is needed.
ALTER TABLE "ShareLink" ADD COLUMN IF NOT EXISTS "masterOfProjectId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ShareLink_masterOfProjectId_key" ON "ShareLink"("masterOfProjectId");
