-- Folders need to nest the way they do on a computer (client folder → year folder).
-- Name uniqueness therefore moves from "per team" to "per sibling set", which needs
-- partial indexes: NULL never compares equal in a plain unique index, so roots would
-- otherwise be allowed to collide.
ALTER TABLE "ProjectGroup" ADD COLUMN "parentId" TEXT;

CREATE INDEX "ProjectGroup_teamId_parentId_idx" ON "ProjectGroup"("teamId", "parentId");
CREATE INDEX "ProjectGroup_parentId_idx" ON "ProjectGroup"("parentId");

ALTER TABLE "ProjectGroup" ADD CONSTRAINT "ProjectGroup_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "ProjectGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "ProjectGroup_teamId_name_key";

CREATE UNIQUE INDEX "ProjectGroup_teamId_name_key"
    ON "ProjectGroup"("teamId", "name") WHERE "parentId" IS NULL;

CREATE UNIQUE INDEX "ProjectGroup_teamId_parentId_name_key"
    ON "ProjectGroup"("teamId", "parentId", "name") WHERE "parentId" IS NOT NULL;
