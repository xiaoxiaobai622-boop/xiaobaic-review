'use client'

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
import { passwordRuleHint, validateAccountPassword } from '@/lib/password-policy'

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
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false)
  const [phoneStep, setPhoneStep] = useState<'method' | 'verify' | 'new' | 'confirm'>('method')
  const [phoneMethod, setPhoneMethod] = useState<'password' | 'sms' | null>(null)
  const [phoneCredential, setPhoneCredential] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newPhoneCode, setNewPhoneCode] = useState('')
  const [phoneGrantToken, setPhoneGrantToken] = useState('')
  const [phoneSubmitting, setPhoneSubmitting] = useState(false)
  const [phoneCodeCooldown, setPhoneCodeCooldown] = useState(0)
  const [newPhoneCodeCooldown, setNewPhoneCodeCooldown] = useState(0)

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
  }

  function changePhone() {
    setError('')
    setMessage('')
    setPhoneDialogOpen(true)
    resetPhoneDialog()
  }

  async function selectPhoneMethod(method: 'password' | 'sms') {
    setPhoneMethod(method)
    setPhoneCredential('')
    setError('')
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
      if (!response.ok) throw new Error(data.error || '验证码发送失败')
      setPhoneCodeCooldown(60)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '验证码发送失败')
      setPhoneStep('method')
    } finally {
      setPhoneSubmitting(false)
    }
  }

  async function verifyCurrentPhone(event: React.FormEvent) {
    event.preventDefault()
    if (!phoneMethod) return
    if (phoneMethod === 'password' && !phoneCredential) {
      setError('请输入当前登录密码')
      return
    }
    if (phoneMethod === 'sms' && !/^\d{6}$/.test(phoneCredential)) {
      setError('请输入 6 位验证码')
      return
    }

    setPhoneSubmitting(true)
    setError('')
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
      if (!response.ok || !data.token) throw new Error(data.error || '验证失败，请重试')
      setPhoneGrantToken(data.token)
      setPhoneCredential('')
      setPhoneStep('new')
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : '验证失败，请重试')
    } finally {
      setPhoneSubmitting(false)
    }
  }

  async function sendNewPhone(event: React.FormEvent) {
    event.preventDefault()
    if (!/^1[3-9]\d{9}$/.test(newPhone)) {
      setError('请输入有效的 11 位手机号')
      return
    }

    setPhoneSubmitting(true)
    setError('')
    try {
      const response = await apiFetch('/api/account/phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-new', token: phoneGrantToken, phone: newPhone }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '验证码发送失败')
      setNewPhoneCode('')
      setNewPhoneCodeCooldown(60)
      setPhoneStep('confirm')
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '验证码发送失败')
    } finally {
      setPhoneSubmitting(false)
    }
  }

  async function resendNewPhoneCode() {
    if (newPhoneCodeCooldown > 0 || phoneSubmitting) return
    setPhoneSubmitting(true)
    setError('')
    try {
      const response = await apiFetch('/api/account/phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-new', token: phoneGrantToken, phone: newPhone }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '验证码发送失败')
      setNewPhoneCodeCooldown(60)
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : '验证码发送失败')
    } finally {
      setPhoneSubmitting(false)
    }
  }

  async function confirmNewPhone(event: React.FormEvent) {
    event.preventDefault()
    if (!/^\d{6}$/.test(newPhoneCode)) {
      setError('请输入 6 位验证码')
      return
    }

    setPhoneSubmitting(true)
    setError('')
    try {
      const response = await apiFetch('/api/account/phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', token: phoneGrantToken, phone: newPhone, code: newPhoneCode }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '手机号更换失败')
      setForm(current => ({ ...current, phone: data.phone || newPhone }))
      setPhoneDialogOpen(false)
      resetPhoneDialog()
      setMessage('手机号更换成功')
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : '手机号更换失败')
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
      setMessage('飞书绑定成功')
    } else if (params.get('feishu_error')) {
      setError(params.get('feishu_error') === 'invalid_state'
        ? '飞书授权已过期，请重新绑定'
        : '飞书绑定失败，请稍后重试')
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
  }, [])

  useEffect(() => {
    if (!user?.id) return
    let active = true
    apiFetch(`/api/users/${user.id}`, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('无法读取个人资料，请重新登录后再试')
        const data = await response.json()
        if (active) {
          setForm({
            name: data.user.name || '',
            phone: data.user.phone || '',
          })
          setAvatarUrl(data.user.avatarUrl || null)
        }
      })
      .catch(fetchError => active && setError(fetchError instanceof Error ? fetchError.message : '无法读取个人资料'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [user?.id])

  const displayName = form.name || form.phone || '团队成员'
  const visibleReturnUrl = returnUrl?.startsWith('/studio/') && user?.role !== 'ADMIN'
    ? null
    : returnUrl

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault()
    if (!user?.id) return
    if (form.phone && !/^1\d{10}$/.test(form.phone)) {
      setError('请输入有效的 11 位手机号')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      await apiPatch(`/api/users/${user.id}`, {
        name: form.name.trim() || null,
        phone: form.phone,
      })
      if (requirePhone && form.phone && phoneReturnUrl) {
        window.location.href = phoneReturnUrl
        return
      }
      setMessage('个人资料已保存')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  async function handleAvatarChange(file: File | null) {
    if (!user?.id || !file) return
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('仅支持 PNG、JPG、WebP 或 GIF 图片')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('头像不能超过 2MB')
      return
    }

    setError('')
    setAvatarUploading(true)
    try {
      const response = await apiFetch(`/api/users/${user.id}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '头像上传失败')
      setAvatarUrl(data.avatarUrl || null)
    } catch (avatarError) {
      setError(avatarError instanceof Error ? avatarError.message : '头像上传失败')
    } finally {
      setAvatarUploading(false)
    }
  }

  async function bindFeishu() {
    setError('')
    setMessage('')
    try {
      const response = await apiFetch('/api/auth/feishu/authorize', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.authUrl) {
        throw new Error(data.error || '无法启动飞书授权')
      }
      window.location.href = data.authUrl
    } catch (bindError) {
      setError(bindError instanceof Error ? bindError.message : '飞书绑定失败')
    }
  }

  async function unbindFeishu() {
    if (!confirm('确认解除飞书绑定吗？解绑后将无法接收批注意见通知。')) {
      return
    }
    setFeishuLoading(true)
    setError('')
    setMessage('')
    try {
      const response = await apiFetch('/api/feishu/unbind', {
        method: 'POST',
        cache: 'no-store',
      })
      if (!response.ok) {
        throw new Error('解绑失败')
      }
      setFeishuBinding({ bound: false, nickname: null, avatarUrl: null })
      setMessage('已解除飞书绑定')
    } catch (unbindError) {
      setError(unbindError instanceof Error ? unbindError.message : '解绑失败，请稍后重试')
    } finally {
      setFeishuLoading(false)
    }
  }

  async function refreshFeishuProfile() {
    setFeishuRefreshing(true)
    setError('')
    setMessage('')
    try {
      const response = await apiFetch('/api/feishu/binding?refresh=1', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.bound) throw new Error(data.error || '飞书资料同步失败')
      setFeishuBinding({ bound: true, nickname: data.nickname || null, avatarUrl: data.avatarUrl || null, profileSyncError: data.profileSyncError })
      setMessage(data.profileSyncError ? '' : '飞书姓名和头像已同步')
      if (data.profileSyncError) setError(data.profileSyncError)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : '飞书资料同步失败')
    } finally {
      setFeishuRefreshing(false)
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault()
    if (!user?.id) return
    if (!validateAccountPassword(passwordForm.next).isValid) {
      setError(`新密码不符合要求：${passwordRuleHint}`)
      return
    }
    if (passwordForm.next !== passwordForm.confirm) {
      setError('两次输入的新密码不一致')
      return
    }

    setPasswordSaving(true)
    setError('')
    setMessage('')
    try {
      await apiPatch(`/api/users/${user.id}`, {
        oldPassword: passwordForm.current,
        password: passwordForm.next,
      })
      clearTokens()
      const destination = visibleReturnUrl || (user.role === 'ADMIN' ? '/studio/projects' : '/profile')
      window.location.href = `/login?returnUrl=${encodeURIComponent(destination)}`
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '密码修改失败')
      setPasswordSaving(false)
    }
  }

  // 顶栏居中标题跟随滚动（对标 frame.io 设置页）：滚到哪一段就显示哪一段的名字。
  // 注意：内嵌浏览器（IAB）滚动不走 window scroll 事件，所以用 300ms 轮询而不是监听 scroll。
  const [sectionTitle, setSectionTitle] = useState('个人资料')
  useEffect(() => {
    if (loading) return
    const recompute = () => {
      // 取「顶边已越过顶栏下沿」的最后一段，跟人眼看到的当前段一致。
      const line = 96
      let current = '个人资料'
      for (const id of ['profile-title', 'wechat-title', 'password-title']) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= line) current = el.textContent || current
      }
      setSectionTitle(current)
    }
    recompute()
    const timer = window.setInterval(recompute, 300)
    return () => window.clearInterval(timer)
  }, [loading])

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">正在加载个人资料...</div>
  }

  return (
    // 个人中心从后台进入：左侧窄图标栏保留（对标 frame.io 设置页常驻 rail）。
    <div className="flex min-h-dvh bg-background">
      <StudioRail />
      <div className="flex min-w-0 flex-1 flex-col">
      <header className="relative flex items-center justify-between gap-4 border-b border-border pb-3 lg:mb-[2px] lg:shrink-0 lg:rounded-[8px] lg:border-b-0 lg:bg-popover lg:px-4 lg:py-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="gap-2">
            <a href={visibleReturnUrl || (user?.role === 'ADMIN' ? '/studio/projects' : '/')}><ArrowLeft className="h-4 w-4" />返回</a>
          </Button>
        </div>
        {/* 顶栏居中标题：滚动到哪一段就显示哪一段，对标 frame.io 设置页的顶栏。 */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 text-sm font-medium sm:block">{sectionTitle}</div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={logout} className="gap-2 text-muted-foreground">
            <LogOut className="h-4 w-4" />退出登录
          </Button>
        </div>
      </header>

      {/* 面板之间用 2px 画布缝分隔（项目中心同款），不再是竖分界线。 */}
      <div className="flex flex-1 items-stretch gap-[2px]">
        <aside className="hidden w-60 shrink-0 lg:block lg:rounded-[8px] lg:bg-popover">
          <nav aria-label="个人中心导航" className="sticky top-14 px-4 py-6">
            <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">个人</p>
            <a href="#profile-title" className="flex items-center gap-2.5 rounded-md bg-primary/10 px-2 py-2 text-sm font-medium text-primary">
              <UserRound className="h-4 w-4" />个人资料
            </a>
            <p className="mb-1 mt-6 px-2 text-xs font-medium text-muted-foreground">帐户</p>
            <a href="#wechat-title" className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Link2 className="h-4 w-4" />账号连接
            </a>
            <p className="mb-1 mt-6 px-2 text-xs font-medium text-muted-foreground">安全性</p>
            <a href="#password-title" className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <KeyRound className="h-4 w-4" />安全设置
            </a>
          </nav>
        </aside>

        <div className="min-w-0 flex-1 lg:rounded-[8px] lg:bg-popover">
          <div className="mx-auto max-w-[915px] space-y-12 px-6 py-8 sm:px-10">
          <section aria-labelledby="profile-title" className="scroll-mt-10">
            <h2 id="profile-title" className="text-base font-semibold">个人信息</h2>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">设置您的个人资料。</p>

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
                <p className="mt-1 text-sm text-muted-foreground">{form.phone || '尚未绑定手机号'} · {user?.role === 'ADMIN' ? '管理员' : '团队成员'}</p>
              </div>
            </div>

            {requirePhone && (
              <div className="mt-4 rounded-md border border-warning-visible bg-warning-visible px-3 py-2 text-sm text-warning">
                进入团队后台前需要先绑定手机号。
              </div>
            )}

            <div className="mt-4 rounded-xl bg-muted/70">
              <form onSubmit={saveProfile} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="text-sm font-medium">显示名称</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">在整个工作台展示的名字。</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id="profile-name"
                    value={form.name}
                    onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
                    placeholder="你的姓名或昵称"
                    className="h-9 w-52 bg-background"
                  />
                  <Button type="submit" disabled={saving} size="sm" className="gap-2">{saving ? '正在保存...' : '保存'}</Button>
                </div>
              </form>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-5 py-4">
                <div>
                  <p className="text-sm font-medium">手机号</p>
                  <p className="mt-0.5 max-w-md text-xs text-muted-foreground">更换手机号需要先验证当前手机号验证码或登录密码，再验证新手机号。</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">{form.phone || '尚未绑定'}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => void changePhone()}>更换手机号</Button>
                </div>
              </div>
            </div>
          </section>

          <section aria-labelledby="wechat-title" className="scroll-mt-10">
            <h2 id="wechat-title" className="text-base font-semibold">账号连接</h2>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">绑定第三方账号后可以快速登录并接收通知。</p>
            <div className="rounded-xl bg-muted/70">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="text-sm font-medium">微信账号</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">使用微信扫一扫完成绑定，绑定后可使用微信快速登录。</p>
                </div>
                <WechatMiniQrLogin mode="bind" returnUrl="/profile" onBound={() => setMessage('微信绑定成功')}>立即绑定</WechatMiniQrLogin>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  {feishuBinding?.bound && (
                    <InitialsAvatar
                      name={feishuBinding.nickname || '飞书用户'}
                      src={feishuAvatarSrc}
                      size="md"
                      title={feishuBinding.nickname || '飞书用户'}
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">飞书通知</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {feishuBinding === null
                        ? '加载中...'
                        : feishuBinding.bound
                          ? `已绑定：${feishuBinding.nickname || '飞书用户'}`
                          : '绑定飞书后，可以及时收到逐帧审阅批注意见通知。'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {feishuBinding === null ? null : feishuBinding.bound ? (
                    <>
                      <Button type="button" variant="outline" size="sm" onClick={() => void bindFeishu()} disabled={feishuRefreshing || feishuLoading}>
                        重新绑定并更新资料
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => void refreshFeishuProfile()} disabled={feishuRefreshing || feishuLoading}>
                        <RefreshCw className={`h-4 w-4 ${feishuRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
                        {feishuRefreshing ? '同步中...' : '同步资料'}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => void unbindFeishu()} disabled={feishuLoading || feishuRefreshing}>
                        {feishuLoading ? '解绑中...' : '解除绑定'}
                      </Button>
                    </>
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => void bindFeishu()}>
                      绑定飞书
                    </Button>
                  )}
                </div>
              </div>
              {feishuBinding?.profileSyncError && (
                <p className="border-t border-border/60 px-5 py-3 text-xs leading-5 text-warning">{feishuBinding.profileSyncError}</p>
              )}
            </div>
          </section>

          <section aria-labelledby="password-title" className="scroll-mt-10">
            <h2 id="password-title" className="text-base font-semibold">安全设置</h2>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">定期更新密码可以让账号更安全。</p>
            <form onSubmit={changePassword} className="rounded-xl bg-muted/70 p-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="current-password">当前密码</Label>
                  <PasswordInput id="current-password" value={passwordForm.current} onChange={event => setPasswordForm(current => ({ ...current, current: event.target.value }))} required className="bg-background" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">新密码</Label>
                  <PasswordInput id="new-password" maxLength={128} value={passwordForm.next} onChange={event => setPasswordForm(current => ({ ...current, next: event.target.value }))} required className="bg-background" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">确认新密码</Label>
                  <PasswordInput id="confirm-password" maxLength={128} value={passwordForm.confirm} onChange={event => setPasswordForm(current => ({ ...current, confirm: event.target.value }))} required className="bg-background" />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" />{passwordRuleHint}</p>
                <Button type="submit" variant="outline" size="sm" disabled={passwordSaving} className="gap-2"><KeyRound className="h-4 w-4" />{passwordSaving ? '正在修改...' : '修改密码'}</Button>
              </div>
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
                <DialogTitle>更换手机号</DialogTitle>
                <DialogDescription>
                  {phoneStep === 'method' && '先验证当前账号，再绑定新的手机号。'}
                  {phoneStep === 'verify' && (phoneMethod === 'sms' ? '验证码已发送到当前手机号。' : '请输入当前登录密码完成验证。')}
                  {phoneStep === 'new' && '输入新的手机号，我们会发送验证码。'}
                  {phoneStep === 'confirm' && `验证码已发送到 ${newPhone}。`}
                </DialogDescription>
              </DialogHeader>

              {phoneStep === 'method' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button type="button" variant="outline" className="h-auto min-h-20 justify-start px-4 py-3 text-left" onClick={() => void selectPhoneMethod('password')}>
                    <span>
                      <span className="block font-medium">使用登录密码</span>
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">立即验证，无需等待短信</span>
                    </span>
                  </Button>
                  <Button type="button" variant="outline" className="h-auto min-h-20 justify-start px-4 py-3 text-left" onClick={() => void selectPhoneMethod('sms')} disabled={!form.phone || phoneSubmitting}>
                    <span>
                      <span className="block font-medium">使用短信验证码</span>
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">发送到当前手机号</span>
                    </span>
                  </Button>
                </div>
              )}

              {phoneStep === 'verify' && (
                <form onSubmit={verifyCurrentPhone} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone-current-credential">{phoneMethod === 'password' ? '当前登录密码' : '当前手机号验证码'}</Label>
                    <div className="flex gap-2">
                      <Input
                        id="phone-current-credential"
                        type={phoneMethod === 'password' ? 'password' : 'text'}
                        inputMode={phoneMethod === 'sms' ? 'numeric' : undefined}
                        maxLength={phoneMethod === 'sms' ? 6 : undefined}
                        autoComplete={phoneMethod === 'password' ? 'current-password' : 'one-time-code'}
                        value={phoneCredential}
                        onChange={(event) => setPhoneCredential(phoneMethod === 'sms' ? event.target.value.replace(/\D/g, '') : event.target.value)}
                        placeholder={phoneMethod === 'sms' ? '请输入 6 位验证码' : '请输入当前登录密码'}
                        autoFocus
                      />
                      {phoneMethod === 'sms' && (
                        <Button type="button" variant="outline" className="shrink-0" onClick={() => void selectPhoneMethod('sms')} disabled={phoneSubmitting || phoneCodeCooldown > 0}>
                          {phoneCodeCooldown > 0 ? `${phoneCodeCooldown}s 后重发` : '重新发送'}
                        </Button>
                      )}
                    </div>
                  </div>
                  {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                  <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => { setPhoneStep('method'); setPhoneMethod(null); setPhoneCredential(''); setError('') }} disabled={phoneSubmitting}>返回</Button>
                    <Button type="submit" disabled={phoneSubmitting}>{phoneSubmitting ? '验证中...' : '下一步'}</Button>
                  </DialogFooter>
                </form>
              )}

              {phoneStep === 'new' && (
                <form onSubmit={sendNewPhone} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone-new-number">新手机号</Label>
                    <Input id="phone-new-number" type="tel" inputMode="numeric" maxLength={11} autoComplete="tel" value={newPhone} onChange={(event) => setNewPhone(event.target.value.replace(/\D/g, ''))} placeholder="请输入新的 11 位手机号" autoFocus />
                  </div>
                  {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                  <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => { setPhoneStep('verify'); setError('') }} disabled={phoneSubmitting}>返回</Button>
                    <Button type="submit" disabled={phoneSubmitting}>{phoneSubmitting ? '发送中...' : '获取验证码'}</Button>
                  </DialogFooter>
                </form>
              )}

              {phoneStep === 'confirm' && (
                <form onSubmit={confirmNewPhone} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone-new-code">新手机号验证码</Label>
                    <div className="flex gap-2">
                      <Input id="phone-new-code" type="text" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={newPhoneCode} onChange={(event) => setNewPhoneCode(event.target.value.replace(/\D/g, ''))} placeholder="请输入 6 位验证码" autoFocus />
                      <Button type="button" variant="outline" className="shrink-0" onClick={() => void resendNewPhoneCode()} disabled={phoneSubmitting || newPhoneCodeCooldown > 0}>
                        {newPhoneCodeCooldown > 0 ? `${newPhoneCodeCooldown}s 后重发` : '重新发送'}
                      </Button>
                    </div>
                  </div>
                  {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                  <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => { setPhoneStep('new'); setNewPhoneCode(''); setError('') }} disabled={phoneSubmitting}>返回</Button>
                    <Button type="submit" disabled={phoneSubmitting}>{phoneSubmitting ? '确认中...' : '确认更换'}</Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>

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
