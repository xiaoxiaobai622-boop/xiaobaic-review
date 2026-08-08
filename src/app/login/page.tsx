'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { ArrowLeft, ArrowRight, MessageCircle } from 'lucide-react'
import { setTokens, clearTokens } from '@/lib/token-store'
import BrandLogo from '@/components/BrandLogo'
import { AnimatedCharacters } from '@/components/ui/animated-characters'
import { getDeviceAuthHeaders } from '@/lib/device-id'

type FocusedField = 'phone' | 'password' | null

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
        <span>{focusedField === 'password' ? (passwordVisible ? '他们自觉移开了视线' : '他们会替你保密') : '欢迎回来'}</span>
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
  const rawReturnUrl = requestedReturnUrl || '/admin/projects'
  // SECURITY: Only allow relative paths — prevents javascript: and open redirect attacks
  const returnUrl = rawReturnUrl.startsWith('/') && !rawReturnUrl.startsWith('//') ? rawReturnUrl : '/admin/projects'
  const sessionExpired = searchParams?.get('sessionExpired') === 'true'

  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [focusedField, setFocusedField] = useState<FocusedField>(null)
  const [passwordVisible, setPasswordVisible] = useState(false)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
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
        setError(data.error || t('loginFailed'))
        setLoading(false)
        return
      }

      if (data?.tokens?.accessToken && data?.tokens?.refreshToken) {
        setTokens({
          accessToken: data.tokens.accessToken,
          refreshToken: data.tokens.refreshToken,
        })
      } else {
        clearTokens()
      }

      // Members signing in from the home page should land in their profile,
      // while an explicit review return URL must be preserved.
      const destination = data.user?.role === 'MEMBER' && !requestedReturnUrl
        ? '/profile'
        : returnUrl
      router.push(destination)
      router.refresh()
    } catch (err) {
      setError(tc('errorTryAgain'))
      setLoading(false)
    }
  }

  const startWechatLogin = () => {
    const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
    window.location.href = `/api/auth/wechat/start?returnUrl=${encodeURIComponent(returnPath)}`
  }

  return (
    <div className="login-page-shell flex min-h-dvh flex-1 items-center p-3 sm:p-5 lg:p-7">
      <div className="login-panel mx-auto grid min-h-[min(720px,calc(100dvh-3.5rem))] w-full max-w-[1120px] overflow-hidden rounded-md bg-white shadow-2xl dark:bg-[#17191f] lg:grid-cols-2">
        <section className="relative hidden overflow-hidden border-r border-black/10 bg-[#ececea] dark:border-white/10 dark:bg-[#222329] lg:flex lg:flex-col">
          <div className="relative z-50 flex items-center gap-3 px-8 pt-8">
            <BrandLogo height={38} />
            <div>
              <p className="text-sm font-semibold text-[#17191f] dark:text-white">逐帧审阅</p>
              <p className="text-xs text-black/50 dark:text-white/50">申请使用权限：Xiaobai-v001</p>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-end justify-center overflow-hidden pb-6 pt-8">
            <AnimatedCharacters
              isTyping={focusedField === 'phone'}
              showPassword={passwordVisible}
              passwordLength={password.length}
            />
          </div>
          <p className="relative z-50 px-8 pb-8 text-xs text-black/45 dark:text-white/45">目前仅限内部团队成员访问</p>
        </section>

        <section className="flex min-w-0 items-center justify-center px-5 py-8 sm:px-10 lg:px-14">
          <div className="w-full max-w-[420px]">
            <Button type="button" variant="ghost" className="mb-6 h-9 px-2 text-muted-foreground" onClick={() => router.push('/')}>
              <ArrowLeft className="mr-2 h-4 w-4" />返回首页
            </Button>
            <div className="mb-9 lg:hidden">
              <div className="flex items-center gap-3">
                <BrandLogo height={42} />
                <div>
                  <p className="font-semibold text-foreground">逐帧审阅</p>
                  <p className="text-xs text-muted-foreground">申请使用权限：Xiaobai-v001</p>
                </div>
              </div>
            </div>

            <div className="mb-9">
              <h1 className="text-3xl font-semibold text-foreground">{t('welcomeBack')}</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('signInDescription')}</p>
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

              <div className="space-y-2.5">
                <Label htmlFor="phone" className="text-sm font-medium">手机号</Label>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  className="h-12 rounded-md bg-transparent px-4"
                  placeholder="请输入手机号"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
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

              <div className="space-y-2.5">
                <Label htmlFor="password" className="text-sm font-medium">密码登录</Label>
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
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  disabled={loading}
                />
                <div className="flex justify-end pt-0.5">
                  <Link
                    href="/forgot-password"
                    className="text-sm text-muted-foreground transition-colors hover:text-primary"
                  >
                    {t('forgotPassword')}
                  </Link>
                </div>
              </div>

              <Button
                type="submit"
                variant="default"
                size="lg"
                className="h-12 w-full rounded-md"
                disabled={loading}
              >
                {loading ? t('signingIn') : t('signIn')}
                {!loading && <ArrowRight className="ml-auto h-4 w-4" />}
              </Button>

              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center"><span className="bg-background px-3 text-xs text-muted-foreground">或</span></div>
              </div>

              <Button type="button" variant="outline" className="h-12 w-full border-[#07c160]/50 text-[#079c4e]" onClick={startWechatLogin}>
                <MessageCircle className="mr-2 h-4 w-4" />微信登录
              </Button>

            </form>

            <p className="mt-8 text-center text-xs text-muted-foreground">目前仅限内部团队成员访问</p>
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
