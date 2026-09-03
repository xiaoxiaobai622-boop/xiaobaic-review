import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateUniqueSlug, generateUniqueTeamShareSlug } from '@/lib/utils'
import { getProjectDefaults } from '@/lib/settings'
import { getTeamQuota, getTeamUsage } from '@/lib/platform-access'
import { requireApiAdmin, requireApiUser } from '@/lib/auth'
import { nextProjectCode, projectAccessWhere } from '@/lib/project-access'
import { encrypt } from '@/lib/encryption'
import { rateLimit } from '@/lib/rate-limit'
import { createProjectSchema, validateRequest } from '@/lib/validation'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'
import { getRequestedTeamId } from '@/lib/team-access'
import {
  checkWechatText,
  CONTENT_SECURITY_ERROR,
  CONTENT_VIOLATION_MESSAGE,
} from '@/lib/wechat-content-security'

export const runtime = 'nodejs'



// Prevent static generation for this route
export const dynamic = 'force-dynamic'

// GET /api/projects - List all projects
export async function GET(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const projectMessages = messages?.projects || {}

  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) {
    return authResult
  }

  // Rate limiting: 100 requests per minute for listing projects
  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 100,
    message: projectMessages.tooManyRequestsGeneric || 'Too many requests. Please slow down.'
  }, 'admin-projects-list')

  if (rateLimitResult) {
    return rateLimitResult
  }

  try {
    // Optimized query: only fetch essential fields + minimal video data for list view
    const projects = await prisma.project.findMany({
      where: projectAccessWhere(authResult, getRequestedTeamId(request)),
      select: {
        id: true,
        projectCode: true,
        title: true,
        slug: true,
        status: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        watermarkEnabled: true,
        sharePassword: true,
        authMode: true,
        hideFeedback: true,
        guestMode: true,
        allowAssetDownload: true,
        allowClientAssetUpload: true,
        previewResolution: true,
        companyName: true,
        clientCompanyId: true,
        clientCompany: {
          select: {
            name: true,
          },
        },
        dueDate: true,
        maxRevisions: true,
        enableRevisions: true,
        videos: {
          where: { status: { not: 'ROLLED_BACK' } },
          select: {
            id: true,
            status: true,
            version: true,
            thumbnailPath: true,
          },
        },
        recipients: {
          select: {
            id: true,
            name: true,
            email: true,
            isPrimary: true,
          },
        },
        _count: {
          select: {
            videos: { where: { status: { not: 'ROLLED_BACK' } } },
            comments: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    const sanitizedProjects = projects.map(({ sharePassword, recipients, ...project }) => ({
      ...project,
      sharePassword: Boolean(sharePassword),
      recipients,
    }))

    return NextResponse.json({ projects: sanitizedProjects })
  } catch (error) {
    return NextResponse.json(
      { error: projectMessages.unableToProcessRequest || 'Unable to process request' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const projectMessages = messages?.projects || {}

  // Check authentication
  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }
  const admin = authResult

  const requestedTeamId = getRequestedTeamId(request)
  const activeMembership = requestedTeamId
    ? await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: requestedTeamId, userId: admin.id } },
        select: { teamId: true, status: true },
      })
    : await prisma.teamMember.findFirst({
        where: { userId: admin.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: { teamId: true, status: true },
      })
  if (!activeMembership || activeMembership.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'You do not belong to a team' }, { status: 403 })
  }

  const [quota, usage] = await Promise.all([
    getTeamQuota(activeMembership.teamId),
    getTeamUsage(activeMembership.teamId),
  ])
  if (quota.maxProjects > 0 && usage.projects >= quota.maxProjects) {
    return NextResponse.json({ error: '当前团队的项目数量已达到配额上限' }, { status: 403 })
  }

  // Rate limiting: Max 20 projects per hour
  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 20,
    message: projectMessages.tooManyProjectsCreated || 'Too many projects created. Please try again later.'
  }, 'create-project')
  if (rateLimitResult) return rateLimitResult

  try {
    const body = await request.json()

    // Validate request body
    const validation = validateRequest(createProjectSchema, body)
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error, details: validation.details },
        { status: 400 }
      )
    }

    const {
      title,
      description,
      companyName,
      clientCompanyId,
      recipientEmail,
      recipientName,
      sharePassword,
      authMode,
      enableRevisions,
      maxRevisions,
      restrictCommentsToLatestVersion,
      dueDate,
      dueReminder,
      isShareOnly
    } = validation.data

    const securityFields = [
      { value: title, scene: 1 },
      { value: description, scene: 3 },
      { value: companyName, scene: 3 },
      { value: recipientName, scene: 1 },
    ]
    for (const field of securityFields) {
      const securityCheck = await checkWechatText(field.value, { userId: admin.id, scene: field.scene as 1 | 2 | 3 | 4 })
      if (!securityCheck.passed) {
        return NextResponse.json(
          { error: securityCheck.error },
          { status: securityCheck.error === CONTENT_VIOLATION_MESSAGE ? 400 : 503 },
        )
      }
    }

    // Normalize auth/password inputs
    const trimmedPassword = sharePassword?.trim()
    const resolvedAuthMode = authMode || 'PASSWORD'

    // Enforce password presence for password-based modes
    if (resolvedAuthMode === 'PASSWORD' || resolvedAuthMode === 'BOTH') {
      if (!trimmedPassword) {
        return NextResponse.json(
          { error: projectMessages.passwordAuthRequiresSharePassword || 'Password authentication mode requires a share password.' },
          { status: 400 }
        )
      }
      // Password strength validation (8+ chars, letter, number) is handled by Zod schema
    }

    // Clear password for modes that don't use it
    const passwordForStorage = (resolvedAuthMode === 'OTP' || resolvedAuthMode === 'NONE')
      ? null
      : (trimmedPassword || null)

    const settings = await getProjectDefaults(activeMembership.teamId)

    // Generate unique slug from title
    const slug = await generateUniqueSlug(title, prisma)
    const shareSlug = await generateUniqueTeamShareSlug(title, activeMembership.teamId, prisma)

    // Encrypt share password if provided (so we can decrypt it later for email notifications)
    const encryptedSharePassword = passwordForStorage ? encrypt(passwordForStorage) : null

    // Use transaction to ensure atomicity: if recipient creation fails, project creation is rolled back
    const project = await prisma.$transaction(async (tx) => {
      const projectCode = await nextProjectCode(tx, activeMembership.teamId)
      const newProject = await tx.project.create({
        data: {
          projectCode,
          title,
          slug,
          shareSlug,
          description,
          companyName: companyName || null,
          clientCompanyId: clientCompanyId || null,
          sharePassword: encryptedSharePassword,
          authMode: resolvedAuthMode,
          enableRevisions: isShareOnly ? false : (enableRevisions || false),
          maxRevisions: isShareOnly ? 0 : (enableRevisions ? (maxRevisions || 3) : 0),
          restrictCommentsToLatestVersion: isShareOnly ? false : (restrictCommentsToLatestVersion || false),
          status: isShareOnly ? 'SHARE_ONLY' : 'IN_REVIEW',
          hideFeedback: isShareOnly ? true : false,
          approvedAt: isShareOnly ? new Date() : null,
          previewResolution: settings?.defaultPreviewResolution || '720p',
          skipTranscoding: settings?.defaultSkipTranscoding ?? false,
          watermarkEnabled: settings?.defaultWatermarkEnabled ?? true,
          watermarkText: settings?.defaultWatermarkText || null,
          watermarkPositions: settings?.defaultWatermarkPositions || 'center',
          watermarkOpacity: settings?.defaultWatermarkOpacity ?? 30,
          watermarkFontSize: settings?.defaultWatermarkFontSize || 'medium',
          timestampDisplay: settings?.defaultTimestampDisplay || 'TIMECODE',
          usePreviewForApprovedPlayback: settings?.defaultUsePreviewForApprovedPlayback ?? false,
          allowClientAssetUpload: settings?.defaultAllowClientAssetUpload ?? false,
          allowReverseShare: settings?.defaultAllowReverseShare ?? false,
          showClientTutorial: settings?.defaultShowClientTutorial ?? true,
          allowAssetDownload: settings?.defaultAllowAssetDownload ?? true,
          clientCanApprove: settings?.defaultClientCanApprove ?? true,
          applyPreviewLut: settings?.defaultApplyPreviewLut ?? true,
          dueDate: dueDate ? new Date(dueDate) : null,
          dueReminder: dueReminder || null,
          createdById: admin.id,
          teamId: activeMembership.teamId,
        },
      })

      // Create recipient if email provided (validated by schema)
      if (recipientEmail) {
        await tx.projectRecipient.create({
          data: {
            projectId: newProject.id,
            email: recipientEmail,
            name: recipientName || null,
            isPrimary: true,
          },
        })
      }

      return newProject
    })

    return NextResponse.json(project)
  } catch (error) {
    logError('[API] Project creation error:', error)
    return NextResponse.json(
      { error: projectMessages.failedToCreateProjectApi || 'Failed to create project' },
      { status: 500 }
    )
  }
}
