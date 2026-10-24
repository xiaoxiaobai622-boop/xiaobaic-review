import { prisma } from './db'
import { normalizePhone, phoneStoreFields, phoneWhereOrNone, readPhone } from './phone-field'

const ROLE_PRIORITY: Record<string, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 }

interface MergeParams {
  sourceUserId: string
  targetUserId: string
  phone: string
  nickname?: string | null
  avatarUrl?: string | null
}

/**
 * Merge the WeChat placeholder account into the existing account that owns the
 * same phone number. The target account survives; its credentials and team
 * roles stay intact. Every User foreign key has to be moved (or deduped) before
 * the source row is deleted, otherwise the delete either cascades data away or
 * trips a Restrict constraint.
 */
export async function mergeWechatUserIntoPhoneAccount(params: MergeParams) {
  const { sourceUserId, targetUserId, phone, nickname, avatarUrl } = params
  if (sourceUserId === targetUserId) {
    return prisma.user.findUniqueOrThrow({ where: { id: targetUserId } })
  }

  const storedPhone = phoneStoreFields(phone)

  return prisma.$transaction(async (tx) => {
    const source = await tx.user.findUniqueOrThrow({ where: { id: sourceUserId } })
    const target = await tx.user.findUniqueOrThrow({ where: { id: targetUserId } })

    const targetTeamMemberships = await tx.teamMember.findMany({ where: { userId: targetUserId } })
    const sourceTeamMemberships = await tx.teamMember.findMany({ where: { userId: sourceUserId } })
    for (const membership of sourceTeamMemberships) {
      const existing = targetTeamMemberships.find((item) => item.teamId === membership.teamId)
      if (!existing) {
        await tx.teamMember.update({ where: { id: membership.id }, data: { userId: targetUserId } })
        continue
      }
      const higherRole = (ROLE_PRIORITY[membership.role] || 0) > (ROLE_PRIORITY[existing.role] || 0)
        ? membership.role
        : existing.role
      await tx.teamMember.update({
        where: { id: existing.id },
        data: { role: higherRole as any, status: 'ACTIVE' },
      })
      await tx.teamMember.delete({ where: { id: membership.id } })
    }

    const targetProjectMemberships = await tx.projectMember.findMany({ where: { userId: targetUserId } })
    const sourceProjectMemberships = await tx.projectMember.findMany({ where: { userId: sourceUserId } })
    for (const membership of sourceProjectMemberships) {
      const duplicate = targetProjectMemberships.some((item) => item.projectId === membership.projectId)
      if (duplicate) {
        await tx.projectMember.delete({ where: { id: membership.id } })
      } else {
        await tx.projectMember.update({ where: { id: membership.id }, data: { userId: targetUserId } })
      }
    }

    const targetJoinRequests = await tx.teamJoinRequest.findMany({ where: { userId: targetUserId } })
    const sourceJoinRequests = await tx.teamJoinRequest.findMany({ where: { userId: sourceUserId } })
    for (const request of sourceJoinRequests) {
      const duplicate = targetJoinRequests.some(
        (item) => item.teamId === request.teamId && item.status === request.status
      )
      if (duplicate) {
        await tx.teamJoinRequest.delete({ where: { id: request.id } })
      } else {
        await tx.teamJoinRequest.update({ where: { id: request.id }, data: { userId: targetUserId } })
      }
    }

    const targetPushEndpoints = new Set(
      (await tx.pushSubscription.findMany({
        where: { userId: targetUserId },
        select: { endpoint: true },
      })).map((item) => item.endpoint)
    )
    const sourcePushSubscriptions = await tx.pushSubscription.findMany({ where: { userId: sourceUserId } })
    for (const subscription of sourcePushSubscriptions) {
      if (targetPushEndpoints.has(subscription.endpoint)) {
        await tx.pushSubscription.delete({ where: { id: subscription.id } })
      } else {
        await tx.pushSubscription.update({
          where: { id: subscription.id },
          data: { userId: targetUserId },
        })
      }
    }

    await tx.project.updateMany({ where: { createdById: sourceUserId }, data: { createdById: targetUserId } })
    await tx.team.updateMany({ where: { createdById: sourceUserId }, data: { createdById: targetUserId } })
    await tx.teamInvite.updateMany({ where: { createdById: sourceUserId }, data: { createdById: targetUserId } })
    await tx.comment.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } })
    await tx.adminSavedView.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } })
    await tx.passkeyCredential.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } })
    await tx.wechatIdentity.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } })

    // These are Restrict on delete: leaving them on the placeholder makes the
    // final user.delete() fail, so they must move even when the account is new.
    await tx.order.updateMany({ where: { createdById: sourceUserId }, data: { createdById: targetUserId } })
    await tx.order.updateMany({ where: { fulfilledById: sourceUserId }, data: { fulfilledById: targetUserId } })
    await tx.orderEvent.updateMany({ where: { actorUserId: sourceUserId }, data: { actorUserId: targetUserId } })

    await tx.feishuNotification.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } })
    await tx.feishuNotification.updateMany({ where: { uploaderId: sourceUserId }, data: { uploaderId: targetUserId } })
    await tx.platformAnnouncement.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } })
    await tx.platformFeedback.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } })

    // (announcementId, userId) is unique: keep the target's read state and drop
    // the placeholder's duplicate receipts.
    const targetReads = await tx.platformAnnouncementRead.findMany({
      where: { userId: targetUserId },
      select: { announcementId: true },
    })
    const targetReadAnnouncements = new Set(targetReads.map((item) => item.announcementId))
    const sourceReads = await tx.platformAnnouncementRead.findMany({
      where: { userId: sourceUserId },
      select: { id: true, announcementId: true },
    })
    for (const read of sourceReads) {
      if (targetReadAnnouncements.has(read.announcementId)) {
        await tx.platformAnnouncementRead.delete({ where: { id: read.id } })
      } else {
        await tx.platformAnnouncementRead.update({ where: { id: read.id }, data: { userId: targetUserId } })
      }
    }

    // userId is unique on FeishuBinding; the surviving account's binding wins.
    const targetFeishu = await tx.feishuBinding.findUnique({ where: { userId: targetUserId } })
    if (targetFeishu) {
      await tx.feishuBinding.deleteMany({ where: { userId: sourceUserId } })
    } else {
      await tx.feishuBinding.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } })
    }

    const targetCalendar = await tx.calendarToken.findUnique({ where: { userId: targetUserId } })
    if (targetCalendar) {
      await tx.calendarToken.deleteMany({ where: { userId: sourceUserId } })
    } else {
      await tx.calendarToken.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } })
    }

    const profile: { name?: string; avatarUrl?: string; phone?: string; phoneHash?: string } = {}
    if (!target.name) {
      const name = source.name || nickname || null
      if (name) profile.name = name
    }
    if (!target.avatarUrl) {
      const avatar = source.avatarUrl || avatarUrl || null
      if (avatar) profile.avatarUrl = avatar
    }
    const targetPhone = normalizePhone(readPhone(target.phone ?? ''))
    if (targetPhone !== phone && storedPhone.phone) {
      profile.phone = storedPhone.phone
      if (storedPhone.phoneHash) profile.phoneHash = storedPhone.phoneHash
    }
    if (Object.keys(profile).length) {
      await tx.user.update({ where: { id: targetUserId }, data: profile })
    }

    await tx.user.delete({ where: { id: sourceUserId } })
    return tx.user.findUniqueOrThrow({ where: { id: targetUserId } })
  })
}

export async function bindPhoneToWechatUser(params: {
  userId: string
  phone: string
  nickname?: string | null
  avatarUrl?: string | null
}) {
  const { userId, phone, nickname, avatarUrl } = params
  const existing = await prisma.user.findFirst({ where: phoneWhereOrNone(phone) })

  if (existing && existing.id !== userId) {
    const user = await mergeWechatUserIntoPhoneAccount({
      sourceUserId: userId,
      targetUserId: existing.id,
      phone,
      nickname,
      avatarUrl,
    })
    return { user, merged: true }
  }

  const current = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  const storedPhone = phoneStoreFields(phone)
  const data: { phone?: string; phoneHash?: string; name?: string; avatarUrl?: string } = {}
  if (storedPhone.phone) data.phone = storedPhone.phone
  if (storedPhone.phoneHash) data.phoneHash = storedPhone.phoneHash
  if (!current.name && nickname) data.name = nickname
  if (!current.avatarUrl && avatarUrl) data.avatarUrl = avatarUrl
  const user = await prisma.user.update({ where: { id: userId }, data })
  return { user, merged: false }
}
