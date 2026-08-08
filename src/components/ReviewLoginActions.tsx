'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, LogIn, LogOut, MessageCircle, Settings, ShieldCheck, UserCircle, X } from 'lucide-react'
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
import { getDisplayEmail } from '@/lib/user-contact'

interface WechatSession {
  configured: boolean
  authenticated: boolean
  user?: { id: string; name?: string | null; email?: string; role?: string; avatarUrl?: string | null; linkedForMiniProgram?: boolean }
}

interface ReviewLoginActionsProps {
  onIdentityChange?: (identity: { name: string | null } | null) => void
  compact?: boolean
  openSignal?: number
}

export default function ReviewLoginActions({ onIdentityChange, compact = false, openSignal = 0 }: ReviewLoginActionsProps) {
  const t = useTranslations('share')
  const [session, setSession] = useState<WechatSession | null>(null)
  const [passwordUser, setPasswordUser] = useState<{ id: string; name: string | null; email: string; phone?: string | null; role?: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [focusedField, setFocusedField] = useState<'phone' | 'password' | null>(null)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => {
    Promise.all([
      apiFetch('/api/auth/session', { cache: 'no-store' }),
      fetch('/api/auth/wechat/session', { cache: 'no-store' }),
    ])
      .then(async ([authResponse, wechatResponse]) => {
        const authData = authResponse.ok ? await authResponse.json() : null
        const wechatData = wechatResponse.ok ? await wechatResponse.json() : { configured: false, authenticated: false }
        setSession(wechatData)
        if (authData?.authenticated && authData.user) {
          setPasswordUser({
            id: authData.user.id,
            name: authData.user.name || authData.user.phone || getDisplayEmail(authData.user.email) || null,
            email: authData.user.email,
            phone: authData.user.phone,
            role: authData.user.role,
          })
          onIdentityChange?.({ name: authData.user.name || authData.user.phone || getDisplayEmail(authData.user.email) || null })
        } else if (wechatData.authenticated && wechatData.user) {
          onIdentityChange?.({ name: wechatData.user.name || null })
        } else {
          setPasswordUser(null)
          onIdentityChange?.(null)
        }
      })
      .catch(() => {
        setPasswordUser(null)
        setSession({ configured: false, authenticated: false })
      })
  }, [onIdentityChange])

  useEffect(() => {
    if (openSignal > 0) setOpen(true)
  }, [openSignal])

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])

  const currentReturnUrl = () => `${window.location.pathname}${window.location.search}${window.location.hash}`

  const startWechatLogin = () => {
    if (session && !session.configured) {
      setError(t('wechatNotConfigured'))
      return
    }
    window.location.href = `/api/auth/wechat/start?returnUrl=${encodeURIComponent(currentReturnUrl())}`
  }

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
      if (!response.ok) throw new Error(data.error || '登录失败，请检查手机号和密码')

      if (data?.tokens?.accessToken && data?.tokens?.refreshToken) {
        setTokens({ accessToken: data.tokens.accessToken, refreshToken: data.tokens.refreshToken })
      } else {
        clearTokens()
      }
      const identity = { id: data.user?.id || '', name: data.user?.name || data.user?.phone || getDisplayEmail(data.user?.email) || null, email: data.user?.email || '', phone: data.user?.phone, role: data.user?.role }
      setPasswordUser(identity)
      onIdentityChange?.({ name: identity.name })
      setOpen(false)
      setPassword('')
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败，请稍后重试')
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
  }

  const authenticated = Boolean(passwordUser || session?.authenticated)
  const currentUser = passwordUser || (session?.authenticated && session.user ? {
    id: session.user.id,
    name: session.user.name || session.user.email || null,
    email: session.user.email || '',
    phone: null,
    role: session.user.role,
  } : null)
  const displayName = currentUser?.name || '已登录'
  const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'OWNER'
  const profileHref = currentUser?.id
    ? `/profile?returnUrl=${encodeURIComponent(typeof window === 'undefined' ? '/' : currentReturnUrl())}`
    : '/profile'
  const secondaryContact = currentUser?.phone || getDisplayEmail(currentUser?.email)

  return (
    <>
      {authenticated ? (
        <div className="relative flex items-center gap-1.5">
          <button type="button" onClick={() => setProfileOpen(value => !value)} className="flex min-h-8 items-center gap-1.5 rounded-md px-1.5 text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-expanded={profileOpen} aria-haspopup="menu">
            <InitialsAvatar name={displayName} size="sm" title={displayName} isInternal={isAdmin} />
            {!compact && <span className="max-w-28 truncate">{displayName}</span>}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-52 rounded-lg border border-border bg-card p-1.5 shadow-lg" role="menu">
              <div className="flex items-center gap-2 border-b border-border px-2.5 py-2.5">
                <InitialsAvatar name={displayName} size="md" isInternal={isAdmin} />
                <div className="min-w-0"><p className="truncate text-sm font-medium">{displayName}</p>{secondaryContact && <p className="truncate text-xs text-muted-foreground">{secondaryContact}</p>}</div>
              </div>
              <Link href={profileHref} role="menuitem" onClick={() => setProfileOpen(false)} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-muted">
                <UserCircle className="h-4 w-4" />个人中心
              </Link>
              {isAdmin && <Link href="/admin/projects" role="menuitem" onClick={() => setProfileOpen(false)} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-muted">
                <ShieldCheck className="h-4 w-4" />后台入口
              </Link>}
              <button type="button" role="menuitem" onClick={logout} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-destructive hover:bg-destructive/10">
                <LogOut className="h-4 w-4" />{t('logout')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <Button variant="default" size="sm" onClick={() => setOpen(true)} className={compact ? 'h-8 px-3' : undefined}>
          <LogIn className="mr-1.5 h-4 w-4" />
          {t('login')}
        </Button>
      )}

      {open && createPortal((
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="review-login-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
          <div className="relative grid w-full max-w-[1120px] overflow-hidden rounded-xl border border-border bg-card shadow-2xl lg:grid-cols-2">
            <section className="relative hidden min-h-[560px] overflow-hidden border-r border-black/10 bg-[#ececea] dark:border-white/10 dark:bg-[#222329] lg:flex lg:flex-col">
              <div className="relative z-10 flex items-center gap-3 px-7 pt-7">
                <BrandLogo height={36} />
                <div>
                  <p className="text-sm font-semibold text-[#17191f] dark:text-white">逐帧审阅</p>
                  <p className="text-xs text-black/50 dark:text-white/50">申请使用权限：Xiaobai-v001</p>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 items-end justify-center overflow-hidden pb-2 pt-4">
                <AnimatedCharacters isTyping={focusedField === 'phone'} showPassword={passwordVisible} passwordLength={password.length} />
              </div>
              <p className="relative z-10 px-7 pb-6 text-xs text-black/45 dark:text-white/45">目前仅限内部团队成员访问</p>
            </section>

            <section className="relative flex min-w-0 items-center justify-center px-6 py-8 sm:px-10">
              <Button type="button" variant="ghost" size="icon" className="absolute right-4 top-4 h-8 w-8 text-muted-foreground" onClick={() => setOpen(false)} aria-label="关闭登录窗口">
                <X className="h-4 w-4" />
              </Button>

            <form onSubmit={handlePasswordLogin} className="w-full max-w-[360px] space-y-4">
              <div className="mb-7">
                <h2 id="review-login-title" className="text-2xl font-semibold tracking-tight text-foreground">欢迎回来</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">登录后进入工作室审片后台</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="review-phone">手机号</Label>
                <Input id="review-phone" name="review-phone" type="tel" inputMode="numeric" autoComplete="off" data-lpignore="true" data-1p-ignore="true" placeholder="请输入手机号" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))} onFocus={() => setFocusedField('phone')} onBlur={() => setFocusedField(null)} autoFocus required />
              </div>
                <div className="space-y-2">
                <Label htmlFor="review-password">密码登录</Label>
                <PasswordInput id="review-password" name="review-password" autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" placeholder="请输入密码" value={password} onChange={(event) => setPassword(event.target.value)} onFocus={() => setFocusedField('password')} onBlur={() => setFocusedField(null)} onVisibilityChange={setPasswordVisible} required />
                <div className="flex justify-end pt-0.5">
                  <a href="/forgot-password" className="text-xs text-muted-foreground transition-colors hover:text-primary">忘记密码？</a>
                </div>
              </div>
              {error && <p className="rounded-md border border-destructive/30 bg-destructive-visible px-3 py-2 text-sm text-destructive" aria-live="polite">{error}</p>}
              <Button type="submit" className="h-11 w-full" disabled={loading || !phone || !password}>
                {loading ? '正在登录...' : '登录'}
              </Button>
              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center"><span className="bg-card px-3 text-xs text-muted-foreground">或</span></div>
              </div>
              <Button type="button" variant="outline" className="h-11 w-full border-[#07c160]/50 text-[#079c4e]" onClick={startWechatLogin}>
                <MessageCircle className="mr-2 h-4 w-4" />微信登录
              </Button>
              <p className="pt-2 text-center text-xs text-muted-foreground lg:hidden">目前仅限内部团队成员访问</p>
            </form>
            </section>
          </div>
        </div>
      ), document.body)}
    </>
  )
}
