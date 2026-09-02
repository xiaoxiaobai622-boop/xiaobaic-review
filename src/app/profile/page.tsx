'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Camera, Check, KeyRound, LogOut, MessageSquare, RefreshCw, Save, UserRound } from 'lucide-react'
import { AuthProvider, useAuth } from '@/components/AuthProvider'
import { InitialsAvatar } from '@/components/InitialsAvatar'
import { WechatMiniQrLogin } from '@/components/WechatMiniQrLogin'
import ThemeToggle from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { apiFetch, apiPatch } from '@/lib/api-client'
import { clearTokens } from '@/lib/token-store'

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

  const displayName = useMemo(() => form.name || form.phone || '团队成员', [form])
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
    if (!/^\d{6}$/.test(passwordForm.next)) {
      setError('新密码必须是 6 位数字')
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

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">正在加载个人资料...</div>
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border/70 px-4 sm:px-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="gap-2">
            <a href={visibleReturnUrl || (user?.role === 'ADMIN' ? '/studio/projects' : '/')}><ArrowLeft className="h-4 w-4" />返回</a>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={logout} className="gap-2 text-muted-foreground">
            <LogOut className="h-4 w-4" />退出登录
          </Button>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:py-12">
        <aside className="flex items-center gap-4 self-start lg:flex-col lg:items-start">
          <div className="relative">
            <InitialsAvatar name={displayName} src={avatarUrl} size="lg" isInternal={user?.role === 'ADMIN'} />
            <label className="absolute bottom-0 right-0 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90">
              <Camera className="h-3 w-3" />
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
            <h1 className="truncate text-xl font-semibold">{displayName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{user?.role === 'ADMIN' ? '管理员' : '团队成员'}</p>
          </div>
        </aside>

        <div className="min-w-0 space-y-10">
          <section aria-labelledby="profile-title">
            <div className="mb-5 flex items-center gap-2">
              <UserRound className="h-5 w-5 text-primary" />
              <h2 id="profile-title" className="text-lg font-semibold">个人资料</h2>
            </div>
            {requirePhone && (
              <div className="mb-4 rounded-md border border-warning-visible bg-warning-visible px-3 py-2 text-sm text-warning">
                进入团队后台前需要先绑定手机号。
              </div>
            )}
            <form onSubmit={saveProfile} className="max-w-xl space-y-4">
              <div className="space-y-2">
                <Label htmlFor="profile-name">显示名称</Label>
                <Input id="profile-name" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="你的姓名或昵称" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="profile-phone">手机号</Label>
                  <Input id="profile-phone" type="tel" inputMode="numeric" maxLength={11} value={form.phone} onChange={event => setForm(current => ({ ...current, phone: event.target.value.replace(/\D/g, '') }))} placeholder="用于加入或创建团队" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">看片、上传、批注和修改头像无需手机号；加入或创建团队前需要绑定手机号。</p>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving} className="gap-2"><Save className="h-4 w-4" />{saving ? '正在保存...' : '保存资料'}</Button>
                <WechatMiniQrLogin mode="bind" returnUrl="/profile" onBound={() => setMessage('微信绑定成功')}>
                  绑定微信
                </WechatMiniQrLogin>

              </div>
            </form>
          </section>

          <section aria-labelledby="feishu-title" className="border-t border-border pt-8">
            <div className="mb-5 flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              <h2 id="feishu-title" className="text-lg font-semibold">飞书通知</h2>
            </div>
            <div className="max-w-xl space-y-4">
              {feishuBinding === null ? (
                <p className="text-sm text-muted-foreground">加载中...</p>
              ) : feishuBinding.bound ? (
                <>
                  <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <InitialsAvatar
                          name={feishuBinding.nickname || '飞书用户'}
                          src={feishuAvatarSrc}
                          size="md"
                          title={feishuBinding.nickname || '飞书用户'}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{feishuBinding.nickname || '飞书用户'}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">飞书姓名与头像</p>
                        </div>
                      </div>
                      <span className="shrink-0 text-sm text-green-600 dark:text-green-400">已绑定</span>
                    </div>
                    {feishuBinding.profileSyncError && (
                      <p className="mt-3 text-xs leading-5 text-warning">{feishuBinding.profileSyncError}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" className="gap-2" onClick={() => void bindFeishu()} disabled={feishuRefreshing || feishuLoading}>
                      <MessageSquare className="h-4 w-4" aria-hidden="true" />
                      重新绑定并更新资料
                    </Button>
                    <Button type="button" variant="outline" className="gap-2" onClick={() => void refreshFeishuProfile()} disabled={feishuRefreshing || feishuLoading}>
                      <RefreshCw className={`h-4 w-4 ${feishuRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
                      {feishuRefreshing ? '同步中...' : '同步资料'}
                    </Button>
                    <Button type="button" variant="outline" className="gap-2" onClick={() => void unbindFeishu()} disabled={feishuLoading || feishuRefreshing}>
                      {feishuLoading ? '解绑中...' : '解除绑定'}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">当前状态：</span>
                      <span className="text-muted-foreground">未绑定</span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      绑定飞书后，可以及时收到逐帧审阅批注意见通知。
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => void bindFeishu()}
                  >
                    <MessageSquare className="h-4 w-4" />
                    绑定飞书
                  </Button>
                </>
              )}
            </div>
          </section>

          <section aria-labelledby="password-title" className="border-t border-border pt-8">
            <div className="mb-5 flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              <h2 id="password-title" className="text-lg font-semibold">修改密码</h2>
            </div>
            <form onSubmit={changePassword} className="max-w-xl space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">当前密码</Label>
                <PasswordInput id="current-password" value={passwordForm.current} onChange={event => setPasswordForm(current => ({ ...current, current: event.target.value }))} required />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-password">新密码</Label>
                  <PasswordInput id="new-password" inputMode="numeric" maxLength={6} value={passwordForm.next} onChange={event => setPasswordForm(current => ({ ...current, next: event.target.value.replace(/\D/g, '') }))} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">确认新密码</Label>
                  <PasswordInput id="confirm-password" inputMode="numeric" maxLength={6} value={passwordForm.confirm} onChange={event => setPasswordForm(current => ({ ...current, confirm: event.target.value.replace(/\D/g, '') }))} required />
                </div>
              </div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" />密码只需 6 位数字</p>
              <Button type="submit" variant="outline" disabled={passwordSaving} className="gap-2"><KeyRound className="h-4 w-4" />{passwordSaving ? '正在修改...' : '修改密码'}</Button>
            </form>
          </section>

          {(error || message) && (
            <div className={`max-w-xl rounded-md px-3 py-2 text-sm ${error ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'}`} role="status">
              {error || message}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default function ProfilePage() {
  return <AuthProvider requireAuth={true}><ProfileContent /></AuthProvider>
}
