'use client'

import { useCallback, useEffect, useState } from 'react'
import { Eye, RefreshCw } from 'lucide-react'
import type { TeamMembersPage } from '@/lib/platform-team-360'
import { formatBeijingDateTime } from '@/lib/utils'
import { authHeaders, lastActiveText, platformJson, roleLabel, sourceLabel } from './team-panel-utils'

export default function TeamMembersPanel({ teamId }: { teamId: string }) {
  const [data, setData] = useState<TeamMembersPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [phones, setPhones] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await platformJson<TeamMembersPage>(`/api/platform/teams/${teamId}/members`))
    } catch (reason) {
      setData(null)
      setError(reason instanceof Error ? reason.message : '成员与邀请读取失败')
    } finally {
      setLoading(false)
    }
  }, [teamId])

  useEffect(() => { void load() }, [load])

  const revealPhone = async (userId: string) => {
    setBusy(userId)
    setError('')
    try {
      const response = await fetch(`/api/users/${userId}/reveal-phone`, { method: 'POST', headers: authHeaders() })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || '无法读取手机号')
      setPhones((current) => ({ ...current, [userId]: body?.phone || '未绑定' }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取手机号')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">成员与邀请</h2>
          <p className="mt-1 text-xs text-muted-foreground">只列 ACTIVE 成员；禁用成员单独计数，不混进成员数。手机号默认掩码，展开会写审计。</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" />刷新</button>
      </div>

      {error && <div role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive-visible p-3 text-sm text-destructive">{error}</div>}

      {loading ? (
        <div className="mt-3 space-y-2" aria-busy="true"><span className="sr-only" role="status" aria-live="polite">正在加载成员与邀请</span>{[0, 1, 2].map((index) => <div key={index} className="skeleton h-10 rounded-md" />)}</div>
      ) : !data ? (
        <p className="mt-3 py-8 text-center text-sm text-muted-foreground">成员与邀请读取失败，这里不显示 0。</p>
      ) : (
        <>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-muted-foreground">ACTIVE 成员</p><p className="mt-0.5 tabular-nums">{data.members.length} / {data.quota.maxMembers > 0 ? data.quota.maxMembers : '不限'}</p></div>
            <div><p className="text-xs text-muted-foreground">待接受邀请</p><p className="mt-0.5 tabular-nums">{data.pendingInvites.length}</p></div>
            <div><p className="text-xs text-muted-foreground">从未活跃成员</p><p className="mt-0.5 tabular-nums">{data.membersNeverActive}</p></div>
            <div><p className="text-xs text-muted-foreground">禁用成员</p><p className="mt-0.5 tabular-nums">{data.disabledCount}</p></div>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">成员</th><th className="py-2 pr-3 font-medium">手机号</th><th className="py-2 pr-3 font-medium">角色</th><th className="py-2 pr-3 font-medium">状态</th><th className="py-2 pr-3 font-medium">加入时间</th><th className="py-2 pr-3 font-medium">最后活跃</th><th className="py-2 text-right font-medium">操作</th></tr></thead>
              <tbody>
                {data.members.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">这个团队还没有 ACTIVE 成员。</td></tr>
                ) : data.members.map((member) => (
                  <tr key={member.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5 pr-3"><p className="font-medium">{member.name || '未命名成员'}</p><p className="text-[11px] text-muted-foreground">{member.email}</p></td>
                    <td className="py-2.5 pr-3 text-xs tabular-nums">
                      {phones[member.userId] ? <span>{phones[member.userId]}</span> : <span>{member.phoneMasked || '未绑定'}</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-xs">{roleLabel(member.role)}</td>
                    <td className="py-2.5 pr-3 text-xs">{member.status === 'ACTIVE' ? '正常' : '已禁用'}</td>
                    <td className="py-2.5 pr-3 text-xs">{formatBeijingDateTime(member.joinedAt)}</td>
                    <td className="py-2.5 pr-3 text-xs">
                      <p>{lastActiveText(member.lastActive)}</p>
                      <p className="text-[11px] text-muted-foreground">{member.lastActive.source ? sourceLabel(member.lastActive.source) : '暂无记录'}</p>
                    </td>
                    <td className="py-2.5 text-right">
                      <button type="button" onClick={() => void revealPhone(member.userId)} disabled={busy === member.userId || Boolean(phones[member.userId])} className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-accent disabled:opacity-50">
                        <Eye className="h-3 w-3" />{phones[member.userId] ? '已展开' : busy === member.userId ? '读取中…' : '查看手机号'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <h3 className="text-sm font-semibold">待接受邀请</h3>
            {data.pendingInvites.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">没有待接受的邀请。</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">邀请对象</th><th className="py-2 pr-3 font-medium">角色</th><th className="py-2 pr-3 font-medium">状态</th><th className="py-2 pr-3 font-medium">有效期至</th><th className="py-2 font-medium">创建时间</th></tr></thead>
                  <tbody>
                    {data.pendingInvites.map((invite) => (
                      <tr key={invite.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-3 text-xs">{invite.email || invite.phoneMasked || '未留联系方式'}</td>
                        <td className="py-2 pr-3 text-xs">{roleLabel(invite.role)}</td>
                        <td className="py-2 pr-3 text-xs">{invite.status === 'PENDING' ? '待接受' : invite.status === 'EXPIRED' ? '已过期' : invite.status}</td>
                        <td className="py-2 pr-3 text-xs">{formatBeijingDateTime(invite.expiresAt)}</td>
                        <td className="py-2 text-xs">{formatBeijingDateTime(invite.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
