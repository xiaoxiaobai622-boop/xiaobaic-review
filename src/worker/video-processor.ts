import { Job } from 'bullmq'
import { VideoProcessingJob } from '../lib/queue'
import { logMessage } from '../lib/logging'
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
