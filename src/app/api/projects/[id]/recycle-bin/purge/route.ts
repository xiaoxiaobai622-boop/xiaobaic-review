import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'
import { rateLimit } from '@/lib/rate-limit'
import { purgeRecycleBinItems } from '@/lib/recycle-bin'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'

export const runtime = 'nodejs'

/**
 * Deleting one record at a time is what the row-level button does; this is the
 * bulk entry behind 「清空回收站」 and 「永久删除所选」. Every id is checked against
 * the project in the path, so reaching into another team's bin costs a NOT_FOUND
 * rather than someone else's footage.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const videoMessages = (await loadLocaleMessages(locale).catch(() => null))?.videos || {}

  const auth = await requireApiAdmin(request)
  if (auth instanceof Response) return auth
  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: videoMessages.tooManyBatchOperations || 'Too many batch operations. Please slow down.',
  }, 'admin-batch-ops', auth.id)
  if (rateLimitResult) return rateLimitResult

  const { id: projectId } = await params
  if (!(await canAccessProject(prisma, auth, projectId))) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const itemIds = body?.itemIds
  if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: videoMessages.invalidBatchRequest || 'Invalid request' }, { status: 400 })
  }
  if (itemIds.length > 100) {
    return NextResponse.json({ error: videoMessages.batchSizeLimitExceeded || 'Batch size limit exceeded' }, { status: 400 })
  }

  const { purged, failed } = await purgeRecycleBinItems(projectId, itemIds)
  return NextResponse.json({ purged, failed })
}
