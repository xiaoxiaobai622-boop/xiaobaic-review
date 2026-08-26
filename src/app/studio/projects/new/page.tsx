'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Eye, EyeOff, RefreshCw, Copy, Check, Plus, X, Calendar } from 'lucide-react'
import { apiPost } from '@/lib/api-client'
import { SharePasswordRequirements } from '@/components/SharePasswordRequirements'
import { ClientSelector } from '@/components/ClientSelector'
import { generateSecurePassword } from '@/lib/password-utils'
import { copyTextToClipboard } from '@/lib/clipboard'

export default function NewProjectPage() {
  const router = useRouter()
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const [loading, setLoading] = useState(false)
  const [isShareOnly, setIsShareOnly] = useState(false)
  const [passwordProtected, setPasswordProtected] = useState(true)
  const [sharePassword, setSharePassword] = useState('')
  const [showPassword, setShowPassword] = useState(true)
  const [copied, setCopied] = useState(false)

  // Authentication mode
  const authMode = 'PASSWORD' as const
  
  // Due date
  const [dueDate, setDueDate] = useState('')
  const [dueReminder, setDueReminder] = useState<'NONE' | 'DAY_BEFORE' | 'WEEK_BEFORE'>('NONE')

  // Client info
  const [companyName, setCompanyName] = useState('')
  const [clientCompanyId, setClientCompanyId] = useState<string | null>(null)
  const [recipientName, setRecipientName] = useState('')

  // Generate password on mount
  useEffect(() => {
    setSharePassword(generateSecurePassword())
  }, [])

  function handleGeneratePassword() {
    setSharePassword(generateSecurePassword())
    setCopied(false)
  }

  async function handleCopyPassword() {
    if (await copyTextToClipboard(sharePassword)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const isShareOnlyValue = formData.get('isShareOnly') === 'on'
    const data = {
      title: formData.get('title') as string,
      description: formData.get('description') as string,
      companyName: companyName || null,
      clientCompanyId: clientCompanyId,
      recipientName: recipientName || null,
      recipientEmail: null,
      sharePassword: passwordProtected ? sharePassword : '',
      authMode: passwordProtected ? authMode : 'NONE',
      isShareOnly: isShareOnlyValue,
      dueDate: dueDate ? `${dueDate}T12:00:00.000Z` : null,
      dueReminder: dueDate ? dueReminder : null,
    }

    try {
      const project = await apiPost('/api/projects', data)
      router.push(`/studio/projects/${project.id}`)
    } catch (error) {
      alert(t('failedToCreateProject'))
    } finally {
      setLoading(false)
    }
  }

  const needsPassword = passwordProtected

  return (
    <div className="flex-1 min-h-0 bg-background">
      <div className="max-w-screen-2xl mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-6">
        <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>{t('createNew')}</CardTitle>
            <CardDescription>{t('createDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="title">{t('titleLabel')}</Label>
                <Input
                  id="title"
                  name="title"
                  placeholder={t('titlePlaceholder')}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">{t('descriptionOptional')}</Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder={t('descriptionPlaceholder')}
                  rows={3}
                />
              </div>

              {/* Client Selection with Directory Search */}
              <ClientSelector
                companyName={companyName}
                onCompanyChange={(name, id) => {
                  setCompanyName(name)
                  setClientCompanyId(id)
                }}
                recipientName={recipientName}
                onRecipientNameChange={setRecipientName}
                recipientEmail=""
                onRecipientEmailChange={() => {}}
                hideEmail
                disabled={loading}
              />

              {/* Due Date */}
              <div className="space-y-3">
                <Label htmlFor="dueDate" className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  {t('dueDateOptional')}
                </Label>
                <div className="space-y-3">
                  <Input
                    id="dueDate"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                  {dueDate && (
                    <div className="space-y-2 pt-2 border-t border-border">
                      <Label htmlFor="dueReminder">{t('reminder')}</Label>
                      <Select value={dueReminder} onValueChange={(v) => setDueReminder(v as 'NONE' | 'DAY_BEFORE' | 'WEEK_BEFORE')}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NONE">{t('noReminder')}</SelectItem>
                          <SelectItem value="DAY_BEFORE">{t('dayBefore')}</SelectItem>
                          <SelectItem value="WEEK_BEFORE">{t('weekBefore')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {t('reminderHint')}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Authentication Section */}
              <div className="space-y-4 border rounded-lg p-4 bg-primary-visible border-2 border-primary-visible">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <Label htmlFor="passwordProtected" className="text-base font-semibold">
                      {t('requireAuthRecommended')}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t('requireAuthDescriptionLong')}
                    </p>
                  </div>
                  <input
                    id="passwordProtected"
                    type="checkbox"
                    checked={passwordProtected}
                    onChange={(e) => setPasswordProtected(e.target.checked)}
                    className="h-5 w-5 rounded border-border text-primary focus:ring-primary mt-1"
                  />
                </div>

                {passwordProtected && (
                  <div className="space-y-4 pt-2 border-t">
                    {/* Authentication Method Selection */}
                    <div className="space-y-2">
                      <Label>{t('authMethod')}</Label>
                      <p className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
                        {t('passwordOnly')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {authMode === 'PASSWORD' && t('passwordDescriptionLong')}

                      </p>

                    </div>

                    {/* Password Field (conditional) */}
                    {needsPassword && (
                      <div className="space-y-3">
                        <Label htmlFor="sharePassword">{t('sharePassword')}</Label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Input
                              id="sharePassword"
                              value={sharePassword}
                              onChange={(e) => setSharePassword(e.target.value)}
                              type={showPassword ? 'text' : 'password'}
                              className="pr-10 font-mono"
                              required={needsPassword}
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={handleGeneratePassword}
                            title={t('generatePassword')}
                          >
                            <RefreshCw className="w-4 h-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={handleCopyPassword}
                            title={t('copyPassword')}
                          >
                            {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                          </Button>
                        </div>
                        {sharePassword && (
                          <SharePasswordRequirements password={sharePassword} />
                        )}
                        <p className="text-xs text-muted-foreground">
                          {t('savePasswordWarningLong')}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {!passwordProtected && (
                  <div className="flex items-start gap-2 p-3 bg-warning-visible border-2 border-warning-visible rounded-md">
                    <span className="text-warning text-sm font-bold">!</span>
                    <p className="text-sm text-warning font-medium">
                      {t('noAuthWarningLong')}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-4 border-t pt-4">
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <input
                      id="isShareOnly"
                      name="isShareOnly"
                      type="checkbox"
                      checked={isShareOnly}
                      onChange={(e) => setIsShareOnly(e.target.checked)}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <Label htmlFor="isShareOnly" className="font-normal cursor-pointer">
                      {t('shareOnly')}
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">
                    {t('shareOnlyLong')}
                  </p>
                </div>
              </div>

              <div className="space-y-2 border-t pt-4">
                <p className="text-sm text-muted-foreground">
                  {t('additionalOptionsLong')}
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <Button type="submit" variant="default" size="lg" disabled={loading}>
                  <Plus className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">{loading ? tc('creating') : t('createProject')}</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => router.push('/studio/projects')}
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
    </div>
  )
}
