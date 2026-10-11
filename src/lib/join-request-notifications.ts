import { prisma } from '@/lib/db'
import { logError, logMessage } from '@/lib/logging'
import { getAppDomain } from '@/lib/url'

/**
 * 一条「申请加入团队」提交之后，负责审批的人凭什么知道？
 *
 * 现状是全仓没有人通知过团队负责人：`TeamJoinRequest` 落库后接口直接返回 201，
 * 唯一的可见处是 团队管理 → 席位成员 里那张「成员审批」卡（`canManage` 之下），
 * 不点开就永远躺着。这里复用两样已有的东西：窄栏「平台消息」（`PlatformAnnouncement`
 * 定向到具体账号，面板 30 秒轮询、已读状态在服务端）与一封站内跳转链接。
 *
 * 不做的两件事，理由写在报告里：外部推送要新事件类型（`NOTIFICATION_EVENT_TYPES`
 * 那七种里没有「待审批」，塞一个进去等于造一条没人订阅的通道），邮件要模板与四语。
 */
export async function notifyTeamAdminsOfJoinRequest(params: {
  teamId: string
  teamName: string
  applicantName: string
}): Promise<void> {
  const { teamId, teamName, applicantName } = params

  try {
    const admins = await prisma.teamMember.findMany({
      where: { teamId, role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' },
      select: { userId: true },
    })
    if (admins.length === 0) {
      logMessage(`[JOIN-NOTIFICATION] 团队 ${teamId} 没有可通知的负责人`)
      return
    }

    const domain = await getAppDomain()
    const reviewUrl = domain
      ? `${domain.replace(/\/$/, '')}/studio/team/members`
      : '/studio/team/members'
    const title = `有人申请加入「${teamName}」`.slice(0, 60)
    const content = `${applicantName} 提交了加入申请，在「席位成员 → 成员审批」里通过或拒绝。${reviewUrl}`

    // 同一条申请只留一条消息：审批页刷新过、或负责人被重复计算，都不该再来一条。
    for (const admin of admins) {
      const existing = await prisma.platformAnnouncement.findFirst({
        where: { userId: admin.userId, title, content },
        select: { id: true },
      })
      if (existing) continue
      await prisma.platformAnnouncement.create({ data: { title, content, userId: admin.userId } })
    }
  } catch (error) {
    // 通知失败绝不能把申请本身打回：那是申请人唯一能做的事。
    logError('[JOIN-NOTIFICATION] 通知负责人失败（申请已落库）:', error)
  }
}

/**
 * 审批的结果怎么回到申请人：还是同一枚窄栏「平台消息」，定向到 TA 一个账号。
 *
 * 之前通过和拒绝都只改 `TeamJoinRequest.status`，申请人除了自己反复回来看那张卡，
 * 没有任何渠道知道结果——而「加入成功」这件事恰恰只有负责人能确认。
 */
export async function notifyApplicantOfJoinDecision(params: {
  applicantUserId: string
  teamName: string
  approved: boolean
}): Promise<void> {
  const { applicantUserId, teamName, approved } = params

  try {
    const title = (approved
      ? `加入「${teamName}」的申请已通过`
      : `加入「${teamName}」的申请未通过`).slice(0, 60)
    const content = approved
      ? '你已经是该团队的成员，打开工作台就能看到它的项目和素材。'
      : '该团队的负责人或管理员没有通过这次申请，没有加入任何团队。如有疑问可以联系该团队的负责人。'

    // 同一条审批只留一条：负责人连点两次、或判据之外的重放，都不该再来一条消息。
    const existing = await prisma.platformAnnouncement.findFirst({
      where: { userId: applicantUserId, title, content },
      select: { id: true },
    })
    if (existing) return
    await prisma.platformAnnouncement.create({ data: { title, content, userId: applicantUserId } })
  } catch (error) {
    // 审批本身已经写进库了，通知失败只记日志，绝不许把这个 PATCH 打成 500。
    logError('[JOIN-NOTIFICATION] 通知申请人审批结果失败（决定已落库）:', error)
  }
}
