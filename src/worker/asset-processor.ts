import { Job } from 'bullmq'
import sharp from 'sharp'
import { prisma } from '../lib/db'
import { downloadFile } from '../lib/storage'
import { ALLOWED_ASSET_TYPES, markInvalidFileType } from '../lib/file-validation'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { TEMP_DIR } from './cleanup'
import { logError, logMessage } from '../lib/logging'

const DEBUG = process.env.DEBUG_WORKER === 'true'

export interface AssetProcessingJob {
  assetId: string
  storagePath: string
  expectedCategory?: string
}

/**
 * Categories where every allowed MIME is something sharp can raster, so a decode
 * failure is proof of a broken file rather than of an unsupported format.
 */
const DECODABLE_ASSET_CATEGORIES = new Set(['image', 'thumbnail'])

/**
 * Force a real pixel decode. Magic bytes and headers both pass a file that is
 * truncated or corrupt mid-stream, and unlike photos an asset has no rendition
 * pass, so nothing else in the pipeline would ever notice.
 */
async function assertDecodable(filePath: string): Promise<void> {
  await sharp(filePath).resize(1, 1, { fit: 'inside' }).png().toBuffer()
}

/**
 * Mark the asset record as holding unexpected content and build the rejection
 * error. The thrown message is what the queue stores as the job failure, so the
 * log line and the error share one wording. Callers must `throw` the result —
 * returning it here would leave TypeScript unable to see the abort.
 */
async function rejectAsset(assetId: string, mime: string, reason: string): Promise<Error> {
  logError(`[WORKER ERROR] ${reason}`)

  await prisma.videoAsset.update({
    where: { id: assetId },
    data: {
      fileType: markInvalidFileType(mime)
    }
  })

  return new Error(reason)
}

/**
 * Process uploaded asset - validate magic bytes
 * Called after TUS upload completes
 */
export async function processAsset(job: Job<AssetProcessingJob>) {
  const { assetId, storagePath, expectedCategory } = job.data

  logMessage(`[WORKER] Processing asset ${assetId}`)

  if (DEBUG) {
    logMessage(`[WORKER DEBUG] Asset job data: ${JSON.stringify(job.data, null, 2)}`)
  }

  let tempFilePath: string | undefined

  try {
    // Download asset to temp location
    tempFilePath = path.join(TEMP_DIR, `${assetId}-asset`)

    if (DEBUG) {
      logMessage(`[WORKER DEBUG] Downloading asset from: ${storagePath}`)
      logMessage(`[WORKER DEBUG] Temp file path: ${tempFilePath}`)
    }

    const downloadStream = await downloadFile(storagePath)
    await pipeline(downloadStream, fs.createWriteStream(tempFilePath))

    // Verify file exists and has content
    const stats = fs.statSync(tempFilePath)
    if (stats.size === 0) {
      throw new Error('Downloaded file is empty')
    }

    logMessage(`[WORKER] Downloaded asset ${assetId}, size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`)

    // Validate magic bytes
    if (DEBUG) {
      logMessage('[WORKER DEBUG] Validating asset magic bytes...')
    }

    const { fileTypeFromFile } = await import('file-type')
    const fileType = await fileTypeFromFile(tempFilePath)

    if (!fileType) {
      // Some files (like .prproj, .txt) don't have magic bytes
      logMessage(`[ASSET VALIDATION] Could not detect magic bytes for: ${tempFilePath}`)

      await prisma.videoAsset.update({
        where: { id: assetId },
        data: {
          fileType: 'unknown',
          category: expectedCategory || 'other'
        }
      })

      logMessage(`[WORKER] Asset ${assetId} processed (no magic bytes detected)`)
      return
    }

    // If expected category is provided, verify the MIME type is compatible with it
    let finalCategory: string

    if (expectedCategory && expectedCategory !== 'other') {
      // Check if the expected category supports this MIME type
      const expectedConfig = ALLOWED_ASSET_TYPES[expectedCategory as keyof typeof ALLOWED_ASSET_TYPES]

      if (expectedConfig && expectedConfig.mimeTypes.includes(fileType.mime)) {
        // Expected category is valid and compatible - use it (preserve manual selection)
        finalCategory = expectedCategory
        logMessage(`[WORKER] Asset MIME type ${fileType.mime} is compatible with expected category '${expectedCategory}'`)
      } else {
        // Expected category doesn't support this MIME type - validation failed
        throw await rejectAsset(
          assetId,
          fileType.mime,
          `File MIME type '${fileType.mime}' is not compatible with expected category '${expectedCategory}'`
        )
      }
    } else {
      // No expected category - auto-detect from MIME type
      let detectedCategory: string | undefined

      for (const [cat, config] of Object.entries(ALLOWED_ASSET_TYPES)) {
        if (config.mimeTypes.includes(fileType.mime)) {
          detectedCategory = cat
          break
        }
      }

      if (!detectedCategory) {
        throw await rejectAsset(
          assetId,
          fileType.mime,
          `File content does not match any allowed asset type. Detected: ${fileType.mime}`
        )
      }

      finalCategory = detectedCategory
    }

    logMessage(`[WORKER] Asset magic byte validation passed - type: ${fileType.mime}, category: ${finalCategory}`)

    if (DECODABLE_ASSET_CATEGORIES.has(finalCategory)) {
      try {
        await assertDecodable(tempFilePath)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw await rejectAsset(
          assetId,
          fileType.mime,
          `Image content cannot be decoded. Detected: ${fileType.mime}. ${detail}`
        )
      }
    }

    // Update asset with detected file type and final category
    await prisma.videoAsset.update({
      where: { id: assetId },
      data: {
        fileType: fileType.mime,
        category: finalCategory
      }
    })

    logMessage(`[WORKER] Asset ${assetId} processed successfully`)

  } catch (error) {
    logError(`[WORKER ERROR] Asset processing failed for ${assetId}`, error)
    throw error
  } finally {
    // Cleanup temp file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath)
        if (DEBUG) {
          logMessage(`[WORKER DEBUG] Cleaned up temp file: ${tempFilePath}`)
        }
      } catch (cleanupError) {
        logError('[WORKER ERROR] Failed to cleanup temp file', cleanupError)
      }
    }
  }
}
