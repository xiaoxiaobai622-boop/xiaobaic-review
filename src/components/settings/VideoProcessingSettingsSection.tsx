import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { useTranslations } from 'next-intl'

interface VideoProcessingSettingsSectionProps {
  defaultPreviewResolution: string
  setDefaultPreviewResolution: (value: string) => void
  defaultSkipTranscoding: boolean
  setDefaultSkipTranscoding: (value: boolean) => void
  defaultApplyPreviewLut: boolean
  setDefaultApplyPreviewLut: (value: boolean) => void
  show: boolean
  setShow: (value: boolean) => void
  collapsible?: boolean
}

export function VideoProcessingSettingsSection({
  defaultPreviewResolution,
  setDefaultPreviewResolution,
  defaultSkipTranscoding,
  setDefaultSkipTranscoding,
  defaultApplyPreviewLut,
  setDefaultApplyPreviewLut,
  show,
  setShow,
  collapsible,
}: VideoProcessingSettingsSectionProps) {
  const t = useTranslations('settings')

  return (
    <CollapsibleSection
      className="border-border"
      title={t('videoProcessing.title')}
      description={t('videoProcessing.description')}
      open={show}
      onOpenChange={setShow}
      contentClassName="space-y-4 border-t pt-4"
      collapsible={collapsible}
    >
      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="defaultSkipTranscoding">{t('videoProcessing.skipTranscoding')}</Label>
            <p className="text-xs text-muted-foreground">{t('videoProcessing.skipTranscodingHint')}</p>
          </div>
          <Switch id="defaultSkipTranscoding" checked={defaultSkipTranscoding} onCheckedChange={(checked) => {
            setDefaultSkipTranscoding(checked)
            if (checked) {
              setDefaultApplyPreviewLut(false)
            }
          }} />
        </div>
        {defaultSkipTranscoding && (
          <p className="text-xs text-warning">{t('videoProcessing.skipTranscodingWarning')}</p>
        )}
      </div>

      {!defaultSkipTranscoding && (
      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
        <Label>{t('videoProcessing.previewResolution')}</Label>
        <Select value={defaultPreviewResolution} onValueChange={setDefaultPreviewResolution}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="720p">{t('videoProcessing.resolution720')}</SelectItem>
            <SelectItem value="1080p">{t('videoProcessing.resolution1080')}</SelectItem>
            <SelectItem value="2160p">{t('videoProcessing.resolution2160')}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t('videoProcessing.resolutionHint')}
        </p>
      </div>
      )}

      {!defaultSkipTranscoding && (
      <div className="space-y-3 border p-4 rounded-lg bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="defaultApplyPreviewLut">{t('videoProcessing.applyPreviewLut')}</Label>
            <p className="text-xs text-muted-foreground">{t('videoProcessing.applyPreviewLutHint')}</p>
          </div>
          <Switch id="defaultApplyPreviewLut" checked={defaultApplyPreviewLut} onCheckedChange={setDefaultApplyPreviewLut} />
        </div>
      </div>
      )}
    </CollapsibleSection>
  )
}
