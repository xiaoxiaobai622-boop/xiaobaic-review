'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, LogIn, LogOut, Phone, Settings, ShieldCheck, UserCircle, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import BrandLogo from '@/components/BrandLogo'
import { AnimatedCharacters } from '@/components/ui/animated-characters'
import { clearTokens, setTokens } from '@/lib/token-store'
import { apiFetch } from '@/lib/api-client'
import { InitialsAvatar } from '@/components/InitialsAvatar'
import Link from 'next/link'
import { getDeviceAuthHeaders } from '@/lib/device-id'
import { getContactEmail } from '@/lib/user-contact'
import { maskPhoneDisplay } from '@/lib/phone-display'
import { WechatMiniQrLogin } from '@/components/WechatMiniQrLogin'
import { cn } from '@/lib/utils'

interface WechatSession {
  configured: boolean
  authenticated: boolean
  user?: { id: string; name?: string | null; email?: string; role?: string; avatarUrl?: string | null; linkedForMiniProgram?: boolean }
}

interface ReviewLoginActionsProps {
  onIdentityChange?: (identity: { name: string | null; email: string | null } | null) => void
  compact?: boolean
  openSignal?: number
  onOpenChange?: (open: boolean) => void
}

const PHONE_REGEX = /^1[3-9]\d{9}$/

/**
 * Placeholder emails are internal identifiers, not contact info, so they never reach the UI.
 * `wechatFallback` comes from the caller because this runs outside the component: the
 * "WeChat user" default is interface text and has to follow the active language.
 */
function contactNameOf(
  user: { name?: string | null; phone?: string | null; email?: string | null },
  wechatFallback: string,
): string | null {
  const email = getContactEmail(user.email)
  return user.name || maskPhoneDisplay(user.phone) || email || (user.email ? wechatFallback : null)
}

function notifyReviewAuth(authenticated: boolean, name: string | null = null, email: string | null = null) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('review-auth-changed', {
    detail: { authenticated, name, email },
  }))
}

export default function ReviewLoginActions({ onIdentityChange, compact = false, openSignal = 0, onOpenChange }: ReviewLoginActionsProps) {
  const t = useTranslations('share')
  const ta = useTranslations('auth')
  const [session, setSession] = useState<WechatSession | null>(null)
  const [passwordUser, setPasswordUser] = useState<{ id: string; name: string | null; email: string; phone?: string | null; role?: string; avatarUrl?: string | null } | null>(null)
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [focusedField, setFocusedField] = useState<'phone' | 'password' | null>(null)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [mode, setMode] = useState<'password' | 'sms'>('password')
  const [view, setView] = useState<'wechat' | 'phone'>('wechat')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  const updateOpen = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [onOpenChange])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  function switchMode(nextMode: 'password' | 'sms') {
    setMode(nextMode)
    setError('')
    setCode('')
    setCodeSent(false)
    setCooldown(0)
  }

  // The review surfaces pass a fresh inline function on every render, so the callback
  // lives in a ref: the session poll must not restart because a parent re-rendered.
  const identityChangeRef = useRef(onIdentityChange)
  useEffect(() => { identityChangeRef.current = onIdentityChange }, [onIdentityChange])
  const wechatUserLabel = t('wechatUser')

  const refreshSession = useCallback(async () => {
    let authResponse: Response
    let wechatResponse: Response
    try {
      ;[authResponse, wechatResponse] = await Promise.all([
        apiFetch('/api/auth/session', { cache: 'no-store' }),
        fetch('/api/auth/wechat/session', { cache: 'no-store' }),
      ])
    } catch {
      // 取不到答案不等于没登录。留着已知状态，回到前台时再问一次——把网络抖动报成
      // 「未登录」会把正在审的人踢成陌生人，还逼他重新登录。
      return
    }

    const wechatData: WechatSession = wechatResponse.ok
      ? await wechatResponse.json().catch(() => ({ configured: false, authenticated: false }))
      : { configured: false, authenticated: false }
    setSession(wechatData)

    // 401 is a real answer (apiFetch already tried to refresh). Anything else, such as a
    // 5xx or a proxy error page, is not evidence that this person signed out.
    if (!authResponse.ok && authResponse.status !== 401) return
    const authData = authResponse.ok ? await authResponse.json().catch(() => null) : null

    if (authData?.authenticated && authData.user) {
      const identity = {
        id: authData.user.id,
        name: contactNameOf(authData.user, wechatUserLabel),
        email: authData.user.email,
        phone: authData.user.phone,
        role: authData.user.role,
        avatarUrl: authData.user.avatarUrl,
      }
      setPasswordUser(identity)
      const email = getContactEmail(authData.user.email) || null
      identityChangeRef.current?.({ name: identity.name, email })
      notifyReviewAuth(true, identity.name, email)
    } else if (wechatData.authenticated && wechatData.user) {
      const name = wechatData.user.name || null
      identityChangeRef.current?.({ name, email: null })
      notifyReviewAuth(true, name)
    } else {
      setPasswordUser(null)
    }
  }, [wechatUserLabel])

  useEffect(() => {
    refreshSession()
  }, [refreshSession])

  useEffect(() => {
    const onForeground = () => {
      if (document.visibilityState === 'visible') refreshSession()
    }
    window.addEventListener('focus', onForeground)
    document.addEventListener('visibilitychange', onForeground)
    return () => {
      window.removeEventListener('focus', onForeground)
      document.removeEventListener('visibilitychange', onForeground)
    }
  }, [refreshSession])

  useEffect(() => {
    if (openSignal > 0) {
      updateOpen(true)
      setView('wechat')
      setError('')
      setCode('')
      setCodeSent(false)
    }
  }, [openSignal, updateOpen])

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') updateOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open, updateOpen])

  const currentReturnUrl = () => `${window.location.pathname}${window.location.search}${window.location.hash}`

  const handlePasswordLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getDeviceAuthHeaders(),
        },
        body: JSON.stringify({ email: phone.trim(), password }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || ta('invalidUsernameEmailOrPassword'))

      if (data?.tokens?.accessToken && data?.tokens?.refreshToken) {
        setTokens({ accessToken: data.tokens.accessToken, refreshToken: data.tokens.refreshToken })
      } else {
        clearTokens()
      }
      const identity = { id: data.user?.id || '', name: contactNameOf(data.user, wechatUserLabel), email: data.user?.email || '', phone: data.user?.phone, role: data.user?.role, avatarUrl: data.user?.avatarUrl }
      setPasswordUser(identity)
      const email = getContactEmail(identity.email) || null
      onIdentityChange?.({ name: identity.name, email })
      notifyReviewAuth(true, identity.name, email)
      updateOpen(false)
      setPassword('')
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : ta('loginFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleSendCode = async () => {
    setError('')
    if (!PHONE_REGEX.test(phone)) {
      setError(ta('invalidPhone'))
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
      if (!response.ok) throw new Error(data.error || ta('smsSendFailed'))
      setCodeSent(true)
      setCooldown(60)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : ta('smsSendFailed'))
    } finally {
      setSendingCode(false)
    }
  }

  const handleSmsLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (!PHONE_REGEX.test(phone)) {
      setError(ta('invalidPhone'))
      return
    }
    if (!/^\d{6}$/.test(code)) {
      setError(ta('invalidCode'))
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/auth/sms/verify-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getDeviceAuthHeaders(),
        },
        body: JSON.stringify({ phone, code }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || ta('loginFailed'))

      if (data?.tokens?.accessToken && data?.tokens?.refreshToken) {
        setTokens({ accessToken: data.tokens.accessToken, refreshToken: data.tokens.refreshToken })
      } else {
        clearTokens()
      }
      const identity = { id: data.user?.id || '', name: contactNameOf(data.user, wechatUserLabel), email: data.user?.email || '', phone: data.user?.phone, role: data.user?.role, avatarUrl: data.user?.avatarUrl }
      setPasswordUser(identity)
      const email = getContactEmail(identity.email) || null
      onIdentityChange?.({ name: identity.name, email })
      notifyReviewAuth(true, identity.name, email)
      updateOpen(false)
      setCode('')
      setCodeSent(false)
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : ta('loginFailed'))
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    clearTokens()
    if (session?.authenticated) await fetch('/api/auth/wechat/session', { method: 'DELETE' })
    setPasswordUser(null)
    setProfileOpen(false)
    setSession(current => ({ configured: current?.configured ?? false, authenticated: false }))
    onIdentityChange?.(null)
    notifyReviewAuth(false)
  }

  const authenticated = Boolean(passwordUser || session?.authenticated)
  const currentUser = passwordUser || (session?.authenticated && session.user ? {
    id: session.user.id,
    name: session.user.name || session.user.email || null,
    email: session.user.email || '',
    phone: null,
    role: session.user.role,
    avatarUrl: session.user.avatarUrl || null,
  } : null)
  const displayName = currentUser?.name || ta('loggedInShort')
  const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'OWNER'
  const profileHref = currentUser?.id
    ? `/profile?returnUrl=${encodeURIComponent(typeof window === 'undefined' ? '/' : currentReturnUrl())}`
    : '/profile'
  const secondaryContact = maskPhoneDisplay(currentUser?.phone) || getContactEmail(currentUser?.email)

  return (
    <>
      {authenticated ? (
        <div className="relative flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setProfileOpen(value => !value)}
            className={cn(
              'flex items-center gap-1.5 rounded-md text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              compact ? 'h-9 w-9 justify-center border border-border bg-background p-0' : 'min-h-8 px-1.5'
            )}
            aria-label={displayName}
            aria-expanded={profileOpen}
            aria-haspopup="menu"
          >
            <InitialsAvatar name={displayName} src={currentUser?.avatarUrl} size="sm" title={displayName} isInternal={isAdmin} />
            {!compact && <span className="max-w-28 truncate">{displayName}</span>}
            {!compact && <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-52 rounded-lg border border-border bg-card p-1.5 shadow-lg" role="menu">
              <div className="flex items-center gap-2 border-b border-border px-2.5 py-2.5">
                <InitialsAvatar name={displayName} src={currentUser?.avatarUrl} size="md" isInternal={isAdmin} />
                <div className="min-w-0"><p className="truncate text-sm font-medium">{displayName}</p>{secondaryContact && <p className="truncate text-xs text-muted-foreground">{secondaryContact}</p>}</div>
              </div>
              <Link href={profileHref} role="menuitem" onClick={() => setProfileOpen(false)} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-muted">
                <UserCircle className="h-4 w-4" />{ta('personalCenter')}
              </Link>
              {isAdmin && <Link href="/studio/projects" role="menuitem" onClick={() => setProfileOpen(false)} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-muted">
                <ShieldCheck className="h-4 w-4" />{ta('consoleEntry')}
              </Link>}
              <button type="button" role="menuitem" onClick={logout} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-destructive hover:bg-destructive/10">
                <LogOut className="h-4 w-4" />{t('logout')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <Button variant="default" size="sm" onClick={() => updateOpen(true)} className={compact ? 'h-9 px-3' : undefined}>
          <LogIn className="mr-1.5 h-4 w-4" />
          {t('login')}
        </Button>
      )}

      {open && createPortal((
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="review-login-title" onMouseDown={(event) => { if (event.target === event.currentTarget) updateOpen(false) }}>
          <div className="relative grid w-full max-w-[1120px] overflow-hidden rounded-xl border border-border bg-card shadow-2xl lg:grid-cols-2">
            <section className="relative hidden min-h-[560px] overflow-hidden border-r border-black/10 bg-[#ececea] dark:border-white/10 dark:bg-[#222329] lg:flex lg:flex-col">
              <div className="relative z-10 flex items-center gap-3 px-7 pt-7">
                <BrandLogo height={36} />
                <div>
                  <p className="text-sm font-semibold text-[#17191f] dark:text-white">逐帧审阅</p>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 items-end justify-center overflow-hidden pb-2 pt-4">
                <AnimatedCharacters isTyping={focusedField === 'phone'} showPassword={passwordVisible} passwordLength={password.length} />
              </div>
            </section>

            <section className="relative flex min-w-0 items-center justify-center px-6 py-8 sm:px-10">
              <Button type="button" variant="ghost" size="icon" className="absolute right-4 top-4 h-8 w-8 text-muted-foreground" onClick={() => updateOpen(false)} aria-label={ta('closeLoginDialog')}>
                <X className="h-4 w-4" />
              </Button>

            {view === 'phone' ? (
              <>
            <form onSubmit={mode === 'password' ? handlePasswordLogin : handleSmsLogin} className="w-full max-w-[360px] space-y-4">
              <div className="mb-7">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 id="review-login-title" className="text-2xl font-semibold tracking-tight text-foreground">{ta('phoneLogin')}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{ta('signInDescription')}</p>
                  </div>
                  <Button type="button" variant="ghost" className="h-8 px-2 text-muted-foreground" onClick={() => setView('wechat')}>
                    {ta('wechatQrShortcut')}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 rounded-md bg-muted p-1" role="tablist" aria-label={ta('loginMethod')}>
                <button type="button" onClick={() => switchMode('password')} className={`h-9 rounded text-sm font-medium transition-colors ${mode === 'password' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}>{ta('passwordLogin')}</button>
                <button type="button" onClick={() => switchMode('sms')} className={`h-9 rounded text-sm font-medium transition-colors ${mode === 'sms' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}>
                  <Phone className="mr-1.5 inline h-3.5 w-3.5" />{ta('smsLogin')}
                </button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="review-phone">{ta('phone')}</Label>
                <Input id="review-phone" name="review-phone" type="tel" inputMode="numeric" autoComplete="off" data-lpignore="true" data-1p-ignore="true" placeholder={ta('phonePlaceholder')} value={phone} onChange={(event) => { const next = event.target.value.replace(/\D/g, '').slice(0, 11); setPhone(next); if (mode === 'sms') { setCode(''); setCodeSent(false); setCooldown(0) } }} onFocus={() => setFocusedField('phone')} onBlur={() => setFocusedField(null)} autoFocus required />
              </div>
              {mode === 'password' ? (
                <div className="space-y-2">
                  <Label htmlFor="review-password">{ta('passwordLogin')}</Label>
                  <PasswordInput id="review-password" name="review-password" autoComplete="current-password" data-lpignore="true" data-1p-ignore="true" placeholder={ta('passwordPlaceholder')} value={password} onChange={(event) => setPassword(event.target.value)} onFocus={() => setFocusedField('password')} onBlur={() => setFocusedField(null)} onVisibilityChange={setPasswordVisible} required />
                  <div className="flex justify-end pt-0.5">
                    <Link href="/forgot-password" className="text-xs text-muted-foreground transition-colors hover:text-primary">{ta('forgotPassword')}</Link>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="review-code">{ta('verificationCode')}</Label>
                  <div className="flex gap-2">
                    <Input id="review-code" name="review-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder={ta('verificationCodePlaceholder')} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required />
                    <Button type="button" variant="outline" className="h-11 w-32 shrink-0" disabled={sendingCode || cooldown > 0 || phone.length !== 11} onClick={handleSendCode}>
                      {sendingCode ? ta('sendingCode') : cooldown > 0 ? `${cooldown}s` : codeSent ? ta('resendCode') : ta('sendCode')}
                    </Button>
                  </div>
                </div>
              )}
              {error && <p className="rounded-md border border-destructive/30 bg-destructive-visible px-3 py-2 text-sm text-destructive" aria-live="polite">{error}</p>}
              <p className="text-center text-xs leading-5 text-muted-foreground">
                {ta.rich('termsAgreement', {
                  terms: (chunks) => <Link href="/terms" target="_blank" rel="noopener noreferrer" className="mx-0.5 font-medium text-primary underline-offset-2 hover:underline">{chunks}</Link>,
                  privacy: (chunks) => <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="mx-0.5 font-medium text-primary underline-offset-2 hover:underline">{chunks}</Link>,
                })}
              </p>
              <Button type="submit" className="h-11 w-full" disabled={loading || !phone || (mode === 'password' ? !password : code.length !== 6 || !codeSent)}>
                {loading ? ta('signingIn') : ta('signIn')}
              </Button>
            </form>
              </>
            ) : (
              <div className="w-full max-w-[360px] text-center">
                <h2 id="review-login-title" className="text-2xl font-semibold tracking-tight text-foreground">{ta('wechatQrLogin')}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{ta('wechatScanHint')}</p>
                <WechatMiniQrLogin inline returnUrl={currentReturnUrl()} className="mt-5" />
                <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
                  {ta.rich('termsByScanning', {
                    terms: (chunks) => <Link href="/terms" target="_blank" rel="noopener noreferrer" className="mx-0.5 text-primary hover:underline">{chunks}</Link>,
                    privacy: (chunks) => <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="mx-0.5 text-primary hover:underline">{chunks}</Link>,
                  })}
                </p>
                <div className="mt-5">
                  <Button type="button" variant="ghost" className="h-10 text-muted-foreground" onClick={() => setView('phone')}>
                    <Phone className="mr-2 h-4 w-4" />{ta('usePhoneLogin')}
                  </Button>
                </div>
                </div>
            )}
            </section>
          </div>
        </div>
      ), document.body)}
    </>
  )
}
