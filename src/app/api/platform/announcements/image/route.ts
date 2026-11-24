import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { initStorage, uploadFile } from '@/lib/storage'
import { logError } from '@/lib/logging'
import {
  ANNOUNCEMENT_IMAGE_MAX_BYTES,
  ANNOUNCEMENT_IMAGE_MAX_LABEL,
  announcementImageExtensionForMime,
  announcementImageStorageKey,
  announcementImageUrl,
  buildAnnouncementImagePublicKey,
} from '@/lib/announcements/image'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/platform/announcements/image — platform-only image upload for
 * release notes. The file type is decided by magic bytes, not the browser's
 * MIME or the client filename. Stored through the existing storage provider.
 */
export async function POST(request: NextRequest) {
  const platformAuth = await requirePlatformAuth(request)
  if (platformAuth instanceof Response) return platformAuth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 20,
    message: '上传过于频繁，请稍后再试',
  }, 'platform-announcement-image', platformAuth.id)
  if (limited) return limited

  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > ANNOUNCEMENT_IMAGE_MAX_BYTES + 1024 * 1024) {
    return NextResponse.json({ error: `图片不能超过 ${ANNOUNCEMENT_IMAGE_MAX_LABEL}` }, { status: 413 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: '上传内容不合法，请重新选择图片' }, { status: 400 })
  }

  const file = form.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: '请选择要上传的图片文件' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: '图片文件为空，请重新选择' }, { status: 400 })
  }
  if (file.size > ANNOUNCEMENT_IMAGE_MAX_BYTES) {
    return NextResponse.json(
      { error: `图片不能超过 ${ANNOUNCEMENT_IMAGE_MAX_LABEL}` },
      { status: 413 },
    )
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.byteLength === 0) {
      return NextResponse.json({ error: '图片文件为空，请重新选择' }, { status: 400 })
    }
    if (buffer.byteLength > ANNOUNCEMENT_IMAGE_MAX_BYTES) {
      return NextResponse.json(
        { error: `图片不能超过 ${ANNOUNCEMENT_IMAGE_MAX_LABEL}` },
        { status: 413 },
      )
    }

    const { fileTypeFromBuffer } = await import('file-type')
    const detected = await fileTypeFromBuffer(buffer)
    const extension = detected ? announcementImageExtensionForMime(detected.mime) : null
    if (!detected || !extension) {
      return NextResponse.json(
        { error: '只支持 JPG、PNG、WebP 或 AVIF 图片' },
        { status: 400 },
      )
    }

    const publicKey = buildAnnouncementImagePublicKey(extension)
    await initStorage()
    await uploadFile(announcementImageStorageKey(publicKey), buffer, buffer.byteLength, detected.mime)

    return NextResponse.json({
      url: announcementImageUrl(publicKey),
      contentType: detected.mime,
      size: buffer.byteLength,
    })
  } catch (error) {
    logError('[ANNOUNCEMENT IMAGE] upload failed:', error)
    return NextResponse.json({ error: '图片上传失败，请稍后重试（上传服务未返回可访问地址）' }, { status: 500 })
  }
}