'use client'

import { Suspense, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, Camera, Check, UserRound } from 'lucide-react'
import { AuthProvider, useAuth } from '@/components/AuthProvider'
import { InitialsAvatar } from '@/components/InitialsAvatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { apiFetch, apiPatch } from '@/lib/api-client'
import { setTokens } from '@/lib/token-store'
import { getDeviceAuthHeaders } from '@/lib/device-id'

function OnboardingContent() {
  const { user, logout } = useAuth()
  const searchParams = useSearchParams()
  const [name, setName] = useState(user?.name || '')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatarUrl || null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const destination = useMemo(() => {
    const requested = searchParams?.get('returnUrl') || ''
    if (requested.startsWith('/share/')) return requested
    if (/^\/studio\/projects\/[^/]+\/share(?:[/?#]|$)/.test(requested)) return requested
    return '/studio/team?welcome=1'
  }, [searchParams])

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
    setUploading(true)
    try {
      const response = await apiFetch(`/api/users/${user.id}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '头像上传失败')
      setAvatarUrl(data.avatarUrl || null)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '头像上传失败')
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!user?.id) return
    if (!name.trim()) {
      setError('请填写你的显示名称')
      return
    }
    if (!/^\d{6}$/.test(password)) {
      setError('密码必须是 6 位数字')
      return
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }

    setError('')
    setLoading(true)
    try {
      await apiPatch(`/api/users/${user.id}`, {
        name: name.trim(),
        password,
      })

      const account = user.phone || user.email
      if (!account) {
        throw new Error('账号信息不完整，请重新登录')
      }

      const loginResponse = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getDeviceAuthHeaders(),
        },
        body: JSON.stringify({ email: account, password }),
      })
      const loginData = await loginResponse.json().catch(() => ({}))
      if (!loginResponse.ok || !loginData.tokens?.accessToken || !loginData.tokens?.refreshToken) {
        throw new Error(loginData.error || '自动登录失败，请重新登录')
      }

      setTokens({
        accessToken: loginData.tokens.accessToken,
        refreshToken: loginData.tokens.refreshToken,
      })
      window.location.href = destination
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存失败，请稍后再试')
      setLoading(false)
    }
  }

  const displayName = name.trim() || user?.phone || user?.email || '新成员'

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border/70 px-4 sm:px-6">
        <div className="text-sm text-muted-foreground">完成注册资料</div>
        <Button variant="ghost" size="sm" onClick={logout}>退出登录</Button>
      </header>

      <main className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-md items-center px-4 py-10">
        <form onSubmit={handleSubmit} className="w-full space-y-6">
          <div className="text-center">
            <div className="relative mx-auto h-24 w-24">
              <InitialsAvatar name={displayName} src={avatarUrl} size="lg" className="h-24 w-24 text-3xl" />
              <label className="absolute bottom-0 right-0 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-border bg-background shadow-sm">
                <Camera className="h-4 w-4 text-muted-foreground" />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) => void handleAvatarChange(event.target.files?.[0] || null)}
                />
              </label>
            </div>
            <h1 className="mt-5 text-2xl font-semibold">完善你的账号</h1>
            <p className="mt-2 text-sm text-muted-foreground">完成资料后即可创建或加入团队</p>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive-visible p-3 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="onboarding-name">显示名称</Label>
            <Input
              id="onboarding-name"
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
              placeholder="你的姓名或昵称"
              autoFocus
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="onboarding-password">设置密码</Label>
            <PasswordInput
              id="onboarding-password"
              inputMode="numeric"
              maxLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value.replace(/\D/g, ''))}
              placeholder="6 位数字密码"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="onboarding-confirm-password">确认密码</Label>
            <PasswordInput
              id="onboarding-confirm-password"
              inputMode="numeric"
              maxLength={6}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value.replace(/\D/g, ''))}
              placeholder="再次输入密码"
              required
            />
          </div>

          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5" />头像使用你名字的第一个字，也可以点击右下角上传更换
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserRound className="h-3.5 w-3.5" />注册完成后会进入团队中心，你可以创建自己的团队
            </p>
          </div>

          <Button type="submit" className="h-12 w-full" disabled={loading || uploading}>
            {loading ? '正在保存...' : '完成注册'}
            {!loading && <ArrowRight className="ml-auto h-4 w-4" />}
          </Button>
        </form>
      </main>
    </div>
  )
}

export default function OnboardingPage() {
  return (
    <AuthProvider requireAuth={true}>
      <Suspense fallback={<div className="min-h-dvh bg-background" />}>
        <OnboardingContent />
      </Suspense>
    </AuthProvider>
  )
}
