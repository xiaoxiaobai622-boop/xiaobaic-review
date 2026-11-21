import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiUser } from '@/lib/auth'
import { canAccessProject } from '@/lib/project-access'

export const runtime = 'nodejs'

const API_TTL_SECONDS = 10 * 60
const EDITOR_TTL_SECONDS = 2 * 60 * 60

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString('base64url')
}

function signToken(payload: Record<string, unknown>, secret: string) {
  const body = base64Url(JSON.stringify(payload))
  const key = crypto.createHmac('sha256', secret).update('vidx-docs-token-v1').digest()
  const signature = crypto.createHmac('sha256', key).update(body).digest('base64url')
  return `${body}.${signature}`
}

export async function GET(request: NextRequest) {
  const auth = await requireApiUser(request)
  if (auth instanceof Response) return auth

  const projectId = request.nextUrl.searchParams.get('projectId')?.trim() || ''
  if (!projectId) {
    return NextResponse.json({ error: '缺少项目 ID' }, { status: 400 })
  }

  const purposeParam = request.nextUrl.searchParams.get('purpose')
  if (purposeParam && purposeParam !== 'api' && purposeParam !== 'editor') {
    return NextResponse.json({ error: '无效的令牌用途' }, { status: 400 })
  }
  const purpose = purposeParam === 'editor' ? 'editor' : 'api'
  const docId = purpose === 'editor' ? request.nextUrl.searchParams.get('docId')?.trim() || '' : ''
  if (purpose === 'editor' && !docId) {
    return NextResponse.json({ error: '缺少文档 ID' }, { status: 400 })
  }

  if (!(await canAccessProject(prisma, auth, projectId))) {
    return NextResponse.json({ error: '你没有这个项目的访问权限' }, { status: 403 })
  }

  const secret = process.env.DOCS_TOKEN_SECRET || process.env.JWT_SECRET
  if (!secret) {
    return NextResponse.json({ error: '文档令牌未配置' }, { status: 500 })
  }

  let avatar = ''
  if (auth.avatarUrl) {
    try {
      avatar = new URL(auth.avatarUrl, process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).toString()
    } catch {}
  }

  const now = Math.floor(Date.now() / 1000)
  const ttl = purpose === 'editor' ? EDITOR_TTL_SECONDS : API_TTL_SECONDS
  const token = signToken(
    {
      sub: auth.id,
      name: auth.name || '网站用户',
      ...(avatar ? { avatar } : {}),
      projectId,
      purpose,
      ...(docId ? { docId } : {}),
      iat: now,
      exp: now + ttl,
    },
    secret
  )

  return NextResponse.json(
    { token, expiresAt: (now + ttl) * 1000 },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
