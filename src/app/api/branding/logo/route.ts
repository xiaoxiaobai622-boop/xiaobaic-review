import { NextResponse } from 'next/server'
import { isS3Mode, getFilePath } from '@/lib/storage'
import { s3FileExists, s3GetPresignedDownloadUrl } from '@/lib/s3-storage'
import fs from 'fs/promises'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The key the upload endpoint writes to. Reading it off the local disk alone
// silently served the pre-S3 file forever, so every custom logo upload looked
// like it "reverted"; the object store is probed first, same as /api/branding/favicon.
const STORAGE_PATH = 'branding/logo.svg'

export async function GET() {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const settingsMessages = messages?.settings || {}

  if (isS3Mode()) {
    if (await s3FileExists(STORAGE_PATH).catch(() => false)) {
      const url = await s3GetPresignedDownloadUrl(STORAGE_PATH, 3600, undefined, 'image/svg+xml')
      return NextResponse.redirect(url, {
        status: 302,
        headers: { 'Cache-Control': 'public, max-age=300, must-revalidate' },
      })
    }
    return NextResponse.json({ error: settingsMessages.logoNotFound || 'Logo not found' }, { status: 404 })
  }

  try {
    const data = await fs.readFile(getFilePath(STORAGE_PATH))
    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=300, must-revalidate',
      },
    })
  } catch {
    return NextResponse.json({ error: settingsMessages.logoNotFound || 'Logo not found' }, { status: 404 })
  }
}
