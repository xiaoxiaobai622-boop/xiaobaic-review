'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Send, AlertTriangle, ChevronDown, ChevronUp, Check, RotateCcw, Loader2 } from 'lucide-react'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { apiFetch } from '@/lib/api-client'
import { InitialsAvatar } from './InitialsAvatar'

function formatDateTime(value: string | null) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatTime(value: string | null) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function FeishuAvatar({
  name,
  feishuAvatar,
  avatarUrl,
  size = 'sm',
  title,
  className,
}: {
  name?: string | null
  feishuAvatar?: string | null
  avatarUrl?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  title?: string
  className?: string
}) {
  return (
    <InitialsAvatar
      name={name || '未知'}
      src={feishuAvatar || avatarUrl || null}
      size={size}
      title={title || name || '飞书接收人'}
      className={className}
    />
  )
}

function SelectCheckbox({
  checked,
  indeterminate = false,
  onChange,
  disabled = false,
  ariaLabel,
  id,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  ariaLabel: string
  id?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <input
      ref={inputRef}
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-checked={indeterminate ? 'mixed' : checked}
      onChange={(event) => onChange(event.target.checked)}
      className="h-4 w-4 rounded border-input accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed"
    />
  )
}

async function getApiError(response: Response, fallback: string) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const data = await response.json().catch(() => null)
    if (data?.error) return data.error
  }
  return `${fallback}（HTTP ${response.status}）`
}

interface FeishuPushButtonProps {
  projectId: string
  videoId?: string
  className?: string
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

interface VideoWithStatus {
  video: { id: string; name: string; versionLabel: string }
  totalComments: number
  pushedComments: number
  unpushedComments: number
  lastPushAt: string | null
  uploader: {
    id: string
    name: string | null
    avatarUrl: string | null
    feishuNickname?: string
    feishuAvatar?: string
    isBound: boolean
  }
}

interface PushPreview {
  scope: string
  project: { id: string; title: string; code: string }
  videos?: { id: string; name: string; versionLabel: string }
  videoList?: VideoWithStatus[]
  totalComments: number
  pushedComments: number
  unpushedComments: number
  recipient: {
    userId: string
    name: string | null
    avatarUrl?: string | null
    feishuNickname?: string
    feishuAvatar?: string
    isBound: boolean
  }
  hasPreviousPush: boolean
  lastPushAt: string | null
  lastFailedPush?: {
    id: string
    errorMessage: string | null
    retryCount: number
    createdAt: string
  } | null
}

export function FeishuPushButton({ projectId, videoId, className = '', size = 'default' }: FeishuPushButtonProps) {
  const idPrefix = useId()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<PushPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [rePushAll, setRePushAll] = useState(false)
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set())
  const [expandedList, setExpandedList] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const handleOpen = async () => {
    setOpen(true)
    setLoading(true)
    setError(null)
    setPreview(null)
    setSuccess(false)
    setRePushAll(false)
    setSelectedVideos(new Set())
    setExpandedList(false)
    setShowConfirmDialog(false)

    try {
      const query = videoId ? `?videoId=${videoId}` : ''
      const res = await apiFetch(`/api/feishu/push/${projectId}/preview${query}`)
      if (!res.ok) {
        throw new Error(await getApiError(res, '预览失败'))
      }
      const data = await res.json()

      // Check if no comments
      if (data.totalComments === 0) {
        setError(
          videoId
            ? '当前视频暂无逐帧审阅批注意见，无需推送。'
            : '当前项目暂无逐帧审阅批注意见，无需推送。'
        )
        setLoading(false)
        return
      }

      // Auto-select videos with unpushed comments
      if (data.scope === 'project' && data.videoList) {
        const autoSelected = new Set<string>()
        data.videoList.forEach((item: VideoWithStatus) => {
          if (item.unpushedComments > 0) {
            autoSelected.add(item.video.id)
          }
        })
        setSelectedVideos(autoSelected)
      }

      setPreview(data)
    } catch (err: any) {
      setError(err.message || '未知错误')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (showConfirmDialog) {
      setShowConfirmDialog(false)
      return
    }
    setOpen(false)
    setPreview(null)
    setError(null)
    setSuccess(false)
    setRePushAll(false)
    setSelectedVideos(new Set())
    setExpandedList(false)
  }

  const handleConfirmPush = async () => {
    if (!preview) return

    const selectedProjectVideoIds = preview.scope === 'project'
      ? (preview.videoList || [])
          .filter((item) => selectedVideos.has(item.video.id) && (rePushAll || item.unpushedComments > 0))
          .map((item) => item.video.id)
      : []

    // Check if trying to push without selecting videos (project scope)
    if (preview.scope === 'project' && selectedProjectVideoIds.length === 0) {
      setError('请至少选择一个视频进行推送')
      return
    }

    // Check if re-pushing and need confirmation
    if (preview.hasPreviousPush && rePushAll && !showConfirmDialog) {
      setShowConfirmDialog(true)
      return
    }

    // Check if pushing already-pushed comments without rePushAll
    if (preview.scope === 'video' && preview.pushedComments > 0 && preview.unpushedComments === 0 && !rePushAll) {
      setShowConfirmDialog(true)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const body = {
        scope: preview.scope,
        projectId,
        ...(preview.scope === 'video' && videoId ? { videoId } : {}),
        ...(rePushAll ? { rePushAll: true } : {}),
        ...(preview.scope === 'project' ? { videoIds: selectedProjectVideoIds } : {}),
      }

      const res = await apiFetch('/api/feishu/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        throw new Error(await getApiError(res, '推送失败'))
      }

      setSuccess(true)
      setShowConfirmDialog(false)
    } catch (err: any) {
      setError(err.message || '未知错误')
    } finally {
      setLoading(false)
    }
  }

  const handleRetry = async () => {
    const notificationId = preview?.lastFailedPush?.id
    if (!notificationId) return

    setRetrying(true)
    setError(null)
    try {
      const res = await apiFetch('/api/feishu/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retryNotificationId: notificationId }),
      })
      if (!res.ok) {
        throw new Error(await getApiError(res, '重试失败'))
      }
      setSuccess(true)
    } catch (err: any) {
      setError(err.message || '重试失败')
    } finally {
      setRetrying(false)
    }
  }

  const toggleVideoSelection = (videoId: string) => {
    const item = preview?.videoList?.find((video) => video.video.id === videoId)
    if (!item || (!rePushAll && item.unpushedComments === 0)) return

    const newSelected = new Set(selectedVideos)
    if (newSelected.has(videoId)) {
      newSelected.delete(videoId)
    } else {
      newSelected.add(videoId)
    }
    setSelectedVideos(newSelected)
  }

  const handleSelectAll = (checked: boolean) => {
    if (!preview?.videoList) return

    const selectableIds = preview.videoList
      .filter((item) => rePushAll || item.unpushedComments > 0)
      .map((item) => item.video.id)

    setSelectedVideos((current) => {
      const next = new Set(current)
      selectableIds.forEach((id) => {
        if (checked) next.add(id)
        else next.delete(id)
      })
      return next
    })
  }

  const handleRePushAllChange = (checked: boolean) => {
    setRePushAll(checked)

    if (preview?.scope !== 'project' || !preview.videoList) return

    const nextSelection = preview.videoList
      .filter((item) => checked || item.unpushedComments > 0)
      .map((item) => item.video.id)
    setSelectedVideos(new Set(nextSelection))
  }

  const MAX_VISIBLE_VIDEOS = 5

  const projectVideos = preview?.scope === 'project' ? preview.videoList || [] : []
  const selectableProjectVideos = projectVideos.filter(
    (item) => rePushAll || item.unpushedComments > 0
  )
  const selectedProjectCount = projectVideos.filter(
    (item) => selectedVideos.has(item.video.id) && (rePushAll || item.unpushedComments > 0)
  ).length
  const selectedProjectVideos = projectVideos.filter(
    (item) => selectedVideos.has(item.video.id) && (rePushAll || item.unpushedComments > 0)
  )
  const selectedProjectStats = selectedProjectVideos.reduce(
    (stats, item) => ({
      totalComments: stats.totalComments + item.totalComments,
      pushedComments: stats.pushedComments + item.pushedComments,
      unpushedComments: stats.unpushedComments + item.unpushedComments,
    }),
    { totalComments: 0, pushedComments: 0, unpushedComments: 0 },
  )
  const displayedStats = preview?.scope === 'project'
    ? selectedProjectStats
    : {
        totalComments: preview?.totalComments || 0,
        pushedComments: preview?.pushedComments || 0,
        unpushedComments: preview?.unpushedComments || 0,
      }
  const allProjectVideosSelected =
    selectableProjectVideos.length > 0 &&
    selectableProjectVideos.every((item) => selectedVideos.has(item.video.id))
  const someProjectVideosSelected = selectableProjectVideos.some((item) => selectedVideos.has(item.video.id))
  const hasSelection = preview?.scope !== 'project' || selectedProjectCount > 0
  const selectedProjectHasUnboundRecipient = selectedProjectVideos.some((item) => !item.uploader.isBound)
  const canPush = preview?.scope === 'project'
    ? hasSelection && !selectedProjectHasUnboundRecipient && !loading
    : !!preview?.recipient.isBound && hasSelection && !loading

  const recipientTitleId = `${idPrefix}-recipient-title`
  const scopeTitleId = `${idPrefix}-scope-title`
  const projectScopeTitleId = `${idPrefix}-project-scope-title`
  const statisticsTitleId = `${idPrefix}-statistics-title`
  const rePushAllId = `${idPrefix}-re-push-all`

  return (
    <>
      <Button
        variant="outline"
        size={size}
        className={className}
        onClick={handleOpen}
      >
        <Send className="h-4 w-4" />
        {videoId ? '推送本集' : '推送项目批注'}
      </Button>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="flex w-[calc(100%-1rem)] max-w-[760px] max-h-[calc(100vh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[90vh]">
          <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12 sm:px-6">
            <DialogTitle className="text-xl">
              {videoId ? '推送本集批注到飞书' : '推送项目批注到飞书'}
            </DialogTitle>
            <DialogDescription>
              {videoId
                ? '将当前视频的批注推送到飞书群'
                : '将项目下所有视频的批注推送到飞书群'}
            </DialogDescription>
          </DialogHeader>

          <div
            className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6"
            aria-busy={loading && !preview}
          >
            {/* Confirmation State */}
            {showConfirmDialog && preview && (
              <div className="space-y-4" role="alertdialog" aria-live="assertive">
                <div className="rounded-lg border border-warning/60 bg-warning-visible p-4">
                  <div className="flex gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">该批注意见此前已经通过飞书推送过</p>
                      <p className="text-sm text-muted-foreground">
                        再次推送可能造成重复通知，是否继续？
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Loading State */}
            {loading && !preview && !showConfirmDialog && (
              <div className="space-y-4 py-2" role="status" aria-live="polite">
                <div className="h-16 animate-pulse rounded-lg bg-muted" />
                <div className="h-48 animate-pulse rounded-lg bg-muted" />
                <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  加载中...
                </p>
              </div>
            )}

            {/* Success State */}
            {success && !showConfirmDialog && (
              <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 py-8" role="status" aria-live="polite">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success-visible text-success">
                  <Check className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="text-lg font-semibold">推送成功</span>
                <p className="text-sm text-muted-foreground">飞书消息已发送</p>
              </div>
            )}

            {/* Error State (no comments) */}
            {error && !preview && !showConfirmDialog && !loading && (
              <div className="flex min-h-[220px] items-center justify-center py-8" role="alert">
                <p className="max-w-md text-center text-sm text-muted-foreground">{error}</p>
              </div>
            )}

            {/* Preview State */}
            {preview && !success && !showConfirmDialog && (
              <div className="space-y-4">
                {/* Recipient Section */}
                <section className="rounded-lg border bg-card p-4" aria-labelledby={recipientTitleId}>
                  <h3 id={recipientTitleId} className="mb-3 text-xs font-medium text-muted-foreground">
                    接收人
                  </h3>
                  <FeishuAvatar
                    name={preview.recipient.feishuNickname || preview.recipient.name}
                    feishuAvatar={preview.recipient.feishuAvatar}
                    avatarUrl={preview.recipient.avatarUrl}
                    size="lg"
                    title={
                      preview.recipient.feishuNickname ||
                      preview.recipient.name ||
                      (preview.recipient.isBound ? '飞书接收人' : '未绑定飞书')
                    }
                    className="h-11 w-11"
                  />
                </section>

                {/* Push Scope Section - Video */}
                {preview.scope === 'video' && preview.videos && (
                  <section className="rounded-lg border bg-card p-4" aria-labelledby={scopeTitleId}>
                    <h3 id={scopeTitleId} className="mb-3 text-sm font-semibold">推送范围</h3>
                    <div className="space-y-2 text-sm">
                      <p>
                        <span className="font-medium">项目：</span>
                        {preview.project.title}
                      </p>
                      <p>
                        <span className="font-medium">视频：</span>
                        {preview.videos.name} <span className="text-muted-foreground">{preview.videos.versionLabel}</span>
                      </p>
                    </div>
                  </section>
                )}

                {/* Push Scope Section - Project */}
                {preview.scope === 'project' && preview.videoList && preview.videoList.length > 0 && (
                  <section className="rounded-lg border bg-card p-4" aria-labelledby={projectScopeTitleId}>
                    <div className="mb-3">
                      <h3 id={projectScopeTitleId} className="text-sm font-semibold">推送范围</h3>
                      <p className="mt-1 text-xs text-muted-foreground">只显示有批注的集数</p>
                    </div>

                    <p className="mb-4 text-sm">
                      <span className="font-medium">项目：</span>
                      {preview.project.title}
                    </p>

                    <div className="overflow-x-auto rounded-md border border-border/70">
                      <table className="w-full min-w-[580px] table-fixed text-left text-sm">
                        <colgroup>
                          <col className="w-12" />
                          <col className="w-44" />
                          <col className="w-20" />
                          <col className="w-24" />
                          <col className="w-24" />
                          <col className="w-12" />
                        </colgroup>
                        <thead className="bg-muted/60 text-xs text-muted-foreground">
                          <tr>
                            <th scope="col" className="px-1 py-2 text-center">
                              <label className="flex h-9 w-10 cursor-pointer items-center justify-center">
                                <SelectCheckbox
                                  checked={allProjectVideosSelected}
                                  indeterminate={someProjectVideosSelected && !allProjectVideosSelected}
                                  onChange={handleSelectAll}
                                  disabled={selectableProjectVideos.length === 0}
                                  ariaLabel="选择全部可推送集数"
                                />
                              </label>
                            </th>
                            <th scope="col" className="px-2 py-2 font-medium">集数</th>
                            <th scope="col" className="px-2 py-2 font-medium">批注数</th>
                            <th scope="col" className="px-2 py-2 font-medium">状态</th>
                            <th scope="col" className="px-2 py-2 font-medium">时间</th>
                            <th scope="col" className="px-1 py-2" aria-label="飞书头像" />
                          </tr>
                        </thead>
                        <tbody>
                          {preview.videoList
                            .slice(0, expandedList ? undefined : MAX_VISIBLE_VIDEOS)
                            .map((item) => {
                              const isDisabled = item.unpushedComments === 0 && !rePushAll
                              const status = item.pushedComments === 0
                                ? '未推送'
                                : item.unpushedComments > 0
                                  ? '部分推送'
                                  : '已推送'
                              const statusClass = status === '已推送'
                                ? 'text-success'
                                : status === '部分推送'
                                  ? 'text-warning'
                                  : 'text-muted-foreground'

                              return (
                                <tr
                                  key={item.video.id}
                                  className={`border-t border-border/70 transition-colors hover:bg-muted/40 ${isDisabled ? 'text-muted-foreground' : ''}`}
                                >
                                  <td className="px-1 py-1 text-center">
                                    <label className={`flex h-10 w-10 items-center justify-center ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                                      <SelectCheckbox
                                        checked={selectedVideos.has(item.video.id)}
                                        onChange={() => toggleVideoSelection(item.video.id)}
                                        disabled={isDisabled}
                                        ariaLabel={`选择${item.video.name}`}
                                      />
                                    </label>
                                  </td>
                                  <td className="max-w-0 px-2 py-2.5">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <span className="block min-w-0 max-w-[180px] truncate text-sm font-medium" title={item.video.name}>
                                        {item.video.name}
                                      </span>
                                      {item.video.versionLabel && (
                                        <span className="shrink-0 text-xs text-muted-foreground">
                                          {item.video.versionLabel}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-2 py-2.5 tabular-nums text-muted-foreground">
                                    {item.totalComments} 条
                                  </td>
                                  <td className={`px-2 py-2.5 font-medium ${statusClass}`}>
                                    {status}
                                  </td>
                                  <td className="px-2 py-2.5 tabular-nums text-muted-foreground">
                                    {formatTime(item.lastPushAt)}
                                  </td>
                                  <td className="px-1 py-2.5">
                                    <FeishuAvatar
                                      name={item.uploader.feishuNickname || item.uploader.name}
                                      feishuAvatar={item.uploader.feishuAvatar}
                                      avatarUrl={item.uploader.avatarUrl}
                                      size="sm"
                                      title={
                                        item.uploader.isBound
                                          ? item.uploader.feishuNickname || item.uploader.name || '飞书接收人'
                                          : '未绑定飞书'
                                      }
                                      className="mx-auto"
                                    />
                                  </td>
                                </tr>
                              )
                            })}
                        </tbody>
                      </table>
                    </div>

                    {preview.videoList.length > MAX_VISIBLE_VIDEOS && (
                      <button
                        type="button"
                        onClick={() => setExpandedList(!expandedList)}
                        className="mt-2 flex min-h-10 w-full items-center justify-center gap-1 text-sm text-primary transition-colors hover:text-primary/80 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        {expandedList ? (
                          <>
                            <ChevronUp className="h-4 w-4" aria-hidden="true" />
                            收起
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-4 w-4" aria-hidden="true" />
                            共 {preview.videoList.length} 集，查看全部
                          </>
                        )}
                      </button>
                    )}
                  </section>
                )}

                {/* Previous Push Warning */}
                {preview.hasPreviousPush && preview.unpushedComments > 0 && (
                  <div className="rounded-lg border border-warning/60 bg-warning-visible p-3" role="status">
                    <div className="flex gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                      <div className="space-y-1 text-sm">
                        <p>
                          本{preview.scope === 'video' ? '集' : '项目'}已有{' '}
                          <strong>{preview.pushedComments}</strong> 条批注意见推送过，本次新增{' '}
                          <strong>{preview.unpushedComments}</strong> 条未推送批注意见。
                        </p>
                        {preview.lastPushAt && (
                          <p className="text-xs text-muted-foreground">
                            上次推送时间：{formatDateTime(preview.lastPushAt)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {preview.lastFailedPush && (
                  <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3" role="alert" aria-live="assertive">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-sm font-medium">上次推送失败</p>
                        <p className="break-words text-xs text-muted-foreground">
                          {preview.lastFailedPush.errorMessage || '飞书接口返回错误'}
                          {' · '}第 {preview.lastFailedPush.retryCount} 次尝试
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleRetry}
                          disabled={loading || retrying || !preview.recipient.isBound}
                          className="mt-1"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          {retrying ? '重试中...' : '重试发送'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Re-push All Option */}
                {preview.hasPreviousPush && (
                  <label
                    htmlFor={rePushAllId}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
                  >
                    <SelectCheckbox
                      id={rePushAllId}
                      checked={rePushAll}
                      onChange={handleRePushAllChange}
                      ariaLabel="再次推送全部批注意见"
                    />
                    <span className="space-y-1">
                      <span className="block text-sm font-medium">再次推送</span>
                      <span className="block text-xs leading-5 text-muted-foreground">
                        勾选后将重新推送所有批注意见（包括已推送的）
                      </span>
                    </span>
                  </label>
                )}

                {/* Statistics */}
                <section className="rounded-lg border bg-card p-4" aria-labelledby={statisticsTitleId}>
                  <h3 id={statisticsTitleId} className="mb-3 text-xs font-medium text-muted-foreground">推送统计</h3>
                  <div className="grid grid-cols-3 divide-x divide-border text-center">
                    <div className="px-2">
                      <div className="text-2xl font-semibold tabular-nums">{displayedStats.totalComments}</div>
                      <div className="mt-1 text-xs text-muted-foreground">总批注数</div>
                    </div>
                    <div className="px-2">
                      <div className="text-2xl font-semibold tabular-nums text-muted-foreground">{displayedStats.pushedComments}</div>
                      <div className="mt-1 text-xs text-muted-foreground">已推送</div>
                    </div>
                    <div className="px-2">
                      <div className="text-2xl font-semibold tabular-nums text-primary">
                        {rePushAll ? displayedStats.totalComments : displayedStats.unpushedComments}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">待推送</div>
                    </div>
                  </div>
                </section>

                {/* Error Message */}
                {error && (
                  <div className="rounded-lg border border-destructive/60 bg-destructive/5 p-3" role="alert" aria-live="assertive">
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Fixed Action Bar */}
          {showConfirmDialog && preview && (
            <DialogFooter className="flex shrink-0 flex-col gap-3 border-t bg-background px-5 py-4 sm:flex-row sm:flex-nowrap sm:items-center sm:justify-end sm:px-6">
              <Button variant="outline" onClick={() => setShowConfirmDialog(false)} disabled={loading}>
                取消
              </Button>
              <Button onClick={handleConfirmPush} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {loading ? '推送中...' : '确认再次推送'}
              </Button>
            </DialogFooter>
          )}

          {success && !showConfirmDialog && (
            <DialogFooter className="flex shrink-0 flex-col gap-3 border-t bg-background px-5 py-4 sm:flex-row sm:flex-nowrap sm:items-center sm:justify-end sm:px-6">
              <Button onClick={handleClose}>关闭</Button>
            </DialogFooter>
          )}

          {error && !preview && !showConfirmDialog && !loading && (
            <DialogFooter className="flex shrink-0 flex-col gap-3 border-t bg-background px-5 py-4 sm:flex-row sm:flex-nowrap sm:items-center sm:justify-end sm:px-6">
              <Button onClick={handleClose}>关闭</Button>
            </DialogFooter>
          )}

          {preview && !success && !showConfirmDialog && (
            <DialogFooter className="flex shrink-0 flex-col gap-3 border-t bg-background px-5 py-4 sm:flex-row sm:flex-nowrap sm:items-center sm:justify-end sm:px-6">
              <div className="flex min-w-0 flex-1 items-center text-xs text-muted-foreground">
                {preview.scope === 'project' && <span>{selectedProjectCount} 集待推送</span>}
                {preview.scope === 'project' && selectedProjectHasUnboundRecipient && (
                  <span className="ml-2 text-warning">请取消未绑定飞书的集数</span>
                )}
                {preview.scope !== 'project' && !preview.recipient.isBound && (
                  <span className="ml-2 text-warning">接收人未绑定飞书</span>
                )}
              </div>
              <Button variant="outline" onClick={handleClose} disabled={loading}>
                取消
              </Button>
              <Button onClick={handleConfirmPush} disabled={!canPush}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {loading ? '推送中...' : '确认推送'}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
