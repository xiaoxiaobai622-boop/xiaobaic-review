'use client'

import { appConfirm } from '@/components/AppDialogProvider'
import { useEffect, useState } from 'react'
import { ArrowLeft, Camera, Check, KeyRound, Link2, LogOut, MessageSquare, RefreshCw, UserRound } from 'lucide-react'
import { AuthProvider, useAuth } from '@/components/AuthProvider'
import StudioRail from '@/components/StudioRail'
import { InitialsAvatar } from '@/components/InitialsAvatar'
import { WechatMiniQrLogin } from '@/components/WechatMiniQrLogin'
import ThemeToggle from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { apiFetch, apiPatch } from '@/lib/api-client'
import { clearTokens } from '@/lib/token-store'
import { maskPhoneDisplay } from '@/lib/phone-display'
import { getContactEmail } from '@/lib/user-contact'
import { useActionFeedback, ActionFeedback, FeedbackSlot } from '@/components/ActionFeedback'
import { useTranslations } from 'next-intl'
import { validateAccountPassword } from '@/lib/password-policy'
import Link from 'next/link'

function safeReviewReturnUrl(): string | null {
  const requested = new URLSearchParams(window.location.search).get('returnUrl')
  if (!requested?.startsWith('/') || requested.startsWith('//')) return null
  return requested.startsWith('/share/') || /^\/studio\/projects\/[^/]+\/share(?:[/?#]|$)/.test(requested)
    ? requested
    : null
}

function safeStudioReturnUrl(): string | null {
  const requested = new URLSearchParams(window.location.search).get('returnUrl')
  if (!requested?.startsWith('/studio')) return null
  return requested
}

function ProfileContent() {
  const t = useTranslations('profile')
  const ta = useTranslations('auth')
  const tc = useTranslations('common')
  const { user, logout } = useAuth()
  const [returnUrl, setReturnUrl] = useState<string | null>(null)
  const [phoneReturnUrl, setPhoneReturnUrl] = useState<string | null>(null)
  const [requirePhone, setRequirePhone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', phone: '' })
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' })
  // null = 仍在加载；false = 随机占位密码（微信/短信建号），走「设置密码」；true = 走「修改密码」。
  const [passwordSet, setPasswordSet] = useState<boolean | null>(null)
  const [contactEmail, setContactEmail] = useState('')
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false)
  // change = 已有号码换号（双验证）；bind = 还没有号码，短信验证后首次绑定。
  const [phoneMode, setPhoneMode] = useState<'change' | 'bind'>('change')
  const [phoneError, setPhoneError] = useState('')
  const [phoneStep, setPhoneStep] = useState<'method' | 'verify' | 'new' | 'confirm'>('method')
  const [phoneMethod, setPhoneMethod] = useState<'password' | 'sms' | null>(null)
  const [phoneCredential, setPhoneCredential] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newPhoneCode, setNewPhoneCode] = useState('')
  const [phoneGrantToken, setPhoneGrantToken] = useState('')
  const [phoneSubmitting, setPhoneSubmitting] = useState(false)
  const [phoneCodeCooldown, setPhoneCodeCooldown] = useState(0)
  const [newPhoneCodeCooldown, setNewPhoneCodeCooldown] = useState(0)

  // 每个动作区一枚独立反馈位：提示贴着所属按钮，不再堆到页面顶部。
  const profileSaveFeedback = useActionFeedback()
  const phoneFeedback = useActionFeedback()
  const connectionsFeedback = useActionFeedback()
  const passwordFeedback = useActionFeedback()

  useEffect(() => {
    if (phoneCodeCooldown <= 0) return
    const timer = window.setInterval(() => setPhoneCodeCooldown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [phoneCodeCooldown])

  useEffect(() => {
    if (newPhoneCodeCooldown <= 0) return
    const timer = window.setInterval(() => setNewPhoneCodeCooldown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [newPhoneCodeCooldown])

  function resetPhoneDialog() {
    setPhoneStep('method')
    setPhoneMethod(null)
    setPhoneCredential('')
    setNewPhone('')
    setNewPhoneCode('')
    setPhoneGrantToken('')
    setPhoneSubmitting(false)
    setPhoneCodeCooldown(0)
    setNewPhoneCodeCooldown(0)
    setPhoneError('')
  }

  function changePhone() {
    resetPhoneDialog()
    if (!form.phone) {
      // 还没有号码：跳过旧号验证，直接「填新号 + 短信验证码」首次绑定（复用登录短信接口 intent=bind）。
      setPhoneMode('bind')
      setPhoneStep('new')
    } else {
      setPhoneMode('change')
    }
    setPhoneDialogOpen(true)
  }

  async function selectPhoneMethod(method: 'password' | 'sms') {
    setPhoneMethod(method)
    setPhoneCredential('')
    setPhoneError('')
    setPhoneStep('verify')
    if (method !== 'sms') return

    setPhoneSubmitting(true)
    try {
      const response = await apiFetch('/api/account/phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-old' }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || ta('smsSendFailed'))
      setPhoneCodeCooldown(60)
    } catch (sendError) {
      setPhoneError(sendError instanceof Error ? sendError.message : ta('smsSendFailed'))
      setPhoneStep('method')
    } finally {
      setPhoneSubmitting(false)
    }
  }

  async function verifyCurrentPhone(event: React.FormEvent) {
    event.preventDefault()
    if (!phoneMethod) return
    if (phoneMethod === 'password' && !phoneCredential) {
      setPhoneError(t('enterCurrentPassword'))
      return
    }
    if (phoneMethod === 'sms' && !/^\d{6}$/.test(phoneCredential)) {
      setPhoneError(ta('invalidCode'))
      return
    }

    setPhoneSubmitting(true)
    setPhoneError('')
    try {
      const response = await apiFetch('/api/account/phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify',
          method: phoneMethod,
          ...(phoneMethod === 'password' ? { password: phoneCredential } : { code: phoneCredential }),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.token) throw new Error(data.error || t('verifyFailed'))
      setPhoneGrantToken(data.token)
      setPhoneCredential('')
      setPhoneStep('new')
    } catch (verifyError) {
      setPhoneError(verifyError instanceof Error ? verifyError.message : t('verifyFailed'))
    } finally {
      setPhoneSubmitting(false)
    }
  }

  async function sendNewPhone(event: React.FormEvent) {
    event.preventDefault()
    if (!/^1[3-9]\d{9}$/.test(newPhone)) {
      setPhoneError(ta('invalidPhone'))
      return
    }

    setPhoneSubmitting(true)
    setPhoneError('')
    try {
      const response = phoneMode === 'bind'
        ? await apiFetch('/api/auth/sms/send-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: newPhone }),
          })
        : await apiFetch('/api/account/phone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'send-new', token: phoneGrantToken, phone: newPhone }),
          })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || ta('smsSendFailed'))
      setNewPhoneCode('')
      setNewPhoneCodeCooldown(60)
      setPhoneStep('confirm')
    } catch (sendError) {
      setPhoneError(sendError instanceof Error ? sendError.message : ta('smsSendFailed'))
    } finally {
      setPhoneSubmitting(false)
    }
  }

  async function resendNewPhoneCode() {
    if (newPhoneCodeCooldown > 0 || phoneSubmitting) return
    setPhoneSubmitting(true)
    setPhoneError('')
    try {
      const response = phoneMode === 'bind'
        ? await apiFetch('/api/auth/sms/send-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: newPhone }),
          })
        : await apiFetch('/api/account/phone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'send-new', token: phoneGrantToken, phone: newPhone }),
          })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || ta('smsSendFailed'))
      setNewPhoneCodeCooldown(60)
    } catch (resendError) {
      setPhoneError(resendError instanceof Error ? resendError.message : ta('smsSendFailed'))
    } finally {
      setPhoneSubmitting(false)
    }
  }

  async function confirmNewPhone(event: React.FormEvent) {
    event.preventDefault()
    if (!/^\d{6}$/.test(newPhoneCode)) {
      setPhoneError(ta('invalidCode'))
      return
    }

    const wasBind = phoneMode === 'bind'
    setPhoneSubmitting(true)
    setPhoneError('')
    try {
      const response = wasBind
        ? await apiFetch('/api/auth/sms/verify-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: newPhone, code: newPhoneCode, intent: 'bind' }),
          })
        : await apiFetch('/api/account/phone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'confirm', token: phoneGrantToken, phone: newPhone, code: newPhoneCode }),
          })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || (wasBind ? t('phoneBindFailed') : t('phoneChangeFailed')))
      setForm(current => ({ ...current, phone: data.phone || data.user?.phone || newPhone }))
      setPhoneDialogOpen(false)
      resetPhoneDialog()
      phoneFeedback.show('success', wasBind ? t('phoneBound') : t('phoneChanged'))
    } catch (confirmError) {
      setPhoneError(confirmError instanceof Error ? confirmError.message : (wasBind ? t('phoneBindFailed') : t('phoneChangeFailed')))
    } finally {
      setPhoneSubmitting(false)
    }
  }
  const [feishuBinding, setFeishuBinding] = useState<{ bound: boolean; nickname?: string | null; avatarUrl?: string | null; profileSyncError?: string } | null>(null)
  const [feishuLoading, setFeishuLoading] = useState(false)
  const [feishuRefreshing, setFeishuRefreshing] = useState(false)
  const [feishuAvatarSrc, setFeishuAvatarSrc] = useState<string | null>(null)

  useEffect(() => {
    const source = feishuBinding?.avatarUrl && user?.id
      ? `/api/feishu/avatar/${encodeURIComponent(user.id)}`
      : null
    if (!source) {
      setFeishuAvatarSrc(null)
      return
    }
    let objectUrl: string | null = null
    let active = true
    void apiFetch(source, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) return
        objectUrl = URL.createObjectURL(await response.blob())
        if (active) setFeishuAvatarSrc(objectUrl)
      })
      .catch(() => undefined)
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [feishuBinding?.avatarUrl, user?.id])

  useEffect(() => {
    setReturnUrl(safeReviewReturnUrl())
    setPhoneReturnUrl(safeStudioReturnUrl())
    const params = new URLSearchParams(window.location.search)
    setRequirePhone(params.get('requirePhone') === '1')

    // Surface the Feishu OAuth callback result, then clean the URL so a
    // refresh doesn't show a stale message.
    if (params.get('feishu_success') === 'true') {
      setMessage(t('feishuLinked'))
    } else if (params.get('feishu_error')) {
      setError(params.get('feishu_error') === 'invalid_state'
        ? t('feishuExpired')
        : t('feishuLinkFailedRetry'))
    }
    if (params.has('feishu_success') || params.has('feishu_error')) {
      params.delete('feishu_success')
      params.delete('feishu_error')
      const qs = params.toString()
      window.history.replaceState({}, '', qs ? `/profile?${qs}` : '/profile')
    }

    // Fetch Feishu binding status
    apiFetch('/api/feishu/binding?refresh=1', { cache: 'no-store' })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json()
          setFeishuBinding({
            bound: data.bound || false,
            nickname: data.nickname,
            avatarUrl: data.avatarUrl || null,
            profileSyncError: data.profileSyncError,
          })
        }
      })
      .catch(() => setFeishuBinding({ bound: false }))
    // t 每次渲染都换身份，塞进依赖数组会让这段一次性的拉取反复重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!user?.id) return
    let active = true
    apiFetch(`/api/users/${user.id}`, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(t('profileLoadFailedRelogin'))
        const data = await response.json()
        if (active) {
          setForm({
            name: data.user.name || '',
            phone: data.user.phone || '',
          })
          setAvatarUrl(data.user.avatarUrl || null)
          setPasswordSet(Boolean(data.user.passwordSet))
          setContactEmail(getContactEmail(data.user.email))
        }
      })
      .catch(fetchError => active && setError(fetchError instanceof Error ? fetchError.message : t('profileLoadFailed')))
      .finally(() => active && setLoading(false))
    return () => { active = false }
    // t 每次渲染都换身份，塞进依赖数组会让这段一次性的拉取反复重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const displayName = form.name || maskPhoneDisplay(form.phone) || t('roleMember')
  // 密码登录要有可输入的标识：真实手机号或真实邮箱（占位邮箱 phone.local/wechat.local 不算）。
  const canPasswordLogin = Boolean(form.phone) || Boolean(contactEmail)
  const visibleReturnUrl = returnUrl?.startsWith('/studio/') && user?.role !== 'ADMIN'
    ? null
    : returnUrl

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault()
    if (!user?.id) return
    if (form.phone && !/^1\d{10}$/.test(form.phone)) {
      profileSaveFeedback.show('error', ta('invalidPhone'))
      return
    }

    setSaving(true)
    profileSaveFeedback.clear()
    try {
      await apiPatch(`/api/users/${user.id}`, {
        name: form.name.trim() || null,
        phone: form.phone,
      })
      if (requirePhone && form.phone && phoneReturnUrl) {
        window.location.href = phoneReturnUrl
        return
      }
      profileSaveFeedback.show('success', t('profileSaved'))
    } catch (saveError) {
      profileSaveFeedback.show('error', saveError instanceof Error ? saveError.message : t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleAvatarChange(file: File | null) {
    if (!user?.id || !file) return
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(file.type)) {
      profileSaveFeedback.show('error', t('avatarFormatError'))
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      profileSaveFeedback.show('error', t('avatarSizeError'))
      return
    }

    profileSaveFeedback.clear()
    setAvatarUploading(true)
    try {
      const response = await apiFetch(`/api/users/${user.id}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || t('avatarUploadFailed'))
      setAvatarUrl(data.avatarUrl || null)
    } catch (avatarError) {
      profileSaveFeedback.show('error', avatarError instanceof Error ? avatarError.message : t('avatarUploadFailed'))
    } finally {
      setAvatarUploading(false)
    }
  }

  async function bindFeishu() {
    connectionsFeedback.clear()
    try {
      const response = await apiFetch('/api/auth/feishu/authorize', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.authUrl) {
        throw new Error(data.error || t('feishuAuthStartFailed'))
      }
      window.location.href = data.authUrl
    } catch (bindError) {
      connectionsFeedback.show('error', bindError instanceof Error ? bindError.message : t('feishuLinkFailed'))
    }
  }

  async function unbindFeishu() {
    if (!await appConfirm(t('feishuUnbindConfirm'))) {
      return
    }
    setFeishuLoading(true)
    connectionsFeedback.clear()
    try {
      const response = await apiFetch('/api/feishu/unbind', {
        method: 'POST',
        cache: 'no-store',
      })
      if (!response.ok) {
        throw new Error(t('unlinkFailed'))
      }
      setFeishuBinding({ bound: false, nickname: null, avatarUrl: null })
      connectionsFeedback.show('success', t('feishuUnlinked'))
    } catch (unbindError) {
      connectionsFeedback.show('error', unbindError instanceof Error ? unbindError.message : t('unlinkFailedRetry'))
    } finally {
      setFeishuLoading(false)
    }
  }

  async function refreshFeishuProfile() {
    setFeishuRefreshing(true)
    connectionsFeedback.clear()
    try {
      const response = await apiFetch('/api/feishu/binding?refresh=1', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.bound) throw new Error(data.error || t('feishuSyncFailed'))
      setFeishuBinding({ bound: true, nickname: data.nickname || null, avatarUrl: data.avatarUrl || null, profileSyncError: data.profileSyncError })
      if (data.profileSyncError) connectionsFeedback.show('error', data.profileSyncError)
      else connectionsFeedback.show('success', t('feishuSynced'))
    } catch (refreshError) {
      connectionsFeedback.show('error', refreshError instanceof Error ? refreshError.message : t('feishuSyncFailed'))
    } finally {
      setFeishuRefreshing(false)
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault()
    if (!user?.id) return
    if (!validateAccountPassword(passwordForm.next).isValid) {
      passwordFeedback.show('error', t('passwordRuleUnmet', { hint: t('passwordRule') }))
      return
    }
    if (passwordForm.next !== passwordForm.confirm) {
      passwordFeedback.show('error', t('passwordMismatch'))
      return
    }

    const isFirstSet = passwordSet === false
    setPasswordSaving(true)
    passwordFeedback.clear()
    try {
      await apiPatch(`/api/users/${user.id}`, isFirstSet
        ? { password: passwordForm.next }
        : { oldPassword: passwordForm.current, password: passwordForm.next })
      if (isFirstSet) {
        // 首次设置：服务端不吊销当前会话，留在本页把状态翻成「已设置」，不强制跳登录。
        setPasswordSet(true)
        setPasswordForm({ current: '', next: '', confirm: '' })
        passwordFeedback.show('success', t('passwordSetSuccess'))
        setPasswordSaving(false)
        return
      }
      clearTokens()
      const destination = visibleReturnUrl || (user.role === 'ADMIN' ? '/studio/projects' : '/profile')
      window.location.href = `/login?returnUrl=${encodeURIComponent(destination)}`
    } catch (saveError) {
      passwordFeedback.show('error', saveError instanceof Error ? saveError.message : (isFirstSet ? t('passwordSetFailed') : t('passwordChangeFailed')))
      setPasswordSaving(false)
    }
  }

  // 顶栏居中标题跟随滚动（对标 frame.io 设置页）：滚到哪一段就显示哪一段的名字。
  // 注意：内嵌浏览器（IAB）滚动不走 window scroll 事件，所以用 300ms 轮询而不是监听 scroll。
  const [sectionTitle, setSectionTitle] = useState(t('sectionProfile'))
  useEffect(() => {
    if (loading) return
    const recompute = () => {
      // 取「顶边已越过顶栏下沿」的最后一段，跟人眼看到的当前段一致。
      const line = 96
      let current = t('sectionProfile')
      for (const id of ['profile-title', 'wechat-title', 'password-title']) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= line) current = el.textContent || current
      }
      setSectionTitle(current)
    }
    recompute()
    const timer = window.setInterval(recompute, 300)
    return () => window.clearInterval(timer)
    // t 每次渲染都换身份，塞进依赖数组会让这段一次性的拉取反复重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">{t('loadingProfile')}</div>
  }

  return (
    // 个人中心从后台进入：左侧窄图标栏保留（对标 frame.io 设置页常驻 rail）。
    <div className="flex min-h-dvh bg-background">
      <StudioRail />
      <div className="flex min-w-0 flex-1 flex-col">
      <header className="relative flex items-center justify-between gap-4 border-b border-border pb-3 lg:mb-[2px] lg:shrink-0 lg:rounded-[8px] lg:border-b-0 lg:bg-popover lg:px-4 lg:py-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="gap-2">
            <Link href={visibleReturnUrl || (user?.role === 'ADMIN' ? '/studio/projects' : '/')}><ArrowLeft className="h-4 w-4" />{tc('back')}</Link>
          </Button>
        </div>
        {/* 顶栏居中标题：滚动到哪一段就显示哪一段，对标 frame.io 设置页的顶栏。 */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 text-sm font-medium sm:block">{sectionTitle}</div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={logout} className="gap-2 text-muted-foreground">
            <LogOut className="h-4 w-4" />{ta('signOut')}
          </Button>
        </div>
      </header>

      {/* 面板之间用 2px 画布缝分隔（项目中心同款），不再是竖分界线。 */}
      <div className="flex flex-1 items-stretch gap-[2px]">
        <aside className="hidden w-60 shrink-0 lg:block lg:rounded-[8px] lg:bg-popover">
          <nav aria-label={t('navigationLabel')} className="sticky top-14 px-4 py-6">
            <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">{t('groupPersonal')}</p>
            <a href="#profile-title" className="flex items-center gap-2.5 rounded-md bg-primary/10 px-2 py-2 text-sm font-medium text-primary">
              <UserRound className="h-4 w-4" />{t('sectionProfile')}
            </a>
            <p className="mb-1 mt-6 px-2 text-xs font-medium text-muted-foreground">{t('groupAccount')}</p>
            <a href="#wechat-title" className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Link2 className="h-4 w-4" />{t('sectionConnections')}
            </a>
            <p className="mb-1 mt-6 px-2 text-xs font-medium text-muted-foreground">{t('groupSecurity')}</p>
            <a href="#password-title" className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <KeyRound className="h-4 w-4" />{t('sectionSecurity')}
            </a>
          </nav>
        </aside>

        <div className="min-w-0 flex-1 lg:rounded-[8px] lg:bg-popover">
          <div className="mx-auto max-w-[915px] space-y-12 px-6 py-8 sm:px-10">
          <section aria-labelledby="profile-title" className="scroll-mt-10">
            <h2 id="profile-title" className="text-base font-semibold">{t('personalInfoTitle')}</h2>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">{t('personalInfoDescription')}</p>

            <div className="flex items-center gap-5 rounded-xl bg-muted/70 p-6">
              <div className="relative shrink-0">
                <InitialsAvatar name={displayName} src={avatarUrl} size="xl" isInternal={user?.role === 'ADMIN'} />
                <label className="absolute -bottom-1 -right-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90">
                  <Camera className="h-3.5 w-3.5" />
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="sr-only"
                    disabled={avatarUploading}
                    onChange={(event) => void handleAvatarChange(event.target.files?.[0] || null)}
                  />
                </label>
              </div>
              <div className="min-w-0">
                <p className="truncate text-xl font-semibold">{displayName}</p>
                <p className="mt-1 text-sm text-muted-foreground">{maskPhoneDisplay(form.phone) || t('phoneNotLinked')} · {user?.role === 'ADMIN' ? t('roleAdmin') : t('roleMember')}</p>
              </div>
            </div>

            {requirePhone && (
              <div className="mt-4 rounded-md border border-warning-visible bg-warning-visible px-3 py-2 text-sm text-warning">
                {t('phoneRequiredForConsole')}
              </div>
            )}

            <div className="mt-4 rounded-xl bg-muted/70">
              <form onSubmit={saveProfile} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="text-sm font-medium">{t('displayName')}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('displayNameDescription')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id="profile-name"
                    value={form.name}
                    onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
                    placeholder={t('namePlaceholder')}
                    className="h-9 w-52 bg-background"
                  />
                  <Button type="submit" disabled={saving} size="sm" className="gap-2">{saving ? tc('saving') : tc('save')}</Button>
                </div>
              </form>
              {profileSaveFeedback.feedback && (
                <div className="px-5 pb-3">
                  <ActionFeedback feedback={profileSaveFeedback.feedback} onDismiss={profileSaveFeedback.clear} />
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-5 py-4">
                <div>
                  <p className="text-sm font-medium">{ta('phone')}</p>
                  <p className="mt-0.5 max-w-md text-xs text-muted-foreground">{t('changePhoneFlow')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">{maskPhoneDisplay(form.phone) || t('notLinked')}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => void changePhone()}>{form.phone ? t('changePhone') : t('bindPhone')}</Button>
                </div>
              </div>
              {phoneFeedback.feedback && (
                <div className="px-5 pb-3">
                  <ActionFeedback feedback={phoneFeedback.feedback} onDismiss={phoneFeedback.clear} />
                </div>
              )}
            </div>
          </section>

          <section aria-labelledby="wechat-title" className="scroll-mt-10">
            <h2 id="wechat-title" className="text-base font-semibold">{t('sectionConnections')}</h2>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">{t('connectionsDescription')}</p>
            <div className="rounded-xl bg-muted/70">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="text-sm font-medium">{t('wechatAccount')}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('wechatLinkHint')}</p>
                </div>
                <WechatMiniQrLogin mode="bind" returnUrl="/profile" onBound={() => connectionsFeedback.show('success', ta('wechatBindSuccess'))}>{t('linkNow')}</WechatMiniQrLogin>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  {feishuBinding?.bound && (
                    <InitialsAvatar
                      name={feishuBinding.nickname || t('feishuUser')}
                      src={feishuAvatarSrc}
                      size="md"
                      title={feishuBinding.nickname || t('feishuUser')}
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{t('feishuNotifications')}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {feishuBinding === null
                        ? tc('loading')
                        : feishuBinding.bound
                          ? t('feishuBoundAs', { name: feishuBinding.nickname || t('feishuUser') })
                          : t('feishuBenefit')}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {feishuBinding === null ? null : feishuBinding.bound ? (
                    <>
                      <Button type="button" variant="outline" size="sm" onClick={() => void bindFeishu()} disabled={feishuRefreshing || feishuLoading}>
                        {t('relinkAndUpdate')}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => void refreshFeishuProfile()} disabled={feishuRefreshing || feishuLoading}>
                        <RefreshCw className={`h-4 w-4 ${feishuRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
                        {feishuRefreshing ? t('syncing') : t('syncDetails')}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => void unbindFeishu()} disabled={feishuLoading || feishuRefreshing}>
                        {feishuLoading ? t('unlinking') : t('unlink')}
                      </Button>
                    </>
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => void bindFeishu()}>
                      {t('linkFeishu')}
                    </Button>
                  )}
                </div>
              </div>
              {feishuBinding?.profileSyncError && (
                <p className="border-t border-border/60 px-5 py-3 text-xs leading-5 text-warning">{feishuBinding.profileSyncError}</p>
              )}
              {connectionsFeedback.feedback && (
                <div className="px-5 pb-3">
                  <ActionFeedback feedback={connectionsFeedback.feedback} onDismiss={connectionsFeedback.clear} />
                </div>
              )}
            </div>
          </section>

          <section aria-labelledby="password-title" className="scroll-mt-10">
            <h2 id="password-title" className="text-base font-semibold">{t('sectionSecurity')}</h2>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">{passwordSet === false ? t('securityDescriptionUnset') : t('securityDescription')}</p>
            <form onSubmit={changePassword} className="rounded-xl bg-muted/70 p-5">
              {passwordSet === false && !canPasswordLogin && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-visible bg-warning-visible px-3 py-2.5">
                  <p className="min-w-0 flex-1 text-xs leading-5 text-warning">{t('bindContactFirst')}</p>
                  <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => void changePhone()}>{t('bindPhone')}</Button>
                </div>
              )}
              <div className={`grid gap-4 ${passwordSet === false ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
                {passwordSet !== false && (
                  <div className="space-y-2">
                    <Label htmlFor="current-password">{ta('currentPassword')}</Label>
                    <PasswordInput id="current-password" value={passwordForm.current} onChange={event => setPasswordForm(current => ({ ...current, current: event.target.value }))} required className="bg-background" />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="new-password">{ta('newPassword')}</Label>
                  <PasswordInput id="new-password" maxLength={128} value={passwordForm.next} onChange={event => setPasswordForm(current => ({ ...current, next: event.target.value }))} required className="bg-background" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">{t('confirmNewPassword')}</Label>
                  <PasswordInput id="confirm-password" maxLength={128} value={passwordForm.confirm} onChange={event => setPasswordForm(current => ({ ...current, confirm: event.target.value }))} required className="bg-background" />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" />{t('passwordRule')}</p>
                <Button type="submit" variant="outline" size="sm" disabled={passwordSaving || passwordSet === null} className="gap-2"><KeyRound className="h-4 w-4" />{passwordSaving ? (passwordSet === false ? t('settingPassword') : t('changingPassword')) : (passwordSet === false ? t('setPassword') : ta('changePassword'))}</Button>
              </div>
              <FeedbackSlot feedback={passwordFeedback.feedback} onDismiss={passwordFeedback.clear} className="mt-3" />
            </form>
          </section>

          <Dialog
            open={phoneDialogOpen}
            onOpenChange={(open) => {
              setPhoneDialogOpen(open)
              if (!open) resetPhoneDialog()
            }}
          >
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{phoneMode === 'bind' ? t('bindPhoneTitle') : t('changePhone')}</DialogTitle>
                <DialogDescription>
                  {phoneStep === 'method' && t('verifyCurrentFirst')}
                  {phoneStep === 'verify' && (phoneMethod === 'sms' ? t('codeSentToCurrent') : t('enterPasswordToVerify'))}
                  {phoneStep === 'new' && (phoneMode === 'bind' ? t('bindPhoneNewHint') : t('enterNewPhoneNext'))}
                  {phoneStep === 'confirm' && t('codeSentToNew', { phone: newPhone })}
                </DialogDescription>
              </DialogHeader>

              {phoneStep === 'method' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button type="button" variant="outline" className="h-auto min-h-20 justify-start px-4 py-3 text-left" onClick={() => void selectPhoneMethod('password')}>
                    <span>
                      <span className="block font-medium">{t('usePassword')}</span>
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">{t('usePasswordHint')}</span>
                    </span>
                  </Button>
                  <Button type="button" variant="outline" className="h-auto min-h-20 justify-start px-4 py-3 text-left" onClick={() => void selectPhoneMethod('sms')} disabled={!form.phone || phoneSubmitting}>
                    <span>
                      <span className="block font-medium">{t('useSmsCode')}</span>
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">{t('sentToCurrentPhone')}</span>
                    </span>
                  </Button>
                </div>
              )}

              {phoneStep === 'verify' && (
                <form onSubmit={verifyCurrentPhone} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone-current-credential">{phoneMethod === 'password' ? t('currentLoginPassword') : t('currentPhoneCode')}</Label>
                    <div className="flex gap-2">
                      <Input
                        id="phone-current-credential"
                        type={phoneMethod === 'password' ? 'password' : 'text'}
                        inputMode={phoneMethod === 'sms' ? 'numeric' : undefined}
                        maxLength={phoneMethod === 'sms' ? 6 : undefined}
                        autoComplete={phoneMethod === 'password' ? 'current-password' : 'one-time-code'}
                        value={phoneCredential}
                        onChange={(event) => setPhoneCredential(phoneMethod === 'sms' ? event.target.value.replace(/\D/g, '') : event.target.value)}
                        placeholder={phoneMethod === 'sms' ? ta('invalidCode') : t('enterCurrentPassword')}
                        autoFocus
                      />
                      {phoneMethod === 'sms' && (
                        <Button type="button" variant="outline" className="shrink-0" onClick={() => void selectPhoneMethod('sms')} disabled={phoneSubmitting || phoneCodeCooldown > 0}>
                          {phoneCodeCooldown > 0 ? t('resendIn', { seconds: phoneCodeCooldown }) : ta('resendCode')}
                        </Button>
                      )}
                    </div>
                  </div>
                  {phoneError && <p className="text-sm text-destructive" role="alert">{phoneError}</p>}
                  <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => { setPhoneStep('method'); setPhoneMethod(null); setPhoneCredential(''); setPhoneError('') }} disabled={phoneSubmitting}>{tc('back')}</Button>
                    <Button type="submit" disabled={phoneSubmitting}>{phoneSubmitting ? t('verifyingStep') : tc('next')}</Button>
                  </DialogFooter>
                </form>
              )}

              {phoneStep === 'new' && (
                <form onSubmit={sendNewPhone} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone-new-number">{t('newPhone')}</Label>
                    <Input id="phone-new-number" type="tel" inputMode="numeric" maxLength={11} autoComplete="tel" value={newPhone} onChange={(event) => setNewPhone(event.target.value.replace(/\D/g, ''))} placeholder={t('enterNewPhone')} autoFocus />
                  </div>
                  {phoneError && <p className="text-sm text-destructive" role="alert">{phoneError}</p>}
                  <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => { if (phoneMode === 'bind') { setPhoneDialogOpen(false) } else { setPhoneStep('verify') } setPhoneError('') }} disabled={phoneSubmitting}>{tc('back')}</Button>
                    <Button type="submit" disabled={phoneSubmitting}>{phoneSubmitting ? ta('sendingCode') : ta('sendCode')}</Button>
                  </DialogFooter>
                </form>
              )}

              {phoneStep === 'confirm' && (
                <form onSubmit={confirmNewPhone} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone-new-code">{t('newPhoneCode')}</Label>
                    <div className="flex gap-2">
                      <Input id="phone-new-code" type="text" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={newPhoneCode} onChange={(event) => setNewPhoneCode(event.target.value.replace(/\D/g, ''))} placeholder={ta('invalidCode')} autoFocus />
                      <Button type="button" variant="outline" className="shrink-0" onClick={() => void resendNewPhoneCode()} disabled={phoneSubmitting || newPhoneCodeCooldown > 0}>
                        {newPhoneCodeCooldown > 0 ? t('resendIn', { seconds: newPhoneCodeCooldown }) : ta('resendCode')}
                      </Button>
                    </div>
                  </div>
                  {phoneError && <p className="text-sm text-destructive" role="alert">{phoneError}</p>}
                  <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => { setPhoneStep('new'); setNewPhoneCode(''); setPhoneError('') }} disabled={phoneSubmitting}>{tc('back')}</Button>
                    <Button type="submit" disabled={phoneSubmitting}>{phoneSubmitting ? t('confirming') : (phoneMode === 'bind' ? t('confirmBind') : t('confirmChange'))}</Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>

          {/* 仅页面级反馈：资料加载失败、飞书 OAuth 回调结果。各动作的成功/错误已就近显示在所属卡片。 */}
          {(error || message) && (
            <div className={`max-w-xl rounded-md px-3 py-2 text-sm ${error ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'}`} role="status">
              {error || message}
            </div>
          )}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}

export default function ProfilePage() {
  return <AuthProvider requireAuth={true}><ProfileContent /></AuthProvider>
}
