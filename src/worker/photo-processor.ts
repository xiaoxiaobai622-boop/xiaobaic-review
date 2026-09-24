import { Job } from 'bullmq'
import sharp from 'sharp'
import { prisma } from '../lib/db'
import { downloadFile, uploadFile } from '../lib/storage'
import { ALLOWED_PHOTO_TYPES, markInvalidFileType } from '../lib/file-validation'
import { PhotoProcessingJob } from '../lib/queue'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { TEMP_DIR } from './cleanup'
import { logError, logMessage } from '../lib/logging'
import { teamProjectStorageKey } from '../lib/storage-keys'

const THUMBNAIL_SIZE = 512 // longest edge in pixels
const THUMBNAIL_QUALITY = 75
const PREVIEW_SIZE = 2048 // longest edge — lightbox rendition, originals are download-only
const PREVIEW_QUALITY = 82

interface PhotoRenditions {
  thumbnail: Buffer
  preview: Buffer
}

/**
 * Decode both web renditions from the stored file.
 *
 * This is the only step that can tell a real image from a file that merely has
 * image magic bytes and parseable headers — `fileType` and `sharp.metadata()`
 * both pass a permanently undecodable PNG. A failure here is deterministic, so
 * the caller records it on the row instead of leaving it as "still processing".
 */
async function decodeRenditions(sourcePath: string): Promise<PhotoRenditions> {
  const image = sharp(sourcePath)

  // Animated GIFs keep their first frame; .rotate() applies EXIF orientation
  const thumbnail = await image
    .rotate()
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMBNAIL_QUALITY })
    .toBuffer()

  const preview = await image
    .rotate()
    .resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: PREVIEW_QUALITY })
    .toBuffer()

  return { thumbnail, preview }
}

/**
 * Process uploaded photo - validate magic bytes, extract dimensions,
 * generate webp thumbnail. Called after upload completes.
 */
export async function processPhoto(job: Job<PhotoProcessingJob>) {
  const { photoId, storagePath } = job.data

  logMessage(`[WORKER] Processing photo ${photoId}`)

  let tempFilePath: string | undefined

  try {
    const photo = await prisma.photo.findUnique({
      where: { id: photoId },
      include: { album: { select: { id: true, projectId: true } } },
    })

    if (!photo) {
      throw new Error(`Photo record not found: ${photoId}`)
    }

    tempFilePath = path.join(TEMP_DIR, `${photoId}-photo`)
    const downloadStream = await downloadFile(storagePath)
    await pipeline(downloadStream, fs.createWriteStream(tempFilePath))

    const stats = fs.statSync(tempFilePath)
    if (stats.size === 0) {
      throw new Error('Downloaded file is empty')
    }

    // Validate magic bytes - photos must be a real image of an allowed type
    const { fileTypeFromFile } = await import('file-type')
    const fileType = await fileTypeFromFile(tempFilePath)

    if (!fileType || !ALLOWED_PHOTO_TYPES.mimeTypes.includes(fileType.mime)) {
      const detected = fileType?.mime || 'unknown'
      await prisma.photo.update({
        where: { id: photoId },
        data: { fileType: markInvalidFileType(detected) },
      })
      throw new Error(`File content is not an allowed photo type. Detected: ${detected}`)
    }

    // Dimensions come from headers; renditions come from a real decode. Decoding
    // up front keeps an undecodable file from leaving half-written objects.
    const metadata = await sharp(tempFilePath).metadata()

    let renditions: PhotoRenditions
    try {
      renditions = await decodeRenditions(tempFilePath)
    } catch (error) {
      await prisma.photo.update({
        where: { id: photoId },
        data: { fileType: markInvalidFileType(fileType.mime) },
      })
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Photo content cannot be decoded. Detected: ${fileType.mime}. ${detail}`)
    }

    const project = await prisma.project.findUnique({ where: { id: photo.album.projectId }, select: { teamId: true } })
    if (!project) throw new Error(`Project not found: ${photo.album.projectId}`)
    const thumbnailPath = teamProjectStorageKey(project.teamId, photo.album.projectId, 'photos', photo.album.id, 'thumbs', `${photoId}.webp`)
    await uploadFile(thumbnailPath, renditions.thumbnail, renditions.thumbnail.length, 'image/webp')

    // Web-sized preview for the lightbox — large originals (25-90 MB PNGs)
    // are far too slow to view inline; they remain available for download
    const previewPath = teamProjectStorageKey(project.teamId, photo.album.projectId, 'photos', photo.album.id, 'previews', `${photoId}.webp`)
    await uploadFile(previewPath, renditions.preview, renditions.preview.length, 'image/webp')

    // EXIF orientation 5-8 swaps width/height for display
    const orientationSwaps = (metadata.orientation || 1) >= 5
    await prisma.photo.update({
      where: { id: photoId },
      data: {
        fileType: fileType.mime,
        thumbnailPath,
        previewPath,
        width: (orientationSwaps ? metadata.height : metadata.width) ?? null,
        height: (orientationSwaps ? metadata.width : metadata.height) ?? null,
      },
    })

    logMessage(`[WORKER] Photo ${photoId} processed successfully (${fileType.mime}, ${metadata.width}x${metadata.height})`)
  } catch (error) {
    logError(`[WORKER ERROR] Photo processing failed for ${photoId}`, error)
    throw error
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath)
      } catch (cleanupError) {
        logError('[WORKER ERROR] Failed to cleanup temp file', cleanupError)
      }
    }
  }
}
