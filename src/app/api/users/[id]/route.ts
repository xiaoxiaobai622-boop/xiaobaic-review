import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin, requireApiUser, getCurrentUserFromRequest } from '@/lib/auth'
import { hashPassword, validateSixDigitPassword, verifyPassword } from '@/lib/encryption'
import { revokeAllUserTokens } from '@/lib/token-revocation'
import { invalidateAdminSessions } from '@/lib/session-invalidation'
import { rateLimit } from '@/lib/rate-limit'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'
import { createPhoneOnlyEmail, isPhoneOnlyEmail } from '@/lib/user-contact'

export const runtime = 'nodejs'



export const dynamic = 'force-dynamic'

// GET /api/users/[id] - Get user by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const usersMessages = messages?.users || {}

  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) {
    return authResult
  }

  const { id } = await params
  if (authResult.role !== 'ADMIN' && authResult.id !== id) {
    return NextResponse.json({ error: 'You can only view your own profile' }, { status: 403 })
  }

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: usersMessages.tooManyRequestsSlowDown || 'Too many requests. Please slow down.'
  }, 'user-read')

  if (rateLimitResult) {
    return rateLimitResult
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        phone: true,
        username: true,
        name: true,
        role: true,
        projectAccessScope: true,
        projectMemberships: {
          select: { project: { select: { id: true, title: true, projectCode: true } } },
        },
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!user) {
      return NextResponse.json(
        { error: usersMessages.userNotFound || 'User not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ user })
  } catch (error) {
    logError('Error fetching user:', error)
    // SECURITY: Generic message
    return NextResponse.json(
      { error: usersMessages.unableToProcessRequest || 'Unable to process request' },
      { status: 500 }
    )
  }
}

// PATCH /api/users/[id] - Update user
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const usersMessages = messages?.users || {}

  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) {
    return authResult
  }

  try {
    const { id } = await params
    if (authResult.role !== 'ADMIN' && authResult.id !== id) {
      return NextResponse.json({ error: 'You can only update your own profile' }, { status: 403 })
    }
    const body = await request.json()
    const { email, phone, username, name, password, oldPassword, role, projectAccessScope, projectIds } = body
    const currentAccess = await prisma.user.findUnique({
      where: { id },
      select: { role: true, projectAccessScope: true, email: true, phone: true },
    })
    if (!currentAccess) {
      return NextResponse.json({ error: usersMessages.userNotFound || 'User not found' }, { status: 404 })
    }
    if (authResult.role !== 'ADMIN' && (role !== undefined || projectAccessScope !== undefined || projectIds !== undefined || username !== undefined)) {
      return NextResponse.json({ error: 'Administrator permission required' }, { status: 403 })
    }
    if (role !== undefined && role !== 'ADMIN' && role !== 'MEMBER') {
      return NextResponse.json({ error: '角色必须是管理员或团队成员' }, { status: 400 })
    }
    if (projectAccessScope !== undefined && projectAccessScope !== 'ALL_PROJECTS' && projectAccessScope !== 'ASSIGNED_ONLY') {
      return NextResponse.json({ error: '项目访问范围无效' }, { status: 400 })
    }

    const updateData: any = {}

    let roleChanged = false

    if (email !== undefined && email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      return NextResponse.json({ error: '请输入有效的邮箱地址' }, { status: 400 })
    }
    
    if (email !== undefined && email !== '') {
      const existingUser = await prisma.user.findFirst({
        where: {
          email,
          NOT: { id },
        },
      })

      if (existingUser) {
        return NextResponse.json(
          { error: usersMessages.emailAlreadyTaken || 'Email already taken' },
          { status: 409 }
        )
      }

      updateData.email = email
    }

    if (username !== undefined) {
      const existingUsername = await prisma.user.findFirst({
        where: {
          username,
          NOT: { id },
        },
      })

      if (existingUsername) {
        return NextResponse.json(
          { error: usersMessages.usernameAlreadyTaken || 'Username already taken' },
          { status: 409 }
        )
      }

      updateData.username = username || null
    }

    if (name !== undefined) {
      updateData.name = name
    }

    if (role !== undefined) {
      if (role !== 'ADMIN' && role !== 'MEMBER') {
        return NextResponse.json(
          { error: '角色必须是管理员或团队成员' },
          { status: 400 }
        )
      }

      if (authResult.id === id && role !== 'ADMIN') {
        return NextResponse.json({ error: '不能将当前登录的管理员改为团队成员' }, { status: 400 })
      }

      if (currentAccess.role !== role) {
        updateData.role = role
        roleChanged = true
      }
    }

    if (phone !== undefined) {
      const normalizedPhone = String(phone).replace(/\D/g, '')
      if (normalizedPhone && !/^1\d{10}$/.test(normalizedPhone)) {
        return NextResponse.json({ error: '请输入有效的 11 位手机号' }, { status: 400 })
      }
      const existingPhone = normalizedPhone
        ? await prisma.user.findFirst({ where: { phone: normalizedPhone, NOT: { id } } })
        : null
      if (existingPhone) return NextResponse.json({ error: '该手机号已被使用' }, { status: 409 })
      updateData.phone = normalizedPhone || null
    }

    const normalizedRequestedPhone = phone === undefined ? currentAccess.phone : String(phone).replace(/\D/g, '') || null
    const requestedEmail = email === undefined ? currentAccess.email : String(email).trim()
    const finalPublicEmail = requestedEmail && !isPhoneOnlyEmail(requestedEmail) ? requestedEmail : ''
    if (!finalPublicEmail && !normalizedRequestedPhone) {
      return NextResponse.json({ error: 'Email or phone is required' }, { status: 400 })
    }
    if (!finalPublicEmail) {
      updateData.email = createPhoneOnlyEmail(normalizedRequestedPhone!)
    } else if (email === undefined && isPhoneOnlyEmail(currentAccess.email)) {
      updateData.email = currentAccess.email
    }

    const targetRole = role || currentAccess.role
    const resolvedScope = targetRole === 'ADMIN'
      ? 'ALL_PROJECTS'
      : projectAccessScope === undefined
        ? currentAccess.projectAccessScope
        : projectAccessScope === 'ASSIGNED_ONLY' ? 'ASSIGNED_ONLY' : 'ALL_PROJECTS'
    const accessChanged = role !== undefined || projectAccessScope !== undefined || projectIds !== undefined
    if (role !== undefined || projectAccessScope !== undefined) {
      updateData.projectAccessScope = resolvedScope
    }

    const assignedProjectIds = Array.isArray(projectIds)
      ? [...new Set(projectIds.filter((projectId: unknown): projectId is string => typeof projectId === 'string'))]
      : null
    if (assignedProjectIds) {
      const projectCount = await prisma.project.count({ where: { id: { in: assignedProjectIds } } })
      if (projectCount !== assignedProjectIds.length) {
        return NextResponse.json({ error: '包含不存在的项目' }, { status: 400 })
      }
    }

    let passwordChanged = false

    const newPassword = typeof password === 'string' ? password.trim() : ''
    const oldPasswordStr = typeof oldPassword === 'string' ? oldPassword : ''
    const passwordValidation = validateSixDigitPassword(newPassword)

    if (password !== undefined && !passwordValidation.isValid) {
      return NextResponse.json({ error: passwordValidation.errors[0] }, { status: 400 })
    }

    if (password !== undefined && passwordValidation.isValid) {
      const userWithPassword = await prisma.user.findUnique({
        where: { id },
        select: { password: true },
      })

      if (!userWithPassword) {
        return NextResponse.json(
          { error: usersMessages.userNotFound || 'User not found' },
          { status: 404 }
        )
      }

      // SECURITY: Verify old password before allowing password change
      const isOldPasswordValid = await verifyPassword(oldPasswordStr, userWithPassword.password)
      if (!isOldPasswordValid) {
        return NextResponse.json(
          { error: usersMessages.currentPasswordIncorrect || 'Current password is incorrect' },
          { status: 401 }
        )
      }

      updateData.password = await hashPassword(newPassword)
      passwordChanged = true
    }

    const user = await prisma.$transaction(async (tx) => {
      if (accessChanged && (assignedProjectIds || resolvedScope === 'ALL_PROJECTS')) {
        await tx.projectMember.deleteMany({ where: { userId: id } })
      }
      if (accessChanged && resolvedScope === 'ASSIGNED_ONLY' && assignedProjectIds?.length) {
        await tx.projectMember.createMany({
          data: assignedProjectIds.map((projectId) => ({ userId: id, projectId })),
          skipDuplicates: true,
        })
      }
      return tx.user.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          email: true,
          phone: true,
          username: true,
          name: true,
          role: true,
          projectAccessScope: true,
          projectMemberships: {
            select: { project: { select: { id: true, title: true, projectCode: true } } },
          },
          createdAt: true,
          updatedAt: true,
        },
      })
    })

    // SECURITY: Handle session invalidation for sensitive changes
    const currentUser = await getCurrentUserFromRequest(request)
    let securityMessage = ''

    if (passwordChanged) {
      if (currentUser && currentUser.id === id) {
        await revokeAllUserTokens(user.id)
      } else {
        await revokeAllUserTokens(user.id)
      }

      securityMessage = usersMessages.allSessionsInvalidatedUserMustLoginAgain || 'All sessions have been invalidated - user will need to log in again.'
    }

    if (roleChanged) {
      if (currentUser && currentUser.id === id) {
        await revokeAllUserTokens(user.id)
        securityMessage = securityMessage
          ? `${securityMessage} ${usersMessages.roleUpdatedLoginAgainToRefreshPermissions || 'Role updated - please log in again to refresh permissions.'}`
          : (usersMessages.roleUpdatedLoginAgainToRefreshPermissions || 'Role updated - please log in again to refresh permissions.')
      } else {
        await revokeAllUserTokens(user.id)
        securityMessage = securityMessage
          ? `${securityMessage} ${usersMessages.roleChangedUserMustLoginAgain || 'Role changed - user will need to log in again.'}`
          : (usersMessages.roleChangedUserMustLoginAgainToReflectPermissions || 'Role changed - user will need to log in again to reflect new permissions.')
      }
    }

    return NextResponse.json({
      user,
      message: securityMessage || usersMessages.userUpdatedSuccessfully || 'User updated successfully'
    })
  } catch (error) {
    logError('Error updating user:', error)
    // SECURITY: Generic message
    return NextResponse.json(
      { error: usersMessages.operationFailed || 'Operation failed' },
      { status: 500 }
    )
  }
}

// DELETE /api/users/[id] - Delete user
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const usersMessages = messages?.users || {}

  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }

  try {
    const { id } = await params
    const currentUser = authResult

    if (currentUser.id === id) {
      return NextResponse.json(
        { error: usersMessages.cannotDeleteOwnAccount || 'Cannot delete your own account' },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { id },
    })

    if (!user) {
      return NextResponse.json(
        { error: usersMessages.userNotFound || 'User not found' },
        { status: 404 }
      )
    }

    // Invalidate all sessions before deletion so active tokens are revoked immediately
    await invalidateAdminSessions(id)

    await prisma.user.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('Error deleting user:', error)
    // SECURITY: Generic message
    return NextResponse.json(
      { error: usersMessages.operationFailed || 'Operation failed' },
      { status: 500 }
    )
  }
}
