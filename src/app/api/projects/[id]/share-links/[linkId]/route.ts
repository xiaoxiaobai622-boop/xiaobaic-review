import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { canAdministerProject } from '@/lib/project-access'
import { encrypt } from '@/lib/encryption'
import { getAppUrl } from '@/lib/url'

export const runtime = 'nodejs'

function cleanPermissions(value: unknown, type: string) {
  const allowed = type === 'COLLECT' ? ['upload'] : ['view', 'comment', 'download', 'approve']
  if (!Array.isArray(value)) return undefined
  return Array.from(new Set(value.map(String).filter(item => allowed.includes(item))))
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const user = await requireApiAdmin(request)
  if (user instanceof Response) return user
  const { id, linkId } = await params
  if (!(await canAdministerProject(prisma, user, id))) return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  const current = await prisma.shareLink.findFirst({ where: { id: linkId, projectId: id } })
  if (!current) return NextResponse.json({ error: '分享记录不存在' }, { status: 404 })
  const body = await request.json()
  const data: any = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 120)
  if (['ACTIVE', 'REVOKED', 'EXPIRED'].includes(body.status)) data.status = body.status
  if (Array.isArray(body.permissions)) data.permissions = cleanPermissions(body.permissions, current.type)
  if (['NONE', 'PASSWORD', 'OTP', 'BOTH'].includes(body.authMode)) data.authMode = body.authMode
  if (body.password !== undefined) data.sharePassword = body.password ? encrypt(String(body.password)) : null
  if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null
  if (body.maxViews !== undefined) data.maxViews = body.maxViews === null || body.maxViews === '' ? null : Math.max(1, Number(body.maxViews))
  const link = await prisma.shareLink.update({ where: { id: current.id }, data })
  const baseUrl = await getAppUrl(request)
  return NextResponse.json({ shareLink: { ...link, url: `${baseUrl}/share/${encodeURIComponent(link.token)}`, sharePassword: undefined } })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const user = await requireApiAdmin(request)
  if (user instanceof Response) return user
  const { id, linkId } = await params
  if (!(await canAdministerProject(prisma, user, id))) return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  const result = await prisma.shareLink.deleteMany({ where: { id: linkId, projectId: id } })
  if (!result.count) return NextResponse.json({ error: '分享记录不存在' }, { status: 404 })
  return NextResponse.json({ success: true })
}
