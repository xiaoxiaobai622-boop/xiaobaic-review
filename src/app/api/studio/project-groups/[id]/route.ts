import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireApiAdmin } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { updateProjectGroupSchema, validateRequest } from '@/lib/validation'
import { sanitizeText } from '@/lib/security/html-sanitization'
import { MAX_FOLDER_DEPTH, folderDepth, subtreeDepth, wouldCreateCycle } from '@/lib/project-folders'
import { getConfiguredLocale, loadLocaleMessages } from '@/i18n/locale'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GROUP_SELECT = { id: true, name: true, parentId: true } as const

type RouteContext = { params: Promise<{ id: string }> }

async function resolveTeam(request: NextRequest) {
  const authResult = await requireApiAdmin(request)
  if (authResult instanceof Response) return { response: authResult } as const
  const teamId = authResult.authorizedTeamId
  if (!teamId) {
    return { response: NextResponse.json({ error: 'You do not belong to a team' }, { status: 403 }) } as const
  }
  return { teamId } as const
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const projectMessages = messages?.projects || {}

  const auth = await resolveTeam(request)
  if ('response' in auth) return auth.response

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: projectMessages.tooManyRequestsGeneric || 'Too many requests. Please slow down.',
  }, 'project-groups-update')
  if (rateLimitResult) return rateLimitResult

  const { id } = await params

  try {
    const body = await request.json()
    const validation = validateRequest(updateProjectGroupSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error, details: validation.details }, { status: 400 })
    }

    const name = validation.data.name === undefined
      ? undefined
      : sanitizeText(validation.data.name)
    // Validation runs before sanitization, so an XSS payload can arrive valid and leave empty.
    if (validation.data.name !== undefined && !name) {
      return NextResponse.json({ error: projectMessages.folderNameRequired }, { status: 400 })
    }

    // Scoped by teamId, so an id from another team reads as "not found" rather than touching their folder.
    const own = await prisma.projectGroup.findFirst({
      where: { id, teamId: auth.teamId },
      select: { id: true },
    })
    if (!own) {
      return NextResponse.json({ error: projectMessages.folderNotFound }, { status: 404 })
    }

    const data: { name?: string; parentId?: string | null } = {}
    if (name !== undefined) data.name = name

    if (validation.data.parentId !== undefined) {
      const nextParentId = validation.data.parentId
      if (nextParentId) {
        const folders = await prisma.projectGroup.findMany({
          where: { teamId: auth.teamId },
          select: { id: true, name: true, parentId: true },
        })
        if (!folders.some(f => f.id === nextParentId)) {
          return NextResponse.json({ error: projectMessages.folderParentNotFound }, { status: 400 })
        }
        if (wouldCreateCycle(folders, id, nextParentId)) {
          return NextResponse.json({ error: projectMessages.folderCycleNotAllowed }, { status: 400 })
        }
        // The subtree keeps its shape when it moves, so only its new top can break the cap.
        const deepestAfterMove = folderDepth(folders, nextParentId) + subtreeDepth(folders, [id]) - 1
        if (deepestAfterMove > MAX_FOLDER_DEPTH) {
          return NextResponse.json({ error: projectMessages.folderTooDeep }, { status: 400 })
        }
      }
      data.parentId = nextParentId
    }

    const group = await prisma.projectGroup.update({ where: { id }, data, select: GROUP_SELECT })
    return NextResponse.json({ group })
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: projectMessages.folderNameTaken }, { status: 409 })
    }
    logError('[API] Failed to rename project folder:', error)
    return NextResponse.json(
      { error: projectMessages.unableToProcessRequest || 'Unable to process request' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const locale = await getConfiguredLocale().catch(() => 'en')
  const messages = await loadLocaleMessages(locale).catch(() => null)
  const projectMessages = messages?.projects || {}

  const auth = await resolveTeam(request)
  if ('response' in auth) return auth.response

  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: projectMessages.tooManyRequestsGeneric || 'Too many requests. Please slow down.',
  }, 'project-groups-delete')
  if (rateLimitResult) return rateLimitResult

  const { id } = await params

  try {
    // Project.groupId is ON DELETE SET NULL: the folder goes, its projects fall back to
    // "未归类" instead of being taken with it.
    const deleted = await prisma.projectGroup.deleteMany({ where: { id, teamId: auth.teamId } })
    if (deleted.count === 0) {
      return NextResponse.json({ error: projectMessages.folderNotFound }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    logError('[API] Failed to delete project folder:', error)
    return NextResponse.json(
      { error: projectMessages.unableToProcessRequest || 'Unable to process request' },
      { status: 500 }
    )
  }
}
