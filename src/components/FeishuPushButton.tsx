'use client'

import { useState } from 'react'
import { Send, AlertTriangle, ChevronDown, ChevronUp, Check } from 'lucide-react'
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
import { Label } from './ui/label'
import { InitialsAvatar } from './InitialsAvatar'

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
}

export function FeishuPushButton({ projectId, videoId, className = '', size = 'default' }: FeishuPushButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<PushPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [rePushAll, setRePushAll] = useState(false)
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set())
  const [expandedList, setExpandedList] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

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
        const data = await res.json()
        throw new Error(data.error || '预览失败')
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

    // Check if trying to push without selecting videos (project scope)
    if (preview.scope === 'project' && selectedVideos.size === 0) {
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
      const query = videoId ? `?videoId=${videoId}` : ''
      const body = rePushAll
        ? { rePushAll: true }
        : preview.scope === 'project'
        ? { videoIds: Array.from(selectedVideos) }
        : {}

      const res = await apiFetch(`/api/feishu/push/${projectId}${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '推送失败')
      }

      setSuccess(true)
      setShowConfirmDialog(false)
    } catch (err: any) {
      setError(err.message || '未知错误')
    } finally {
      setLoading(false)
    }
  }

  const toggleVideoSelection = (videoId: string) => {
    const newSelected = new Set(selectedVideos)
    if (newSelected.has(videoId)) {
      newSelected.delete(videoId)
    } else {
      newSelected.add(videoId)
    }
    setSelectedVideos(newSelected)
  }

  const MAX_VISIBLE_VIDEOS = 5

  return (
    <>
      <Button
        variant="outline"
        size={size}
        className={className}
        onClick={handleOpen}
      >
        <Send className="w-4 h-4 mr-2" />
        {videoId ? '推送本集' : '推送项目批注'}
      </Button>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {videoId ? '推送本集批注到飞书' : '推送项目批注到飞书'}
            </DialogTitle>
            <DialogDescription>
              {videoId
                ? '将当前视频的批注推送到飞书群'
                : '将项目下所有视频的批注推送到飞书群'}
            </DialogDescription>
          </DialogHeader>

          {/* Confirmation Dialog */}
          {showConfirmDialog && preview && (
            <div className="space-y-4">
              <div className="rounded-lg border border-warning bg-warning/10 p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium">该批注意见此前已经通过飞书推送过</p>
                    <p className="text-sm text-muted-foreground">
                      再次推送可能造成重复通知，是否继续？
                    </p>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
                  取消
                </Button>
                <Button onClick={handleConfirmPush} disabled={loading}>
                  {loading ? '推送中...' : '确认再次推送'}
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Loading State */}
          {loading && !preview && !showConfirmDialog && (
            <div className="py-8 text-center text-muted-foreground">
              加载中...
            </div>
          )}

          {/* Success State */}
          {success && !showConfirmDialog && (
            <div className="py-8 space-y-4">
              <div className="flex items-center justify-center gap-2 text-success">
                <Check className="w-6 h-6" />
                <span className="text-lg font-medium">推送成功</span>
              </div>
              <DialogFooter>
                <Button onClick={handleClose}>关闭</Button>
              </DialogFooter>
            </div>
          )}

          {/* Error State (no comments) */}
          {error && !preview && !showConfirmDialog && (
            <div className="py-8 space-y-4">
              <p className="text-center text-muted-foreground">{error}</p>
              <DialogFooter>
                <Button onClick={handleClose}>关闭</Button>
              </DialogFooter>
            </div>
          )}

          {/* Preview State */}
          {preview && !success && !showConfirmDialog && (
            <div className="space-y-4">
              {/* Recipient Section */}
              <div className="rounded-lg border p-4">
                <Label className="text-xs text-muted-foreground mb-3 block">接收人</Label>
                <div className="flex items-center gap-3">
                  {preview.recipient.feishuNickname ? (
                    <InitialsAvatar
                      name={preview.recipient.feishuNickname}
                      size="md"
                    />
                  ) : (
                    <InitialsAvatar
                      name={preview.recipient.name || '未知'}
                      size="md"
                    />
                  )}
                  <div>
                    <p className="font-medium">
                      {preview.recipient.name || '未知用户'}
                    </p>
                    {!preview.recipient.isBound && (
                      <p className="text-xs text-warning flex items-center gap-1 mt-1">
                        <AlertTriangle className="w-3 h-3" />
                        该用户尚未绑定飞书账号
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Push Scope Section - Video */}
              {preview.scope === 'video' && preview.videos && (
                <div className="rounded-lg border p-4 space-y-3">
                  <Label className="text-xs text-muted-foreground">推送范围</Label>
                  <div className="space-y-1">
                    <p className="text-sm">
                      <span className="font-medium">项目：</span>
                      {preview.project.title}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">视频：</span>
                      {preview.videos.name} {preview.videos.versionLabel}
                    </p>
                  </div>
                </div>
              )}

              {/* Push Scope Section - Project */}
              {preview.scope === 'project' && preview.videoList && preview.videoList.length > 0 && (
                <div className="rounded-lg border p-4 space-y-3">
                  <Label className="text-xs text-muted-foreground">推送范围（只显示有批注的集数）</Label>
                  <p className="text-sm">
                    <span className="font-medium">项目：</span>
                    {preview.project.title}
                  </p>

                  <div className="space-y-2">
                    {preview.videoList
                      .slice(0, expandedList ? undefined : MAX_VISIBLE_VIDEOS)
                      .map((item) => (
                        <div
                          key={item.video.id}
                          className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 transition-colors"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 rounded border-input accent-primary"
                            checked={selectedVideos.has(item.video.id)}
                            onChange={() => toggleVideoSelection(item.video.id)}
                            disabled={item.unpushedComments === 0 && !rePushAll}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">
                                {item.video.name}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {item.totalComments}条
                              </span>
                            </div>
                            {item.lastPushAt ? (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                已推送（{new Date(item.lastPushAt).toLocaleString('zh-CN', {
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}）
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                未推送
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {item.uploader.isBound ? (
                              item.uploader.feishuAvatar || item.uploader.avatarUrl ? (
                                <img
                                  src={item.uploader.feishuAvatar || item.uploader.avatarUrl || ''}
                                  alt={item.uploader.name || ''}
                                  className="w-6 h-6 rounded-full"
                                />
                              ) : (
                                <InitialsAvatar
                                  name={item.uploader.name || '未知'}
                                  size="sm"
                                />
                              )
                            ) : (
                              <div className="text-xs text-warning flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                未绑定
                              </div>
                            )}
                          </div>
                        </div>
                      ))}

                    {preview.videoList.length > MAX_VISIBLE_VIDEOS && (
                      <button
                        onClick={() => setExpandedList(!expandedList)}
                        className="w-full text-sm text-primary hover:underline flex items-center justify-center gap-1 py-2"
                      >
                        {expandedList ? (
                          <>
                            <ChevronUp className="w-4 h-4" />
                            收起
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-4 h-4" />
                            共 {preview.videoList.length} 集，查看全部
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Previous Push Warning */}
              {preview.hasPreviousPush && preview.unpushedComments > 0 && (
                <div className="rounded-lg border border-warning bg-warning/10 p-3">
                  <div className="flex gap-2">
                    <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                    <div className="text-sm space-y-1">
                      <p>
                        本{preview.scope === 'video' ? '集' : '项目'}已有{' '}
                        <strong>{preview.pushedComments}</strong> 条批注意见推送过，
                        本次新增 <strong>{preview.unpushedComments}</strong> 条未推送批注意见。
                      </p>
                      {preview.lastPushAt && (
                        <p className="text-xs text-muted-foreground">
                          上次推送时间：
                          {new Date(preview.lastPushAt).toLocaleString('zh-CN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Re-push All Option */}
              {preview.hasPreviousPush && (
                <div className="flex items-start gap-2 p-3 rounded-lg border">
                  <input
                    type="checkbox"
                    id="rePushAll"
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
                    checked={rePushAll}
                    onChange={(e) => setRePushAll(e.target.checked)}
                  />
                  <div className="grid gap-1.5 leading-none">
                    <label
                      htmlFor="rePushAll"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      再次推送
                    </label>
                    <p className="text-xs text-muted-foreground">
                      勾选后将重新推送所有批注意见（包括已推送的）
                    </p>
                  </div>
                </div>
              )}

              {/* Statistics */}
              <div className="rounded-lg border p-4">
                <Label className="text-xs text-muted-foreground mb-3 block">推送统计</Label>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold">{preview.totalComments}</div>
                    <div className="text-xs text-muted-foreground mt-1">总批注数</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-muted-foreground">
                      {preview.pushedComments}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">已推送</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-primary">
                      {rePushAll ? preview.totalComments : preview.unpushedComments}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">待推送</div>
                  </div>
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="rounded-lg border border-destructive bg-destructive/10 p-3">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              {/* Footer Actions */}
              <DialogFooter>
                <Button variant="outline" onClick={handleClose} disabled={loading}>
                  取消
                </Button>
                <Button
                  onClick={handleConfirmPush}
                  disabled={loading || !preview.recipient.isBound || (preview.scope === 'project' && selectedVideos.size === 0)}
                >
                  {loading ? '推送中...' : '确认推送'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
