'use client'

import { useState, Suspense, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { ArrowLeft, LockKeyhole, Phone } from 'lucide-react'
import { setTokens, clearTokens } from '@/lib/token-store'
import { setActiveTeamId } from '@/lib/team-store'
import BrandLogo from '@/components/BrandLogo'
import { AnimatedCharacters } from '@/components/ui/animated-characters'
import { getDeviceAuthHeaders } from '@/lib/device-id'
import { safeReturnUrl } from '@/lib/return-url'
import { WechatMiniQrLogin } from '@/components/WechatMiniQrLogin'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type FocusedField = 'phone' | 'password' | null
type LoginMode = 'password' | 'sms'
type LoginView = 'options' | 'wechat' | 'phone'
const PHONE_REGEX = /^1[3-9]\d{9}$/
const BRAND_NAME = '逐帧审阅'

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

  function requestConsent(action: () => void) {
    if (agreed) {
      action()
      return
    }
    setError('')
    pendingActionRef.current = action
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

  function openWechat() {
    setError('')
    requestConsent(() => setView('wechat'))
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
          body: JSON.stringify({ phone, code }),
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
        if (data.needsOnboarding) {
          const onboardingUrl = `/onboarding?returnUrl=${encodeURIComponent(returnUrl)}`
          router.replace(onboardingUrl)
          router.refresh()
          return
        }
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    requestConsent(() => { void performSubmit() })
  }

  const terms = (className: string) => t.rich('termsAgreement', {
    terms: (chunks) => <Link href="/terms" target="_blank" rel="noopener noreferrer" className={className}>{chunks}</Link>,
    privacy: (chunks) => <Link href="/privacy" target="_blank" rel="noopener noreferrer" className={className}>{chunks}</Link>,
  })

  return (
    <div className="grid min-h-dvh flex-1 bg-popover lg:grid-cols-[minmax(0,33fr)_minmax(0,67fr)]">
      <aside className="relative hidden overflow-hidden border-r border-black/10 bg-[#ececea] dark:border-white/10 dark:bg-[#222329] lg:flex lg:flex-col">
        <div className="relative z-10 flex flex-1 items-center justify-center px-6 py-12">
          <div className="h-[240px] w-[270px] xl:h-[300px] xl:w-[338px] 2xl:h-[360px] 2xl:w-[405px] [--s:0.6] xl:[--s:0.75] 2xl:[--s:0.9]">
            <div className="origin-top-left [transform:scale(var(--s))] dark:drop-shadow-[0_0_1px_rgba(255,255,255,0.35)]">
              <AnimatedCharacters
                isTyping={focusedField === 'phone'}
                showPassword={passwordVisible}
                passwordLength={password.length}
              />
            </div>
          </div>
        </div>
        <div className="absolute bottom-6 left-6 z-10 flex flex-col items-center gap-1.5 text-center">
          <div className="flex items-center gap-3">
            <BrandLogo height={38} />
            <p className="text-sm font-semibold text-[#17191f] dark:text-white">{BRAND_NAME}</p>
          </div>
          <p className="text-xs text-muted-foreground">{t('brandTagline')}</p>
        </div>
      </aside>

      <section className="relative flex min-h-dvh flex-col bg-popover lg:min-h-0">
        {view === 'options' && (
          <Button
            type="button"
            variant="ghost"
            className="absolute left-4 top-4 z-10 h-9 px-2 text-muted-foreground sm:left-6 sm:top-6 lg:left-8 lg:top-7"
            onClick={() => router.push('/')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />{t('backToHome')}
          </Button>
        )}

        <div className="flex flex-1 items-center justify-center px-5 py-8 sm:px-10 lg:px-14">
          <div className="w-full max-w-[360px]">
            <div className="mb-8 lg:hidden">
              <div className="flex items-center gap-3">
                <BrandLogo height={42} />
                <div>
                  <p className="font-semibold text-foreground">{BRAND_NAME}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('brandTagline')}</p>
                </div>
              </div>
            </div>

            {view === 'options' ? (
              <div className="text-center">
                <h1 className="text-[32px] font-semibold leading-[1.2] tracking-tight text-foreground sm:text-[36px]">
                  {t('loginWelcome', { brand: BRAND_NAME })}
                </h1>

                {sessionExpired && (
                  <div className="mt-5 rounded-md border border-warning/30 bg-warning-visible p-3 text-left">
                    <p className="text-sm font-medium text-warning">{t('sessionExpired')}</p>
                  </div>
                )}
                {error && (
                  <div className="mt-5 rounded-md border border-destructive/30 bg-destructive-visible p-3 text-left" aria-live="polite">
                    <p className="text-sm font-medium text-destructive">{error}</p>
                  </div>
                )}

                <Button
                  type="button"
                  size="lg"
                  className="mt-8 h-12 w-full rounded-md text-sm font-medium"
                  onClick={openWechat}
                >
                  {t('wechatQrButton')}
                </Button>

                <label className="mt-4 flex items-start justify-center gap-2 text-left text-xs leading-5 text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => toggleAgreed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
                  />
                  <span>{terms('mx-0.5 font-medium text-primary underline-offset-2 hover:underline')}</span>
                </label>

                <div className="my-8 flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">{t('otherLoginMethods')}</span>
                  <span className="h-px flex-1 bg-border" />
                </div>

                <div className="flex items-start justify-center gap-10">
                  <button
                    type="button"
                    onClick={() => openPhone('password')}
                    className="group flex flex-col items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background/40 text-foreground transition-colors group-hover:bg-accent">
                      <LockKeyhole className="h-5 w-5" />
                    </span>
                    <span className="text-xs text-muted-foreground">{t('passwordLogin')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openPhone('sms')}
                    className="group flex flex-col items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background/40 text-foreground transition-colors group-hover:bg-accent">
                      <Phone className="h-5 w-5" />
                    </span>
                    <span className="text-xs text-muted-foreground">{t('smsLogin')}</span>
                  </button>
                </div>
              </div>
            ) : view === 'wechat' ? (
              <div className="text-center">
                <button
                  type="button"
                  onClick={openOptions}
                  className="mb-8 inline-flex items-center gap-1.5 rounded px-1 py-1 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t('otherLoginMethods')}
                </button>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t('wechatQrLogin')}</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('wechatScanHint')}</p>

                <WechatMiniQrLogin
                  inline
                  returnUrl={returnUrl}
                  className="mt-7"
                />

                <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
                  {t.rich('termsByScanning', {
                    terms: (chunks) => <Link href="/terms" target="_blank" rel="noopener noreferrer" className="mx-0.5 text-primary hover:underline">{chunks}</Link>,
                    privacy: (chunks) => <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="mx-0.5 text-primary hover:underline">{chunks}</Link>,
                  })}
                </p>

                <div className="mt-6 flex items-center justify-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => openPhone('sms')}>
                    {t('smsLogin')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => openPhone('password')}>
                    {t('passwordLogin')}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={openOptions}
                  className="mb-6 inline-flex items-center gap-1.5 rounded px-1 py-1 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t('otherLoginMethods')}
                </button>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                  {mode === 'sms' ? t('smsLogin') : t('passwordLogin')}
                </h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('signInDescription')}</p>

                <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                  {sessionExpired && (
                    <div className="rounded-md border border-warning/30 bg-warning-visible p-3">
                      <p className="text-sm font-medium text-warning">{t('sessionExpired')}</p>
                    </div>
                  )}

                  {error && (
                    <div className="rounded-md border border-destructive/30 bg-destructive-visible p-3" aria-live="polite">
                      <p className="text-sm font-medium text-destructive">{error}</p>
                    </div>
                  )}

                  <div className="space-y-2.5">
                    <Label htmlFor="phone" className="text-sm font-medium">{t('phone')}</Label>
                    <Input
                      id="phone"
                      type="tel"
                      inputMode="numeric"
                      className="h-12 rounded-md bg-transparent px-4"
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

                  {mode === 'password' ? (
                    <div className="space-y-2.5">
                      <Label htmlFor="password" className="text-sm font-medium">{t('password')}</Label>
                      <PasswordInput
                        id="password"
                        className="h-12 rounded-md bg-transparent px-4"
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
                      <div className="flex justify-end">
                        <Link href="/forgot-password" className="text-xs text-muted-foreground transition-colors hover:text-primary">{t('forgotPassword')}</Link>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <Label htmlFor="login-code" className="text-sm font-medium">{t('verificationCode')}</Label>
                      <div className="flex gap-2">
                        <Input
                          id="login-code"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          className="h-12 min-w-0 flex-1 rounded-md bg-transparent px-4"
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
                          className="h-12 w-32 shrink-0 rounded-md"
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

                  <label className="flex items-start gap-2.5 text-xs leading-5 text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => toggleAgreed(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
                    />
                    <span>{terms('mx-0.5 font-medium text-primary underline-offset-2 hover:underline')}</span>
                  </label>

                  <Button
                    type="submit"
                    size="lg"
                    className="h-12 w-full rounded-md"
                    disabled={loading || (mode === 'sms' && (code.length !== 6 || !codeSent))}
                  >
                    {loading ? (mode === 'sms' ? t('verifying') : t('signingIn')) : t('signIn')}
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>

        <footer className="shrink-0 px-5 pb-5 text-center text-[10px] tracking-wide text-muted-foreground lg:pr-8 lg:text-right">
          © {new Date().getFullYear()} {BRAND_NAME}
        </footer>
      </section>

      <Dialog open={consentOpen} onOpenChange={(open) => { if (!open) cancelConsent() }}>
        <DialogContent hideClose className="max-w-[420px] gap-0 rounded-lg bg-popover p-6">
          <DialogHeader className="space-y-0">
            <DialogTitle className="text-center text-base font-normal leading-7 text-foreground">
              {t.rich('termsConsentPrompt', {
                terms: (chunks) => <Link href="/terms" target="_blank" rel="noopener noreferrer" className="mx-0.5 font-medium text-primary underline underline-offset-2">{chunks}</Link>,
                privacy: (chunks) => <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="mx-0.5 font-medium text-primary underline underline-offset-2">{chunks}</Link>,
              })}
            </DialogTitle>
          </DialogHeader>
          <DialogFooter className="mt-6 flex-row justify-center gap-3 sm:justify-center">
            <Button type="button" variant="outline" className="h-10 min-w-[108px]" onClick={cancelConsent}>{tc('cancel')}</Button>
            <Button type="button" className="h-10 min-w-[132px]" onClick={confirmConsent}>{t('termsAgree')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
