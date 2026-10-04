'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { ArrowLeft, Calendar, FileText, Save, Share2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { ProjectOverlay } from '@/components/ProjectOverlay'
import { ReprocessModal } from '@/components/ReprocessModal'
import { RecipientManager } from '@/components/RecipientManager'
import { ScheduleSelector } from '@/components/ScheduleSelector'
import { CompanyNameInput } from '@/components/CompanyNameInput'
import { apiFetch, apiPatch, apiPost } from '@/lib/api-client'
import { logError } from '@/lib/logging'
import { cn } from '@/lib/utils'

interface Project {
  id: string
  title: string
  slug: string
  description: string | null
  companyName: string | null
  clientCompanyId: string | null
  enableRevisions: boolean
  maxRevisions: number
  restrictCommentsToLatestVersion: boolean
  hideFeedback: boolean
  canAdminister: boolean
  allowAssetDownload: boolean
  allowPhotoDownload: boolean
  allowClientAssetUpload: boolean
  allowReverseShare: boolean
  clientCanApprove: boolean
  showClientTutorial: boolean
  clientNotificationSchedule: string
  clientNotificationTime: string | null
  clientNotificationDay: number | null
  dueDate: string | null
  dueReminder: string | null
}

export type ProjectSettingsSection = 'project-details' | 'client-info' | 'client-share'

interface ProjectSettingsPanelProps {
  projectId: string
  /** page＝/settings 那条路由；overlay＝项目页里浮起来的那一层。两种外壳共用下面这一份内容。 */
  variant: 'page' | 'overlay'
  initialSection?: ProjectSettingsSection
  onClose?: () => void
}

export function ProjectSettingsPanel({ projectId, variant, initialSection = 'project-details', onClose }: ProjectSettingsPanelProps) {
  const router = useRouter()
  const t = useTranslations('projects')
  const tc = useTranslations('common')

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [clientCompanyId, setClientCompanyId] = useState<string | null>(null)
  const [enableRevisions, setEnableRevisions] = useState(false)
  const [maxRevisions, setMaxRevisions] = useState<number | ''>('')
  const [restrictCommentsToLatestVersion, setRestrictCommentsToLatestVersion] = useState(false)
  const [hideFeedback, setHideFeedback] = useState(false)
  const [allowAssetDownload, setAllowAssetDownload] = useState(true)
  const [allowPhotoDownload, setAllowPhotoDownload] = useState(true)
  const [allowClientAssetUpload, setAllowClientAssetUpload] = useState(false)
  const [allowReverseShare, setAllowReverseShare] = useState(false)
  const [clientCanApprove, setClientCanApprove] = useState(true)
  const [showClientTutorial, setShowClientTutorial] = useState(true)

  const [clientNotificationSchedule, setClientNotificationSchedule] = useState('HOURLY')
  const [clientNotificationTime, setClientNotificationTime] = useState('09:00')
  const [clientNotificationDay, setClientNotificationDay] = useState(1)

  const [dueDate, setDueDate] = useState('')
  const [dueReminder, setDueReminder] = useState<'NONE' | 'DAY_BEFORE' | 'WEEK_BEFORE'>('NONE')

  const [showProjectDetails, setShowProjectDetails] = useState(false)
  const [showClientInfo, setShowClientInfo] = useState(false)
  const [showClientSharePage, setShowClientSharePage] = useState(false)

  const [activeSection, setActiveSection] = useState<ProjectSettingsSection>(initialSection)

  const [originalTitle, setOriginalTitle] = useState('')

  const [showReprocessModal, setShowReprocessModal] = useState(false)
  const [pendingUpdates, setPendingUpdates] = useState<any>(null)
  const [reprocessing, setReprocessing] = useState(false)

  useEffect(() => {
    async function loadProject() {
      try {
        const response = await apiFetch(`/api/projects/${projectId}`)
        if (!response.ok) {
          throw new Error(t('failedToLoad'))
        }
        const data = await response.json()
        setProject(data)

        setTitle(data.title)
        setDescription(data.description || '')
        setCompanyName(data.companyName || '')
        setClientCompanyId(data.clientCompanyId || null)
        setEnableRevisions(data.enableRevisions)
        setMaxRevisions(data.maxRevisions)
        setRestrictCommentsToLatestVersion(data.restrictCommentsToLatestVersion)
        setHideFeedback(data.hideFeedback || false)
        setAllowAssetDownload(data.allowAssetDownload ?? true)
        setAllowPhotoDownload(data.allowPhotoDownload ?? true)
        setAllowClientAssetUpload(data.allowClientAssetUpload ?? false)
        setAllowReverseShare(data.allowReverseShare ?? false)
        setClientCanApprove(data.clientCanApprove ?? true)
        setShowClientTutorial(data.showClientTutorial ?? true)

        setOriginalTitle(data.title)

        if (data.dueDate) {
          const d = new Date(data.dueDate)
          setDueDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
        }
        setDueReminder(data.dueReminder || 'NONE')

        setClientNotificationSchedule(data.clientNotificationSchedule || 'HOURLY')
        setClientNotificationTime(data.clientNotificationTime || '09:00')
        setClientNotificationDay(data.clientNotificationDay ?? 1)
      } catch (err) {
        setError(t('failedToLoadSettings'))
      } finally {
        setLoading(false)
      }
    }

    loadProject()
  }, [projectId, t])

  // PATCH /api/projects/[id] requires project-admin rights; a plain team member
  // could open this page and press 保存 into a bare 403.
  const canSave = project?.canAdminister !== false

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setError('')
    setSuccess(false)

    try {
      const finalMaxRevisions = typeof maxRevisions === 'number' ? maxRevisions : parseInt(String(maxRevisions), 10) || 1

      if (enableRevisions && finalMaxRevisions < 1) {
        setError(t('maxRevisionsMinError'))
        setSaving(false)
        return
      }

      const updates: any = {
        title,
        description: description || null,
        companyName: companyName || null,
        clientCompanyId: clientCompanyId || null,
        enableRevisions,
        maxRevisions: enableRevisions ? finalMaxRevisions : 0,
        restrictCommentsToLatestVersion,
        hideFeedback,
        allowAssetDownload,
        allowPhotoDownload,
        allowClientAssetUpload,
        allowReverseShare,
        clientCanApprove,
        showClientTutorial,
        clientNotificationSchedule,
        clientNotificationTime: (clientNotificationSchedule === 'DAILY' || clientNotificationSchedule === 'WEEKLY') ? clientNotificationTime : null,
        clientNotificationDay: clientNotificationSchedule === 'WEEKLY' ? clientNotificationDay : null,
        dueDate: dueDate ? `${dueDate}T12:00:00.000Z` : null,
        dueReminder: dueDate ? dueReminder : null,
      }

      const titleChanged = title !== originalTitle

      if (titleChanged) {
        setPendingUpdates(updates)
        setShowReprocessModal(true)
        setSaving(false)
        return
      }

      await saveSettings(updates)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToSave'))
      setSaving(false)
    }
  }

  async function saveSettings(updates: any, shouldReprocess = false) {
    setSaving(true)
    setError('')

    try {
      await apiPatch(`/api/projects/${projectId}`, updates)

      if (shouldReprocess) {
        await reprocessVideos()
      }

      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)

      const refreshResponse = await apiFetch(`/api/projects/${projectId}`)
      if (refreshResponse.ok) {
        const refreshedData = await refreshResponse.json()
        setProject(refreshedData)

        setOriginalTitle(refreshedData.title)
      }

      router.refresh()

      setShowReprocessModal(false)
      setPendingUpdates(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToSave'))
    } finally {
      setSaving(false)
    }
  }

  async function reprocessVideos() {
    setReprocessing(true)
    try {
      await apiPost(`/api/projects/${projectId}/reprocess`, { confirm: true })
    } catch (err) {
      logError('Error reprocessing videos:', err)
      // Don't throw - we still want to save settings
    } finally {
      setReprocessing(false)
    }
  }

  const settingSections: { id: ProjectSettingsSection; label: string; icon: typeof FileText }[] = [
    { id: 'project-details', label: t('projectDetails'), icon: FileText },
    { id: 'client-info', label: t('clientInfoNotifications'), icon: Users },
    { id: 'client-share', label: t('clientSharePage'), icon: Share2 },
  ]

  const projectDetailsContent = (
    <>
      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
        <div className="space-y-2">
          <Label htmlFor="title">{t('titleLabel')}</Label>
          <Input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('titlePlaceholderShort')}
          />
          <p className="text-xs text-muted-foreground">
            {t('titleHint')}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">{t('descriptionLabel')}</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('descriptionPlaceholderShort')}
            rows={3}
          />
          <p className="text-xs text-muted-foreground">
            {t('descriptionHint')}
          </p>
        </div>
      </div>

      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5 flex-1">
            <Label htmlFor="enableRevisions">{t('enableRevisionTracking')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('enableRevisionTrackingDescription')}
            </p>
          </div>
          <Switch
            id="enableRevisions"
            checked={enableRevisions}
            onCheckedChange={setEnableRevisions}
          />
        </div>

        {enableRevisions && (
          <div className="space-y-2">
            <Label htmlFor="maxRevisions">{t('maxRevisions')}</Label>
            <Input
              id="maxRevisions"
              type="number"
              min="1"
              max="20"
              value={maxRevisions}
              onChange={(e) => {
                const val = e.target.value
                if (val === '') {
                  setMaxRevisions('')
                } else {
                  const num = parseInt(val, 10)
                  if (!isNaN(num)) setMaxRevisions(num)
                }
              }}
              onBlur={(e) => {
                const val = e.target.value
                if (val === '') {
                  setMaxRevisions(1)
                } else {
                  const num = parseInt(val, 10)
                  if (isNaN(num) || num < 1) setMaxRevisions(1)
                  else if (num > 20) setMaxRevisions(20)
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              {t('maxRevisionsHint')}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
        <Label htmlFor="dueDate" className="flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          {t('dueDateLabel')}
        </Label>
        <div className="space-y-3">
          <Input
            id="dueDate"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t('dueDateHint')}
          </p>

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

          {dueDate && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => { setDueDate(''); setDueReminder('NONE') }}
            >
              {t('clearDueDate')}
            </Button>
          )}
        </div>
      </div>
    </>
  )

  const clientInfoContent = (
    <>
      {/* Company/Brand Selection */}
      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
        <div className="space-y-2">
          <Label htmlFor="companyName">{t('companyBrandName')}</Label>
          <CompanyNameInput
            value={companyName}
            selectedId={clientCompanyId}
            onChange={(name, id) => {
              setCompanyName(name)
              setClientCompanyId(id)
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t('companyBrandNameHint')}
          </p>
        </div>
      </div>

      {/* Recipients */}
      <div className="space-y-3">
        <RecipientManager
          projectId={projectId}
          companyId={clientCompanyId}
          onError={setError}
        />
      </div>

      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
        <ScheduleSelector
          schedule={clientNotificationSchedule}
          time={clientNotificationTime}
          day={clientNotificationDay}
          onScheduleChange={setClientNotificationSchedule}
          onTimeChange={setClientNotificationTime}
          onDayChange={setClientNotificationDay}
          label={t('clientNotificationSchedule')}
          description={t('clientNotificationScheduleDescription')}
        />
      </div>
    </>
  )

  const clientShareContent = (
    <>
      {/* ── Approval & Workflow ─────────────────────────────────── */}
      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5 flex-1">
            <Label htmlFor="clientCanApprove">{t('allowClientApproval')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('allowClientApprovalDescription')}
            </p>
          </div>
          <Switch
            id="clientCanApprove"
            checked={clientCanApprove}
            onCheckedChange={setClientCanApprove}
          />
        </div>
      </div>

      {/* ── Client Access ────────────────────────────────────────── */}
      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5 flex-1">
            <Label htmlFor="allowAssetDownload">{t('allowAssetDownloads')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('allowAssetDownloadsDescription')}
            </p>
          </div>
          <Switch
            id="allowAssetDownload"
            checked={allowAssetDownload}
            onCheckedChange={setAllowAssetDownload}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5 flex-1">
            <Label htmlFor="allowPhotoDownload">{t('allowPhotoDownloads')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('allowPhotoDownloadsDescription')}
            </p>
          </div>
          <Switch
            id="allowPhotoDownload"
            checked={allowPhotoDownload}
            onCheckedChange={setAllowPhotoDownload}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5 flex-1">
            <Label htmlFor="allowClientAssetUpload">{t('allowClientFileAttachments')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('allowClientFileAttachmentsDescription')}
            </p>
          </div>
          <Switch
            id="allowClientAssetUpload"
            checked={allowClientAssetUpload}
            onCheckedChange={setAllowClientAssetUpload}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5 flex-1">
            <Label htmlFor="allowReverseShare">{t('allowReverseShare')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('allowReverseShareDescription')}
            </p>
          </div>
          <Switch
            id="allowReverseShare"
            checked={allowReverseShare}
            onCheckedChange={setAllowReverseShare}
          />
        </div>
      </div>

      {/* ── Presentation ─────────────────────────────────────────── */}
      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5 flex-1">
            <Label htmlFor="showClientTutorial">{t('showClientTutorial')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('showClientTutorialDescription')}
            </p>
          </div>
          <Switch
            id="showClientTutorial"
            checked={showClientTutorial}
            onCheckedChange={setShowClientTutorial}
          />
        </div>

        <div className="flex items-center justify-between gap-4 pt-2 mt-1 border-t border-border">
          <div className="space-y-0.5 flex-1">
            <Label htmlFor="hideFeedback">{t('hideFeedbackSection')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('hideFeedbackSectionDescription')}
            </p>
          </div>
          <Switch
            id="hideFeedback"
            checked={hideFeedback}
            onCheckedChange={setHideFeedback}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5 flex-1">
            <Label htmlFor="restrictComments">{t('restrictCommentsLatest')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('restrictCommentsLatestDescription')}
            </p>
          </div>
          <Switch
            id="restrictComments"
            checked={restrictCommentsToLatestVersion}
            onCheckedChange={setRestrictCommentsToLatestVersion}
          />
        </div>
      </div>
    </>
  )

  // Section content blocks (shared between mobile and desktop layouts)
  const sectionsMarkup = (
    <>
      {/* Mobile: stacked collapsible cards */}
      <div className="lg:hidden space-y-4 sm:space-y-6">
        <CollapsibleSection className="border-border" title={t('projectDetails')} description={t('projectDetailsDescription')} open={showProjectDetails} onOpenChange={setShowProjectDetails} contentClassName="space-y-4 border-t pt-4">
          {projectDetailsContent}
        </CollapsibleSection>
        <CollapsibleSection className="border-border" title={t('clientInfoNotifications')} description={t('clientInfoNotificationsDescription')} open={showClientInfo} onOpenChange={setShowClientInfo} contentClassName="space-y-6 border-t pt-4">
          {clientInfoContent}
        </CollapsibleSection>
        <CollapsibleSection className="border-border" title={t('clientSharePage')} description={t('clientSharePageDescription')} open={showClientSharePage} onOpenChange={setShowClientSharePage} contentClassName="space-y-6 border-t pt-4">
          {clientShareContent}
        </CollapsibleSection>
      </div>

      {/* Desktop: sidebar nav + content panel */}
      <div className="hidden lg:flex gap-6">
        <div className="w-56 flex-shrink-0">
          <nav className="space-y-1 sticky top-6">
            {settingSections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  'w-full text-left px-3 py-2.5 rounded-md text-sm flex items-center gap-2.5 transition-colors',
                  activeSection === section.id
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                )}
              >
                <section.icon className="w-4 h-4 flex-shrink-0" />
                {section.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 min-w-0">
          {activeSection === 'project-details' && (
            <CollapsibleSection className="border-border" title={t('projectDetails')} description={t('projectDetailsDescription')} open={true} onOpenChange={() => {}} collapsible={false} contentClassName="space-y-4 border-t pt-4">
              {projectDetailsContent}
            </CollapsibleSection>
          )}
          {activeSection === 'client-info' && (
            <CollapsibleSection className="border-border" title={t('clientInfoNotifications')} description={t('clientInfoNotificationsDescription')} open={true} onOpenChange={() => {}} collapsible={false} contentClassName="space-y-6 border-t pt-4">
              {clientInfoContent}
            </CollapsibleSection>
          )}
          {activeSection === 'client-share' && (
            <CollapsibleSection className="border-border" title={t('clientSharePage')} description={t('clientSharePageDescription')} open={true} onOpenChange={() => {}} collapsible={false} contentClassName="space-y-6 border-t pt-4">
              {clientShareContent}
            </CollapsibleSection>
          )}
        </div>
      </div>
    </>
  )

  const banners = (
    <>
      {!canSave && (
        <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-muted border-2 border-border rounded-lg">
          <p className="text-xs sm:text-sm text-muted-foreground">{t('settingsReadOnlyForMembers')}</p>
        </div>
      )}

      {error && (
        <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-destructive-visible border-2 border-destructive-visible rounded-lg">
          <p className="text-xs sm:text-sm text-destructive font-medium">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-success-visible border-2 border-success-visible rounded-lg">
          <p className="text-xs sm:text-sm text-success font-medium">{t('settingsSaved')}</p>
        </div>
      )}
    </>
  )

  const reprocessModal = (
    <ReprocessModal
      show={showReprocessModal}
      onCancel={() => {
        setShowReprocessModal(false)
        setPendingUpdates(null)
        setSaving(false)
      }}
      onSaveWithoutReprocess={() => saveSettings(pendingUpdates, false)}
      onSaveAndReprocess={() => saveSettings(pendingUpdates, true)}
      saving={saving}
      reprocessing={reprocessing}
    />
  )

  const saveButton = (
    <Button onClick={handleSave} variant="default" disabled={saving || !canSave} size="lg" className="h-11 w-full sm:w-auto">
      <Save className="w-4 h-4 mr-2" />
      {saving ? tc('saving') : tc('saveChanges')}
    </Button>
  )

  if (loading) {
    return (
      <div className="flex-1 min-h-0 bg-background flex items-center justify-center">
        <p className="text-muted-foreground">{tc('loading')}</p>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex-1 min-h-0 bg-background flex items-center justify-center">
        <p className="text-muted-foreground">{t('projectNotFound')}</p>
      </div>
    )
  }

  if (variant === 'overlay') {
    return (
      <ProjectOverlay
        tutorial="project-settings"
        title={t('projectSettings')}
        subtitle={project.title}
        actions={saveButton}
        onClose={onClose}
        confirmModalOpen={showReprocessModal}
      >
        <div className="px-3 py-3 sm:px-4 sm:py-4 lg:px-6">
          {banners}
          {sectionsMarkup}
        </div>
        {reprocessModal}
      </ProjectOverlay>
    )
  }

  return (
    <div className="flex-1 min-h-0 bg-background">
      <div className="max-w-screen-2xl mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-6">
        <div className="mb-4 sm:mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <Link href={`/studio/projects/${projectId}`}>
                <Button variant="outline" size="default" className="h-11 justify-start px-3">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  <span className="hidden sm:inline">{t('backToProject')}</span>
                  <span className="sm:hidden">{tc('back')}</span>
                </Button>
              </Link>
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold">{t('projectSettings')}</h1>
                <p className="text-sm sm:text-base text-muted-foreground mt-1 truncate">{project.title}</p>
              </div>
            </div>

            {saveButton}
          </div>
        </div>

        {banners}

        {sectionsMarkup}

        {reprocessModal}
      </div>
    </div>
  )
}
