'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import QRCode from 'qrcode'
import { Check, Copy, Download, Link2, Loader2, MessageSquare, QrCode, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { apiFetch } from '@/lib/api-client'
import { copyTextToClipboard } from '@/lib/clipboard'

export type SharePreset = 'REVIEW' | 'DELIVERY'
export type ShareTarget = { scopeType: 'FOLDER' | 'VIDEO'; scopeId: string; name: string }

interface CreateShareDialogProps {
  projectId: string
  open: boolean
  preset: SharePreset
  target: ShareTarget | null
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

function ToggleRow({ checked, onChange, icon: Icon, title, description }: { checked: boolean; onChange: (value: boolean) => void; icon: any; title: string; description: string }) {
  return <label className="flex cursor-pointer items-center gap-3 py-3">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon className="h-4 w-4" /></span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="block text-xs leading-5 text-muted-foreground">{description}</span></span>
    <button type="button" role="switch" aria-checked={checked} onClick={(event) => { event.preventDefault(); onChange(!checked) }} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted-foreground/30'}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} /></button>
  </label>
}

function generateSharePassword(): string {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return String(values[0] % 10000).padStart(4, '0')
}

export default function CreateShareDialog({ projectId, open, preset, target, onOpenChange, onCreated }: CreateShareDialogProps) {
  const [name, setName] = useState('')
  const [allowDownload, setAllowDownload] = useState(true)
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

  useEffect(() => {
    if (!open || !target) return
    const delivery = preset === 'DELIVERY'
    setName(`${target.name}${delivery ? '交付' : '审阅'}`.slice(0, 100))
    setAllowDownload(true)
    setAllowComment(!delivery)
    setPasswordEnabled(false)
    setPassword('')
    setExpiryEnabled(false)
    setExpiresAt('')
    setLimitEnabled(false)
    setMaxViews('')
    setSubmitting(null)
    setError('')
    setCreated(null)
  }, [open, preset, target])

  const create = async (method: 'link' | 'qr') => {
    if (!target || !name.trim()) { setError('请输入分享名称'); return }
    if (expiryEnabled && !expiresAt) { setError('请选择过期时间'); return }
    if (limitEnabled && (!maxViews || Number(maxViews) < 1)) { setError('请输入有效的查看次数'); return }
    setSubmitting(method)
    setError('')
    try {
      const permissions = ['view', ...(allowComment ? ['comment'] : []), ...(allowDownload ? ['download'] : [])]
      const effectivePassword = passwordEnabled ? (password.trim() || generateSharePassword()) : ''
      if (passwordEnabled && !password.trim()) setPassword(effectivePassword)
      const response = await apiFetch(`/api/projects/${projectId}/share-links`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), type: preset, scopeType: target.scopeType, scopeId: target.scopeId, permissions, authMode: passwordEnabled ? 'PASSWORD' : 'NONE', password: effectivePassword, expiresAt: expiryEnabled ? new Date(expiresAt).toISOString() : null, maxViews: limitEnabled ? Number(maxViews) : null }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '创建分享失败')
      const url = data.shareLink.url as string
      const copyText = `请点击链接，审阅${target.name}\n链接：${url}${effectivePassword ? `\n密码：${effectivePassword}` : ''}`
      if (method === 'link') await copyTextToClipboard(copyText)
      const qrImage = method === 'qr' ? await QRCode.toDataURL(url, { width: 240, margin: 1, color: { dark: '#111827', light: '#ffffff' } }) : undefined
      setCreated({ url, copyText, qrImage })
      onCreated?.()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '创建分享失败') } finally { setSubmitting(null) }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="w-[calc(100%-2rem)] max-w-[520px] gap-0 overflow-hidden !rounded-lg !p-0">
      <DialogHeader className="border-b border-border px-6 py-5 pr-14">
        <DialogTitle>创建{preset === 'DELIVERY' ? '交付' : '审阅'}分享</DialogTitle>
        <DialogDescription>{target?.name || ''}</DialogDescription>
      </DialogHeader>
      {created ? <div className="px-6 py-6">
        <div className="flex flex-col items-center text-center">{created.qrImage ? <Image src={created.qrImage} alt="分享二维码" width={208} height={208} unoptimized className="h-52 w-52 rounded-md border border-border bg-white p-2" /> : <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"><Check className="h-6 w-6" /></span>}<h3 className="mt-4 font-semibold">{created.qrImage ? '通过扫码分享' : '通过链接分享'}</h3><p className="mt-1 text-sm text-muted-foreground">{created.qrImage ? '扫码即可打开分享页面' : '分享内容已复制到剪贴板'}</p></div>
        {created.qrImage ? <div className="mt-5 flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2"><Link2 className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-xs">{created.url}</span><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void copyTextToClipboard(created.url)} title="复制链接"><Copy className="h-4 w-4" /></Button></div> : <div className="mt-5 rounded-md border border-border bg-background p-3"><p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{created.copyText}</p><Button className="mt-3 h-9 w-full" onClick={() => void copyTextToClipboard(created.copyText)}><Copy className="mr-2 h-4 w-4" />复制</Button></div>}
        <Button variant="outline" className="mt-4 w-full" onClick={() => onOpenChange(false)}>完成</Button>
      </div> : <>
        <div className="max-h-[calc(100vh-12rem)] overflow-y-auto px-6 py-5">
          <label className="block text-sm font-medium">分享名称 <span className="text-destructive">*</span><input value={name} maxLength={100} onChange={event => setName(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" /></label>
          <div className="mt-5 divide-y divide-border border-y border-border">
            <ToggleRow checked={allowDownload} onChange={setAllowDownload} icon={Download} title="允许下载" description={preset === 'DELIVERY' ? '接收方可以下载交付文件' : '审阅者可以下载视频文件'} />
            <ToggleRow checked={allowComment} onChange={setAllowComment} icon={MessageSquare} title="允许批注" description="接收方可以添加时间点和画面批注" />
            <ToggleRow checked={passwordEnabled} onChange={(value) => { setPasswordEnabled(value); setPassword(value ? (password || generateSharePassword()) : '') }} icon={ShieldCheck} title="密码保护" description="打开链接时需要输入访问密码" />
          </div>
          {passwordEnabled && <label className="mt-4 block text-sm font-medium">密码<input type="text" value={password} onChange={event => setPassword(event.target.value)} placeholder="输入访问密码" className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" /></label>}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium"><span className="flex items-center gap-2"><input type="checkbox" checked={expiryEnabled} onChange={event => setExpiryEnabled(event.target.checked)} />过期时间</span><input type="datetime-local" disabled={!expiryEnabled} value={expiresAt} onChange={event => setExpiresAt(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-45" /></label>
            <label className="text-sm font-medium"><span className="flex items-center gap-2"><input type="checkbox" checked={limitEnabled} onChange={event => setLimitEnabled(event.target.checked)} />限制次数</span><input type="number" min="1" disabled={!limitEnabled} value={maxViews} onChange={event => setMaxViews(event.target.value)} placeholder="无限制" className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-45" /></label>
          </div>
          {error && <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="grid grid-cols-2 gap-2 border-t border-border bg-muted/20 px-6 py-4 sm:grid-cols-2">
          <Button variant="outline" disabled={Boolean(submitting)} onClick={() => void create('qr')}>{submitting === 'qr' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}扫码分享</Button>
          <Button disabled={Boolean(submitting)} onClick={() => void create('link')}>{submitting === 'link' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}链接分享</Button>
        </DialogFooter>
      </>}
    </DialogContent>
  </Dialog>
}
