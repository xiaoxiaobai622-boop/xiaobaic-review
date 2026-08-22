import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'stream'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { deleteFile, downloadFile, initStorage, uploadFile } from '@/lib/storage'
import { rateLimit } from '@/lib/rate-limit'
import { logError } from '@/lib/logging'
import { getAppDomain } from '@/lib/url'
import {
  checkWechatImage,
  CONTENT_SECURITY_ERROR,
  CONTENT_VIOLATION_MESSAGE,
  submitWechatMediaCheck,
} from '@/lib/wechat-content-security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// WeChat img_sec_check has a 1MB upload limit for synchronous checks.
const MAX_SIZE_BYTES = 1 * 1024 * 1024
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await getCurrentUserFromRequest(request)
  if (!authResult) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (authResult.id !== id && authResult.role !== 'ADMIN') {
    return NextResponse.json({ error: 'You can only update your own avatar' }, { status: 403 })
  }

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 6,
    message: '头像更新过于频繁，请稍后再试',
  }, 'user-avatar-upload', id)
  if (limited) return limited

  const contentType = request.headers.get('content-type') || ''
  const ext = EXT_BY_MIME[contentType]
  if (!ext) {
    return NextResponse.json({ error: '仅支持 PNG、JPG、WebP 或 GIF 图片' }, { status: 400 })
  }

  const buffer = Buffer.from(await request.arrayBuffer())
  if (buffer.byteLength === 0) {
    return NextResponse.json({ error: '请选择要上传的头像' }, { status: 400 })
  }
  if (buffer.byteLength > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: '头像不能超过 1MB' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

  const securityCheck = await checkWechatImage(buffer, contentType)
  if (!securityCheck.passed) {
    return NextResponse.json(
      { error: securityCheck.error },
      { status: securityCheck.error === CONTENT_VIOLATION_MESSAGE ? 400 : 503 },
    )
  }

  const key = `avatars/${id}.${ext}`
  try {
    await initStorage()
    await uploadFile(key, buffer, buffer.byteLength, contentType)
    const avatarUrl = `/api/users/${id}/avatar?ext=${ext}&v=${Date.now()}`
    await prisma.user.update({ where: { id }, data: { avatarUrl } })
    const appDomain = await getAppDomain()
    if (appDomain) {
      const mediaUrl = new URL(avatarUrl, appDomain).toString()
      await submitWechatMediaCheck({
        userId: id,
        mediaUrl,
        key,
        avatarUrl,
      }).catch((error) => {
        logError('Failed to submit avatar async security check:', error)
      })
    }
    return NextResponse.json({ avatarUrl })
  } catch (error) {
    logError('Failed to upload user avatar:', error)
    await deleteFile(key).catch(() => {})
    return NextResponse.json({ error: '头像上传失败，请稍后再试' }, { status: 500 })
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const url = new URL(_request.url)
  const ext = url.searchParams.get('ext') || 'png'
  const mime = MIME_BY_EXT[ext]
  if (!mime) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const key = `avatars/${id}.${ext}`
  try {
    const stream = await downloadFile(key)
    return new NextResponse(Readable.toWeb(stream) as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=300, must-revalidate',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
