'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Mail, Phone } from 'lucide-react'

interface Props {
  onSubmitted: (email: string) => void
  onAuthenticated: (token: string) => void
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_REGEX = /^1[3-9]\d{9}$/

export default function PortalLogin({ onSubmitted, onAuthenticated }: Props) {
  const t = useTranslations('portal')
  const tc = useTranslations('common')
  const [mode, setMode] = useState<'email' | 'phone'>('phone')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [error, setError] = useState('')

  function switchMode(nextMode: 'email' | 'phone') {
    setMode(nextMode)
    setError('')
  }

  async function handleSendCode() {
    setError('')
    if (!PHONE_REGEX.test(phone)) {
      setError('\u8bf7\u8f93\u5165\u6b63\u786e\u7684 11 \u4f4d\u624b\u673a\u53f7')
      return
    }
    setSendingCode(true)
    try {
      const res = await fetch('/api/portal/phone/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '\u9a8c\u8bc1\u7801\u53d1\u9001\u5931\u8d25')
      setCodeSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '\u9a8c\u8bc1\u7801\u53d1\u9001\u5931\u8d25')
    } finally {
      setSendingCode(false)
    }
  }

  async function handlePhoneSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (!/^\d{6}$/.test(code)) {
      setError('\u8bf7\u8f93\u5165 6 \u4f4d\u9a8c\u8bc1\u7801')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/portal/phone/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.token) throw new Error(data.error || '\u767b\u5f55\u5931\u8d25')
      onAuthenticated(data.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : '\u767b\u5f55\u5931\u8d25')
    } finally {
      setLoading(false)
    }
  }

  async function handleEmailSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (!EMAIL_REGEX.test(email)) {
      setError(t('invalidEmail'))
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/portal/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (res.ok) {
        onSubmitted(email)
        return
      }
      const data = await res.json().catch(() => ({}))
      setError(data?.error || tc('errorTryAgain'))
    } catch {
      setError(tc('errorTryAgain'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="bg-card border-border w-full">
      <CardHeader className="text-center space-y-3">
        <div className="flex justify-center">
          {mode === 'phone' ? <Phone className="w-12 h-12 text-muted-foreground" /> : <Mail className="w-12 h-12 text-muted-foreground" />}
        </div>
        <CardTitle className="text-foreground">{t('title')}</CardTitle>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 rounded-md bg-muted p-1" role="tablist" aria-label={'\u767b\u5f55\u65b9\u5f0f'}>
          <button type="button" onClick={() => switchMode('phone')} className={`h-9 rounded text-sm font-medium ${mode === 'phone' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>{'\u624b\u673a\u53f7'}</button>
          <button type="button" onClick={() => switchMode('email')} className={`h-9 rounded text-sm font-medium ${mode === 'email' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>{'\u90ae\u7bb1'}</button>
        </div>

        {mode === 'email' ? (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="portal-email" className="text-sm font-medium text-foreground">{t('emailLabel')}</label>
              <Input id="portal-email" type="email" autoComplete="email" autoFocus placeholder={t('emailPlaceholder')} value={email} onChange={(event) => setEmail(event.target.value)} maxLength={255} required />
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <Button type="submit" disabled={loading || !email} className="w-full">{loading ? t('sending') : t('submit')}</Button>
          </form>
        ) : (
          <form onSubmit={handlePhoneSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="portal-phone" className="text-sm font-medium text-foreground">{'\u624b\u673a\u53f7'}</label>
              <Input id="portal-phone" type="tel" inputMode="numeric" autoComplete="tel" maxLength={11} placeholder={'\u8bf7\u8f93\u5165\u624b\u673a\u53f7'} value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))} autoFocus />
            </div>
            {codeSent && (
              <div className="space-y-2">
                <label htmlFor="portal-code" className="text-sm font-medium text-foreground">{'\u9a8c\u8bc1\u7801'}</label>
                <Input id="portal-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder={'\u8bf7\u8f93\u5165 6 \u4f4d\u9a8c\u8bc1\u7801'} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />
              </div>
            )}
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            {!codeSent ? (
              <Button type="button" onClick={handleSendCode} disabled={sendingCode || phone.length !== 11} className="w-full">{sendingCode ? '\u6b63\u5728\u53d1\u9001...' : '\u83b7\u53d6\u9a8c\u8bc1\u7801'}</Button>
            ) : (
              <div className="flex gap-2">
                <Button type="submit" disabled={loading || code.length !== 6} className="flex-1">{loading ? '\u6b63\u5728\u767b\u5f55...' : '\u767b\u5f55'}</Button>
                <Button type="button" variant="outline" onClick={handleSendCode} disabled={sendingCode}>{sendingCode ? '\u53d1\u9001\u4e2d' : '\u91cd\u65b0\u53d1\u9001'}</Button>
              </div>
            )}
          </form>
        )}
        <p className="text-xs text-muted-foreground text-center pt-2">{t('dontHaveAccess')}</p>
      </CardContent>
    </Card>
  )
}
