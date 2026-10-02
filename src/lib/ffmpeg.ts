import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getCpuAllocation } from './cpu-config'
import { logError, logMessage } from './logging'

// Debug mode - outputs verbose FFmpeg logs
// Enable with: DEBUG_WORKER=true environment variable
const DEBUG = process.env.DEBUG_WORKER === 'true'

// Use system-installed ffmpeg (installed via apk in Dockerfile)
const ffmpegPath = 'ffmpeg'
const ffprobePath = 'ffprobe'

// Idle bounds measured locally: ffprobe of a 15 MB clip stays silent for 0.01-0.03 s
// total, a transcode's stderr gap peaks at 500 ms, and a 10-minute waveform render is
// quiet for 0.21 s. A ffprobe pointed at an unresponsive HTTP input goes permanently
// silent after 23 ms and never exits, so silence is the stall signal. The bounds sit
// ~300x and ~240x above the busiest healthy gap and are idle-only: a process that keeps
// producing output is never cut off, however long the real work takes.
const FFPROBE_IDLE_TIMEOUT_MS = 15_000
const FFMPEG_IDLE_TIMEOUT_MS = 120_000

/**
 * Kill a spawned process that stops writing to both pipes. Without it a stalled
 * ffprobe or ffmpeg holds the worker's Promise forever and the job never resolves.
 */
function attachIdleWatchdog(child: ChildProcess, idleMs: number, label: string): void {
  let timer: NodeJS.Timeout | null = null

  const arm = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      logError(`${label} produced no output for ${idleMs / 1000}s, killing it`)
      child.kill('SIGKILL')
    }, idleMs)
  }

  const disarm = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  child.stdout?.on('data', arm)
  child.stderr?.on('data', arm)
  child.once('close', disarm)
  child.once('error', disarm)
  arm()
}

/**
 * Resolve the optional preview LUT across Docker and local development.
 * Production images copy the LUT to /usr/share/ffmpeg, while local macOS
 * development uses the repository root copy. A missing LUT must not make an
 * otherwise valid transcode fail, so callers can safely skip it.
 */
function resolvePreviewLutPath(): string | null {
  const candidates = [
    process.env.PREVIEW_LUT_PATH,
    '/usr/share/ffmpeg/previewlut.cube',
    path.resolve(process.cwd(), 'previewlut.cube'),
    path.resolve(__dirname, '../../previewlut.cube'),
  ].filter((candidate): candidate is string => Boolean(candidate))

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

// 'faster' is the speed/size sweet spot for CRF-based review proxies; FFMPEG_PRESET overrides
const VALID_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']
const FFMPEG_PRESET = VALID_PRESETS.includes(process.env.FFMPEG_PRESET ?? '') ? process.env.FFMPEG_PRESET! : 'faster'

export interface VideoMetadata {
  duration: number
  width: number
  height: number
  fps?: number
  codec?: string
  audioCodecs?: string[]
  format?: string
}

export async function getVideoMetadata(inputPath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'verbose', // Enable verbose logging for debug
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      inputPath
    ]

    if (DEBUG) {
      logMessage('[FFPROBE DEBUG] Executing:', ffprobePath, args.join(' '))
      logMessage('[FFPROBE DEBUG] Input file:', inputPath)
    }

    const ffprobe = spawn(ffprobePath, args)
    attachIdleWatchdog(ffprobe, FFPROBE_IDLE_TIMEOUT_MS, 'ffprobe')
    let stdout = ''
    let stderr = ''

    ffprobe.stdout.on('data', (data) => {
      const text = data.toString()
      stdout += text
      if (DEBUG) {
        logMessage('[FFPROBE STDOUT]', text.trim())
      }
    })

    ffprobe.stderr.on('data', (data) => {
      const text = data.toString()
      stderr += text
      if (DEBUG) {
        logMessage('[FFPROBE STDERR]', text.trim())
      }
    })

    ffprobe.on('close', (code) => {
      if (DEBUG) {
        logMessage('[FFPROBE DEBUG] Process exited with code:', code)
      }

      if (code !== 0) {
        // Extract useful error information from stderr
        const errorLines = stderr.split('\n').filter(line =>
          line.includes('error') ||
          line.includes('Error') ||
          line.includes('Invalid') ||
          line.includes('not found') ||
          line.includes('moov atom')
        )

        const errorMessage = errorLines.length > 0
          ? errorLines.join('; ')
          : stderr || 'Unknown error'

        if (DEBUG) {
          logError('[FFPROBE DEBUG] Error detected:', errorMessage)
        }

        reject(new Error(
          `ffprobe failed with exit code ${code}: ${errorMessage}. ` +
          `This usually indicates a corrupted or incomplete video file.`
        ))
        return
      }

      try {
        const metadata = JSON.parse(stdout)
        const videoStream = metadata.streams.find((s: any) => s.codec_type === 'video')

        if (DEBUG) {
          logMessage('[FFPROBE DEBUG] Parsed metadata:', JSON.stringify(metadata, null, 2))
        }

        if (!videoStream) {
          if (DEBUG) {
            logError('[FFPROBE DEBUG] No video stream found in metadata')
          }
          reject(new Error('No video stream found in file. The file may be audio-only or corrupted.'))
          return
        }

        // Parse frame rate
        let fps: number | undefined
        if (videoStream.r_frame_rate) {
          const [num, den] = videoStream.r_frame_rate.split('/').map(Number)
          fps = den ? num / den : undefined
        }

        const audioCodecs = metadata.streams
          .filter((stream: any) => stream.codec_type === 'audio')
          .map((stream: any) => stream.codec_name)
          .filter((codec: unknown): codec is string => typeof codec === 'string' && codec.length > 0)

        const result = {
          duration: parseFloat(metadata.format.duration) || 0,
          width: videoStream.width || 0,
          height: videoStream.height || 0,
          fps,
          codec: videoStream.codec_name,
          audioCodecs,
          format: metadata.format.format_name,
        }

        if (DEBUG) {
          logMessage('[FFPROBE DEBUG] Extracted video metadata:', result)
        }

        resolve(result)
      } catch (error) {
        if (DEBUG) {
          logError('[FFPROBE DEBUG] Failed to parse output:', error)
        }
        reject(new Error(`Failed to parse ffprobe output: ${error}. Output was: ${stdout.substring(0, 200)}`))
      }
    })

    ffprobe.on('error', (err) => {
      reject(new Error(`Failed to spawn ffprobe: ${err.message}. Is ffprobe installed?`))
    })
  })
}

export interface TranscodeOptions {
  inputPath: string
  outputPath: string
  width: number
  height: number
  quality?: '720p' | '1080p'
  applyLut?: boolean // Apply preview LUT for color-calibrated previews (default: true)
  onProgress?: (progress: number) => void
}

export async function transcodeVideo(options: TranscodeOptions): Promise<void> {
  const {
    inputPath,
    outputPath,
    width,
    height,
    quality = '720p',
    onProgress
  } = options

  if (DEBUG) {
    logMessage('[FFMPEG DEBUG] Starting transcodeVideo with options:', {
      inputPath,
      outputPath,
      width,
      height,
      hasProgressCallback: !!onProgress
    })
  }

  // This coordinates with worker concurrency to prevent CPU overload
  const cpuAllocation = getCpuAllocation()
  const threads = cpuAllocation.threadsPerJob
  const preset = FFMPEG_PRESET

  if (DEBUG) {
    logMessage('[FFMPEG DEBUG] CPU optimization:', {
      totalThreads: cpuAllocation.totalThreads,
      threadsPerJob: threads,
      selectedPreset: preset
    })
  }

  // Get video metadata for duration (needed for progress calculation)
  const metadata = await getVideoMetadata(inputPath)
  const duration = metadata.duration

  if (DEBUG) {
    logMessage('[FFMPEG DEBUG] Input video metadata:', metadata)
  }

  // Build video filters
  const filters: string[] = []

  // Scale video
  filters.push(`scale=${width}:${height}`)

  // Apply preview LUT unless explicitly disabled.
  // Convert to BT.709 limited-range yuv420p first — this matches what a decoded
  // H.264 proxy would look like, which is what the LUT was calibrated against.
  // Then apply the LUT to those normalised values as the very last step.
  if (options.applyLut !== false) {
    filters.push('format=yuv420p')
    const lutPath = resolvePreviewLutPath()
    if (lutPath) {
      // FFmpeg filter syntax treats ':' as a separator; escape it for paths
      // such as Windows drive letters while leaving normal Unix paths intact.
      const escapedLutPath = lutPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:')
      filters.push(`lut3d=${escapedLutPath}`)
    } else {
      logMessage('[FFMPEG] previewlut.cube not found; skipping preview LUT')
    }
  }

  const filterComplex = filters.join(',')

  if (DEBUG) {
    logMessage('[FFMPEG DEBUG] Built filter complex:', filterComplex)
  }

  const bitrateProfile = quality === '1080p'
    ? { videoBitrate: '5000k', minRate: '3000k', maxRate: '5000k', bufferSize: '10000k' }
    : { videoBitrate: '2000k', minRate: '1500k', maxRate: '2500k', bufferSize: '5000k' }
  const gopSize = Math.max(24, Math.round((metadata.fps || 25) * 2))

  const args = [
    '-v', 'verbose', // Enable verbose logging for debug
    '-i', inputPath,
    '-vf', filterComplex,
    '-c:v', 'libx264',
    '-preset', preset,
    '-b:v', bitrateProfile.videoBitrate,
    '-minrate', bitrateProfile.minRate,
    '-maxrate', bitrateProfile.maxRate,
    '-bufsize', bitrateProfile.bufferSize,
    '-g', gopSize.toString(),
    '-keyint_min', gopSize.toString(),
    '-sc_threshold', '0',
    '-threads', threads.toString(),
    '-profile:v', 'high',
    '-level', '4.1',
    '-pix_fmt', 'yuv420p', // Ensure compatibility with all players (especially Safari/iOS)
    '-c:a', 'aac',
    '-b:a', '128k', // Reduced from 192k to 128k (sufficient for most use cases, saves bandwidth)
    '-ar', '48000', // Standard audio sample rate
    '-movflags', '+faststart', // Enable progressive download (moov atom at start)
    '-max_muxing_queue_size', '1024', // Prevent muxing errors on high-bitrate videos
    '-progress', 'pipe:2',
    '-y', // Overwrite output file
    outputPath
  ]

  if (DEBUG) {
    logMessage('[FFMPEG DEBUG] Executing command:', 'nice -n 10', ffmpegPath, args.join(' '))
  }

  return new Promise((resolve, reject) => {
    // Run FFmpeg with lower CPU priority (nice 10) to prevent system freeze
    // This allows other processes to remain responsive during video processing
    // nice values: -20 (highest priority) to 19 (lowest priority), default is 0
    const ffmpeg = spawn('nice', ['-n', '10', ffmpegPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    attachIdleWatchdog(ffmpeg, FFMPEG_IDLE_TIMEOUT_MS, 'FFmpeg transcode')
    let stderr = ''

    if (DEBUG) {
      logMessage('[FFMPEG DEBUG] FFmpeg process spawned, PID:', ffmpeg.pid)
    }

    ffmpeg.stderr.on('data', (data) => {
      const text = data.toString()
      stderr += text

      if (DEBUG) {
        logMessage('[FFMPEG STDERR]', text.trim())
      }

      if (onProgress && duration > 0) {
        const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/)
        if (timeMatch) {
          const hours = parseInt(timeMatch[1], 10)
          const minutes = parseInt(timeMatch[2], 10)
          const seconds = parseFloat(timeMatch[3])
          const currentTime = hours * 3600 + minutes * 60 + seconds
          const progress = Math.min(currentTime / duration, 1)
          if (DEBUG) {
            logMessage('[FFMPEG DEBUG] Progress:', Math.round(progress * 100) + '%')
          }
          onProgress(progress)
        }
      }

      // Log errors and warnings (even when not in debug mode)
      if (!DEBUG && (text.includes('error') || text.includes('Error') || text.includes('failed'))) {
        logError('FFmpeg stderr:', text)
      }
    })

    ffmpeg.on('close', (code) => {
      if (DEBUG) {
        logMessage('[FFMPEG DEBUG] Process exited with code:', code)
      }

      if (code === 0) {
        if (DEBUG) {
          logMessage('[FFMPEG DEBUG] Transcoding completed successfully')
        }
        resolve()
      } else {
        if (DEBUG) {
          logError('[FFMPEG DEBUG] Transcoding failed with code:', code)
          logError('[FFMPEG DEBUG] Full stderr output:', stderr)
        }
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`))
      }
    })

    ffmpeg.on('error', (err) => {
      if (DEBUG) {
        logError('[FFMPEG DEBUG] Failed to spawn FFmpeg:', err)
      }
      reject(new Error(`Failed to start FFmpeg: ${err.message}`))
    })
  })
}

export async function generateThumbnail(
  inputPath: string,
  outputPath: string,
  timestamp: number = 10
): Promise<void> {
  if (DEBUG) {
    logMessage('[FFMPEG DEBUG] Starting generateThumbnail:', {
      inputPath,
      outputPath,
      timestamp
    })
  }

  const args = [
    '-v', 'verbose', // Enable verbose logging for debug
    '-ss', timestamp.toString(), // Seek before input (faster - avoids decoding entire video)
    '-i', inputPath,
    '-vframes', '1', // Extract single frame
    '-vf', 'scale=w=min(1280\\,iw):h=min(720\\,ih):force_original_aspect_ratio=decrease', // Scale down if needed, preserve aspect ratio, no padding
    '-q:v', '2', // High quality JPEG (1-31 scale, 2 = excellent quality)
    '-y', // Overwrite output file
    outputPath
  ]

  if (DEBUG) {
    logMessage('[FFMPEG DEBUG] Thumbnail command:', 'nice -n 10', ffmpegPath, args.join(' '))
  }

  return new Promise((resolve, reject) => {
    // Run with lower CPU priority to keep system responsive
    const ffmpeg = spawn('nice', ['-n', '10', ffmpegPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    attachIdleWatchdog(ffmpeg, FFMPEG_IDLE_TIMEOUT_MS, 'FFmpeg thumbnail')
    let stderr = ''

    if (DEBUG) {
      logMessage('[FFMPEG DEBUG] Thumbnail process spawned, PID:', ffmpeg.pid)
    }

    ffmpeg.stderr.on('data', (data) => {
      const text = data.toString()
      stderr += text
      if (DEBUG) {
        logMessage('[FFMPEG THUMBNAIL STDERR]', text.trim())
      }
    })

    ffmpeg.on('close', (code) => {
      if (DEBUG) {
        logMessage('[FFMPEG DEBUG] Thumbnail process exited with code:', code)
      }

      if (code === 0) {
        if (DEBUG) {
          logMessage('[FFMPEG DEBUG] Thumbnail generated successfully')
        }
        resolve()
      } else {
        if (DEBUG) {
          logError('[FFMPEG DEBUG] Thumbnail generation failed:', stderr)
        }
        reject(new Error(`FFmpeg thumbnail generation failed: ${stderr}`))
      }
    })

    ffmpeg.on('error', (err) => {
      if (DEBUG) {
        logError('[FFMPEG DEBUG] Failed to spawn FFmpeg for thumbnail:', err)
      }
      reject(new Error(`Failed to start FFmpeg: ${err.message}`))
    })
  })
}

/**
 * Render an audio waveform preview image (used for client upload thumbnails)
 */
export async function generateWaveformImage(
  inputPath: string,
  outputPath: string
): Promise<void> {
  const args = [
    '-v', 'error',
    '-i', inputPath,
    '-filter_complex', 'showwavespic=s=512x288:colors=#7c8cf8',
    '-frames:v', '1',
    // '-v error' keeps stderr empty while the render works, which the idle watchdog would
    // read as a stall, so progress goes to stdout instead and keeps the heartbeat.
    '-progress', 'pipe:1',
    '-y',
    outputPath
  ]

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('nice', ['-n', '10', ffmpegPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    attachIdleWatchdog(ffmpeg, FFMPEG_IDLE_TIMEOUT_MS, 'FFmpeg waveform')
    let stderr = ''

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`FFmpeg waveform generation failed: ${stderr}`))
      }
    })

    ffmpeg.on('error', (err) => {
      reject(new Error(`Failed to start FFmpeg: ${err.message}`))
    })
  })
}
