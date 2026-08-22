import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from './db'
import { deleteDirectory, deleteFile } from './storage'
import { getAssetQueue, getPhotoQueue, getProjectUploadQueue, getVideoQueue } from './queue'
import { logError } from './logging'

type DbClient = PrismaClient | Prisma.TransactionClient

export type DurableTaskKind =
  | 'PROCESS_VIDEO'
  | 'PROCESS_ASSET'
  | 'PROCESS_PROJECT_UPLOAD'
  | 'PROCESS_PHOTO'
  | 'DELETE_STORAGE'

export async function recordDurableTask(
  db: DbClient,
  kind: DurableTaskKind,
  dedupeKey: string,
  payload: Prisma.InputJsonValue,
) {
  return db.durableTask.upsert({
    where: { dedupeKey },
    create: { kind, dedupeKey, payload },
    update: { kind, payload, availableAt: new Date(), lastError: null },
  })
}

export async function dispatchDurableTask(taskId: string): Promise<boolean> {
  const task = await prisma.durableTask.findUnique({ where: { id: taskId } })
  if (!task) return true

  const payload = task.payload as Record<string, unknown>
  try {
    if (task.kind === 'PROCESS_VIDEO') {
      await getVideoQueue().add('process-video', payload as any, { jobId: task.id })
    } else if (task.kind === 'PROCESS_ASSET') {
      await getAssetQueue().add('process-asset', payload as any, { jobId: task.id })
    } else if (task.kind === 'PROCESS_PROJECT_UPLOAD') {
      await getProjectUploadQueue().add('process-upload', payload as any, { jobId: task.id })
    } else if (task.kind === 'PROCESS_PHOTO') {
      await getPhotoQueue().add('process-photo', payload as any, { jobId: task.id })
    } else if (task.kind === 'DELETE_STORAGE') {
      const paths = Array.isArray(payload.paths) ? payload.paths.filter((value): value is string => typeof value === 'string') : []
      const directories = Array.isArray(payload.directories) ? payload.directories.filter((value): value is string => typeof value === 'string') : []
      for (const path of paths) await deleteFile(path)
      for (const directory of directories) await deleteDirectory(directory)
    } else {
      throw new Error(`Unsupported durable task kind: ${task.kind}`)
    }

    await prisma.durableTask.delete({ where: { id: task.id } }).catch(() => undefined)
    return true
  } catch (error) {
    const attempts = task.attempts + 1
    const delayMs = Math.min(60 * 60 * 1000, 2 ** Math.min(attempts, 10) * 1000)
    await prisma.durableTask.update({
      where: { id: task.id },
      data: {
        attempts,
        availableAt: new Date(Date.now() + delayMs),
        lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown task error',
      },
    }).catch(() => undefined)
    logError(`[DURABLE_TASK] Dispatch failed (${task.kind}, ${task.id})`, error)
    return false
  }
}

export async function dispatchPendingDurableTasks(limit = 100) {
  const tasks = await prisma.durableTask.findMany({
    where: { availableAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  })
  for (const task of tasks) await dispatchDurableTask(task.id)
}
