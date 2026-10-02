import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAdministerProject } from '@/lib/project-access'
import { encrypt } from '@/lib/encryption'
import { getAppUrl } from '@/lib/url'
import { ensureProjectMasterLink, sanitizeSharePermissions, formatShareLinkUrl } from '@/lib/share-links'
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

/**
 * The project's own address is a real row (`masterOfProjectId`), so the panel can
 * show its expiry, view count and access records the same way as a created link.
 * Its comment/download rules still come from the project settings page, which is
 * what `ensureProjectMasterLink` mirrors into the row.
 */
async function serializeMasterLink(projectId: string, baseUrl: string, archived: boolean) {
  const master = await ensureProjectMasterLink(projectId)
  if (!master) return null
  // 归档的项目对访客已经打不开，这一行不能继续显示「有效」。
  const status = archived
    ? 'ARCHIVED'
    : master.expiresAt && new Date(master.expiresAt).getTime() <= Date.now() ? 'EXPIRED' : master.status
  return {
    id: master.id,
    name: master.name,
    url: formatShareLinkUrl(master.token, baseUrl),
    authMode: master.authMode,
    hasPassword: Boolean(master.sharePassword),
    permissions: master.permissions,
    status,
    expiresAt: master.expiresAt,
    maxViews: master.maxViews,
    viewCount: master.viewCount,
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiAdmin(request)
  if (user instanceof Response) return user
  const { id } = await params
  if (!(await canAdministerProject(prisma, user, id))) return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  const baseUrl = await getAppUrl(request)
  const [links, project] = await Promise.all([
    // The master row is shown as its own pinned line, not twice.
    prisma.shareLink.findMany({ where: { projectId: id, masterOfProjectId: null }, orderBy: { createdAt: 'desc' } }),
    prisma.project.findUnique({ where: { id }, select: { status: true } }),
  ])
  const masterLink = await serializeMasterLink(id, baseUrl, project?.status === 'ARCHIVED')
  return NextResponse.json({
    shareLinks: links.map(link => serialize(link, baseUrl)),
    masterLink,
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiAdmin(request)
  if (user instanceof Response) return user
  const { id } = await params
  if (!(await canAdministerProject(prisma, user, id))) return NextResponse.json({ error: 'Access denied' }, { status: 403 })
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
