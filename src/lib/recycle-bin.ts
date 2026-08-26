import { prisma } from './db'
import type { Prisma, PrismaClient } from '@prisma/client'
import { deleteDirectory, deleteFile } from './storage'
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

export async function permanentlyDeleteRecycleBinItem(itemId: string, projectId?: string) {
  const item = await prisma.recycleBinItem.findFirst({ where: { id: itemId, ...(projectId ? { projectId } : {}) } })
  if (!item) return false
  for (const filePath of stringArray(item.paths)) await deleteFile(filePath)
  for (const directory of stringArray(item.directories)) await deleteDirectory(directory)
  await prisma.recycleBinItem.delete({ where: { id: item.id } })
  return true
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
