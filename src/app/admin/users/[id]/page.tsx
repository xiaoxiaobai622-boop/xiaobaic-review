'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { X, Save, RefreshCw, Eye, EyeOff, Copy, Check, Fingerprint, Plus, Trash2, UserCog, KeyRound } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PasswordRequirements } from '@/components/PasswordRequirements'
import { apiPatch, apiPost, apiDelete, apiFetch } from '@/lib/api-client'
import { startRegistration } from '@simplewebauthn/browser'
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import { useTranslations } from 'next-intl'
import { logError } from '@/lib/logging'
import { copyTextToClipboard } from '@/lib/clipboard'

export default function EditUserPage() {
  const t = useTranslations('users')
  const tc = useTranslations('common')
  const router = useRouter()
  const params = useParams()
  const userId = params?.id as string
  const [returnUrl, setReturnUrl] = useState('/admin/users')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [loggedInUser, setLoggedInUser] = useState<any>(null)
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    name: '',
  })

  // Password modal state
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [copied, setCopied] = useState(false)
  const [passwordData, setPasswordData] = useState({
    oldPassword: '',
    password: '',
    confirmPassword: '',
  })
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  // PassKey modal state
  const [showPasskeyModal, setShowPasskeyModal] = useState(false)
  const [passkeyAvailable, setPasskeyAvailable] = useState(false)
  const [passkeyReason, setPasskeyReason] = useState('')
  const [passkeys, setPasskeys] = useState<any[]>([])
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [passkeyError, setPasskeyError] = useState('')

  useEffect(() => {
    const requestedReturnUrl = new URLSearchParams(window.location.search).get('returnUrl')
    if (requestedReturnUrl?.startsWith('/') && !requestedReturnUrl.startsWith('//')) {
      setReturnUrl(requestedReturnUrl)
    }
  }, [])

  const fetchUser = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/users/${userId}`)
      if (!res.ok) throw new Error('Failed to fetch user')
      const data = await res.json()
      setCurrentUser(data.user)
      setFormData({
        email: data.user.email,
        username: data.user.username || '',
        name: data.user.name || '',
      })
    } catch (err: any) {
      setError(err.message)
    }
  }, [userId])

  const fetchLoggedInUser = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth/session')
      if (res.ok) {
        const data = await res.json()
        setLoggedInUser(data.user)
      }
    } catch (err) {
      // Silently fail
    }
  }, [])

  const fetchPasskeyStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth/passkey/status')
      if (res.ok) {
        const data = await res.json()
        setPasskeyAvailable(data.available)
        setPasskeyReason(data.reason || '')
      }
    } catch (err) {
      // Silently fail - passkey is optional
    }
  }, [])

  const fetchPasskeys = useCallback(async () => {
    if (!userId) return
    
    try {
      const res = await apiFetch(`/api/auth/passkey/list?userId=${userId}`)
      if (res.ok) {
        const data = await res.json()
        setPasskeys(data.passkeys || [])
      }
    } catch (err) {
      // Silently fail
    }
  }, [userId])

  useEffect(() => {
    fetchUser()
    fetchLoggedInUser()
    fetchPasskeyStatus()
    fetchPasskeys()
  }, [fetchUser, fetchLoggedInUser, fetchPasskeyStatus, fetchPasskeys])

  const handleRegisterPasskey = async () => {
    setPasskeyError('')
    setPasskeyLoading(true)

    try {
      // Get registration options
      const options: PublicKeyCredentialCreationOptionsJSON = await apiPost('/api/auth/passkey/register/options', {})

      // Start WebAuthn ceremony
      const attestation = await startRegistration({ optionsJSON: options })

      // Verify registration
      await apiPost('/api/auth/passkey/register/verify', attestation)

      // Refresh passkey list
      await fetchPasskeys()
    } catch (err: any) {
      logError('[PASSKEY] Registration error:', err)

      if (err.name === 'NotAllowedError') {
        setPasskeyError(t('cancelledOrTimedOut'))
      } else if (err.name === 'InvalidStateError') {
        setPasskeyError(t('alreadyRegistered'))
      } else {
        setPasskeyError(t('failedToRegisterPasskeyConfig'))
      }
    } finally {
      setPasskeyLoading(false)
    }
  }

  const handleDeletePasskey = async (id: string) => {
    if (!confirm(t('deletePasskeyConfirm'))) return

    setPasskeyError('')
    try {
      await apiDelete(`/api/auth/passkey/${id}?userId=${userId}`)
      await fetchPasskeys()
    } catch (err: any) {
      setPasskeyError(err.message)
    }
  }

  const generateRandomPassword = () => {
    const values = new Uint32Array(6)
    crypto.getRandomValues(values)
    const password = Array.from(values, value => String(value % 10)).join('')

    setPasswordData({
      ...passwordData,
      password,
      confirmPassword: password,
    })

    setShowPassword(true)
    setShowConfirmPassword(true)
  }

  const copyPassword = async () => {
    if (passwordData.password && await copyTextToClipboard(passwordData.password)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handlePasswordSubmit = async () => {
    setPasswordError('')

    if (passwordData.password !== passwordData.confirmPassword) {
      setPasswordError(t('passwordsDoNotMatch'))
      return
    }

    if (!/^\d{6}$/.test(passwordData.password)) {
      setPasswordError('密码必须是 6 位数字')
      return
    }

    if (!passwordData.oldPassword) {
      setPasswordError(t('currentPasswordRequired'))
      return
    }

    setPasswordLoading(true)

    try {
      await apiPatch(`/api/users/${userId}`, {
        oldPassword: passwordData.oldPassword,
        password: passwordData.password,
      })

      setShowPasswordModal(false)
      setPasswordData({ oldPassword: '', password: '', confirmPassword: '' })
      alert(t('passwordChangedSuccess'))
    } catch (err: any) {
      setPasswordError(err.message)
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await apiPatch(`/api/users/${userId}`, {
        email: formData.email,
        username: formData.username || null,
        name: formData.name || null,
      })

      router.push(returnUrl)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="max-w-screen-2xl mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-4 sm:mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
                  <UserCog className="w-7 h-7 sm:w-8 sm:h-8" />
                  {t('editUserTitle')}
                </h1>
                <p className="text-sm sm:text-base text-muted-foreground mt-1">{t('updateAccountDetails')}</p>
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
                  <Label htmlFor="email">{t('emailRequired')}</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
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

                {/* Action Buttons for Password and Passkeys */}
                <div className="border-t pt-4 mt-4 space-y-3">
                  {loggedInUser && currentUser && loggedInUser.id === currentUser.id && (
                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      className="w-full justify-start"
                      onClick={() => setShowPasswordModal(true)}
                    >
                      <KeyRound className="w-4 h-4 mr-2" />
                      {t('changePasswordTitle')}
                    </Button>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    className="w-full justify-start"
                    onClick={() => setShowPasskeyModal(true)}
                    disabled={!passkeyAvailable}
                    title={!passkeyAvailable ? passkeyReason : undefined}
                  >
                    <Fingerprint className="w-4 h-4 mr-2" />
                    {t('managePasskeys')}
                    {passkeys.length > 0 && (
                      <span className="ml-auto text-xs text-muted-foreground">({passkeys.length})</span>
                    )}
                  </Button>
                  {!passkeyAvailable && (
                    <p className="text-xs text-muted-foreground px-1">{passkeyReason}</p>
                  )}
                </div>

                <div className="flex gap-3 pt-4">
                  <Button type="submit" variant="default" size="default" disabled={loading}>
                    <Save className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">{loading ? tc('saving') : tc('saveChanges')}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    onClick={() => router.push(returnUrl)}
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

      {/* Change Password Modal */}
      <Dialog open={showPasswordModal} onOpenChange={setShowPasswordModal}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" />
              {t('changePasswordTitle')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {passwordError && (
              <div className="bg-destructive-visible border-2 border-destructive-visible text-destructive font-medium px-3 py-2 rounded text-sm">
                {passwordError}
              </div>
            )}

            <div className="flex justify-end">
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

            <div className="space-y-2">
              <Label htmlFor="oldPassword">{t('currentPassword')}</Label>
              <Input
                id="oldPassword"
                type="password"
                value={passwordData.oldPassword}
                onChange={(e) => setPasswordData({ ...passwordData, oldPassword: e.target.value })}
                placeholder={t('required')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t('newPassword')}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={passwordData.password}
                  onChange={(e) => setPasswordData({ ...passwordData, password: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                  inputMode="numeric"
                  maxLength={6}
                  className="pr-20"
                />
                <div className="absolute inset-y-0 right-0 flex items-center gap-1 pr-2">
                  {passwordData.password && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={copyPassword}
                      className="h-7 w-7 p-0"
                      title={t('copyPassword')}
                    >
                      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowPassword(!showPassword)}
                    className="h-7 w-7 p-0"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              {passwordData.password && (
                <PasswordRequirements password={passwordData.password} className="mt-2" />
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t('confirmNewPassword')}</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                  inputMode="numeric"
                  maxLength={6}
                  className="pr-10"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="h-7 w-7 p-0"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              {passwordData.password && passwordData.confirmPassword && passwordData.password !== passwordData.confirmPassword && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <X className="w-4 h-4" /> {t('passwordsDoNotMatch')}
                </p>
              )}
              {passwordData.password && passwordData.confirmPassword && passwordData.password === passwordData.confirmPassword && passwordData.password.length > 0 && (
                <p className="text-sm text-success flex items-center gap-1">
                  <Check className="w-4 h-4" /> {t('passwordsMatch')}
                </p>
              )}
            </div>

            <Button
              onClick={handlePasswordSubmit}
              disabled={passwordLoading || !passwordData.oldPassword || !passwordData.password || passwordData.password !== passwordData.confirmPassword}
              className="w-full"
            >
              {passwordLoading ? t('changing') : t('changePasswordTitle')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage Passkeys Modal */}
      <Dialog open={showPasskeyModal} onOpenChange={setShowPasskeyModal}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Fingerprint className="w-5 h-5 text-primary" />
              {t('managePasskeys')}
            </DialogTitle>
            {currentUser && (
              <p className="text-sm text-muted-foreground pt-1">
                {currentUser.name || currentUser.email}
              </p>
            )}
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('passkeysInfo')}
            </p>

            {passkeyError && (
              <div className="bg-destructive-visible border-2 border-destructive-visible text-destructive font-medium px-3 py-2 rounded text-sm">
                {passkeyError}
              </div>
            )}

            <div className="flex items-center justify-between bg-muted p-3 rounded">
              <div className="text-sm">
                <p className="font-medium">
                  {passkeys.length === 0 ? t('noPasskeys') : t('passkeyCount', { count: passkeys.length })}
                </p>
              </div>
              {loggedInUser && currentUser && loggedInUser.id === currentUser.id && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRegisterPasskey}
                  disabled={passkeyLoading}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  {tc('add')}
                </Button>
              )}
            </div>

            {passkeys.length > 0 && (
              <div className="space-y-2">
                {passkeys.map((pk: any) => (
                  <div key={pk.id} className="flex items-center justify-between bg-card border p-3 rounded">
                    <div className="text-sm">
                      <p className="font-medium">{pk.credentialName || t('unnamedPasskey')}</p>
                      <p className="text-xs text-muted-foreground">
                        {pk.deviceType === 'multiDevice' ? t('multiDevice') : t('singleDevice')} •
                        {t('added', { date: new Date(pk.lastUsedAt).toLocaleDateString() })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeletePasskey(pk.id)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
