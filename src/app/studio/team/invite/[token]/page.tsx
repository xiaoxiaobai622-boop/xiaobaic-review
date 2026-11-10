'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Building2, CalendarDays, Check, CheckCircle2, Link2, Smartphone, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/components/AuthProvider'
import { ApiError, apiFetch, apiPost } from '@/lib/api-client'
import { setActiveTeamId } from '@/lib/team-store'

type InviteMethod = 'PHONE' | 'LINK'
type Role = 'OWNER' | 'ADMIN' | 'MEMBER'
type InviteStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'EXPIRED'

type Invite = {
  teamId: string
  method: InviteMethod
  phone: string | null
  role: Role
  projectAccessScope: 'ALL_PROJECTS' | 'ASSIGNED_ONLY'
  defaultProjectRole: 'REVIEWER' | 'EDITOR'
  status: InviteStatus
  expiresAt: string
  acceptedAt: string | null
  declinedAt: string | null
  team: {
    id: string
    name: string
    slug: string
    avatarUrl: string | null
    status: string
    _count?: { members: number; projects: number }
  }
  viewer: {
    authenticated: boolean
    isMember: boolean
    memberRole: Role | null
    hasPhone: boolean
  }
}

const roleLabel: Record<Role, string> = { OWNER: '负责人', ADMIN: '管理员', MEMBER: '成员' }
const scopeLabel = { ALL_PROJECTS: '全部项目', ASSIGNED_ONLY: '指定项目' }
const projectRoleLabel = { REVIEWER: '审阅者', EDITOR: '编辑者' }
const statusLabel: Record<InviteStatus, string> = {
  PENDING: '待接受',
  ACCEPTED: '已接受',
  DECLINED: '已拒绝',
  REVOKED: '已撤销',
  EXPIRED: '已过期',
}

const errorMessages: Record<string, string> = {
  INVITE_INVALID: '邀请不存在或已失效。',
  INVITE_ALREADY_ACCEPTED: '该邀请已被接受，链接已失效。',
  INVITE_DECLINED: '该邀请已被拒绝，链接已失效。',
  INVITE_REVOKED: '该邀请已被撤销。',
  INVITE_EXPIRED: '该邀请已过期。',
  INVITE_ALREADY_USED: '该邀请刚刚被使用，请刷新页面后重试。',
  INVITE_OWNER_MISMATCH: '该邀请属于另一个账号。',
  INVITE_PHONE_MISMATCH: '该邀请属于另一个手机号。',
  INVITE_EMAIL_MISMATCH: '该邀请属于另一个邮箱账号。',
  PHONE_REQUIRED: '接受手机号邀请前请先绑定手机号。',
  SEAT_LIMIT_REACHED: '当前团队席位已满，请联系团队管理员扩容后再试。',
  TEAM_DISABLED: '团队已停用，暂时无法加入。',
  TEAM_EXPIRED: '团队已到期，暂时无法加入。',
  UNAUTHORIZED: '登录已失效，请重新登录。',
}

function readableError(reason: unknown, fallback: string) {
  if (reason instanceof ApiError && reason.code && errorMessages[reason.code]) {
    return errorMessages[reason.code]
  }
  return reason instanceof Error ? reason.message : fallback
}

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [invite, setInvite] = useState<Invite | null>(null)
  const [result, setResult] = useState<{ teamId: string; role: Role; alreadyMember: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!params?.token || authLoading) return
    let cancelled = false
    ;(async () => {
      try {
        const response = await apiFetch(`/api/team-invitations/${encodeURIComponent(params.token)}`, { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new ApiError(data.error || '邀请不存在', data.code)
        if (!data.invite?.team?.name) throw new Error('邀请不存在')
        if (!cancelled) setInvite(data.invite)
      } catch (err) {
        if (!cancelled) setLoadError(readableError(err, '邀请加载失败'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [params?.token, authLoading, user?.id])

  const returnTo = () => `${window.location.pathname}${window.location.search}`
  const goLogin = () => router.push(`/login?returnUrl=${encodeURIComponent(returnTo())}`)
  const goBindPhone = () => router.push(`/profile?requirePhone=1&returnUrl=${encodeURIComponent(returnTo())}`)
  const goHome = () => router.replace('/')
  const goBackend = (teamId: string) => {
    setActiveTeamId(teamId)
    router.push('/studio/projects')
  }

  const accept = async () => {
    const token = params?.token
    if (!invite || !token || submitting) return
    if (!invite.viewer.authenticated) {
      goLogin()
      return
    }
    if (invite.method === 'PHONE' && !invite.viewer.hasPhone) {
      goBindPhone()
      return
    }
    setSubmitting('accept')
    setError('')
    try {
      const data = await apiPost<{ teamId?: string; role?: Role; alreadyMember?: boolean }>(
        `/api/teams/${invite.teamId}/invitations/${token}/accept`,
        {},
      )
      setResult({
        teamId: data.teamId || invite.teamId,
        role: data.role || invite.role,
        alreadyMember: Boolean(data.alreadyMember),
      })
    } catch (err) {
      setError(readableError(err, '接受邀请失败'))
    } finally {
      setSubmitting(null)
    }
  }

  const decline = async () => {
    const token = params?.token
    if (!invite || !token || submitting) return
    if (invite.method === 'PHONE' && !invite.viewer.authenticated) {
      goLogin()
      return
    }
    setSubmitting('decline')
    setError('')
    try {
      await apiPost(`/api/teams/${invite.teamId}/invitations/${token}/decline`, {})
      goHome()
    } catch (err) {
      setError(readableError(err, '拒绝邀请失败'))
      setSubmitting(null)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6" aria-busy="true">
        <span className="sr-only" role="status" aria-live="polite">正在加载邀请</span>
        <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-card p-6">
          <div className="skeleton h-8 w-48 rounded-md" />
          <div className="skeleton h-4 w-64 rounded" />
          <div className="skeleton h-10 w-full rounded-lg" />
          <div className="skeleton h-10 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  if (loadError || !invite) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-5 py-10 text-center">
            <X className="mx-auto h-10 w-10 text-muted-foreground" />
            <div>
              <p className="text-lg font-semibold">邀请不可用</p>
              <p className="mt-2 text-sm text-muted-foreground">{loadError || '邀请不存在或已失效'}</p>
            </div>
            <Button type="button" className="w-full" onClick={goHome}>返回首页</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const teamName = invite.team.name
  const memberView = invite.viewer.isMember && (
    invite.status === 'ACCEPTED' ||
    (invite.method === 'LINK' && invite.status === 'PENDING')
  )
  const unavailableStatus = invite.status !== 'PENDING'
  const teamUnavailable = invite.status === 'PENDING' && invite.team.status !== 'ACTIVE'
  const needsPhone = invite.method === 'PHONE' && invite.viewer.authenticated && !invite.viewer.hasPhone
  const acceptLabel = !invite.viewer.authenticated
    ? '登录后接受'
    : needsPhone
      ? '先绑定手机号'
      : '接受邀请'

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-8 sm:py-12">
      <Card className="w-full max-w-lg overflow-hidden">
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 shrink-0 text-primary" />
            团队邀请
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          {result ? (
            <div className="space-y-5 py-2 text-center" aria-live="polite">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-sm text-muted-foreground">
                  {result.alreadyMember ? '你已经是团队成员' : '已成功接受邀请'}
                </p>
                <h1 className="mt-2 break-words text-2xl font-semibold">
                  {result.alreadyMember ? `你已是 ${teamName} 成员` : `已加入 ${teamName}`}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">角色：{roleLabel[result.role]}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" className="w-full sm:flex-1" onClick={() => goBackend(result.teamId)}>
                  去后台开始审片
                </Button>
                <Button type="button" variant="outline" className="w-full sm:flex-1" onClick={goHome}>
                  返回首页
                </Button>
              </div>
            </div>
          ) : memberView ? (
            <div className="space-y-5 py-2 text-center" aria-live="polite">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-sm text-muted-foreground">无需重复加入</p>
                <h1 className="mt-2 break-words text-2xl font-semibold">你已是 {teamName} 成员</h1>
                <p className="mt-2 text-sm text-muted-foreground">角色：{roleLabel[invite.viewer.memberRole || invite.role]}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" className="w-full sm:flex-1" onClick={() => goBackend(invite.teamId)}>
                  去后台开始审片
                </Button>
                <Button type="button" variant="outline" className="w-full sm:flex-1" onClick={goHome}>
                  返回首页
                </Button>
              </div>
            </div>
          ) : unavailableStatus || teamUnavailable ? (
            <div className="space-y-5 py-2 text-center" aria-live="polite">
              <X className="mx-auto h-10 w-10 text-muted-foreground" />
              <div>
                <h1 className="text-xl font-semibold">
                  {teamUnavailable ? '团队暂不可加入' : `邀请${statusLabel[invite.status]}`}
                </h1>
                <p className="mt-2 break-words text-sm text-muted-foreground">
                  {teamUnavailable
                    ? `${teamName} 当前已停用，无法接受邀请。`
                    : invite.status === 'ACCEPTED'
                      ? '该邀请已被接受，链接已失效。'
                      : invite.status === 'DECLINED'
                        ? '该邀请已被拒绝，链接已失效。'
                        : invite.status === 'REVOKED'
                          ? '邀请人已撤销该邀请。'
                          : '该邀请已过期。'}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {invite.viewer.isMember && (
                  <Button type="button" className="w-full sm:flex-1" onClick={() => goBackend(invite.teamId)}>
                    去后台开始审片
                  </Button>
                )}
                <Button type="button" variant={invite.viewer.isMember ? 'outline' : 'default'} className="w-full sm:flex-1" onClick={goHome}>
                  返回首页
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <p className="text-sm text-muted-foreground">邀请你加入</p>
                <h1 className="mt-1 break-words text-2xl font-semibold">{teamName}</h1>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    {invite.method === 'LINK' ? <Link2 className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
                    {invite.method === 'LINK' ? '链接邀请' : '手机号邀请'}
                  </span>
                  <span className="rounded-full bg-primary-visible px-2.5 py-1 text-xs font-medium text-primary">
                    {statusLabel[invite.status]}
                  </span>
                </div>
              </div>

              <dl className="space-y-2 rounded-lg border border-border bg-muted/30 p-4 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">角色</dt>
                  <dd className="text-right font-medium">{roleLabel[invite.role]}</dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">项目访问</dt>
                  <dd className="text-right font-medium">
                    {scopeLabel[invite.projectAccessScope]} · {projectRoleLabel[invite.defaultProjectRole]}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="flex items-center gap-1 text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    有效期至
                  </dt>
                  <dd className="text-right font-medium">{new Date(invite.expiresAt).toLocaleString('zh-CN')}</dd>
                </div>
                {invite.method === 'PHONE' && invite.phone && (
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">邀请手机号</dt>
                    <dd className="text-right font-medium">{invite.phone}</dd>
                  </div>
                )}
              </dl>

              {invite.method === 'LINK' && (
                <p className="text-xs leading-5 text-muted-foreground">
                  此链接仅可使用一次：接受或拒绝后立即失效，且不绑定手机号。
                </p>
              )}
              {!invite.viewer.authenticated && (
                <p className="text-xs leading-5 text-muted-foreground">
                  接受前需要登录或注册；拒绝链接邀请无需登录。
                </p>
              )}
              {invite.viewer.isMember && (
                <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                  你已是该团队成员，接受后角色按较高者合并，不会重复加入。
                </p>
              )}
              {needsPhone && (
                <p className="rounded-md border border-warning/25 bg-warning-visible px-3 py-2 text-xs leading-5 text-warning">
                  接受手机号邀请前需要先绑定手机号。
                </p>
              )}

              {error && (
                <p role="alert" aria-live="polite" className="rounded-md border border-destructive/25 bg-destructive-visible px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  className="w-full sm:flex-1"
                  onClick={accept}
                  disabled={Boolean(submitting)}
                >
                  <Check className="mr-2 h-4 w-4" />
                  {submitting === 'accept' ? '正在接受...' : acceptLabel}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:flex-1"
                  onClick={decline}
                  disabled={Boolean(submitting)}
                >
                  <X className="mr-2 h-4 w-4" />
                  {submitting === 'decline' ? '正在拒绝...' : '拒绝'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
