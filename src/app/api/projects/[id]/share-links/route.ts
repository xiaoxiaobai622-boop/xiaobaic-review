import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireProjectAction } from '@/lib/project-authorization'
import { encrypt } from '@/lib/encryption'
import { getAppUrl } from '@/lib/url'
import { sanitizeSharePermissions, formatShareLinkUrl } from '@/lib/share-links'
import { allocateShareToken } from '@/lib/share-tokens'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function cleanScopeType(value: unknown) {
  return ['PROJECT', 'FOLDER', 'VIDEO', 'VIDEO_VERSION'].includes(String(value)) ? String(value) : null
}

function cleanType(value: unknown) {
  return value === 'COLLECT' ? 'COLLECT' : value === 'DELIVERY' ? 'DELIVERY' : 'REVIEW'
}

async function assertScope(projectId: string, scopeType: string, scopeId: string | null) {
  if (scopeType === 'PROJECT') return true
  if (!scopeId) return false
  if (scopeType === 'FOLDER') return Boolean(await prisma.projectFolder.findFirst({ where: { id: scopeId, projectId }, select: { id: true } }))
  return Boolean(await prisma.video.findFirst({ where: { id: scopeId, projectId }, select: { id: true } }))
}

function serialize(link: any, baseUrl: string) {
  return {
    id: link.id,
    projectId: link.projectId,
    token: link.token,
    url: formatShareLinkUrl(link.token, baseUrl),
    name: link.name,
    type: link.type,
    scopeType: link.scopeType,
    scopeId: link.scopeId,
    permissions: link.permissions,
    authMode: link.authMode,
    expiresAt: link.expiresAt,
    maxViews: link.maxViews,
    viewCount: link.viewCount,
    status: link.status === 'ACTIVE' && link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now() ? 'EXPIRED' : link.status,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireProjectAction(request, id, 'share')
  if (access instanceof Response) return access
  const baseUrl = await getAppUrl(request)
  // Legacy master rows may still be in the table, but they are no longer an
  // address and must not appear as a manageable row.
  const links = await prisma.shareLink.findMany({
    where: { projectId: id, masterOfProjectId: null },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ shareLinks: links.map(link => serialize(link, baseUrl)) })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireProjectAction(request, id, 'share')
  if (access instanceof Response) return access
  try {
    const body = await request.json()
    const type = cleanType(body.type)
    const scopeType = cleanScopeType(body.scopeType) || 'PROJECT'
    const scopeId = scopeType === 'PROJECT' ? null : (typeof body.scopeId === 'string' ? body.scopeId : null)
    if (!(await assertScope(id, scopeType, scopeId))) return NextResponse.json({ error: '分享范围不存在' }, { status: 400 })
    const authMode = ['NONE', 'PASSWORD', 'OTP', 'BOTH'].includes(body.authMode) ? body.authMode : 'PASSWORD'
    const password = typeof body.password === 'string' ? body.password.trim() : ''
    if ((authMode === 'PASSWORD' || authMode === 'BOTH') && !password) return NextResponse.json({ error: '密码分享需要设置密码' }, { status: 400 })
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null
    if (expiresAt && Number.isNaN(expiresAt.getTime())) return NextResponse.json({ error: '有效期格式不正确' }, { status: 400 })
    const maxViews = body.maxViews === null || body.maxViews === undefined || body.maxViews === '' ? null : Math.max(1, Number(body.maxViews))
    const link = await prisma.shareLink.create({
      data: {
        projectId: id,
        token: await allocateShareToken(prisma),
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : (type === 'COLLECT' ? '收录分享' : type === 'DELIVERY' ? '交付分享' : '审片分享'),
        type,
        scopeType,
        scopeId,
        permissions: sanitizeSharePermissions(body.permissions, type),
        authMode,
        sharePassword: password ? encrypt(password) : null,
        expiresAt,
        maxViews: Number.isFinite(maxViews) ? maxViews : null,
      },
    })
    const baseUrl = await getAppUrl(request)
    return NextResponse.json({ shareLink: serialize(link, baseUrl) }, { status: 201 })
  } catch (error) {
    logError('[SHARE LINKS] Failed to create share link', error)
    return NextResponse.json({ error: '创建分享失败' }, { status: 500 })
  }
}
