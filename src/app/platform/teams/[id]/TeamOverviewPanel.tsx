'use client'

import { useCallback, useEffect, useState } from 'react'
import { Clock3, HardDrive, RefreshCw, ShieldAlert, Users } from 'lucide-react'
import type { TeamOverview } from '@/lib/platform-team-360'
import { formatBeijingDateTime, formatFileSize } from '@/lib/utils'
import {
  lastActiveText,
  limitLabel,
  percentLabel,
  platformJson,
  quotaStorageLabel,
  riskClass,
  sourceLabel,
  usagePercent,
} from './team-panel-utils'

function UsageRow({ label, used, limit, percent, usedText, limitText }: { label: string; used: number; limit: number; percent: number | null; usedText?: string; limitText?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">{usedText || used} / {limitText || limitLabel(limit)}{percent !== null && <>{' '}<span className="text-xs text-muted-foreground">{percentLabel(percent)}</span></>}</span>
      </div>
      {percent !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className={`h-full rounded-full ${percent >= 100 ? 'bg-destructive' : percent >= 90 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
        </div>
      )}
    </div>
  )
}

function LastActiveCell({ label, value, sub, action }: { label: string; value: TeamOverview['lastActive']['team']; sub?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="rounded-md border border-border/70 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{lastActiveText(value)}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {value.source ? sourceLabel(value.source) : '暂无记录'}{value.at ? ' · 北京' : ''}{sub ? ` · ${sub}` : ''}
      </p>
      {action && <button type="button" onClick={action.onClick} className="mt-1 text-[11px] font-medium text-primary hover:underline">{action.label}</button>}
    </div>
  )
}

export default function TeamOverviewPanel({ teamId, onOpenMembers }: { teamId: string; onOpenMembers?: () => void }) {
  const [data, setData] = useState<TeamOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await platformJson<TeamOverview>(`/api/platform/teams/${teamId}/overview`))
    } catch (reason) {
      setData(null)
      setError(reason instanceof Error ? reason.message : '团队概览读取失败')
    } finally {
      setLoading(false)
    }
  }, [teamId])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-card p-4" aria-busy="true">
        <span className="sr-only" role="status" aria-live="polite">正在加载团队概览</span>
        {[0, 1, 2, 3].map((index) => <div key={index} className="skeleton h-12 rounded-md" />)}
      </div>
    )
  }
  if (error || !data) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-visible p-4">
        <p className="text-sm font-medium text-destructive">团队概览读取失败</p>
        <p className="mt-1 text-sm text-muted-foreground">{error || '没有拿到数据'}。这里不显示 0，也不代表这个团队没有用量。</p>
        <button type="button" onClick={() => void load()} className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm"><RefreshCw className="h-3.5 w-3.5" />重试</button>
      </div>
    )
  }

  const { team, quota, usage, storage, links, pendingInvites, membersNeverActive, lastActive, risk, dataQuality } = data
  const memberPct = usagePercent(usage.members, quota.maxMembers)
  const projectPct = usagePercent(usage.projects, quota.maxProjects)
  const videoPct = usagePercent(usage.videos, quota.maxVideos)
  const storagePct = usagePercent(storage.totalBytes, quota.maxStorageGB * 1024 * 1024 * 1024)
  const storageLimit = quotaStorageLabel(quota)
  const bySource = [
    { label: '视频原片', value: storage.bySource.video },
    { label: '收录文件', value: storage.bySource.upload },
    { label: '批注素材', value: storage.bySource.asset },
    { label: '照片', value: storage.bySource.photo },
  ]

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">团队概览</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${team.status === 'ACTIVE' ? 'bg-success-visible text-success' : 'bg-destructive/10 text-destructive'}`}>{team.status === 'ACTIVE' ? '正常' : '已停用'}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              创建人 {team.createdBy.name || team.createdBy.email} · 套餐 {team.subscriptionPlan} · {team.status === 'ACTIVE' ? '长期有效' : '已停用'}
            </p>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" />刷新</button>
        </div>

        {risk.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {risk.map((item) => <span key={item.key} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${riskClass(item.tone)}`}><ShieldAlert className="h-3 w-3" />{item.label}</span>)}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">当前没有自动风险标签。</p>
        )}

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <LastActiveCell label="团队最后活跃" value={lastActive.team} />
          <LastActiveCell
            label="成员侧最大值"
            value={lastActive.member}
            sub="团队内成员心跳/内容事件取最大"
            action={onOpenMembers ? { label: '查看成员明细', onClick: onOpenMembers } : undefined}
          />
          <LastActiveCell label="客户最后访问" value={lastActive.client} sub="分享页/播放访问" />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4 text-primary" />用量 vs 配额</h2>
        <p className="mt-1 text-xs text-muted-foreground">项目数含归档；视频数不含回收站。配额 0 表示不限。</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <UsageRow label="成员" used={usage.members} limit={quota.maxMembers} percent={memberPct} />
            <UsageRow label="项目" used={usage.projects} limit={quota.maxProjects} percent={projectPct} />
            <UsageRow label="视频" used={usage.videos} limit={quota.maxVideos} percent={videoPct} />
          </div>
          <div className="space-y-3">
            <UsageRow
              label="存储"
              used={storage.totalBytes}
              limit={quota.maxStorageGB * 1024 * 1024 * 1024}
              percent={storagePct}
              usedText={formatFileSize(storage.totalBytes)}
              limitText={storageLimit}
            />
            <p className="text-xs text-muted-foreground">已用 {formatFileSize(storage.totalBytes)} / 配额 {storageLimit}</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-muted/50 p-2"><p className="text-muted-foreground">使用中</p><p className="mt-0.5 font-medium tabular-nums">{formatFileSize(storage.liveBytes)}</p></div>
              <div className="rounded-md bg-muted/50 p-2"><p className="text-muted-foreground">回收站</p><p className="mt-0.5 font-medium tabular-nums">{formatFileSize(storage.recycleBinBytes)}</p></div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {bySource.map((item) => <span key={item.label}>{item.label} {formatFileSize(item.value)}</span>)}
            </div>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">{dataQuality.storageNote}</p>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><HardDrive className="h-4 w-4 text-primary" />存储占用 Top 项目</h2>
          <span className="text-xs text-muted-foreground">按占用 Top {storage.byProject.length}</span>
        </div>
        {storage.byProject.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">这个团队还没有可统计的文件。</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">项目</th><th className="py-2 pr-3 text-right font-medium">使用中</th><th className="py-2 text-right font-medium">回收站</th></tr></thead>
              <tbody>
                {storage.byProject.map((project) => (
                  <tr key={project.projectId} className="border-b border-border/60 last:border-0">
                    <td className="max-w-[240px] truncate py-2 pr-3" title={project.title}>{project.title}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatFileSize(project.liveBytes)}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{formatFileSize(project.recycleBinBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Clock3 className="h-4 w-4 text-primary" />链接与成员摘要</h2>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">链接</p><p className="mt-0.5 tabular-nums">{links.total} 条（主链接 {links.master} / 独立 {links.independent}）</p></div>
          <div><p className="text-xs text-muted-foreground">链接状态</p><p className="mt-0.5 tabular-nums">有效 {links.active} · 过期 {links.expired} · 撤销 {links.revoked}</p></div>
          <div><p className="text-xs text-muted-foreground">待接受邀请</p><p className="mt-0.5 tabular-nums">{pendingInvites} 条</p></div>
          <div><p className="text-xs text-muted-foreground">从未活跃成员</p><p className="mt-0.5 tabular-nums">{membersNeverActive} 人</p></div>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">{dataQuality.activityNote}</p>
      </section>
    </div>
  )
}
