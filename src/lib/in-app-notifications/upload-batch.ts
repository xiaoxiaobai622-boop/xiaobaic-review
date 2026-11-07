import { getRedis } from '@/lib/redis'
import { getUploadNotificationBatchQueue } from '@/lib/queue'
import { logError } from '@/lib/logging'

export interface ClientUploadBatchItem {
  projectId: string
  fileName: string
  uploaderName?: string | null
  uploaderEmail?: string | null
  uploadId?: string | null
  at: string
}

const BATCH_TTL_SECONDS = 60 * 60
// A burst from one uploader is coalesced for one minute before the email/push
// summary leaves. Override with UPLOAD_NOTIFICATION_BATCH_DELAY_MS when an
// operator needs a different window.
const BATCH_DELAY_MS = Number(process.env.UPLOAD_NOTIFICATION_BATCH_DELAY_MS || '60000')

function batchKeyFor(item: ClientUploadBatchItem): string {
  const actor = item.uploaderEmail?.trim().toLowerCase() || item.uploadId || 'client'
  return `upload_batch:${item.projectId}:${actor}`
}

function jobIdFor(batchKey: string): string {
  // BullMQ custom ids cannot contain ':'.
  return `upload-batch_${batchKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

export async function scheduleClientUploadBatch(
  item: Omit<ClientUploadBatchItem, 'at'>,
): Promise<void> {
  const batchKey = batchKeyFor({ ...item, at: new Date().toISOString() })
  const redis = getRedis()
  const payload: ClientUploadBatchItem = { ...item, at: new Date().toISOString() }

  await redis
    .multi()
    .rpush(batchKey, JSON.stringify(payload))
    .expire(batchKey, BATCH_TTL_SECONDS)
    .exec()

  try {
    await getUploadNotificationBatchQueue().add(
      'send',
      { batchKey },
      {
        jobId: jobIdFor(batchKey),
        delay: BATCH_DELAY_MS,
        removeOnComplete: true,
        // Remove a terminally failed job so the next upload can re-schedule the
        // same batch key; the Redis list still holds the files for that retry.
        removeOnFail: true,
      },
    )
  } catch (error) {
    logError('[UPLOAD-NOTIFICATION] Failed to schedule batch', error)
    throw error
  }
}
