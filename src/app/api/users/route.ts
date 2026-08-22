import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requirePlatformAdmin } from '@/lib/auth'
import { hashPassword, validateSixDigitPassword } from '@/lib/encryption'
import { rateLimit } from '@/lib/rate-limit'
import { validateRequest, createUserSchema } from '@/lib/validation'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { createPhoneOnlyEmail } from '@/lib/user-contact'
export const runtime = 'nodejs'



// Prevent static generation for this route
export const dynamic = 'force-dynamic'

// GET /api/users - List all users
export async function GET(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const usersMessages = messages?.users || {}

  const authResult = await requirePlatformAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }

  // Rate limiting: 100 requests per minute for listing users
  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 100,
    message: usersMessages.tooManyRequestsSlowDown || 'Too many requests. Please slow down.'
  }, 'admin-users-list')

  if (rateLimitResult) {
    return rateLimitResult
  }

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        phone: true,
        username: true,
        name: true,
        role: true,
        isPlatformAdmin: true,
        projectAccessScope: true,
        projectMemberships: {
          select: { project: { select: { id: true, title: true, projectCode: true } } },
        },
        createdAt: true,
        updatedAt: true,
        // Exclude password from response
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return NextResponse.json({ users })
  } catch (error) {
    return NextResponse.json(
      { error: usersMessages.unableToProcessRequest || 'Unable to process request' },
      { status: 500 }
    )
  }
}

// POST /api/users - Create a new admin user
export async function POST(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const usersMessages = messages?.users || {}

  const authResult = await requirePlatformAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }

  // Rate limiting: 10 user creation requests per minute
  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 10,
    message: usersMessages.tooManyUserCreationRequests || 'Too many user creation requests. Please slow down.'
  }, 'admin-users-create')

  if (rateLimitResult) {
    return rateLimitResult
  }

  try {
    const body = await request.json()

    // Validate input with Zod schema
    const validation = validateRequest(createUserSchema, body)
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error, details: validation.details },
        { status: 400 }
      )
    }

    const {
      email,
      phone,
      username,
      password,
      name,
      role: validatedRole,
      isPlatformAdmin = false,
      projectAccessScope: validatedProjectAccessScope,
      projectIds: validatedProjectIds = [],
    } = validation.data
    const resolvedEmail = email || createPhoneOnlyEmail(phone!)
    const role = validatedRole === 'MEMBER' ? 'MEMBER' : 'ADMIN'
    const projectAccessScope = role === 'MEMBER' && validatedProjectAccessScope === 'ASSIGNED_ONLY'
      ? 'ASSIGNED_ONLY'
      : 'ALL_PROJECTS'
    const projectIds = [...new Set(validatedProjectIds)]

    // Validate password strength (additional check beyond Zod format validation)
    const passwordValidation = validateSixDigitPassword(password)
    if (!passwordValidation.isValid) {
      return NextResponse.json(
        { error: usersMessages.passwordDoesNotMeetRequirements || 'Password does not meet requirements', details: passwordValidation.errors },
        { status: 400 }
      )
    }

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: resolvedEmail },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: usersMessages.userWithEmailAlreadyExists || 'User with this email already exists' },
        { status: 409 }
      )
    }

    // Check if username already exists (if provided)
    if (username) {
      const existingUsername = await prisma.user.findUnique({
        where: { username },
      })

      if (existingUsername) {
        return NextResponse.json(
          { error: usersMessages.usernameAlreadyTaken || 'Username already taken' },
          { status: 409 }
        )
      }
    }

    // Hash password
    const hashedPassword = await hashPassword(password)

    if (projectAccessScope === 'ASSIGNED_ONLY' && projectIds.length > 0) {
      const projectCount = await prisma.project.count({ where: { id: { in: projectIds } } })
      if (projectCount !== projectIds.length) {
        return NextResponse.json({ error: '包含不存在的项目' }, { status: 400 })
      }
    }

    if (phone) {
      const existingPhone = await prisma.user.findUnique({ where: { phone } })
      if (existingPhone) return NextResponse.json({ error: '该手机号已被使用' }, { status: 409 })
    }

    const user = await prisma.user.create({
        data: {
          email: resolvedEmail,
          phone: phone || null,
          username: username || null,
          password: hashedPassword,
          name: name || null,
          role,
          isPlatformAdmin,
          projectAccessScope,
          projectMemberships: projectAccessScope === 'ASSIGNED_ONLY'
            ? { create: projectIds.map((projectId) => ({ projectId })) }
            : undefined,
        },
        select: {
          id: true,
          email: true,
          phone: true,
          username: true,
          name: true,
          role: true,
          isPlatformAdmin: true,
          projectAccessScope: true,
          projectMemberships: {
            select: { project: { select: { id: true, title: true, projectCode: true } } },
          },
          createdAt: true,
          updatedAt: true,
        },
      })

    return NextResponse.json({ user }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: usersMessages.operationFailed || 'Operation failed' },
      { status: 500 }
    )
  }
}
