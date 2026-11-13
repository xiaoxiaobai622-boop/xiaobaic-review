'use client'

import { useEffect, useId, useState } from 'react'
import Image from 'next/image'
import QRCode from 'qrcode'
import { Check, Copy, Download, ExternalLink, Link2, Loader2, MessageSquare, QrCode, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { apiFetch } from '@/lib/api-client'
import { copyTextToClipboard } from '@/lib/clipboard'
import { Switch } from '@/components/ui/switch'
import { generateSharePasscode } from '@/lib/password-utils'

export type SharePreset = 'REVIEW' | 'DELIVERY' | 'COLLECT'
/** A version row: `VIDEO` shares every version of the file, `VIDEO_VERSION` only one. */
export type ShareVersionOption = { id: string; version: number; versionLabel: string | null }
/** `PROJECT` covers the whole project, which is what 收录 uses; `scopeId` is then unused. */
export type ShareTarget = { scopeType: 'PROJECT' | 'FOLDER' | 'VIDEO' | 'VIDEO_VERSION'; scopeId: string; name: string; versions?: ShareVersionOption[] }

interface CreateShareDialogProps {
  projectId: string
  open: boolean
  preset: SharePreset
  target: ShareTarget | null
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

function versionName(item: ShareVersionOption): string {
  return item.versionLabel || `v${item.version}`
}

function ToggleRow({ checked, onChange, icon: Icon, title, description }: { checked: boolean; onChange: (value: boolean) => void; icon: any; title: string; description: string }) {
  const id = useId()
  return <div className="flex items-center gap-3 py-3">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon className="h-4 w-4" /></span>
    <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer"><span className="block text-sm font-medium">{title}</span><span className="block text-xs leading-5 text-muted-foreground">{description}</span></label>
    <Switch id={id} checked={checked} onCheckedChange={onChange} aria-label={title} />
  </div>
}

export default function CreateShareDialog({ projectId, open, preset, target, onOpenChange, onCreated }: CreateShareDialogProps) {
  const [name, setName] = useState('')
  const [copied, setCopied] = useState(false)
  const [versionScope, setVersionScope] = useState('all')
  const [allowDownload, setAllowDownload] = useState(false)
  const [allowComment, setAllowComment] = useState(true)
  const [passwordEnabled, setPasswordEnabled] = useState(false)
  const [password, setPassword] = useState('')
  const [expiryEnabled, setExpiryEnabled] = useState(false)
  const [expiresAt, setExpiresAt] = useState('')
  const [limitEnabled, setLimitEnabled] = useState(false)
  const [maxViews, setMaxViews] = useState('')
  const [submitting, setSubmitting] = useState<'link' | 'qr' | null>(null)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<{ url: string; copyText: string; qrImage?: string } | null>(null)
  // 现成的有效链接：紧凑列表供挑选复制，避免重复创建；列表限高内滚，不把弹窗撑长。
  const [existingLinks, setExistingLinks] = useState<{ id: string; name: string; url: string; createdAt: string }[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // 两个视图：create=新建表单（图2），copy=旧链接列表（复制）。底部两按钮切换。
  const [mode, setMode] = useState<'create' | 'copy'>('create')

  const label = preset === 'COLLECT' ? '收录' : preset === 'DELIVERY' ? '交付' : '审阅'

  useEffect(() => {
    if (!open || !target) return
    const delivery = preset === 'DELIVERY'
    const collect = preset === 'COLLECT'
    setName(`${target.name}${collect ? '收录' : delivery ? '交付' : '审阅'}`.slice(0, 100))
    setVersionScope('all')
    setAllowDownload(preset === 'DELIVERY')
    setAllowComment(!delivery && !collect)
    setPasswordEnabled(false)
    setPassword('')
    setExpiryEnabled(false)
    setExpiresAt('')
    setLimitEnabled(false)
    setMaxViews('')
    setSubmitting(null)
    setError('')
    setCreated(null)
    setCopiedId(null)
    setMode('create')
  }, [open, preset, target])

  useEffect(() => {
    if (!open || !target) { setExistingLinks([]); return }
    let active = true
    apiFetch(`/api/projects/${projectId}/share-links`, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) return
        const data = await response.json()
        const candidates = (Array.isArray(data.shareLinks) ? data.shareLinks : [])
          .filter((link: any) => link.type === preset && link.status === 'ACTIVE')
          .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        // 同范围的排前面，方便优先复用当前目标的那条。
        const sameScope = candidates.filter((link: any) => link.scopeType === target.scopeType && (target.scopeType === 'PROJECT' || link.scopeId === target.scopeId))
        const rest = candidates.filter((link: any) => !sameScope.includes(link))
        if (active) setExistingLinks([...sameScope, ...rest].map((link: any) => ({ id: link.id, name: link.name, url: link.url, createdAt: link.createdAt })))
      })
      .catch(() => { if (active) setExistingLinks([]) })
    return () => { active = false }
  }, [open, preset, target, projectId, created])

  const copyLink = async (link: { id: string; url: string }) => {
    if (await copyTextToClipboard(link.url)) {
      setCopiedId(link.id)
      window.setTimeout(() => setCopiedId(current => current === link.id ? null : current), 1500)
    }
  }

  const create = async (method: 'link' | 'qr') => {
    if (!target || !name.trim()) { setError('请输入分享名称'); return }
    if (expiryEnabled && !expiresAt) { setError('请选择过期时间'); return }
    if (limitEnabled && (!maxViews || Number(maxViews) < 1)) { setError('请输入有效的查看次数'); return }
    setSubmitting(method)
    setError('')
    try {
      const collect = preset === 'COLLECT'
      const permissions = collect ? ['upload'] : ['view', ...(allowComment ? ['comment'] : []), ...(allowDownload ? ['download'] : [])]
      const onlyVersion = target.versions?.find(item => item.id === versionScope)
      const scopeType = onlyVersion ? 'VIDEO_VERSION' : target.scopeType
      const scopeId = onlyVersion ? onlyVersion.id : target.scopeId
      const effectivePassword = passwordEnabled ? (password.trim() || generateSharePasscode()) : ''
      if (passwordEnabled && !password.trim()) setPassword(effectivePassword)
      const response = await apiFetch(`/api/projects/${projectId}/share-links`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), type: preset, scopeType, scopeId, permissions, authMode: passwordEnabled ? 'PASSWORD' : 'NONE', password: effectivePassword, expiresAt: expiryEnabled ? new Date(expiresAt).toISOString() : null, maxViews: limitEnabled ? Number(maxViews) : null }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '创建分享失败')
      const url = data.shareLink.url as string
      const copyText = collect
        ? `请点击链接，上传素材到${target.name}\n链接：${url}${effectivePassword ? `\n密码：${effectivePassword}` : ''}`
        : `请点击链接，审阅${target.name}${onlyVersion ? `（${versionName(onlyVersion)}）` : ''}\n链接：${url}${effectivePassword ? `\n密码：${effectivePassword}` : ''}`
      if (method === 'link') await copyTextToClipboard(copyText)
      const qrImage = method === 'qr' ? await QRCode.toDataURL(url, { width: 240, margin: 1, color: { dark: '#111827', light: '#ffffff' } }) : undefined
      setCreated({ url, copyText, qrImage })
      onCreated?.()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '创建分享失败') } finally { setSubmitting(null) }
  }

  const copy = async (text: string) => {
    await copyTextToClipboard(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const versions = [...(target?.versions ?? [])].sort((a, b) => b.version - a.version)

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="w-[calc(100%-2rem)] max-w-[520px] gap-0 overflow-hidden !rounded-lg !p-0">
      <DialogHeader className="border-b border-border px-6 py-5 pr-14">
        <DialogTitle>创建{preset === 'COLLECT' ? '收录' : preset === 'DELIVERY' ? '交付' : '审阅'}分享</DialogTitle>
        <DialogDescription>{target?.name || ''}</DialogDescription>
      </DialogHeader>
      {created ? <div className="px-6 py-6">
        <div className="flex flex-col items-center text-center">{created.qrImage ? <Image src={created.qrImage} alt="分享二维码" width={208} height={208} unoptimized className="h-52 w-52 rounded-md border border-border bg-white p-2" /> : <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"><Check className="h-6 w-6" /></span>}<h3 className="mt-4 font-semibold">{created.qrImage ? '通过扫码分享' : '通过链接分享'}</h3><p className="mt-1 text-sm text-muted-foreground">{created.qrImage ? '扫码即可打开分享页面' : '分享内容已复制到剪贴板'}</p></div>
        <p role="status" aria-live="polite" className="mt-2 min-h-4 text-center text-xs text-muted-foreground">{copied ? '已复制到剪贴板' : ''}</p>
        {created.qrImage ? <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2"><Link2 className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-xs">{created.url}</span><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void copy(created.url)} title="复制链接" aria-label="复制链接"><Copy className="h-4 w-4" /></Button></div> : <div className="mt-1 rounded-md border border-border bg-background p-3"><p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{created.copyText}</p><Button className="mt-3 h-9 w-full" onClick={() => void copy(created.copyText)}><Copy className="mr-2 h-4 w-4" />复制</Button></div>}
        <Button variant="outline" className="mt-4 w-full" onClick={() => onOpenChange(false)}>完成</Button>
      </div> : <>
        <div className="border-b border-border px-6 py-3">
          <div role="tablist" aria-label="分享方式" className="relative grid h-9 grid-cols-2 rounded-lg bg-muted p-1">
            <span aria-hidden className={`absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-md bg-background shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none ${mode === 'copy' ? 'translate-x-full' : ''}`} />
            <button type="button" role="tab" aria-selected={mode === 'create'} onClick={() => setMode('create')} className={`relative z-10 inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors duration-200 ${mode === 'create' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <Link2 className="h-4 w-4" />创建{label}链接
            </button>
            <button type="button" role="tab" aria-selected={mode === 'copy'} onClick={() => setMode('copy')} className={`relative z-10 inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors duration-200 ${mode === 'copy' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              <Copy className="h-4 w-4" />复制{label}链接
            </button>
          </div>
        </div>
        <div className="scrollbar-slim h-[min(430px,58vh)] overflow-y-auto">
          <div key={mode} className="animate-share-panel px-6 py-5">
          {mode === 'copy' ? (
            existingLinks.length > 0 ? (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">已有{label}链接（{existingLinks.length}）</span>
                  <span className="text-[11px] text-muted-foreground">点右侧按钮复制 / 打开</span>
                </div>
                <ul className="scrollbar-slim max-h-[320px] divide-y divide-border overflow-y-auto rounded-md border border-border bg-muted/20">
                  {existingLinks.map(link => (
                    <li key={link.id} className="flex items-center gap-2 px-3 py-2.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium" title={link.name}>{link.name}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{new Date(link.createdAt).toLocaleString()}</div>
                      </div>
                      <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 px-2.5 text-xs" onClick={() => void copyLink(link)}>
                        {copiedId === link.id ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}复制
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="打开链接" aria-label={`打开 ${link.name}`} onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}>
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border px-4 py-10 text-center">
                <p className="text-sm text-muted-foreground">还没有{label}链接</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setMode('create')}>去创建</Button>
              </div>
            )
          ) : (<>
            <label className="block text-sm font-medium">分享名称 <span className="text-destructive">*</span><input value={name} maxLength={100} onChange={event => setName(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" /></label>
            {versions.length > 1 && <label className="mt-4 block text-sm font-medium">分享范围<select value={versionScope} onChange={event => setVersionScope(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"><option value="all">全部 {versions.length} 个版本（以后上传的新版本也算在内）</option>{versions.map((item, index) => <option key={item.id} value={item.id}>仅 {versionName(item)}{index === 0 ? '（最新）' : ''}</option>)}</select></label>}
            <div className="mt-5 divide-y divide-border border-y border-border">
              {/* 收录链接只带 upload 一条权限，服务端也会这样落库，所以这两个开关不能出现。 */}
              {preset !== 'COLLECT' && <>
                <ToggleRow checked={allowDownload} onChange={setAllowDownload} icon={Download} title="允许下载" description={preset === 'DELIVERY' ? '接收方可以下载交付文件' : '审阅者可以下载视频文件'} />
                <ToggleRow checked={allowComment} onChange={setAllowComment} icon={MessageSquare} title="允许批注" description="接收方可以添加时间点和画面批注" />
              </>}
              <ToggleRow checked={passwordEnabled} onChange={(value) => { setPasswordEnabled(value); setPassword(value ? (password || generateSharePasscode()) : '') }} icon={ShieldCheck} title="密码保护" description="打开链接时需要输入访问密码" />
            </div>
            {passwordEnabled && <label className="mt-4 block text-sm font-medium">密码<input type="text" value={password} onChange={event => setPassword(event.target.value)} placeholder="输入访问密码" className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" /></label>}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium"><span className="flex items-center gap-2"><input type="checkbox" checked={expiryEnabled} onChange={event => setExpiryEnabled(event.target.checked)} />过期时间</span><input type="datetime-local" disabled={!expiryEnabled} value={expiresAt} onChange={event => setExpiresAt(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-45" /></label>
              <label className="text-sm font-medium"><span className="flex items-center gap-2"><input type="checkbox" checked={limitEnabled} onChange={event => setLimitEnabled(event.target.checked)} />限制次数</span><input type="number" min="1" disabled={!limitEnabled} value={maxViews} onChange={event => setMaxViews(event.target.value)} placeholder="无限制" className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-45" /></label>
            </div>
            {error && <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          </>)}
          </div>
        </div>
        <DialogFooter className="grid grid-cols-2 gap-2 border-t border-border bg-muted/20 px-6 py-4 sm:grid-cols-2">
          <Button variant="outline" disabled={Boolean(submitting)} onClick={() => void create('qr')}>{submitting === 'qr' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}扫码分享</Button>
          <Button disabled={Boolean(submitting)} onClick={() => void create('link')}>{submitting === 'link' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}链接分享</Button>
        </DialogFooter>
      </>}
    </DialogContent>
  </Dialog>
}
