import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { InAppRecipient } from './types'

type DbClient = Prisma.TransactionClient | typeof prisma

export interface NotificationProject {
  id: string
  title: string
  teamId: string
  restricted: boolean
  createdById: string
}

export interface ProjectViewer extends InAppRecipient {
  role: string
}

const VIEWER_SELECT = {
  userId: true,
  role: true,
  user: { select: { name: true, email: true } },
} as const

function toViewer(row: {
  userId: string
  role: string
  user: { name: string | null; email: string | null }
}): ProjectViewer {
  return {
    userId: row.userId,
    role: row.role,
    name: row.user.name,
    email: row.user.email,
  }
}

function dedupeRecipients(rows: InAppRecipient[], excludeUserId?: string | null): InAppRecipient[] {
  const seen = new Set<string>()
  const result: InAppRecipient[] = []
  for (const row of rows) {
    if (!row.userId || row.userId === excludeUserId || seen.has(row.userId)) continue
    seen.add(row.userId)
    result.push(row)
  }
  return result
}

export async function loadNotificationProject(
  projectId: string,
  db: DbClient = prisma,
): Promise<NotificationProject | null> {
  return db.project.findUnique({
    where: { id: projectId },
    select: { id: true, title: true, teamId: true, restricted: true, createdById: true },
  })
}

/**
 * 「能打开这个项目的人」：团队 ACTIVE 成员里，管理员、全部项目成员、
 * 或在本项目单独授权的人；受限项目只保留管理员和本项目授权成员。
 * 这是站内团队动态的唯一收件人口径，和项目成员面板保持同一套规则。
 */
export async function resolveProjectViewers(
  projectId: string,
  options: { excludeUserId?: string | null; db?: DbClient } = {},
): Promise<ProjectViewer[]> {
  const db = options.db ?? prisma
  const project = await loadNotificationProject(projectId, db)
  if (!project) return []

  const rows = await db.teamMember.findMany({
    where: {
      teamId: project.teamId,
      status: 'ACTIVE',
      OR: project.restricted
        ? [
            { role: { in: ['OWNER', 'ADMIN'] } },
            { user: { projectMemberships: { some: { projectId } } } },
          ]
        : [
            { role: { in: ['OWNER', 'ADMIN'] } },
            { user: { projectAccessScope: { not: 'ASSIGNED_ONLY' } } },
            { user: { projectMemberships: { some: { projectId } } } },
          ],
    },
    select: VIEWER_SELECT,
  })

  return dedupeRecipients(rows.map(toViewer), options.excludeUserId) as ProjectViewer[]
}

/**
 * 「项目负责人」：OWNER/ADMIN + 项目创建人 + 显式项目成员。
 * 审批类事件只发给这一组，避免整个团队被审批通知刷屏。
 */
export async function resolveProjectLeads(
  projectId: string,
  options: { excludeUserId?: string | null; db?: DbClient } = {},
): Promise<InAppRecipient[]> {
  const db = options.db ?? prisma
  const project = await loadNotificationProject(projectId, db)
  if (!project) return []

  const rows = await db.teamMember.findMany({
    where: {
      teamId: project.teamId,
      status: 'ACTIVE',
      OR: [
        { role: { in: ['OWNER', 'ADMIN'] } },
        { userId: project.createdById },
        { user: { projectMemberships: { some: { projectId } } } },
      ],
    },
    select: VIEWER_SELECT,
  })

  return dedupeRecipients(rows.map(toViewer), options.excludeUserId)
}

export function findParentAuthor(
  viewers: InAppRecipient[],
  parent: { userId?: string | null; authorEmail?: string | null } | null | undefined,
  actorUserId?: string | null,
): InAppRecipient | null {
  if (!parent) return null
  if (parent.userId) {
    const byId = viewers.find((viewer) => viewer.userId === parent.userId)
    if (byId && byId.userId !== actorUserId) return byId
  }
  const email = parent.authorEmail?.trim().toLowerCase()
  if (!email) return null
  const byEmail = viewers.find((viewer) => viewer.email?.trim().toLowerCase() === email)
  return byEmail && byEmail.userId !== actorUserId ? byEmail : null
}

export function intersectMentionedViewers(
  viewers: InAppRecipient[],
  mentionedUserIds: string[] | null | undefined,
  actorUserId?: string | null,
): InAppRecipient[] {
  if (!mentionedUserIds || mentionedUserIds.length === 0) return []
  const allowed = new Map(viewers.map((viewer) => [viewer.userId, viewer]))
  const seen = new Set<string>()
  const result: InAppRecipient[] = []
  for (const id of mentionedUserIds) {
    const viewer = allowed.get(id)
    if (!viewer || viewer.userId === actorUserId || seen.has(id)) continue
    seen.add(id)
    result.push(viewer)
  }
  return result
}

export async function isActiveTeamMember(userId: string, teamId: string): Promise<boolean> {
  const member = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { status: true, team: { select: { status: true } } },
  })
  return Boolean(member && member.status === 'ACTIVE' && member.team.status === 'ACTIVE')
}
