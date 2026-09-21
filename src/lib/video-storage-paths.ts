import type { Prisma, PrismaClient, Video, VideoAsset } from '@prisma/client'
import { INCLUDE_DELETED } from './db'

/**
 * A stored object can be named by more than one row: a promoted 收录 upload keeps
 * its file as the video's original, and a video in the recycle bin can still be
 * restored. So "may this object go?" is only answerable when the last row that
 * names it is being destroyed, never when one of them is merely deleted. These
 * columns are the single list of places a path can live.
 */
const VIDEO_PATH_COLUMNS = [
  'originalStoragePath',
  'preview2160Path',
  'preview1080Path',
  'preview720Path',
  'hlsPath',
  'cleanPreview2160Path',
  'cleanPreview1080Path',
  'cleanPreview720Path',
  'thumbnailPath',
] as const

type VideoPathColumn = (typeof VIDEO_PATH_COLUMNS)[number]

/** Everything a row points at, co-owners included — reclaim is decided later. */
export function referencedStoragePaths(
  video: Partial<Pick<Video, VideoPathColumn>>,
  assets: Pick<VideoAsset, 'storagePath'>[] = [],
): string[] {
  const columns = VIDEO_PATH_COLUMNS.map((column) => video[column])
    .filter((path): path is string => Boolean(path))
  return [...new Set([...columns, ...assets.map((asset) => asset.storagePath)])]
}

/**
 * The subset of `paths` that at least one other row still names. Tombstoned videos
 * count, because restoring one without its original would hand back a broken entry;
 * `excludingVideoIds` are the rows the caller is destroying right now.
 */
export async function stillReferencedPaths(
  db: PrismaClient | Prisma.TransactionClient,
  paths: string[],
  excludingVideoIds: string[] = [],
): Promise<Set<string>> {
  if (paths.length === 0) return new Set()
  const notThese = excludingVideoIds.length > 0 ? { notIn: excludingVideoIds } : undefined
  const select: Record<VideoPathColumn, true> = {} as Record<VideoPathColumn, true>
  for (const column of VIDEO_PATH_COLUMNS) select[column] = true

  const [videos, assets, uploads] = await Promise.all([
    db.video.findMany({
      where: {
        deletedAt: INCLUDE_DELETED,
        ...(notThese ? { id: notThese } : {}),
        OR: VIDEO_PATH_COLUMNS.map((column) => ({ [column]: { in: paths } })),
      },
      select,
    }),
    db.videoAsset.findMany({
      where: { storagePath: { in: paths }, ...(notThese ? { videoId: notThese } : {}) },
      select: { storagePath: true },
    }),
    // A video delete only unlinks an upload (sourceVideoId is SetNull), so an
    // upload row always survives and always keeps its file alive.
    db.projectUpload.findMany({
      where: { OR: [{ storagePath: { in: paths } }, { thumbnailPath: { in: paths } }] },
      select: { storagePath: true, thumbnailPath: true },
    }),
  ])

  const referenced = new Set<string>()
  for (const row of videos) {
    for (const column of VIDEO_PATH_COLUMNS) {
      const value = row[column]
      if (value) referenced.add(value)
    }
  }
  for (const row of assets) referenced.add(row.storagePath)
  for (const row of uploads) {
    if (row.storagePath) referenced.add(row.storagePath)
    if (row.thumbnailPath) referenced.add(row.thumbnailPath)
  }
  return referenced
}

/**
 * MPS writes the whole HLS package (manifest plus every segment) next to the
 * manifest, so a directory goes only when no other row has a manifest inside it.
 */
export async function directoryStillUsed(
  db: PrismaClient | Prisma.TransactionClient,
  directory: string,
  excludingVideoId?: string,
): Promise<boolean> {
  const count = await db.video.count({
    where: {
      deletedAt: INCLUDE_DELETED,
      ...(excludingVideoId ? { id: { not: excludingVideoId } } : {}),
      hlsPath: { startsWith: `${directory}/` },
    },
  })
  return count > 0
}

export function parentDirectory(path: string | null | undefined): string | null {
  if (!path?.includes('/')) return null
  return path.split('/').slice(0, -1).join('/')
}
