'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiFetch, apiPatch } from '@/lib/api-client'
import { useAuth } from '@/components/AuthProvider'

type TeamSettingsData = {
  defaultWatermarkEnabled: boolean
  defaultWatermarkText: string | null
  defaultWatermarkPositions: string
  defaultWatermarkOpacity: number
  defaultWatermarkFontSize: string
  defaultApplyPreviewLut: boolean
  maxUploadSizeGB: number
  defaultTimestampDisplay: string
  defaultUsePreviewForApprovedPlayback: boolean
  defaultAllowClientAssetUpload: boolean
  defaultAllowReverseShare: boolean
  defaultShowClientTutorial: boolean
  defaultAllowAssetDownload: boolean
  defaultClientCanApprove: boolean
  autoApproveProject: boolean
}

const DEFAULTS: TeamSettingsData = {
  defaultWatermarkEnabled: true,
  defaultWatermarkText: null,
  defaultWatermarkPositions: 'center',
  defaultWatermarkOpacity: 30,
  defaultWatermarkFontSize: 'medium',
  defaultApplyPreviewLut: true,
  maxUploadSizeGB: 1,
  defaultTimestampDisplay: 'TIMECODE',
  defaultUsePreviewForApprovedPlayback: false,
  defaultAllowClientAssetUpload: false,
  defaultAllowReverseShare: true,
  defaultShowClientTutorial: true,
  defaultAllowAssetDownload: true,
  defaultClientCanApprove: true,
  autoApproveProject: true,
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
      </span>
    </label>
  )
}

export default function TeamSettingsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [settings, setSettings] = useState<TeamSettingsData>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (!user) return
    if (user && user.teamRole !== 'OWNER' && user.teamRole !== 'ADMIN') {
      router.replace('/studio/team')
    }
  }, [router, user])

  useEffect(() => {
    if (!user || (user.teamRole !== 'OWNER' && user.teamRole !== 'ADMIN')) {
      setLoading(false)
      return
    }
    ;(async () => {
      try {
        const response = await apiFetch('/api/team-settings')
        if (!response.ok) throw new Error('无法加载视频设置')
        const data = await response.json()
        setSettings({ ...DEFAULTS, ...data.settings })
      } catch (err) {
        setError(err instanceof Error ? err.message : '无法加载视频设置')
      } finally {
        setLoading(false)
      }
    })()
  }, [user])

  const update = <K extends keyof TeamSettingsData>(key: K, value: TeamSettingsData[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  const save = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await apiPatch('/api/team-settings', settings)
      setSuccess('视频设置已保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground" role="status" aria-live="polite">正在加载视频设置…</div>
  }

  if (!user || (user.teamRole !== 'OWNER' && user.teamRole !== 'ADMIN')) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6 text-center">
        <h1 className="text-lg font-semibold">无权访问视频设置</h1>
        <p className="mt-2 text-sm text-muted-foreground">只有团队创建人和管理员可以查看或修改团队设置。</p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">视频设置</h1>
          <p className="mt-1 text-sm text-muted-foreground">这些默认值只影响当前团队新建的项目。</p>
        </div>
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? '保存中…' : '保存设置'}
        </Button>
      </div>

      {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive-visible p-3 text-sm text-destructive">{error}</div>}
      {success && <div role="status" aria-live="polite" className="rounded-md border border-primary/20 bg-primary-visible p-3 text-sm">{success}</div>}

      <Card>
        <CardHeader><CardTitle>视频处理默认值</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm text-muted-foreground">默认时间码格式</span>
            <select
              value={settings.defaultTimestampDisplay}
              onChange={(event) => update('defaultTimestampDisplay', event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="TIMECODE">时码</option>
              <option value="AUTO">自动</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm text-muted-foreground">最大上传大小（GB）</span>
            <Input
              type="number"
              min={1}
              value={settings.maxUploadSizeGB}
              onChange={(event) => update('maxUploadSizeGB', Number(event.target.value) || 1)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm text-muted-foreground">水印位置</span>
            <select
              value={settings.defaultWatermarkPositions}
              onChange={(event) => update('defaultWatermarkPositions', event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="center">居中</option>
              <option value="top-left">左上</option>
              <option value="top-right">右上</option>
              <option value="bottom-left">左下</option>
              <option value="bottom-right">右下</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm text-muted-foreground">默认水印文字</span>
            <Input
              value={settings.defaultWatermarkText || ''}
              onChange={(event) => update('defaultWatermarkText', event.target.value || null)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm text-muted-foreground">水印不透明度</span>
            <Input
              type="number"
              min={10}
              max={100}
              value={settings.defaultWatermarkOpacity}
              onChange={(event) => update('defaultWatermarkOpacity', Number(event.target.value) || 30)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm text-muted-foreground">水印字号</span>
            <select
              value={settings.defaultWatermarkFontSize}
              onChange={(event) => update('defaultWatermarkFontSize', event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="small">小</option>
              <option value="medium">中</option>
              <option value="large">大</option>
            </select>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>默认开关</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          <Toggle label="默认启用水印" checked={settings.defaultWatermarkEnabled} onChange={(value) => update('defaultWatermarkEnabled', value)} />
          <Toggle label="默认应用预览 LUT" checked={settings.defaultApplyPreviewLut} onChange={(value) => update('defaultApplyPreviewLut', value)} />
          <Toggle label="批准后使用预览播放" checked={settings.defaultUsePreviewForApprovedPlayback} onChange={(value) => update('defaultUsePreviewForApprovedPlayback', value)} />
          <Toggle label="允许客户上传附件" checked={settings.defaultAllowClientAssetUpload} onChange={(value) => update('defaultAllowClientAssetUpload', value)} />
          <Toggle label="允许反向分享上传" checked={settings.defaultAllowReverseShare} onChange={(value) => update('defaultAllowReverseShare', value)} />
          <Toggle label="显示客户端引导" checked={settings.defaultShowClientTutorial} onChange={(value) => update('defaultShowClientTutorial', value)} />
          <Toggle label="允许资产下载" checked={settings.defaultAllowAssetDownload} onChange={(value) => update('defaultAllowAssetDownload', value)} />
          <Toggle label="允许客户批准" checked={settings.defaultClientCanApprove} onChange={(value) => update('defaultClientCanApprove', value)} />
          <Toggle label="全部视频批准后自动批准项目" checked={settings.autoApproveProject} onChange={(value) => update('autoApproveProject', value)} />
        </CardContent>
      </Card>
    </div>
  )
}
