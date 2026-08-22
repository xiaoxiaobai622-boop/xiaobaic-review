'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, UserPlus, RefreshCw, Copy, Check, Eye, EyeOff } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordRequirements } from '@/components/PasswordRequirements'
import { apiPost } from '@/lib/api-client'
import { useTranslations } from 'next-intl'
import { copyTextToClipboard } from '@/lib/clipboard'

export default function NewUserPage() {
  const t = useTranslations('users')
  const tc = useTranslations('common')
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copiedPassword, setCopiedPassword] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [formData, setFormData] = useState({
    email: '',
    phone: '',
    username: '',
    password: '',
    confirmPassword: '',
    name: '',
  })

  const generateRandomPassword = () => {
    const values = new Uint32Array(6)
    crypto.getRandomValues(values)
    const password = Array.from(values, value => String(value % 10)).join('')

    setFormData({
      ...formData,
      password,
      confirmPassword: password,
    })

    // Automatically show password when generated so user can see/copy it
    setShowPassword(true)
    setShowConfirmPassword(true)
  }

  const copyPassword = async () => {
    if (formData.password && await copyTextToClipboard(formData.password)) {
      setCopiedPassword(true)
      setTimeout(() => setCopiedPassword(false), 2000)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validation
    if ((!formData.email && !formData.phone) || !formData.password) {
      setError('邮箱或手机号至少填写一项，并设置密码')
      return
    }

    if (!/^\d{6}$/.test(formData.password)) {
      setError('密码必须是 6 位数字')
      return
    }

    if (formData.password !== formData.confirmPassword) {
      setError(t('passwordsDoNotMatch'))
      return
    }

    setLoading(true)

    try {
      await apiPost('/api/users', {
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        username: formData.username || null,
        password: formData.password,
        name: formData.name || null,
        role: 'ADMIN',
      })

      router.push('/platform/users')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-screen-2xl mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-4 sm:mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
                <UserPlus className="w-7 h-7 sm:w-8 sm:h-8" />
                {t('addUser')}
              </h1>
              <p className="text-sm sm:text-base text-muted-foreground mt-1">{t('addNewUserDescription')}</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('userDetails')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-destructive-visible border-2 border-destructive-visible text-destructive font-medium px-4 py-3 rounded">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">邮箱（与手机号二选一）</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">手机号（与邮箱二选一）</Label>
              <Input id="phone" type="tel" inputMode="numeric" maxLength={11} value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '') })} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">{t('username')}</Label>
              <Input
                id="username"
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder={tc('optional')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">{t('fullName')}</Label>
              <Input
                id="name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={tc('optional')}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t('passwordRequired')}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={generateRandomPassword}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {tc('generate')}
                </Button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                  inputMode="numeric"
                  maxLength={6}
                  required
                  className="pr-20"
                />
                <div className="absolute inset-y-0 right-0 flex items-center gap-1 pr-2">
                  {formData.password && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={copyPassword}
                      className="h-7 w-7 p-0"
                      title={t('copyPassword')}
                    >
                      {copiedPassword ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowPassword(!showPassword)}
                    className="h-7 w-7 p-0"
                    title={showPassword ? t('hidePassword') : t('showPassword')}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              {formData.password && (
                <PasswordRequirements password={formData.password} className="mt-3" />
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t('confirmPasswordRequired')}</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                  inputMode="numeric"
                  maxLength={6}
                  required
                  className="pr-10"
                />
                <div className="absolute inset-y-0 right-0 flex items-center gap-1 pr-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="h-7 w-7 p-0"
                    title={showConfirmPassword ? t('hidePassword') : t('showPassword')}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              {formData.confirmPassword && formData.password !== formData.confirmPassword && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <X className="w-4 h-4" /> {t('passwordsDoNotMatch')}
                </p>
              )}
              {formData.confirmPassword && formData.password === formData.confirmPassword && formData.password.length > 0 && (
                <p className="text-sm text-success flex items-center gap-1">
                  <Check className="w-4 h-4" /> {t('passwordsMatch')}
                </p>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="submit" variant="default" size="default" disabled={loading}>
                <UserPlus className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">{loading ? tc('creating') : t('addUser')}</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="default"
                onClick={() => router.push('/platform/users')}
                disabled={loading}
              >
                <X className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">{tc('cancel')}</span>
              </Button>
            </div>
          </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
