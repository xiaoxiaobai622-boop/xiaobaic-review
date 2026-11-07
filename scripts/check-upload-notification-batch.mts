import 'dotenv/config'
import assert from 'node:assert/strict'
import { getRedis } from '../src/lib/redis'
import { getUploadNotificationBatchQueue } from '../src/lib/queue'
import { scheduleClientUploadBatch } from '../src/lib/in-app-notifications/upload-batch'

const suffix = `${Date.now()}`.slice(-8)
const projectId = `gate0-batch-${suffix}`
const batchKey = `upload_batch:${projectId}:gate0-client-${suffix}@example.test`

async function main() {
  const redis = getRedis()
  const queue = getUploadNotificationBatchQueue()

  await redis.del(batchKey)
  await scheduleClientUploadBatch({
    projectId,
    fileName: 'a.mp4',
    uploaderName: 'Gate0 Client',
    uploaderEmail: `gate0-client-${suffix}@example.test`,
    uploadId: `upload-a-${suffix}`,
  })
  await scheduleClientUploadBatch({
    projectId,
    fileName: 'b.mp4',
    uploaderName: 'Gate0 Client',
    uploaderEmail: `gate0-client-${suffix}@example.test`,
    uploadId: `upload-b-${suffix}`,
  })

  const buffered = await redis.llen(batchKey)
  assert.equal(buffered, 2, 'two files must share one Redis batch')

  const delayed = await queue.getDelayed()
  const matching = delayed.filter((job) => job.data?.batchKey === batchKey)
  assert.equal(matching.length, 1, 'two files must leave one delayed summary job')

  await redis.del(batchKey)
  await matching[0]?.remove()
  await queue.close()
  await redis.quit()
  console.log(JSON.stringify({ ok: true, buffered, delayedJobs: matching.length }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    process.exit(process.exitCode || 0)
  })
