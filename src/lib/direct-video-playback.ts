import path from 'path'
import { getVideoMetadata, type VideoMetadata } from './ffmpeg'
import { getVideoProbeSource } from './storage'
import { logError, logMessage } from './logging'

export interface DirectPlaybackProbe {
  compatible: boolean
  metadata?: VideoMetadata
  reason?: string
}

export function isDirectPlayableMp4(fileName: string, metadata: VideoMetadata): boolean {
  const isMp4File = path.extname(fileName).toLowerCase() === '.mp4'
  const isMp4Container = (metadata.format || '').split(',').includes('mp4')
  const hasH264Video = metadata.codec?.toLowerCase() === 'h264'
  const hasCompatibleAudio = (metadata.audioCodecs || [])
    .every((codec) => codec.toLowerCase() === 'aac')

  return isMp4File && isMp4Container && hasH264Video && hasCompatibleAudio
}

export async function probeDirectPlayableMp4(
  input: string,
  fileName: string
): Promise<DirectPlaybackProbe> {
  if (path.extname(fileName).toLowerCase() !== '.mp4') {
    return { compatible: false, reason: 'File is not MP4.' }
  }

  try {
    const metadata = await getVideoMetadata(input)
    const compatible = isDirectPlayableMp4(fileName, metadata)
    return {
      compatible,
      metadata,
      reason: compatible ? undefined : 'MP4 must use H.264 video and AAC audio.',
    }
  } catch (error) {
    logError(`[DIRECT PLAYBACK] Failed to probe ${fileName}:`, error)
    return { compatible: false, reason: 'Media probe failed.' }
  }
}

export async function probeStoredDirectPlayableMp4(
  storagePath: string,
  fileName: string
): Promise<DirectPlaybackProbe> {
  const input = await getVideoProbeSource(storagePath)
  const result = await probeDirectPlayableMp4(input, fileName)
  if (result.compatible) {
    logMessage(`[DIRECT PLAYBACK] ${fileName} is browser-compatible; using the original MP4.`)
  }
  return result
}

export function directPlaybackReadyData(metadata: VideoMetadata) {
  return {
    status: 'READY' as const,
    processingProgress: 100,
    processingError: null,
    duration: metadata.duration,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
    codec: metadata.codec,
  }
}
