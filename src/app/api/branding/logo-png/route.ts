import { NextResponse } from 'next/server'
import { fileExists, downloadFile, uploadFile } from '@/lib/storage'
import { buildLogoSvg, LOGO_SOURCE_KEY, LOGO_PNG_KEY } from '@/lib/brand'
import type { Readable } from 'node:stream'
import sharp from 'sharp'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    if (await fileExists(LOGO_SOURCE_KEY)) {
      // The cache goes through the same abstraction as its invalidation
      // (`deleteFile(LOGO_PNG_KEY)` in settings/logo); reading it off the local
      // disk while deleting it from the bucket left emails serving the first
      // logo forever.
      if (await fileExists(LOGO_PNG_KEY)) {
        try {
          return pngResponse(await readAll(await downloadFile(LOGO_PNG_KEY)))
        } catch (error) {
          logError('[BRANDING:LOGO-PNG] Cache read failed, regenerating:', error)
        }
      }

      const svgData = await readAll(await downloadFile(LOGO_SOURCE_KEY))
      const pngBuffer = await sharp(svgData)
        .resize({ height: 88, withoutEnlargement: false })
        .png()
        .toBuffer()

      try {
        await uploadFile(LOGO_PNG_KEY, pngBuffer, pngBuffer.length, 'image/png')
      } catch (error) {
        logError('[BRANDING:LOGO-PNG] Cache write failed:', error)
      }

      return pngResponse(pngBuffer)
    }

    // The built-in mark is a deterministic render of a 3KB string, so it is not
    // cached at all: a cached copy needs an invalidation path, and the last one
    // (a `-v2` filename plus two loops deleting names that no longer exist) was
    // the bug rather than the guard.
    const pngBuffer = await sharp(Buffer.from(buildLogoSvg(88)))
      .png()
      .toBuffer()

    return pngResponse(pngBuffer)
  } catch (error) {
    logError('[BRANDING:LOGO-PNG] Error:', error)
    return NextResponse.json({ error: settingsMessages.failedToGenerateLogo || 'Failed to generate logo' }, { status: 500 })
  }
}
