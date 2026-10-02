'use client'

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useTranslations } from 'next-intl'
import { QrCode, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { apiFetch, apiPatch } from '@/lib/api-client'

type TransferResponse = {
  accountName: string | null
  accountNo: string | null
  bank: string | null
  note: string | null
  qrPath: string | null
  configured: boolean
  qrUrl: string | null
}

type Form = { accountName: string; accountNo: string; bank: string; note: string }
type Feedback = { kind: 'ok' | 'error'; text: string } | null

export function TransferSettingsSection({
  active,
  show,
  setShow,
  collapsible = true,
}: {
  active: boolean
  show: boolean
  setShow: (value: boolean) => void
  collapsible?: boolean
}) {
  const t = useTranslations('settings')
  const [form, setForm] = useState<Form>({ accountName: '', accountNo: '', bank: '', note: '' })
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [hasQr, setHasQr] = useState(false)
  const [qrRev, setQrRev] = useState(0)
  const [qrSrc, setQrSrc] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 收款码必须走字节而不是 <img src>：那个路由要平台 Bearer，而 <img> 请求带不上
  // Authorization 头（房内 /api/branding/logo 能用 <img> 是因为它根本没鉴权）。
  // 取一次字节顺带解决了换码后的缓存问题，不需要给地址拼版本号。
  // active 把关同下面那次 config GET：本区块在同页挂了两个实例，两边都得等自己真的被用得上
  // 才去取字节，否则一次换码会被拉两遍（关掉时 cleanup 会 revokeObjectURL，见下）。
  useEffect(() => {
    if (!active || !hasQr) {
      setQrSrc(null)
      return
    }
    let url: string | null = null
    let alive = true
    apiFetch('/api/settings/transfer/qr')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (!alive) return
        url = URL.createObjectURL(blob)
        setQrSrc(url)
      })
      .catch(() => {
        if (alive) setFeedback({ kind: 'error', text: t('transfer.qrLoadFailed') })
      })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [active, hasQr, qrRev, t])

  // 自取数按 WebPushSection / ExternalNotificationsSection 的口径由 active 把关：本区块在
  // 移动端折叠栈（lg:hidden，一直挂着）和桌面面板里各有一个实例，不设闸就是每次进设置页两轮
  // config GET + 两轮收款码字节。没 active 时一个请求都不发，Save 按钮继续由 loaded 挡住。
  useEffect(() => {
    if (!active) return
    let alive = true
    apiFetch('/api/settings/transfer')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as TransferResponse
      })
      .then((cfg) => {
        if (!alive) return
        setForm({
          accountName: cfg.accountName ?? '',
          accountNo: cfg.accountNo ?? '',
          bank: cfg.bank ?? '',
          note: cfg.note ?? '',
        })
        setConfigured(cfg.configured)
        setHasQr(Boolean(cfg.qrUrl))
        setLoaded(true)
      })
      .catch(() => {
        if (alive) setFeedback({ kind: 'error', text: t('transfer.loadFailed') })
      })
    return () => {
      alive = false
    }
  }, [active, t])

  const setField =
    (key: keyof Form) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }))

  const save = useCallback(async () => {
    setSaving(true)
    setFeedback(null)
    try {
      const cfg = await apiPatch<TransferResponse>('/api/settings/transfer', form)
      setConfigured(cfg.configured)
      setHasQr(Boolean(cfg.qrUrl))
      setFeedback({ kind: 'ok', text: t('transfer.saved') })
    } catch (error) {
      // apiPatch 在非 2xx 时抛的就是响应里的 error 字段（api-client.ts:62-68），
      // 所以服务端那句「收款账号只能包含数字、字母和连字符」要原样给运营看到，不翻译、不裹一层。
      setFeedback({
        kind: 'error',
        text: error instanceof Error && error.message ? error.message : t('transfer.saveFailed'),
      })
    } finally {
      setSaving(false)
    }
  }, [form, t])

  const uploadQr = useCallback(
    async (file: File) => {
      setUploading(true)
      setFeedback(null)
      const body = new FormData()
      body.set('file', file)
      try {
        // 走 apiFetch 而不是 apiPost：后者硬编 Content-Type: application/json，
        // multipart 必须让浏览器自己带上 boundary。
        const res = await apiFetch('/api/settings/transfer', { method: 'POST', body })
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`)
        // 只刷收款码、不回填那四个框：运营可能有还没保存的编辑，这次上传不该把它们冲掉。
        setHasQr(true)
        setQrRev((v) => v + 1)
        setFeedback({ kind: 'ok', text: t('transfer.qrSaved') })
      } catch (error) {
        setFeedback({
          kind: 'error',
          text: error instanceof Error && error.message ? error.message : t('transfer.qrSaveFailed'),
        })
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [t],
  )

  return (
    <CollapsibleSection
      className="border-border"
      title={t('transfer.title')}
      description={t('transfer.description')}
      open={show}
      onOpenChange={setShow}
      collapsible={collapsible}
      contentClassName="space-y-4 border-t pt-4"
    >
      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="transferAccountName">{t('transfer.accountName')}</Label>
            <Input
              id="transferAccountName"
              value={form.accountName}
              onChange={setField('accountName')}
              maxLength={80}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="transferBank">{t('transfer.bank')}</Label>
            <Input id="transferBank" value={form.bank} onChange={setField('bank')} maxLength={80} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="transferAccountNo">{t('transfer.accountNo')}</Label>
          <Input
            id="transferAccountNo"
            value={form.accountNo}
            onChange={setField('accountNo')}
            maxLength={64}
            inputMode="numeric"
          />
          <p className="text-xs text-muted-foreground">{t('transfer.accountNoHint')}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="transferNote">{t('transfer.note')}</Label>
          <Textarea id="transferNote" rows={3} value={form.note} onChange={setField('note')} maxLength={2000} />
        </div>
        {configured === false && (
          <p className="text-xs font-medium text-destructive">{t('transfer.notConfigured')}</p>
        )}
      </div>

      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
        <Label>{t('transfer.qr')}</Label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void uploadQr(file)
            event.target.value = ''
          }}
        />
        <div className="flex items-center gap-4">
          <div className="w-24 h-24 rounded-xl border border-border bg-card flex items-center justify-center overflow-hidden">
            {qrSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrSrc} alt={t('transfer.qr')} className="w-full h-full object-contain" />
            ) : (
              <QrCode className="w-6 h-6 text-muted-foreground" />
            )}
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card text-sm hover:border-primary/60 hover:text-primary transition-colors disabled:opacity-50"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="w-4 h-4" />
            {uploading ? t('transfer.qrUploading') : hasQr ? t('transfer.qrReplace') : t('transfer.qrUpload')}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t('transfer.qrHint')}</p>
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => void save()} disabled={!loaded || saving || uploading}>
          {saving ? t('transfer.saving') : t('transfer.save')}
        </Button>
        {feedback && (
          <p
            role={feedback.kind === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={
              feedback.kind === 'error'
                ? 'text-xs font-medium text-destructive'
                : 'text-xs font-medium text-success'
            }
          >
            {feedback.text}
          </p>
        )}
      </div>
    </CollapsibleSection>
  )
}
