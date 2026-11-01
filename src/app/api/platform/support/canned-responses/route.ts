import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { noStoreJson, supportErrorResponse } from '@/lib/support/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await requirePlatformAuth(request)
  if (auth instanceof Response) return auth
  try {
    const locale = request.nextUrl.searchParams.get('locale') || undefined
    const items = await prisma.supportCannedResponse.findMany({
      where: { deletedAt: null, ...(locale ? { locale } : {}) },
      orderBy: [{ locale: 'asc' }, { usageCount: 'desc' }, { title: 'asc' }],
      take: 200,
    })
    return noStoreJson({ items })
  } catch (error) {
    return supportErrorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformAuth(request)
  if (auth instanceof Response) return auth
  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: '操作过于频繁',
  }, 'platform-support-canned', auth.id)
  if (limited) return limited

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 80) : ''
    const content = typeof body.body === 'string' ? body.body.trim().slice(0, 4000) : ''
    if (!title || !content) return noStoreJson({ error: '标题和内容不能为空' }, { status: 400 })
    const locale = typeof body.locale === 'string' ? body.locale.slice(0, 8) : 'zh'
    const shortcut = typeof body.shortcut === 'string' ? body.shortcut.trim().slice(0, 40) || null : null

    const item = await prisma.supportCannedResponse.create({
      data: { title, body: content, locale, shortcut, createdBy: auth.id },
    })
    return noStoreJson({ item }, { status: 201 })
  } catch (error) {
    return supportErrorResponse(error)
  }
}
