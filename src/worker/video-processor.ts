import { Job } from 'bullmq'
import { VideoProcessingJob } from '../lib/queue'
import { logMessage } from '../lib/logging'
import { isMpsEnabled, submitMpsHls, waitForMpsHls } from '../lib/tencent-mps'
import { prisma } from '../lib/db'
import {
  TempFiles,
  downloadAndValidateVideo,
  fetchProcessingSettings,
  calculateOutputDimensions,
  processPreview,
  processThumbnail,
  finalizeVideo,
  updateVideoStatus,
  cleanupTempFiles,
  handleProcessingError,
  debugLog
} from './video-processor-helpers'

export async function processVideo(job: Job<VideoProcessingJob>) {
  const { videoId, originalStoragePath, projectId } = job.data

  logMessage(`[WORKER] Processing video ${videoId}`)

  debugLog('Job data:', job.data)
  debugLog('Job ID:', job.id)
  debugLog('Job timestamp:', new Date(job.timestamp).toISOString())

  const tempFiles: TempFiles = {}
  const processingStart = Date.now()

  try {
    // May already be PROCESSING from TUS handler
    logMessage(`[WORKER] Setting video ${videoId} to PROCESSING status (if not already)`)
    await updateVideoStatus(videoId, 'PROCESSING', 0)

    const videoInfo = await downloadAndValidateVideo(videoId, originalStoragePath, tempFiles)

    const settings = await fetchProcessingSettings(projectId, videoId)
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { teamId: true } })
    if (!project) throw new Error(`Project ${projectId} not found`)

    // New uploads use Tencent MPS for HLS. The existing MP4/FFmpeg path remains
    // the fallback so older deployments and transient MPS failures stay usable.
    if (isMpsEnabled()) {
      try {
        logMessage(`[WORKER] Submitting video ${videoId} to Tencent MPS`)
        await prisma.video.update({ where: { id: videoId }, data: { mpsStatus: 'SUBMITTING', mpsError: null } })
        const taskId = await submitMpsHls(originalStoragePath, videoId, project.teamId, projectId)
        await prisma.video.update({ where: { id: videoId }, data: { mpsTaskId: taskId, mpsStatus: 'PROCESSING' } })
        const result = await waitForMpsHls(taskId)
        await prisma.video.update({
          where: { id: videoId },
          data: { mpsStatus: 'READY', hlsPath: result.hlsPath, mpsError: null, status: 'READY', processingProgress: 100 },
        })
        logMessage(`[WORKER] Tencent MPS HLS ready for video ${videoId}: ${result.hlsPath}`)

        // Keep thumbnails and metadata local; only the video rendition moves to MPS.
        const thumbnailPath = await processThumbnail(videoId, projectId, project.teamId, videoInfo.path, videoInfo.metadata.duration, tempFiles)
        await prisma.video.update({
          where: { id: videoId },
          data: { thumbnailPath, duration: videoInfo.metadata.duration, width: videoInfo.metadata.width, height: videoInfo.metadata.height, fps: videoInfo.metadata.fps, codec: videoInfo.metadata.codec },
        })
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await prisma.video.update({ where: { id: videoId }, data: { mpsStatus: 'ERROR', mpsError: message } })
        logMessage(`[WORKER] Tencent MPS failed for ${videoId}; falling back to local MP4 processing: ${message}`)
      }
    }

    if (settings.skipTranscoding) {
      logMessage(`[WORKER] Ignoring skipTranscoding for video ${videoId}; originals are download-only`)
    }

    const previewPaths: Partial<Record<'720p' | '1080p', string>> = {}
    const targetResolutions: Array<'720p' | '1080p'> = ['720p']
    const wants1080 = settings.resolution === '1080p' || settings.resolution === '2160p'
    const sourceSupports1080 = videoInfo.metadata.height > videoInfo.metadata.width
      ? videoInfo.metadata.width >= 1080
      : videoInfo.metadata.height >= 1080
    if (wants1080 && sourceSupports1080) targetResolutions.push('1080p')

    for (const resolution of targetResolutions) {
      const dimensions = calculateOutputDimensions(videoInfo.metadata, resolution)
      previewPaths[resolution] = await processPreview(
        videoId,
        projectId,
        project.teamId,
        videoInfo.path,
        dimensions,
        settings,
        tempFiles,
        videoInfo.metadata.duration,
        resolution
      )
    }

    const thumbnailPath = await processThumbnail(
      videoId,
      projectId,
      project.teamId,
      videoInfo.path,
        videoInfo.metadata.duration,
        tempFiles
      )

    await finalizeVideo(
        videoId,
        previewPaths,
        thumbnailPath,
        videoInfo.metadata
      )

    const totalTime = Date.now() - processingStart
    logMessage(`[WORKER] Successfully processed video ${videoId} in ${(totalTime / 1000).toFixed(2)}s`)

  } catch (error) {
    await handleProcessingError(videoId, error)
    throw error

  } finally {
    // Always cleanup temp files (success or failure)
    await cleanupTempFiles(tempFiles)
  }
}
