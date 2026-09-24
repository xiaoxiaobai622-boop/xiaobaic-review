-- Admins needed a way to file projects themselves: the console only offered
-- status/client/year/due filters, so a team with ~50 projects had no grouping.
-- One nullable column keeps a project in at most one folder; dropping the
-- folder returns its projects to "未归类" instead of taking the projects with it.
CREATE TABLE "ProjectGroup" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectGroup_teamId_name_key" ON "ProjectGroup"("teamId", "name");

CREATE INDEX "ProjectGroup_teamId_idx" ON "ProjectGroup"("teamId");

ALTER TABLE "Project" ADD COLUMN "groupId" TEXT;

CREATE INDEX "Project_groupId_idx" ON "Project"("groupId");

ALTER TABLE "Project" ADD CONSTRAINT "Project_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "ProjectGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectGroup" ADD CONSTRAINT "ProjectGroup_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
