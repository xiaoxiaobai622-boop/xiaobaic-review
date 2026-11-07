import { prisma } from '../lib/db'
import { getRedis } from '../lib/redis'
import { logError, logMessage } from '../lib/logging'
import { sendClientUploadChannels } from '../lib/upload-notifications'
import type { ClientUploadBatchItem } from '../lib/in-app-notifications/upload-batch'

function parseItem(raw: string): ClientUploadBatchItem | null {
  try {
    const value = JSON.parse(raw) as ClientUploadBatchItem
    if (!value?.projectId || !value?.fileName) return null
    return value
  } catch {
    return null
  }
}

export async function processUploadNotificationBatch(batchKey: string): Promise<void> {
  const redis = getRedis()
  const rawItems = await redis.lrange(batchKey, 0, -1)
  if (rawItems.length === 0) return

  const items = rawItems.map(parseItem).filter((item): item is ClientUploadBatchItem => Boolean(item))
  if (items.length === 0) {
    await redis.del(batchKey)
    return
  }

  const first = items[0]
  const project = await prisma.project.findUnique({
    where: { id: first.projectId },
    select: { id: true, title: true, slug: true, teamId: true },
  })
  if (!project) {
    await redis.del(batchKey)
    logMessage(`[UPLOAD-NOTIFICATION] Batch ${batchKey} skipped — project not found`)
    return
  }

  const fileNames = Array.from(new Set(items.map((item) => item.fileName)))
  try {
    await sendClientUploadChannels({
      project,
      fileNames,
      uploaderName: first.uploaderName,
      uploaderEmail: first.uploaderEmail,
    })
    await redis.del(batchKey)
    logMessage(`[UPLOAD-NOTIFICATION] Batch ${batchKey} sent (${fileNames.length} file(s))`)
  } catch (error) {
    // Leave the Redis list in place so BullMQ's retry can try again.
    logError(`[UPLOAD-NOTIFICATION] Batch ${batchKey} failed`, error)
    throw error
  }
}
