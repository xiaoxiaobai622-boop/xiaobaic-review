import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin, requireApiUser } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { createProjectGroupSchema, validateRequest } from '@/lib/validation'
import { sanitizeText } from '@/lib/security/html-sanitization'
import { MAX_FOLDER_DEPTH, folderDepth } from '@/lib/project-folders'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Counts are deliberately not returned here: the console derives them from the
// project list it already loaded, which is scoped per member. A server-side count
// would publish "how many projects a colleague has" to MEMBER accounts.
const GROUP_SELECT = { id: true, name: true, parentId: true } as const

// Past this point the bar stops being scannable, and one member could otherwise
// fill the team's list with junk names.
const MAX_GROUPS_PER_TEAM = 50

export async function GET(request: NextRequest) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const projectMessages = messages?.projects || {}

  // Members read the folders too — the console project list is not admin-only.
  const authResult = await requireApiUser(request)
  if (authResult instanceof Response) return authResult
  const teamId = authResult.authorizedTeamId
  if (!teamId) return NextResponse.json({ error: 'You do not belong to a team' }, { status: 403 })

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: projectMessages.tooManyRequestsGeneric || 'Too many requests. Please slow down.',
  }, 'project-groups-list')
  if (rateLimitResult) return rateLimitResult

  try {
    const groups = await prisma.projectGroup.findMany({
      where: { teamId },
      select: GROUP_SELECT,
      orderBy: { name: 'asc' },
    })
    return NextResponse.json({ groups })
  } catch (error) {
    logError('[API] Failed to fetch project folders:', error)
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

  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) return authResult
  const teamId = authResult.authorizedTeamId
  if (!teamId) return NextResponse.json({ error: 'You do not belong to a team' }, { status: 403 })

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: projectMessages.tooManyRequestsGeneric || 'Too many requests. Please slow down.',
  }, 'project-groups-create')
  if (rateLimitResult) return rateLimitResult

  try {
    const body = await request.json()
    const validation = validateRequest(createProjectGroupSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error, details: validation.details }, { status: 400 })
    }

    const name = sanitizeText(validation.data.name)
    // Validation runs before sanitization, so an XSS payload can arrive valid and leave empty.
    if (!name) {
      return NextResponse.json({ error: projectMessages.folderNameRequired }, { status: 400 })
    }

    const parentId = validation.data.parentId ?? null
    if (parentId) {
      const folders = await prisma.projectGroup.findMany({
        where: { teamId },
        select: { id: true, name: true, parentId: true },
      })
      // A parent from another team reads as missing rather than being adopted.
      if (!folders.some(f => f.id === parentId)) {
        return NextResponse.json({ error: projectMessages.folderParentNotFound }, { status: 400 })
      }
      if (folderDepth(folders, parentId) >= MAX_FOLDER_DEPTH) {
        return NextResponse.json({ error: projectMessages.folderTooDeep }, { status: 400 })
      }
    }

    const existingCount = await prisma.projectGroup.count({ where: { teamId } })
    if (existingCount >= MAX_GROUPS_PER_TEAM) {
      return NextResponse.json({ error: projectMessages.folderLimitReached }, { status: 400 })
    }

    const group = await prisma.projectGroup.create({
      data: { teamId, name, parentId },
      select: GROUP_SELECT,
    })
    return NextResponse.json({ group }, { status: 201 })
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: projectMessages.folderNameTaken }, { status: 409 })
    }
    logError('[API] Failed to create project folder:', error)
    return NextResponse.json(
      { error: projectMessages.unableToProcessRequest || 'Unable to process request' },
      { status: 500 }
    )
  }
}
