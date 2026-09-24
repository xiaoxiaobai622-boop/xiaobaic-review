import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { ScheduleSelector } from '@/components/ScheduleSelector'
import { Send, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

const SMTP_SECURE_MODES = [
  { value: 'STARTTLS', labelKey: 'starttls', hintKey: 'starttlsHint', hintClassName: 'text-muted-foreground' },
  { value: 'TLS', labelKey: 'tls', hintKey: 'tlsHint', hintClassName: 'text-muted-foreground' },
  { value: 'NONE', labelKey: 'noEncryption', hintKey: 'noEncryptionHint', hintClassName: 'text-destructive' },
] as const

export interface EmailSettingsContentProps {
  // SMTP Settings
  smtpServer: string
  setSmtpServer: (value: string) => void
  smtpPort: string
  setSmtpPort: (value: string) => void
  smtpUsername: string
  setSmtpUsername: (value: string) => void
  smtpPassword: string
  setSmtpPassword: (value: string) => void
  smtpFromAddress: string
  setSmtpFromAddress: (value: string) => void
  smtpSecure: string
  setSmtpSecure: (value: string) => void

  // Test Email
  testEmailAddress: string
  setTestEmailAddress: (value: string) => void
  testEmailSending: boolean
  testEmailResult: { type: 'success' | 'error'; message: string } | null
  handleTestEmail: () => void

  // Admin Notifications
  adminNotificationSchedule: string
  setAdminNotificationSchedule: (value: string) => void
  adminNotificationTime: string
  setAdminNotificationTime: (value: string) => void
  adminNotificationDay: number
  setAdminNotificationDay: (value: number) => void
}

export function EmailSettingsContent({
  smtpServer,
  setSmtpServer,
  smtpPort,
  setSmtpPort,
  smtpUsername,
  setSmtpUsername,
  smtpPassword,
  setSmtpPassword,
  smtpFromAddress,
  setSmtpFromAddress,
  smtpSecure,
  setSmtpSecure,
  testEmailAddress,
  setTestEmailAddress,
  testEmailSending,
  testEmailResult,
  handleTestEmail,
  adminNotificationSchedule,
  setAdminNotificationSchedule,
  adminNotificationTime,
  setAdminNotificationTime,
  adminNotificationDay,
  setAdminNotificationDay,
}: EmailSettingsContentProps) {
  const t = useTranslations('settings')
  return (
    <div className="space-y-4">
      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
          <Label className="text-base">{t('email.smtpConfig')}</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="smtpServer">{t('email.smtpServer')}</Label>
            <Input
              id="smtpServer"
              type="text"
              value={smtpServer}
              onChange={(e) => setSmtpServer(e.target.value)}
              placeholder={t('email.smtpServerPlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtpPort">{t('email.port')}</Label>
            <Input
              id="smtpPort"
              type="number"
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              placeholder={t('email.portPlaceholder')}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="smtpFromAddress">{t('email.fromEmail')}</Label>
          <Input
            id="smtpFromAddress"
            type="email"
            value={smtpFromAddress}
            onChange={(e) => setSmtpFromAddress(e.target.value)}
            placeholder={t('email.fromEmailPlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <Label>{t('email.security')}</Label>
          <div className="space-y-3 p-4 bg-muted/50 rounded-md border border-border">
            {SMTP_SECURE_MODES.map((mode) => (
              <label key={mode.value} className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="radio"
                  name="smtpSecure"
                  value={mode.value}
                  checked={smtpSecure === mode.value}
                  onChange={(e) => setSmtpSecure(e.target.value)}
                  className="mt-1 h-4 w-4 text-primary focus:ring-primary"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm group-hover:text-primary transition-colors">
                    {t(`email.${mode.labelKey}`)}
                  </div>
                  <div className={`text-xs ${mode.hintClassName} mt-1`}>
                    {t(`email.${mode.hintKey}`)}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="smtpUsername">{t('email.smtpUsername')}</Label>
          <Input
            id="smtpUsername"
            type="text"
            value={smtpUsername}
            onChange={(e) => setSmtpUsername(e.target.value)}
            placeholder={t('email.smtpUsernamePlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="smtpPassword">{t('email.smtpPassword')}</Label>
          <PasswordInput
            id="smtpPassword"
            value={smtpPassword}
            onChange={(e) => setSmtpPassword(e.target.value)}
            placeholder={t('email.smtpPasswordPlaceholder')}
            showToggle={false}
          />
          <p className="text-xs text-muted-foreground">
            {t('email.smtpPasswordHint')}
          </p>
        </div>
        </div>

      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
          <Label className="text-base">{t('email.testConfig')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('email.testConfigHint')}
          </p>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="testEmailAddress">{t('email.testEmail')}</Label>
              <Input
                id="testEmailAddress"
                type="email"
                value={testEmailAddress}
                onChange={(e) => setTestEmailAddress(e.target.value)}
                placeholder={t('email.testEmailPlaceholder')}
              />
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleTestEmail}
              disabled={testEmailSending || !testEmailAddress}
              className="w-full"
              size="default"
            >
              {testEmailSending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t('email.sendingTest')}
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  {t('email.sendTest')}
                </>
              )}
            </Button>

            {testEmailResult && (
              <div className={`p-3 rounded-lg text-xs sm:text-sm font-medium ${
                testEmailResult.type === 'success'
                  ? 'bg-success-visible text-success border-2 border-success-visible'
                  : 'bg-destructive-visible text-destructive border-2 border-destructive-visible'
              }`}>
                {testEmailResult.message}
              </div>
            )}
          </div>
        </div>

      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
          <ScheduleSelector
            schedule={adminNotificationSchedule}
            time={adminNotificationTime}
            day={adminNotificationDay}
            onScheduleChange={setAdminNotificationSchedule}
            onTimeChange={setAdminNotificationTime}
            onDayChange={setAdminNotificationDay}
            label={t('email.adminSchedule')}
            description={t('email.adminScheduleHint')}
          />
        </div>
    </div>
  )
}
