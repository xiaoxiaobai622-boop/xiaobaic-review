/**
 * 审片能力层：同一个登录者在两个入口拿到同一套能力；分享链接只做数据范围与
 * 访客权限（单版本、评论/下载、密码/有效期），不授予任何内部管理能力。
 *
 * 服务端（/api/share/[token]）和后台审片页都用这里的规则，页面不再按路由写死
 * isAdmin={false} / allowComparison={false}。
 */

export type ReviewActorRole = 'ANONYMOUS' | 'EXTERNAL' | 'MEMBER' | 'MANAGER'

export type TeamRoleName = 'OWNER' | 'ADMIN' | 'MEMBER'

export interface ReviewViewerInput {
  /** 当前账号是否能访问这个项目（团队成员/项目成员）。 */
  hasTeamAccess: boolean
  /** 该账号在这个项目所属团队里的角色；无团队关系时为 null。 */
  teamRole: TeamRoleName | null
  /** 项目创建者即使不是 OWNER/ADMIN，也按管理者处理。 */
  isProjectCreator: boolean
}

export interface ReviewLinkInput {
  /** 分享链接已算出的权限（view / comment / download / approve...）。 */
  permissions: string[]
  /** 这条链接当前能看到几个版本（单版本链接 < 2）。 */
  visibleVersionCount: number
  /** 是否是带链接会话的访客（密码/收件人/游客）；匿名 NONE 入口为 false。 */
  isExternalViewer: boolean
}

export interface ReviewCapabilities {
  role: ReviewActorRole
  canComment: boolean
  canSetCommentVisibility: boolean
  canSeeInternalComments: boolean
  canManageApproval: boolean
  canCompareVersions: boolean
  canShareLink: boolean
  canDownloadOriginal: boolean
  canApprove: boolean
  canSeeRoster: boolean
}

export function getReviewCapabilities(input: {
  viewer: ReviewViewerInput | null
  project: { hideFeedback: boolean; clientCanApprove: boolean }
  link: ReviewLinkInput | null
}): ReviewCapabilities {
  const { viewer, project, link } = input
  const internal = Boolean(viewer?.hasTeamAccess)
  const manager = internal && (Boolean(viewer?.isProjectCreator) || viewer?.teamRole === 'OWNER' || viewer?.teamRole === 'ADMIN')
  const role: ReviewActorRole = manager
    ? 'MANAGER'
    : internal
      ? 'MEMBER'
      : link?.isExternalViewer
        ? 'EXTERNAL'
        : 'ANONYMOUS'

  if (internal) {
    return {
      role,
      canComment: true,
      canSetCommentVisibility: true,
      canSeeInternalComments: true,
      canManageApproval: manager,
      // 内部成员都拿得到全部版本，对比是审片辅助，不是管理动作。
      canCompareVersions: true,
      canShareLink: manager,
      canDownloadOriginal: true,
      canApprove: manager,
      canSeeRoster: true,
    }
  }

  const permissions = new Set(link?.permissions ?? [])
  return {
    role,
    canComment: permissions.has('comment') && !project.hideFeedback,
    canSetCommentVisibility: false,
    canSeeInternalComments: false,
    canManageApproval: false,
    // 单版本链接没有可对比对象；多版本范围才给对比。
    canCompareVersions: Boolean(link && link.visibleVersionCount > 1 && permissions.has('view')),
    canShareLink: false,
    canDownloadOriginal: permissions.has('download'),
    canApprove: project.clientCanApprove,
    canSeeRoster: false,
  }
}

/** 后台审片页：把登录账号 + 项目转成能力层输入（不查库，user.teams 已带团队角色）。 */
export function viewerFromAdminUser(
  user: { id?: string | null; teams?: Array<{ role?: string | null; team?: { id?: string | null } | null }> } | null | undefined,
  project: { teamId?: string | null; createdById?: string | null } | null | undefined,
): ReviewViewerInput | null {
  if (!user?.id || !project) return null
  const membership = user.teams?.find((item) => item.team?.id && item.team.id === project.teamId) ?? null
  const role = membership?.role === 'OWNER' || membership?.role === 'ADMIN' || membership?.role === 'MEMBER'
    ? membership.role
    : null
  return {
    hasTeamAccess: Boolean(membership),
    teamRole: role,
    isProjectCreator: Boolean(project.createdById && project.createdById === user.id),
  }
}
