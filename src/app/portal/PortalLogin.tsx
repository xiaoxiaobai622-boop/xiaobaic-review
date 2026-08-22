'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Phone } from 'lucide-react'

interface Props {
  onSubmitted: (email: string) => void
  onAuthenticated: (token: string) => void
}

const PHONE_REGEX = /^1[3-9]\d{9}$/

export default function PortalLogin({ onSubmitted: _onSubmitted, onAuthenticated }: Props) {
  const t = useTranslations('portal')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [error, setError] = useState('')

  async function handleSendCode() {
    setError('')
    if (!PHONE_REGEX.test(phone)) {
      setError('请输入正确的 11 位手机号')
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
      if (!res.ok) throw new Error(data.error || '验证码发送失败')
      setCodeSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败')
    } finally {
      setSendingCode(false)
    }
  }

  async function handlePhoneSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (!/^\d{6}$/.test(code)) {
      setError('请输入 6 位验证码')
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
      if (!res.ok || !data.token) throw new Error(data.error || '登录失败')
      onAuthenticated(data.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="bg-card border-border w-full">
      <CardHeader className="text-center space-y-3">
        <div className="flex justify-center">
          <Phone className="w-12 h-12 text-muted-foreground" />
        </div>
        <CardTitle className="text-foreground">{t('title')}</CardTitle>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handlePhoneSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="portal-phone" className="text-sm font-medium text-foreground">手机号</label>
            <Input id="portal-phone" type="tel" inputMode="numeric" autoComplete="tel" maxLength={11} placeholder="请输入手机号" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))} autoFocus />
          </div>
          {codeSent && (
            <div className="space-y-2">
              <label htmlFor="portal-code" className="text-sm font-medium text-foreground">验证码</label>
              <Input id="portal-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="请输入 6 位验证码" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />
            </div>
          )}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {!codeSent ? (
            <Button type="button" onClick={handleSendCode} disabled={sendingCode || phone.length !== 11} className="w-full">{sendingCode ? '正在发送...' : '获取验证码'}</Button>
          ) : (
            <div className="flex gap-2">
              <Button type="submit" disabled={loading || code.length !== 6} className="flex-1">{loading ? '正在登录...' : '登录'}</Button>
              <Button type="button" variant="outline" onClick={handleSendCode} disabled={sendingCode}>{sendingCode ? '发送中' : '重新发送'}</Button>
            </div>
          )}
        </form>
        <p className="text-xs text-muted-foreground text-center pt-2">{t('dontHaveAccess')}</p>
      </CardContent>
    </Card>
  )
}
