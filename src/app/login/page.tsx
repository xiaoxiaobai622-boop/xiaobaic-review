'use client'

import { useState, Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { ArrowLeft, ArrowRight, Phone } from 'lucide-react'
import { setTokens, clearTokens } from '@/lib/token-store'
import BrandLogo from '@/components/BrandLogo'
import { AnimatedCharacters } from '@/components/ui/animated-characters'
import { getDeviceAuthHeaders } from '@/lib/device-id'
import { safeReturnUrl } from '@/lib/return-url'
import { WechatMiniQrLogin } from '@/components/WechatMiniQrLogin'

type FocusedField = 'phone' | 'password' | null
type LoginMode = 'password' | 'sms'
type LoginView = 'wechat' | 'phone'
const PHONE_REGEX = /^1[3-9]\d{9}$/

function LoginCharacters({
  focusedField,
  emailLength,
  hasPassword,
  passwordVisible,
  loading,
}: {
  focusedField: FocusedField
  emailLength: number
  hasPassword: boolean
  passwordVisible: boolean
  loading: boolean
}) {
  const t = useTranslations('auth')
  const lookX = Math.min(9, Math.max(-3, emailLength * 0.45 - 2))

  return (
    <div
      className="login-stage relative h-full min-h-[440px] w-full overflow-hidden"
      data-focus={focusedField || 'idle'}
      data-password={hasPassword ? 'filled' : 'empty'}
      data-revealed={passwordVisible ? 'true' : 'false'}
      data-loading={loading ? 'true' : 'false'}
      style={{ '--login-look-x': `${lookX}px` } as React.CSSProperties}
      aria-hidden="true"
    >
      <div className="login-stage-glow" />
      <div className="login-stage-floor" />

      <div className="login-character-slot login-slot-purple">
        <div className="login-character login-character-purple">
          <div className="login-character-face login-face-purple">
            <span className="login-eye"><span className="login-pupil" /></span>
            <span className="login-eye"><span className="login-pupil" /></span>
            <span className="login-mouth" />
          </div>
        </div>
      </div>

      <div className="login-character-slot login-slot-black">
        <div className="login-character login-character-black">
          <div className="login-character-face login-face-black">
            <span className="login-eye login-eye-light"><span className="login-pupil" /></span>
            <span className="login-eye login-eye-light"><span className="login-pupil" /></span>
            <span className="login-mouth" />
          </div>
        </div>
      </div>

      <div className="login-character-slot login-slot-yellow">
        <div className="login-character login-character-yellow">
          <div className="login-character-face login-face-yellow">
            <span className="login-dot-eye" />
            <span className="login-mouth login-mouth-yellow" />
          </div>
        </div>
      </div>

      <div className="login-character-slot login-slot-orange">
        <div className="login-character login-character-orange">
          <div className="login-character-face login-face-orange">
            <span className="login-dot-eye" />
            <span className="login-dot-eye" />
            <span className="login-mouth" />
          </div>
        </div>
      </div>

      <div className="login-stage-caption">
        <span className="login-caption-dot" />
        <span>{focusedField === 'password' ? (passwordVisible ? t('eyesAverted') : t('theyKeepSecret')) : t('welcomeBack')}</span>
      </div>
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
  const [view, setView] = useState<LoginView>('wechat')
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

  function switchMode(nextMode: LoginMode) {
    setMode(nextMode)
    setError('')
    setCode('')
    setCodeSent(false)
    setCooldown(0)
  }

  function applyTokens(data: { tokens?: { accessToken?: string; refreshToken?: string } }) {
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!agreed) {
      setError(t('termsRequired'))
      return
    }
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

  return (
    <div className="login-page-shell flex min-h-dvh flex-1 items-center p-3 sm:p-5 lg:p-7">
      <div className="login-panel mx-auto grid min-h-[min(720px,calc(100dvh-3.5rem))] w-full max-w-[1120px] overflow-hidden rounded-md bg-white shadow-2xl dark:bg-[#17191f] lg:grid-cols-2">
        <section className="relative hidden overflow-hidden border-r border-black/10 bg-[#ececea] dark:border-white/10 dark:bg-[#222329] lg:flex lg:flex-col">
          <div className="relative z-50 flex items-center gap-3 px-8 pt-8">
            <BrandLogo height={38} />
            <div>
              <p className="text-sm font-semibold text-[#17191f] dark:text-white">逐帧审阅</p>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-end justify-center overflow-hidden pb-6 pt-8">
            <AnimatedCharacters
              isTyping={focusedField === 'phone'}
              showPassword={passwordVisible}
              passwordLength={password.length}
            />
          </div>
        </section>

        <section className="flex min-w-0 items-center justify-center px-5 py-8 sm:px-10 lg:px-14">
          <div className="w-full max-w-[420px]">
            <Button type="button" variant="ghost" className="mb-6 h-9 px-2 text-muted-foreground" onClick={() => router.push('/')}>
              <ArrowLeft className="mr-2 h-4 w-4" />{t('backToHome')}
            </Button>
            <div className="mb-9 lg:hidden">
              <div className="flex items-center gap-3">
                <BrandLogo height={42} />
                <div>
                  <p className="font-semibold text-foreground">逐帧审阅</p>
                </div>
              </div>
            </div>

            {view === 'phone' ? (
              <>
                <div className="mb-9">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h1 className="text-3xl font-semibold text-foreground">{t('welcomeBack')}</h1>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('signInDescription')}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 px-2 text-muted-foreground"
                      onClick={() => setView('wechat')}
                    >
                      {t('wechatQrShortcut')}
                    </Button>
                  </div>
                </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {sessionExpired && (
                <div className="rounded-md border border-warning/30 bg-warning-visible p-3">
                  <p className="text-sm text-warning font-medium">
                    {t('sessionExpired')}
                  </p>
                </div>
              )}

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive-visible p-3" aria-live="polite">
                  <p className="text-sm text-destructive font-medium">{error}</p>
                </div>
              )}

              <div className="grid grid-cols-2 rounded-md bg-muted p-1" role="tablist" aria-label={t('loginMethod')}>
                <button
                  type="button"
                  onClick={() => switchMode('password')}
                  className={`h-9 rounded text-sm font-medium transition-colors ${mode === 'password' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
                >
                  {t('passwordLogin')}
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('sms')}
                  className={`h-9 rounded text-sm font-medium transition-colors ${mode === 'sms' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
                >
                  <Phone className="mr-1.5 inline h-3.5 w-3.5" />
                  {t('smsLogin')}
                </button>
              </div>

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
                <span>
                  {t.rich('termsAgreement', {terms: (chunks) => <Link href="/terms" target="_blank" rel="noopener noreferrer" className="mx-0.5 font-medium text-primary underline-offset-2 hover:underline">{chunks}</Link>, privacy: (chunks) => <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="mx-0.5 font-medium text-primary underline-offset-2 hover:underline">{chunks}</Link>})}
                </span>
              </label>

              <Button
                type="submit"
                variant="default"
                size="lg"
                className="h-12 w-full rounded-md"
                disabled={loading || (mode === 'sms' && (code.length !== 6 || !codeSent))}
              >
                {loading ? (mode === 'sms' ? t('verifying') : t('signingIn')) : t('signIn')}
                {!loading && <ArrowRight className="ml-auto h-4 w-4" />}
              </Button>

              </form>
              </>
            ) : (
              <div className="text-center">
                <h1 className="text-3xl font-semibold text-foreground">{t('wechatQrLogin')}</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('wechatScanHint')}</p>

                <WechatMiniQrLogin
                  inline
                  returnUrl={returnUrl}
                  className="mt-6"
                />

                <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
                  {t.rich('termsByScanning', {terms: (chunks) => <Link href="/terms" target="_blank" rel="noopener noreferrer" className="mx-0.5 text-primary hover:underline">{chunks}</Link>, privacy: (chunks) => <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="mx-0.5 text-primary hover:underline">{chunks}</Link>})}
                </p>

                <div className="mt-6">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 text-muted-foreground"
                    onClick={() => setView('phone')}
                  >
                    <Phone className="mr-2 h-4 w-4" />
                    {t('usePhoneLogin')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex-1 min-h-0 bg-background flex items-center justify-center">
        <div className="text-center">
          <BrandLogo height={64} className="mx-auto mb-4 animate-pulse" ariaHidden />
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
