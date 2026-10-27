'use client'

import { useState, Suspense, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { AlertCircle, ArrowLeft, Check, Clock, LockKeyhole, Smartphone } from 'lucide-react'
import { setTokens, clearTokens } from '@/lib/token-store'
import { setActiveTeamId } from '@/lib/team-store'
import BrandLogo from '@/components/BrandLogo'
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout'
import { getDeviceAuthHeaders } from '@/lib/device-id'
import { safeReturnUrl } from '@/lib/return-url'
import { WechatMiniQrLogin } from '@/components/WechatMiniQrLogin'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type FocusedField = 'phone' | 'password' | null
type LoginMode = 'password' | 'sms'
type LoginView = 'options' | 'wechat' | 'phone'
type ConsentAnchor = { x: number; y: number }
const PHONE_REGEX = /^1[3-9]\d{9}$/

const FIELD_CLASS = 'h-11 rounded-lg border-border bg-popover px-3.5 text-[15px] shadow-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 focus-visible:ring-offset-0'

function WechatGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M9.3 4C5.3 4 2 6.7 2 10c0 1.9 1 3.5 2.7 4.7l-.7 2.1 2.5-1.3c.8.2 1.7.4 2.8.4h.5a5.6 5.6 0 0 1-.2-1.4c0-3.1 3-5.7 6.7-5.7h.4C16 6 13 4 9.3 4Zm-2.4 3.4a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Zm4.8 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Z" />
      <path d="M22 14.5c0-2.8-2.8-5-6.2-5s-6.2 2.2-6.2 5 2.8 5 6.2 5c.8 0 1.5-.1 2.2-.3l2 1-.5-1.8C21 17.5 22 16.1 22 14.5Zm-8.2-1.2a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6Zm4 0a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6Z" />
    </svg>
  )
}

function ConsentCheckbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  children: React.ReactNode
}) {
  return (
    <label className="group flex cursor-pointer items-start gap-2.5 text-xs leading-5 text-muted-foreground">
      <span className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 h-4 w-4 cursor-pointer appearance-none rounded-[4px] border border-border bg-popover transition-colors duration-[var(--motion-base)] checked:border-primary checked:bg-primary group-hover:border-foreground/40 checked:group-hover:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20"
        />
        <Check className="pointer-events-none relative h-3 w-3 text-primary-foreground opacity-0 transition-opacity duration-[var(--motion-base)] peer-checked:opacity-100" strokeWidth={3} />
      </span>
      <span>{children}</span>
    </label>
  )
}

function Notice({ tone, children }: { tone: 'warning' | 'error'; children: React.ReactNode }) {
  const Icon = tone === 'warning' ? Clock : AlertCircle
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-5',
        tone === 'warning'
          ? 'border-warning/25 bg-warning-visible text-warning'
          : 'border-destructive/25 bg-destructive-visible text-destructive',
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="font-medium">{children}</p>
    </div>
  )
}

function LoginForm() {
  const t = useTranslations('auth')
  const tc = useTranslations('common')
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedReturnUrl = searchParams?.get('returnUrl')
  // SECURITY: 只许指回本站内路径（`/\evil.com` 会被解析成站外，见 return-url.ts）
  const returnUrl = safeReturnUrl(requestedReturnUrl, '/studio/projects')
  const sessionExpired = searchParams?.get('sessionExpired') === 'true'

  const [mode, setMode] = useState<LoginMode>('password')
  const [view, setView] = useState<LoginView>('options')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [focusedField, setFocusedField] = useState<FocusedField>(null)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [consentOpen, setConsentOpen] = useState(false)
  const [consentAnchor, setConsentAnchor] = useState<ConsentAnchor | null>(null)
  const pendingActionRef = useRef<(() => void) | null>(null)

  // 同意条款不做任何记忆：记住上次的勾选＝下次进页面默认替用户同意，正是被点名的「默认勾选」。
  function toggleAgreed(value: boolean) {
    setAgreed(value)
    if (value) setError('')
  }

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  function openOptions() {
    setView('options')
    setError('')
  }

  function openPhone(nextMode: LoginMode) {
    setMode(nextMode)
    setView('phone')
    setError('')
    setCode('')
    setCodeSent(false)
    setCooldown(0)
  }

  function requestConsent(action: () => void, anchor?: Element | null) {
    if (agreed) {
      action()
      return
    }
    setError('')
    pendingActionRef.current = action
    if (anchor) {
      const rect = anchor.getBoundingClientRect()
      setConsentAnchor({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    } else {
      setConsentAnchor(null)
    }
    setConsentOpen(true)
  }

  function confirmConsent() {
    setAgreed(true)
    setConsentOpen(false)
    const action = pendingActionRef.current
    pendingActionRef.current = null
    action?.()
  }

  function cancelConsent() {
    setConsentOpen(false)
    pendingActionRef.current = null
  }

  function openWechat(anchor?: Element | null) {
    setError('')
    requestConsent(() => setView('wechat'), anchor)
  }

  function applyTokens(data: { tokens?: { accessToken?: string; refreshToken?: string } }) {
    // A fresh login must not inherit the previous session's team choice.
    setActiveTeamId(null)
    if (data?.tokens?.accessToken && data?.tokens?.refreshToken) {
      setTokens({
        accessToken: data.tokens.accessToken,
        refreshToken: data.tokens.refreshToken,
      })
    } else {
      clearTokens()
    }
  }

  async function handleSendCode() {
    setError('')
    if (!PHONE_REGEX.test(phone)) {
      setError(t('invalidPhone'))
      return
    }

    setSendingCode(true)
    try {
      const response = await fetch('/api/auth/sms/send-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getDeviceAuthHeaders(),
        },
        body: JSON.stringify({ phone }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error || t('smsSendFailed'))
        return
      }
      setCodeSent(true)
      setCooldown(60)
    } catch {
      setError(t('smsSendFailed'))
    } finally {
      setSendingCode(false)
    }
  }

  async function performSubmit() {
    setError('')
    setLoading(true)

    try {
      if (mode === 'sms') {
        if (!PHONE_REGEX.test(phone)) {
          setError(t('invalidPhone'))
          setLoading(false)
          return
        }
        if (!/^\d{6}$/.test(code)) {
          setError(t('invalidCode'))
          setLoading(false)
          return
        }

        const response = await fetch('/api/auth/sms/verify-code', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getDeviceAuthHeaders(),
          },
          body: JSON.stringify({ phone, code, intent: 'login' }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          setError(
            data.code === 'PHONE_ACCOUNT_CONFLICT'
              ? t('phoneLinkedElsewhere')
              : data.error || t('loginFailed')
          )
          setLoading(false)
          return
        }

        applyTokens(data)
        const destination = returnUrl
        router.push(destination)
        router.refresh()
        return
      }

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getDeviceAuthHeaders(),
        },
        body: JSON.stringify({ email: phone, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        // 本页只收手机号，不透传 API 的「用户名、邮箱或密码错误」通用文案
        setError(response.status === 401 ? t('invalidPhoneOrPassword') : (data.error || t('loginFailed')))
        setLoading(false)
        return
      }

      applyTokens(data)

      const destination = returnUrl
      router.push(destination)
      router.refresh()
    } catch (err) {
      setError(tc('errorTryAgain'))
      setLoading(false)
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    requestConsent(() => { void performSubmit() }, e.currentTarget.querySelector('button[type="submit"]'))
  }

  const terms = (className: string) => t.rich('termsAgreement', {
    terms: (chunks) => <Link href="/terms" target="_blank" rel="noopener noreferrer" className={className}>{chunks}</Link>,
    privacy: (chunks) => <Link href="/privacy" target="_blank" rel="noopener noreferrer" className={className}>{chunks}</Link>,
  })
  const termsLinkClass = 'mx-0.5 font-medium text-foreground underline decoration-border underline-offset-[3px] transition-colors hover:text-primary hover:decoration-primary'

  const notices = (sessionExpired || error) && (
    <div className="space-y-2.5">
      {sessionExpired && <Notice tone="warning">{t('sessionExpired')}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )

  const backToOptions = (
    <button
      type="button"
      onClick={openOptions}
      className="-ml-1.5 inline-flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[13px] text-muted-foreground outline-none transition-colors duration-[var(--motion-base)] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-primary/20"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      {t('otherLoginMethods')}
    </button>
  )

  return (
    <AuthSplitLayout
      characters={{ isTyping: focusedField === 'phone', showPassword: passwordVisible, passwordLength: password.length }}
      headerEnd={view === 'options' ? (
        <button
          type="button"
          onClick={() => router.push('/')}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground outline-none transition-colors duration-[var(--motion-base)] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-primary/20"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('backToHome')}
        </button>
      ) : null}
    >
      <div
        key={view}
        className="w-full max-w-[380px] animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out fill-mode-both motion-reduce:animate-none"
      >
        {view === 'options' ? (
          <div>
            <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground">
              {t('welcomeBack')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('signInDescription')}</p>

            {notices && <div className="mt-6">{notices}</div>}

            <Button
              type="button"
              className="mt-8 h-11 w-full rounded-lg text-[15px] font-medium [&_svg]:size-[18px]"
              onClick={(e) => openWechat(e.currentTarget)}
            >
              <WechatGlyph />
              {t('wechatQrButton')}
            </Button>

            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">{t('otherLoginMethods')}</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => openPhone('password')}
                className="group flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-popover text-sm font-medium text-foreground shadow-elevation-sm outline-none transition-[border-color,background-color,box-shadow,transform] duration-[var(--motion-base)] hover:border-foreground/25 hover:bg-accent/50 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 active:translate-y-px active:shadow-none"
              >
                <LockKeyhole className="h-4 w-4 text-muted-foreground transition-colors duration-[var(--motion-base)] group-hover:text-foreground" />
                {t('passwordLogin')}
              </button>
              <button
                type="button"
                onClick={() => openPhone('sms')}
                className="group flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-popover text-sm font-medium text-foreground shadow-elevation-sm outline-none transition-[border-color,background-color,box-shadow,transform] duration-[var(--motion-base)] hover:border-foreground/25 hover:bg-accent/50 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 active:translate-y-px active:shadow-none"
              >
                <Smartphone className="h-4 w-4 text-muted-foreground transition-colors duration-[var(--motion-base)] group-hover:text-foreground" />
                {t('smsLogin')}
              </button>
            </div>

            <div className="mt-8">
              <ConsentCheckbox checked={agreed} onChange={toggleAgreed}>
                {terms(termsLinkClass)}
              </ConsentCheckbox>
            </div>
          </div>
        ) : view === 'wechat' ? (
          <div>
            {backToOptions}
            <h1 className="mt-5 text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground">{t('wechatQrLogin')}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('wechatScanHint')}</p>

            <WechatMiniQrLogin
              inline
              returnUrl={returnUrl}
              className="mt-6 text-center"
            />

            <p className="mt-5 text-xs leading-5 text-muted-foreground">
              {t.rich('termsByScanning', {
                terms: (chunks) => <Link href="/terms" target="_blank" rel="noopener noreferrer" className={termsLinkClass}>{chunks}</Link>,
                privacy: (chunks) => <Link href="/privacy" target="_blank" rel="noopener noreferrer" className={termsLinkClass}>{chunks}</Link>,
              })}
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button type="button" variant="outline" className="h-10 rounded-lg" onClick={() => openPhone('password')}>
                <LockKeyhole className="text-muted-foreground" />
                {t('passwordLogin')}
              </Button>
              <Button type="button" variant="outline" className="h-10 rounded-lg" onClick={() => openPhone('sms')}>
                <Smartphone className="text-muted-foreground" />
                {t('smsLogin')}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            {backToOptions}
            <h1 className="mt-5 text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground">
              {t('phoneLogin')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('signInDescription')}</p>

            <div
              role="tablist"
              aria-label={t('loginMethod')}
              className="relative mt-6 grid h-10 grid-cols-2 rounded-lg bg-muted p-1"
            >
              <span
                aria-hidden
                className={cn(
                  'absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-md bg-popover shadow-elevation-sm transition-transform duration-200 ease-out motion-reduce:transition-none',
                  mode === 'sms' && 'translate-x-full',
                )}
              />
              {(['password', 'sms'] as LoginMode[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={mode === option}
                  onClick={() => { if (mode !== option) openPhone(option) }}
                  className={cn(
                    'relative z-10 rounded-md text-[13px] font-medium outline-none transition-colors duration-[var(--motion-base)] focus-visible:ring-[3px] focus-visible:ring-primary/20',
                    mode === option ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option === 'sms' ? t('smsLogin') : t('passwordLogin')}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              {notices}

              <div className="space-y-2">
                <Label htmlFor="phone" className="text-[13px] font-medium text-foreground">{t('phone')}</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[15px] tabular-nums text-muted-foreground">
                    +86
                  </span>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    className={cn(FIELD_CLASS, 'pl-[52px] tabular-nums tracking-[0.02em]')}
                    placeholder={t('phonePlaceholder')}
                    value={phone}
                    onChange={(e) => {
                      const nextPhone = e.target.value.replace(/\D/g, '').slice(0, 11)
                      setPhone(nextPhone)
                      if (mode === 'sms') {
                        setCode('')
                        setCodeSent(false)
                        setCooldown(0)
                      }
                    }}
                    onFocus={() => setFocusedField('phone')}
                    onBlur={() => setFocusedField(null)}
                    required
                    name="site-login-phone"
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    disabled={loading}
                  />
                </div>
              </div>

              {mode === 'password' ? (
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <Label htmlFor="password" className="text-[13px] font-medium text-foreground">{t('password')}</Label>
                    <Link href="/forgot-password" className="text-xs text-muted-foreground transition-colors duration-[var(--motion-base)] hover:text-primary">{t('forgotPassword')}</Link>
                  </div>
                  <PasswordInput
                    id="password"
                    className={FIELD_CLASS}
                    placeholder={t('passwordPlaceholder')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    onVisibilityChange={setPasswordVisible}
                    required
                    name="site-login-password"
                    autoComplete="current-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    disabled={loading}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="login-code" className="text-[13px] font-medium text-foreground">{t('verificationCode')}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="login-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      className={cn(FIELD_CLASS, 'min-w-0 flex-1 tabular-nums tracking-[0.12em] placeholder:tracking-normal')}
                      placeholder={t('verificationCodePlaceholder')}
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                      onFocus={() => setFocusedField(null)}
                      onBlur={() => setFocusedField(null)}
                      required
                      name="site-login-code"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      disabled={loading}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-[108px] shrink-0 rounded-lg bg-popover text-[13px] tabular-nums shadow-none"
                      disabled={sendingCode || cooldown > 0 || phone.length !== 11}
                      onClick={handleSendCode}
                    >
                      {sendingCode
                        ? t('sendingCode')
                        : cooldown > 0
                          ? `${cooldown}s`
                          : codeSent
                            ? t('resendCode')
                            : t('sendCode')}
                    </Button>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">{t('unregisteredPhoneHint')}</p>
                </div>
              )}

              <ConsentCheckbox checked={agreed} onChange={toggleAgreed}>
                {terms(termsLinkClass)}
              </ConsentCheckbox>

              <Button
                type="submit"
                className="h-11 w-full rounded-lg text-[15px] font-medium"
                disabled={loading || (mode === 'sms' && (code.length !== 6 || !codeSent))}
              >
                {loading ? (mode === 'sms' ? t('verifying') : t('signingIn')) : t('signIn')}
              </Button>
            </form>
          </div>
        )}
      </div>

      <Dialog open={consentOpen} onOpenChange={(open) => { if (!open) cancelConsent() }}>
        <DialogContent
          hideClose
          className="max-w-[400px] gap-0 rounded-xl bg-popover p-6"
          style={consentAnchor ? { left: consentAnchor.x, top: consentAnchor.y } : undefined}
        >
          <DialogHeader className="space-y-0">
            <DialogTitle className="text-[15px] font-normal leading-7 text-foreground">
              {t.rich('termsConsentPrompt', {
                terms: (chunks) => <Link href="/terms" target="_blank" rel="noopener noreferrer" className="mx-0.5 font-medium text-primary underline underline-offset-[3px]">{chunks}</Link>,
                privacy: (chunks) => <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="mx-0.5 font-medium text-primary underline underline-offset-[3px]">{chunks}</Link>,
              })}
            </DialogTitle>
          </DialogHeader>
          <DialogFooter className="mt-6 flex-row justify-end gap-2.5 sm:justify-end">
            <Button type="button" variant="outline" className="h-10 min-w-[88px] rounded-lg" onClick={cancelConsent}>{tc('cancel')}</Button>
            <Button type="button" className="h-10 min-w-[120px] rounded-lg" onClick={confirmConsent}>{t('termsAgree')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AuthSplitLayout>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-dvh flex-1 items-center justify-center bg-popover">
        <div className="text-center">
          <BrandLogo height={64} className="mx-auto mb-4 animate-pulse" ariaHidden />
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
