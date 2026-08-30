'use client'

import { useState } from 'react'
import { MessageSquare, Send } from 'lucide-react'
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

interface FeishuPushButtonProps {
  projectId: string
  videoId?: string // If provided, show "Push this video" option
  className?: string
  size?: 'default' | 'sm' | 'lg' | 'icon' // Button size
}

interface PushPreview {
  scope: string
  project: { id: string; title: string; code: string }
  videos?: { id: string; name: string; versionLabel: string }
  videoList?: Array<{ video: any; count: number }>
  totalComments: number
  pushedComments: number
  unpushedComments: number
  recipient: {
    userId: string
    name: string | null
    feishuNickname?: string
    isBound: boolean
  }
}

export function FeishuPushButton({ projectId, videoId, className = '', size = 'default' }: FeishuPushButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<PushPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [rePushAll, setRePushAll] = useState(false)

  const handleOpen = async () => {
    setOpen(true)
    setLoading(true)
    setError(null)
    setPreview(null)
    setSuccess(false)
    setRePushAll(false)

    try {
      const query = videoId ? `?videoId=${videoId}` : ''
      const res = await apiFetch(`/api/feishu/push/${projectId}/preview${query}`)
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '预览失败')
      }
      const data = await res.json()
      setPreview(data)
    } catch (err: any) {
      setError(err.message || '未知错误')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setOpen(false)
    setPreview(null)
    setError(null)
    setSuccess(false)
    setRePushAll(false)
  }

  const handleConfirmPush = async () => {
    if (!preview) return

    setLoading(true)
    setError(null)

    try {
      const query = videoId ? `?videoId=${videoId}` : ''
      const body = rePushAll ? { rePushAll: true } : {}
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
    } catch (err: any) {
      setError(err.message || '未知错误')
    } finally {
      setLoading(false)
    }
  }

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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {videoId ? '推送本集批注到飞书' : '推送项目批注到飞书'}
            </DialogTitle>
            <DialogDescription>
              {videoId
                ? '将当前视频的所有批注推送到飞书群'
                : '将项目下所有视频的批注推送到飞书群'}
            </DialogDescription>
          </DialogHeader>

          {loading && !preview ? (
            <div className="py-8 text-center text-muted-foreground">
              加载中...
            </div>
          ) : success ? (
            <div className="py-8">
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-full bg-green-100 dark:bg-green-900/20 p-3">
                  <MessageSquare className="h-6 w-6 text-green-600 dark:text-green-400" />
                </div>
                <div className="text-center space-y-2">
                  <h3 className="font-semibold text-lg">推送成功</h3>
                  <p className="text-sm text-muted-foreground">
                    批注已成功推送到飞书群
                  </p>
                </div>
              </div>
            </div>
          ) : preview ? (
            <div className="space-y-4">
              {/* Recipient Info */}
              <div className="rounded-lg border p-3 space-y-2">
                <Label className="text-xs text-muted-foreground">接收人</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <p className="font-medium text-sm">
                      {preview.recipient.feishuNickname || preview.recipient.name || '未知用户'}
                    </p>
                    {!preview.recipient.isBound && (
                      <p className="text-xs text-destructive">
                        ⚠️ 该用户尚未绑定飞书账号
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Push Scope */}
              <div className="rounded-lg border p-3 space-y-2">
                <Label className="text-xs text-muted-foreground">推送范围</Label>
                <div className="space-y-1">
                  <p className="text-sm">
                    <span className="font-medium">项目：</span>
                    {preview.project.title}
                  </p>
                  {preview.videos && (
                    <p className="text-sm">
                      <span className="font-medium">视频：</span>
                      {preview.videos.name} {preview.videos.versionLabel}
                    </p>
                  )}
                  {preview.videoList && (
                    <div className="text-sm">
                      <span className="font-medium">包含 {preview.videoList.length} 个视频：</span>
                      <ul className="mt-1 ml-4 text-xs text-muted-foreground space-y-0.5">
                        {preview.videoList.slice(0, 5).map((item, i) => (
                          <li key={i}>
                            • {item.video.name} ({item.count} 条批注)
                          </li>
                        ))}
                        {preview.videoList.length > 5 && (
                          <li>... 以及其他 {preview.videoList.length - 5} 个视频</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* Statistics */}
              <div className="rounded-lg border p-3 space-y-2">
                <Label className="text-xs text-muted-foreground">推送统计</Label>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold">{preview.totalComments}</p>
                    <p className="text-xs text-muted-foreground">总批注数</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-600">{preview.pushedComments}</p>
                    <p className="text-xs text-muted-foreground">已推送</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-orange-600">{preview.unpushedComments}</p>
                    <p className="text-xs text-muted-foreground">待推送</p>
                  </div>
                </div>
              </div>

              {/* Re-push all option */}
              {preview.pushedComments > 0 && (
                <div className="rounded-lg border p-3">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rePushAll}
                      onChange={(e) => setRePushAll(e.target.checked)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium">重新推送所有批注</p>
                      <p className="text-xs text-muted-foreground">
                        包括已推送的 {preview.pushedComments} 条批注
                      </p>
                    </div>
                  </label>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={handleClose} disabled={loading}>
              取消
            </Button>
            {preview && !success && (
              <Button
                onClick={handleConfirmPush}
                disabled={loading || !preview.recipient.isBound || (preview.unpushedComments === 0 && !rePushAll)}
              >
                {loading ? '推送中...' : '确认推送'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
