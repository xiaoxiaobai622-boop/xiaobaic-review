import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { getRequestedTeamId, getTeamMember } from '@/lib/team-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const requestedTeamId = getRequestedTeamId(request)
  const membership = requestedTeamId
    ? await getTeamMember(requestedTeamId, user.id)
    : await prisma.teamMember.findFirst({
        where: { userId: user.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      })

  if (!membership || membership.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'You do not belong to a team' }, { status: 403 })
  }

  const settings = await prisma.teamSettings.upsert({
    where: { teamId: membership.teamId },
    create: { teamId: membership.teamId },
    update: {},
  })

  return NextResponse.json({ settings, role: membership.role })
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const requestedTeamId = getRequestedTeamId(request)
  const membership = requestedTeamId
    ? await getTeamMember(requestedTeamId, user.id)
    : await prisma.teamMember.findFirst({
        where: { userId: user.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      })

  if (!membership || membership.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'You do not belong to a team' }, { status: 403 })
  }
  if (!['OWNER', 'ADMIN'].includes(membership.role)) {
    return NextResponse.json({ error: 'Administrator permission required' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const fields = [
    'defaultWatermarkEnabled',
    'defaultWatermarkText',
    'defaultWatermarkPositions',
    'defaultWatermarkOpacity',
    'defaultWatermarkFontSize',
    'defaultApplyPreviewLut',
    'maxUploadSizeGB',
    'defaultTimestampDisplay',
    'defaultUsePreviewForApprovedPlayback',
    'defaultAllowClientAssetUpload',
    'defaultAllowReverseShare',
    'defaultShowClientTutorial',
    'defaultAllowAssetDownload',
    'defaultClientCanApprove',
    'autoApproveProject',
  ] as const

  const data: Record<string, unknown> = {}
  for (const field of fields) {
    if (body[field] !== undefined) data[field] = body[field]
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const settings = await prisma.teamSettings.upsert({
    where: { teamId: membership.teamId },
    create: { teamId: membership.teamId, ...data },
    update: data,
  })

  return NextResponse.json({ settings })
}
