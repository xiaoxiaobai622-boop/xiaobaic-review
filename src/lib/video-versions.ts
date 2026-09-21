import type { PrismaClient } from '@prisma/client'
import { INCLUDE_DELETED } from './db'

type Db = Pick<PrismaClient, 'video'>

/**
 * The highest version number ever allocated for a video group, recycle bin
 * included. `(projectId, name, version)` is unique at the database level and a
 * tombstone keeps its slot for the whole retention window, so allocating from the
 * live rows only would collide with a video that is merely sitting in the bin.
 */
export async function latestAllocatedVideoVersion(db: Db, projectId: string, name: string) {
  const latest = await db.video.findFirst({
    where: { projectId, name, deletedAt: INCLUDE_DELETED },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  return latest?.version ?? 0
}

/**
 * True when renaming these videos to `name` would drop one of them onto a
 * `(projectId, name, version)` slot that somebody else already holds. Tombstones
 * count, same as above, so a name can stay blocked while the old video sits in the
 * recycle bin. Callers still have to handle the unique violation itself: this check
 * is a friendly 409, the index is the guarantee.
 */
export async function videoNameSlotTaken(
  db: Db,
  name: string,
  targets: Array<{ projectId: string; version: number; videoId: string }>,
) {
  if (targets.length === 0) return false
  const occupied = await db.video.findMany({
    where: {
      deletedAt: INCLUDE_DELETED,
      name,
      NOT: { id: { in: targets.map((target) => target.videoId) } },
      OR: targets.map((target) => ({ projectId: target.projectId, version: target.version })),
    },
    select: { id: true },
  })
  return occupied.length > 0
}
