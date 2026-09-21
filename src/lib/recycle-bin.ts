import { prisma, INCLUDE_DELETED } from './db'
import type { Prisma, PrismaClient } from '@prisma/client'
import { deleteDirectory, deleteFile } from './storage'
import { directoryStillUsed, stillReferencedPaths } from './video-storage-paths'
import { recomputeProjectApprovalStatus } from './project-approval'
import { logError } from './logging'

export const RECYCLE_BIN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

type RecyclePayload = {
  itemType: string
  itemName: string
  metadata?: Record<string, unknown>
  paths?: string[]
  directories?: string[]
}

export async function createRecycleBinItem(
  db: PrismaClient | Prisma.TransactionClient,
  projectId: string,
  payload: RecyclePayload,
) {
  const now = new Date()
  return db.recycleBinItem.create({
    data: {
      projectId,
      itemType: payload.itemType,
      itemName: payload.itemName,
      metadata: payload.metadata as any,
      paths: [...new Set(payload.paths || [])],
      directories: [...new Set(payload.directories || [])],
      deletedAt: now,
      expiresAt: new Date(now.getTime() + RECYCLE_BIN_RETENTION_MS),
    },
  })
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/**
 * Objects are removed before the row so a failing COS call leaves both behind and
 * the next purge pass retries, instead of losing the video and leaking its files.
 *
 * A VIDEO record lists every object its row named, including ones a co-owner still
 * claims, so ownership is settled here where the surviving rows are known: files
 * another row points at stay, and go with that row's own purge instead.
 */
export async function permanentlyDeleteRecycleBinItem(itemId: string, projectId?: string) {
  const item = await prisma.recycleBinItem.findFirst({ where: { id: itemId, ...(projectId ? { projectId } : {}) } })
  if (!item) return false
  const videoId = videoIdOf(item)
  const paths = stringArray(item.paths)
  const keptByOthers = videoId ? await stillReferencedPaths(prisma, paths, [videoId]) : new Set<string>()
  for (const filePath of paths) {
    if (!keptByOthers.has(filePath)) await deleteFile(filePath)
  }
  for (const directory of stringArray(item.directories)) {
    if (videoId && (await directoryStillUsed(prisma, directory, videoId))) continue
    await deleteDirectory(directory)
  }
  await prisma.$transaction(async (tx) => {
    // The retention window is over: now the row goes, and with it the comments,
    // assets and analytics that a recycle-bin delete used to destroy up front.
    if (videoId) await tx.video.deleteMany({ where: { id: videoId } })
    await tx.recycleBinItem.delete({ where: { id: item.id } })
  })
  if (videoId) await recomputeProjectApprovalStatus(item.projectId)
  return true
}

type RecycleItem = { itemType: string; metadata: Prisma.JsonValue }

function videoIdOf(item: RecycleItem) {
  if (item.itemType !== 'VIDEO') return null
  const metadata = item.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const videoId = (metadata as Record<string, unknown>).videoId
  return typeof videoId === 'string' ? videoId : null
}

export type RestoreOutcome =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' | 'UNSUPPORTED' | 'ALREADY_GONE' }

/**
 * Undoing a delete is only possible while the item is in the bin: the row and its
 * comments are still there and no storage has been reclaimed.
 */
export async function restoreRecycleBinItem(itemId: string, projectId: string): Promise<RestoreOutcome> {
  const item = await prisma.recycleBinItem.findFirst({ where: { id: itemId, projectId } })
  if (!item) return { ok: false, reason: 'NOT_FOUND' }
  const videoId = videoIdOf(item)
  if (!videoId) return { ok: false, reason: 'UNSUPPORTED' }

  const video = await prisma.video.findUnique({
    where: { id: videoId, deletedAt: INCLUDE_DELETED },
    select: { id: true, deletedAt: true },
  })
  if (!video || !video.deletedAt) return { ok: false, reason: 'ALREADY_GONE' }

  await prisma.$transaction(async (tx) => {
    await tx.video.update({ where: { id: videoId }, data: { deletedAt: null } })
    await tx.recycleBinItem.delete({ where: { id: item.id } })
  })
  // Restoring an approved version can complete a group again, so the project flag
  // moves both ways across the recycle bin, not just on the way in.
  await recomputeProjectApprovalStatus(projectId)
  return { ok: true }
}

export async function purgeExpiredRecycleBinItems() {
  const items = await prisma.recycleBinItem.findMany({
    where: { expiresAt: { lte: new Date() } },
    select: { id: true },
  })
  let purged = 0
  for (const item of items) {
    try {
      if (await permanentlyDeleteRecycleBinItem(item.id)) purged++
    } catch (error) {
      logError(`[RECYCLE_BIN] Failed to purge item ${item.id}`, error)
    }
  }
  return purged
}
