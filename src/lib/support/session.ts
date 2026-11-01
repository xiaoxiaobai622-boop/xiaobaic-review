import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { getClientIpAddress } from '@/lib/utils'
import { logError } from '@/lib/logging'
import { SUPPORT_COOKIE, SUPPORT_COOKIE_MAX_AGE, SUPPORT_SESSION_TOKEN_BYTES } from './constants'

function sessionHash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function saltedHash(value: string) {
  const salt = process.env.SUPPORT_IP_SALT || process.env.JWT_SECRET || 'support-local-salt'
  return crypto.createHash('sha256').update(`${salt}\n${value}`).digest('hex').slice(0, 32)
}

export function hashSupportIp(request: NextRequest) {
  try {
    return saltedHash(getClientIpAddress(request) || 'unknown')
  } catch {
    return null
  }
}

export function hashSupportUserAgent(request: NextRequest) {
  const userAgent = request.headers.get('user-agent') || 'unknown'
  return crypto.createHash('sha256').update(userAgent).digest('hex').slice(0, 32)
}

function isSecureRequest(request: NextRequest) {
  return (
    request.headers.get('x-forwarded-proto') === 'https' ||
    request.nextUrl.protocol === 'https:' ||
    process.env.HTTPS_ENABLED === 'true' ||
    process.env.HTTPS_ENABLED === '1'
  )
}

export function attachSupportCookie(response: NextResponse, token: string, request: NextRequest) {
  response.cookies.set({
    name: SUPPORT_COOKIE,
    value: token,
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: 'lax',
    path: '/',
    maxAge: SUPPORT_COOKIE_MAX_AGE,
  })
}

export function clearSupportCookie(response: NextResponse, request: NextRequest) {
  response.cookies.set({
    name: SUPPORT_COOKIE,
    value: '',
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}

export function isSameOriginSupportRequest(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    const originUrl = new URL(origin)
    const host = request.headers.get('host')
    if (host && originUrl.host === host) return true
    return originUrl.origin === request.nextUrl.origin
  } catch {
    return false
  }
}

export async function resolveSupportVisitor(request: NextRequest) {
  const currentToken = request.cookies.get(SUPPORT_COOKIE)?.value
  let visitor = currentToken
    ? await prisma.supportVisitor.findUnique({ where: { sessionHash: sessionHash(currentToken) } })
    : null

  if (visitor?.deletedAt) visitor = null

  const user = await getCurrentUserFromRequest(request).catch((error) => {
    logError('[SUPPORT] failed to resolve logged-in user:', error)
    return null
  })

  // A browser that switches accounts must not inherit the previous account's
  // anonymous conversation history. Rotate the support session when the linked
  // user changes.
  if (visitor?.userId && user?.id && visitor.userId !== user.id) visitor = null

  let token = currentToken
  if (!visitor) {
    token = crypto.randomBytes(SUPPORT_SESSION_TOKEN_BYTES).toString('base64url')
    visitor = await prisma.supportVisitor.create({
      data: {
        sessionHash: sessionHash(token),
        userId: user?.id ?? null,
        name: user?.name ?? null,
        email: user?.email ?? null,
        ipHash: hashSupportIp(request),
        userAgentHash: hashSupportUserAgent(request),
      },
    })
  } else {
    visitor = await prisma.supportVisitor.update({
      where: { id: visitor.id },
      data: {
        lastSeenAt: new Date(),
        ...(user && !visitor.userId
          ? { userId: user.id, name: user.name ?? visitor.name, email: user.email ?? visitor.email }
          : {}),
      },
    })
  }

  return { visitor, user, token: token || null }
}

export function sanitizeSupportPagePath(value: unknown) {
  if (typeof value !== 'string') return null
  const path = value.split('?')[0].split('#')[0].trim()
  if (!path.startsWith('/') || path.length > 300) return null
  return path
}
