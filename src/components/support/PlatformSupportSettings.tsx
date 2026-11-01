'use client'

import { useEffect, useState } from 'react'
import { apiFetch, apiPatch } from '@/lib/api-client'

type Settings = {
  enabled: boolean
  firstResponseTargetMinutes: number
  retentionDays: number
  csatEnabled: boolean
  quietHours: { enabled: boolean; start: string; end: string; timezone: string }
}

export function PlatformSupportSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/platform/support/settings', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data?.settings) setSettings(data.settings) })
      .catch(() => {})
  }, [])

  const save = async () => {
    if (!settings || saving) return
    setSaving(true)
    setNotice(null)
    try {
      const response = await apiPatch('/api/platform/support/settings', {
        enabled: settings.enabled,
        firstResponseTargetMinutes: settings.firstResponseTargetMinutes,
        retentionDays: settings.retentionDays,
        csatEnabled: settings.csatEnabled,
        quietHours: settings.quietHours,
      })
      if (!response?.settings) throw new Error('保存失败')
      setSettings(response.settings)
      setNotice('已保存')
    } catch {
      setNotice('保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (!settings) return null

  return (
    <details className="border-t border-border">
      <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-muted-foreground hover:bg-accent/50">客服设置</summary>
      <div className="space-y-3 px-4 pb-4 text-xs">
        <label className="flex items-center justify-between gap-2">
          <span>启用在线客服</span>
          <input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>首响目标（分钟）</span>
          <input
            type="number"
            min={1}
            max={1440}
            value={settings.firstResponseTargetMinutes}
            onChange={(event) => setSettings({ ...settings, firstResponseTargetMinutes: Number(event.target.value) })}
            className="h-7 w-20 rounded border border-border bg-background px-2"
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>关闭后留存（天）</span>
          <input
            type="number"
            min={30}
            max={3650}
            value={settings.retentionDays}
            onChange={(event) => setSettings({ ...settings, retentionDays: Number(event.target.value) })}
            className="h-7 w-20 rounded border border-border bg-background px-2"
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>关闭后评价</span>
          <input type="checkbox" checked={settings.csatEnabled} onChange={(event) => setSettings({ ...settings, csatEnabled: event.target.checked })} />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>免打扰时段</span>
          <input
            type="checkbox"
            checked={settings.quietHours.enabled}
            onChange={(event) => setSettings({ ...settings, quietHours: { ...settings.quietHours, enabled: event.target.checked } })}
          />
        </label>
        {settings.quietHours.enabled && (
          <div className="flex items-center justify-end gap-1">
            <input value={settings.quietHours.start} onChange={(event) => setSettings({ ...settings, quietHours: { ...settings.quietHours, start: event.target.value } })} className="h-7 w-16 rounded border border-border bg-background px-1" aria-label="免打扰开始时间" />
            <span>—</span>
            <input value={settings.quietHours.end} onChange={(event) => setSettings({ ...settings, quietHours: { ...settings.quietHours, end: event.target.value } })} className="h-7 w-16 rounded border border-border bg-background px-1" aria-label="免打扰结束时间" />
            <span className="text-[10px] text-muted-foreground">Asia/Shanghai</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">{notice || '免打扰期间不发推送'}</span>
          <button type="button" onClick={() => void save()} disabled={saving} className="h-7 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground disabled:opacity-50">
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </details>
  )
}
