'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, KeyRound, LogOut, Save, UserRound } from 'lucide-react'
import { AuthProvider, useAuth } from '@/components/AuthProvider'
import { InitialsAvatar } from '@/components/InitialsAvatar'
import ThemeToggle from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { apiFetch, apiPatch } from '@/lib/api-client'
import { clearTokens } from '@/lib/token-store'
import { getDisplayEmail } from '@/lib/user-contact'

function safeReviewReturnUrl(): string | null {
  const requested = new URLSearchParams(window.location.search).get('returnUrl')
  if (!requested?.startsWith('/') || requested.startsWith('//')) return null
  return requested.startsWith('/share/') || /^\/admin\/projects\/[^/]+\/share(?:[/?#]|$)/.test(requested)
    ? requested
    : null
}

function ProfileContent() {
  const { user, logout } = useAuth()
  const [returnUrl, setReturnUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', email: '', phone: '' })
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' })

  useEffect(() => setReturnUrl(safeReviewReturnUrl()), [])

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
            email: getDisplayEmail(data.user.email),
            phone: data.user.phone || '',
          })
        }
      })
      .catch(fetchError => active && setError(fetchError instanceof Error ? fetchError.message : '无法读取个人资料'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [user?.id])

  const displayName = useMemo(() => form.name || form.phone || form.email || '团队成员', [form])
  const visibleReturnUrl = returnUrl?.startsWith('/admin/') && user?.role !== 'ADMIN'
    ? null
    : returnUrl

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault()
    if (!user?.id) return
    if (!form.email.trim() && !form.phone.trim()) {
      setError('邮箱和手机号至少填写一项')
      return
    }
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
        email: form.email.trim(),
        phone: form.phone,
      })
      setMessage('个人资料已保存')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败，请稍后重试')
    } finally {
      setSaving(false)
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
      const destination = visibleReturnUrl || (user.role === 'ADMIN' ? '/admin/projects' : '/profile')
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
          {visibleReturnUrl && (
            <Button asChild variant="ghost" size="sm" className="gap-2">
              <a href={visibleReturnUrl}><ArrowLeft className="h-4 w-4" />返回审片</a>
            </Button>
          )}
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
          <InitialsAvatar name={displayName} size="lg" isInternal={user?.role === 'ADMIN'} />
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
            <form onSubmit={saveProfile} className="max-w-xl space-y-4">
              <div className="space-y-2">
                <Label htmlFor="profile-name">显示名称</Label>
                <Input id="profile-name" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="你的姓名或昵称" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="profile-email">邮箱</Label>
                  <Input id="profile-email" type="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} placeholder="与手机号二选一" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="profile-phone">手机号</Label>
                  <Input id="profile-phone" type="tel" inputMode="numeric" maxLength={11} value={form.phone} onChange={event => setForm(current => ({ ...current, phone: event.target.value.replace(/\D/g, '') }))} placeholder="与邮箱二选一" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">邮箱和手机号至少保留一项，用于登录账户。</p>
              <Button type="submit" disabled={saving} className="gap-2"><Save className="h-4 w-4" />{saving ? '正在保存...' : '保存资料'}</Button>
            </form>
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
