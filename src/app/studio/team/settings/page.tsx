'use client'

import { appConfirm } from '@/components/AppDialogProvider'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StudioPageSkeleton } from '@/components/StudioPageSkeleton'
import { apiFetch, apiPatch } from '@/lib/api-client'
import { useAuth } from '@/components/AuthProvider'

type TeamSettingsData = {
  defaultApplyPreviewLut: boolean
  maxUploadSizeGB: number
  defaultUsePreviewForApprovedPlayback: boolean
  defaultAllowClientAssetUpload: boolean
  defaultAllowReverseShare: boolean
  defaultShowClientTutorial: boolean
  defaultAllowAssetDownload: boolean
  defaultClientCanApprove: boolean
  autoApproveProject: boolean
}

const DEFAULTS: TeamSettingsData = {
  defaultApplyPreviewLut: true,
  maxUploadSizeGB: 1,
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
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [savedSnapshot, setSavedSnapshot] = useState('')

  const canEdit = Boolean(user && (user.teamRole === 'OWNER' || user.teamRole === 'ADMIN'))

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch('/api/team-settings')
      if (!response.ok) throw new Error('无法加载视频设置')
      const data = await response.json()
      const next = { ...DEFAULTS, ...data.settings }
      setSettings(next)
      setSavedSnapshot(JSON.stringify(next))
      setLoaded(true)
    } catch (err) {
      // Leaving the form on DEFAULTS and allowing a save here would overwrite the
      // team's real defaults with factory values, so the form stays hidden.
      setLoaded(false)
      setError(err instanceof Error ? err.message : '无法加载视频设置')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    if (canEdit) return
    router.replace('/studio/team')
  }, [router, user, canEdit])

  useEffect(() => {
    if (!canEdit) {
      setLoading(false)
      return
    }
    void load()
  }, [canEdit, load])

  const dirty = loaded && JSON.stringify(settings) !== savedSnapshot

  // 未保存时离开页面要拦一下：刷新/关页用 beforeunload，站内跳转用捕获阶段拦链接。
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      event.preventDefault()
      event.stopPropagation()
      void appConfirm('有未保存的设置，离开后会丢失。确定离开吗？').then((leave) => {
        if (leave) router.push(`${url.pathname}${url.search}`)
      })
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty, router])

  const update = <K extends keyof TeamSettingsData>(key: K, value: TeamSettingsData[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  const save = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await apiPatch('/api/team-settings', settings)
      setSavedSnapshot(JSON.stringify(settings))
      setSuccess('视频设置已保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <StudioPageSkeleton label="正在加载视频设置…" className="p-6" />
  }

  if (!canEdit) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6 text-center">
        <h1 className="text-lg font-semibold">无权访问视频设置</h1>
        <p className="mt-2 text-sm text-muted-foreground">只有团队创建人和管理员可以查看或修改团队设置。</p>
      </div>
    )
  }

  if (!loaded) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6 text-center">
        <h1 className="text-lg font-semibold">未能加载视频设置</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error || '当前显示的是出厂默认值，保存会覆盖团队已有配置，请重试。'}</p>
        <Button variant="outline" className="mt-4" onClick={() => void load()}>重试</Button>
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
        <div className="flex items-center gap-3">
          {dirty && <span role="status" className="text-sm text-warning">有未保存的修改</span>}
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存设置'}
          </Button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive-visible p-3 text-sm text-destructive">{error}</div>}
      {success && <div role="status" aria-live="polite" className="rounded-md border border-primary/20 bg-primary-visible p-3 text-sm">{success}</div>}

      <Card>
        <CardHeader><CardTitle>视频处理默认值</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm text-muted-foreground">最大上传大小（GB）</span>
            <Input
              type="number"
              min={1}
              value={settings.maxUploadSizeGB}
              onChange={(event) => update('maxUploadSizeGB', Number(event.target.value) || 1)}
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>默认开关</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
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
