import { NextResponse } from 'next/server'
import { getFilePath, fileExists, downloadFile } from '@/lib/storage'
import { buildLogoSvg } from '@/lib/brand'
import fs from 'fs/promises'
import type { Readable } from 'node:stream'
import sharp from 'sharp'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STORAGE_PATH = 'branding/logo.svg'
const CACHE_PATH = 'branding/logo.png'
// v2: the mark stopped following the admin accent, so old cached PNGs must not be reused.
const DEFAULT_CACHE_PATH = 'branding/default-logo-v2.png'

function pngResponse(png: Buffer): NextResponse {
  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600, must-revalidate',
    },
  })
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/**
 * Serve logo as PNG for email clients
 * Uses custom uploaded logo if available, otherwise the built-in product mark
 */
export async function GET() {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const settingsMessages = messages?.settings || {}

  try {
    // Read through the storage abstraction: the upload writes there, so probing
    // the container's own disk made an uploaded logo invisible in S3 mode.
    if (await fileExists(STORAGE_PATH)) {
      const pngPath = getFilePath(CACHE_PATH)
      try {
        const cachedPng = await fs.readFile(pngPath)
        return pngResponse(cachedPng)
      } catch {
        // No cached PNG
      }

      const svgData = await readAll(await downloadFile(STORAGE_PATH))
      const pngBuffer = await sharp(svgData)
        .resize({ height: 88, withoutEnlargement: false })
        .png()
        .toBuffer()

      try {
        await fs.writeFile(pngPath, pngBuffer)
      } catch {
        // Ignore cache write errors
      }

      return pngResponse(pngBuffer)
    }

    const defaultCachePath = getFilePath(DEFAULT_CACHE_PATH)
    try {
      const cachedPng = await fs.readFile(defaultCachePath)
      return pngResponse(cachedPng)
    } catch {
      // No cached PNG
    }

    const pngBuffer = await sharp(Buffer.from(buildLogoSvg(88)))
      .png()
      .toBuffer()

    try {
      await fs.writeFile(defaultCachePath, pngBuffer)
    } catch {
      // Ignore cache write errors
    }

    return pngResponse(pngBuffer)
  } catch (error) {
    logError('[BRANDING:LOGO-PNG] Error:', error)
    return NextResponse.json({ error: settingsMessages.failedToGenerateLogo || 'Failed to generate logo' }, { status: 500 })
  }
}
