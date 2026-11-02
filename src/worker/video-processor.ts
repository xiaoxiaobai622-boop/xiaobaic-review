import { Job } from 'bullmq'
import { VideoProcessingJob } from '../lib/queue'
import { logMessage } from '../lib/logging'
import { isMpsEnabled, submitMpsHls, waitForMpsHls, submitMpsSourceQuality, waitForMpsSourceQuality, sourceQualityTemplateId } from '../lib/tencent-mps'
import { isCdnPrefetchEnabled, prefetchHlsRendition } from '../lib/tencent-cdn'
import { s3GetObjectSize } from '../lib/s3-storage'
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
  processSourceQuality,
  sourceQualityUnsupportedReason,
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

    const settings = await fetchProcessingSettings(projectId)
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { teamId: true } })
    if (!project) throw new Error(`Project ${projectId} not found`)

    const sourceQualityUnsupported = settings.sourceQualityEnabled && !settings.watermarkEnabled && !settings.applyLut
      ? sourceQualityUnsupportedReason(videoInfo.metadata)
      : null
    if (sourceQualityUnsupported) {
      await prisma.video.update({
        where: { id: videoId },
        data: {
          sourceQualityPath: null,
          sourceQualityBytes: null,
          sourceQualityError: sourceQualityUnsupported,
        },
      })
      logMessage(`[WORKER] Source-quality skipped for ${videoId}: ${sourceQualityUnsupported}`)
    }

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

        // A prefetch rejection says nothing about the transcode, so it is contained
        // here rather than allowed to reach the catch below — that would mark the
        // video ERROR and re-run it through the local FFmpeg path.
        if (isCdnPrefetchEnabled()) {
          try {
            const prefetched = await prefetchHlsRendition(result.hlsPath)
            logMessage(`[WORKER] CDN prefetch for ${videoId}: ${prefetched.submitted} urls submitted`
              + `${prefetched.skipped ? `, ${prefetched.skipped} left for the next day` : ''}`)
          } catch (error) {
            logMessage(`[WORKER] CDN prefetch skipped for ${videoId}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }

        // Keep thumbnails and metadata local; only the video rendition moves to MPS.
        // processThumbnail never throws, so a cover the extractor cannot produce
        // degrades to "no new thumbnail" instead of being mistaken for an MPS failure.
        const thumbnailPath = await processThumbnail(videoId, projectId, project.teamId, videoInfo.path, videoInfo.metadata.duration, tempFiles)
        await prisma.video.update({
          where: { id: videoId },
          data: {
            ...(thumbnailPath ? { thumbnailPath } : {}),
            duration: videoInfo.metadata.duration,
            width: videoInfo.metadata.width,
            height: videoInfo.metadata.height,
            fps: videoInfo.metadata.fps,
            codec: videoInfo.metadata.codec,
          },
        })

        if (settings.sourceQualityEnabled && !settings.watermarkEnabled && !settings.applyLut && !sourceQualityUnsupported) {
          const templateId = sourceQualityTemplateId(videoInfo.metadata.width, videoInfo.metadata.height)
          if (!templateId) {
            await prisma.video.update({
              where: { id: videoId },
              data: { sourceQualityError: 'source-quality template not configured' },
            })
            logMessage(`[WORKER] Source-quality skipped for ${videoId}: no MPS template configured`)
          } else {
            try {
              const sourceTask = await submitMpsSourceQuality(
                originalStoragePath,
                videoId,
                videoInfo.metadata.width,
                videoInfo.metadata.height,
                project.teamId,
                projectId,
              )
              if (sourceTask) {
                const sourceQualityPath = await waitForMpsSourceQuality(sourceTask.taskId)
                if (sourceQualityPath) {
                  const sourceQualityBytes = await s3GetObjectSize(sourceQualityPath).catch(() => null)
                  await prisma.video.update({
                    where: { id: videoId },
                    data: {
                      sourceQualityPath,
                      sourceQualityBytes: sourceQualityBytes ? BigInt(sourceQualityBytes) : null,
                      sourceQualityError: null,
                    },
                  })
                  logMessage(`[WORKER] Tencent MPS source-quality ready for ${videoId}: ${sourceQualityPath}`)
                } else {
                  await prisma.video.update({
                    where: { id: videoId },
                    data: { sourceQualityError: 'source-quality output missing' },
                  })
                }
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              await prisma.video.update({
                where: { id: videoId },
                data: { sourceQualityError: message.slice(0, 500) },
              })
              logMessage(`[WORKER] Source-quality failed for ${videoId} (non-fatal): ${message}`)
            }
          }
        }

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

    if (settings.sourceQualityEnabled && !settings.watermarkEnabled && !settings.applyLut && !sourceQualityUnsupported) {
      try {
        const sourceQuality = await processSourceQuality(
          videoId,
          projectId,
          project.teamId,
          videoInfo.path,
          videoInfo.metadata,
          tempFiles,
        )
        await prisma.video.update({
          where: { id: videoId },
          data: {
            sourceQualityPath: sourceQuality.path,
            sourceQualityBytes: sourceQuality.bytes,
            sourceQualityError: null,
          },
        })
        logMessage(`[WORKER] Source-quality proxy ready for ${videoId}: ${sourceQuality.path}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await prisma.video.update({
          where: { id: videoId },
          data: { sourceQualityError: message.slice(0, 500) },
        })
        logMessage(`[WORKER] Source-quality failed for ${videoId} (non-fatal): ${message}`)
      }
    }

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
