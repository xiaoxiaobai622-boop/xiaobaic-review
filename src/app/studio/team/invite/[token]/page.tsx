'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Building2, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiFetch, apiPost } from '@/lib/api-client'
import { setActiveTeamId } from '@/lib/team-store'

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const [invite, setInvite] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!params?.token) return
    let cancelled = false
    ;(async () => {
      try {
        const response = await apiFetch(`/api/team-invitations/${params.token}`)
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '邀请不存在')
        // A payload without the team display name would crash the render below,
        // so treat it the same way as an unknown/expired token.
        if (!data.invite?.team?.name) throw new Error('邀请不存在')
        if (!cancelled) setInvite(data.invite)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '邀请加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [params?.token])

  const accept = async () => {
    const token = params?.token
    if (!invite || !token) return
    setSubmitting(true)
    setError('')
    try {
      await apiPost(`/api/teams/${invite.teamId}/invitations/${token}/accept`, {})
      setActiveTeamId(invite.teamId)
      router.replace('/studio/projects')
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '接受邀请失败')
      setSubmitting(false)
    }
  }

  const decline = async () => {
    const token = params?.token
    if (!invite || !token) return
    setSubmitting(true)
    setError('')
    try {
      await apiPost(`/api/teams/${invite.teamId}/invitations/${token}/decline`, {})
      router.replace('/studio/team')
    } catch (err) {
      setError(err instanceof Error ? err.message : '拒绝邀请失败')
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6" aria-busy="true">
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

  if (error && !invite) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="py-10 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            团队邀请
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground">邀请你加入</p>
            <p className="mt-1 text-xl font-semibold">{invite.team.name}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              角色：{invite.role === 'OWNER' ? '负责人' : invite.role === 'ADMIN' ? '管理员' : '成员'}
            </p>
            {invite.expiresAt && (
              <p className="mt-1 text-sm text-muted-foreground">
                有效期至：{new Date(invite.expiresAt).toLocaleDateString('zh-CN')}
              </p>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" className="flex-1" onClick={accept} disabled={submitting}>
              <Check className="mr-2 h-4 w-4" />
              接受邀请
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={decline} disabled={submitting}>
              <X className="mr-2 h-4 w-4" />
              拒绝
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
