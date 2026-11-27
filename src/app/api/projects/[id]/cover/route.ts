import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { prisma } from '@/lib/db'
import { requireProjectAction } from '@/lib/project-authorization'
import { rateLimit } from '@/lib/rate-limit'
import { initStorage, uploadFile, deleteFile } from '@/lib/storage'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 8 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const COVER_URL = /^\/api\/project-covers\/([a-f0-9]{32}\.webp)$/

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const access = await requireProjectAction(request, id, 'manageSettings')
  if (access instanceof Response) return access

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 6,
    message: '封面上传过于频繁，请稍后再试',
  }, 'project-cover-upload', id)
  if (limited) return limited

  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim()
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: '仅支持 PNG、JPG 或 WebP 图片' }, { status: 400 })
  }

  const buffer = Buffer.from(await request.arrayBuffer())
  if (buffer.byteLength === 0) {
    return NextResponse.json({ error: '请选择封面图片' }, { status: 400 })
  }
  if (buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: '封面不能超过 8MB' }, { status: 400 })
  }

  let processed: Buffer
  try {
    processed = await sharp(buffer)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer()
  } catch {
    return NextResponse.json({ error: '图片无法解析' }, { status: 400 })
  }

  const fileName = `${randomBytes(16).toString('hex')}.webp`
  const storageKey = `project-covers/${fileName}`
  const coverImageUrl = `/api/project-covers/${fileName}`

  try {
    await initStorage()
    await uploadFile(storageKey, processed, processed.byteLength, 'image/webp')
    const current = await prisma.project.findUnique({ where: { id }, select: { coverImageUrl: true } })
    await prisma.project.update({ where: { id }, data: { coverImageUrl } })
    const previous = current?.coverImageUrl?.match(COVER_URL)?.[1]
    if (previous) await deleteFile(`project-covers/${previous}`).catch(() => {})
    return NextResponse.json({ coverImageUrl })
  } catch (error) {
    logError('Failed to upload project cover:', error)
    await deleteFile(storageKey).catch(() => {})
    return NextResponse.json({ error: '封面上传失败，请稍后再试' }, { status: 500 })
  }
}