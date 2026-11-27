'use client'
/* eslint-disable @next/next/no-img-element -- 预览可能是本地 blob URL；封面已由服务端转成 WebP，不走 next/image */

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslations } from 'next-intl'
import { ImagePlus, Lock } from 'lucide-react'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { apiFetch, apiPatch } from '@/lib/api-client'
import { logError } from '@/lib/logging'
import type { ProjectListItem } from '@/lib/projects-filter'

interface ProjectSettingsDialogProps {
  project: ProjectListItem
  art: { a: string; b: string }
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

const MAX_COVER_BYTES = 8 * 1024 * 1024
const COVER_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export default function ProjectSettingsDialog({
  project, art, open, onOpenChange, onSaved,
}: ProjectSettingsDialogProps) {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const [title, setTitle] = useState(project.title)
  const [restricted, setRestricted] = useState(Boolean(project.restricted))
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(project.coverImageUrl ?? null)
  const [previewError, setPreviewError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle(project.title)
    setRestricted(Boolean(project.restricted))
    setCoverFile(null)
    setPreview(project.coverImageUrl ?? null)
    setPreviewError(false)
    setError('')
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [open, project.id, project.title, project.restricted, project.coverImageUrl])

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  function pickCover() {
    fileInputRef.current?.click()
  }

  function handleCoverFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!COVER_TYPES.includes(file.type)) {
      setError(t('coverInvalidType'))
      return
    }
    if (file.size > MAX_COVER_BYTES) {
      setError(t('coverTooLarge'))
      return
    }
    setError('')
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setCoverFile(file)
    setPreview(url)
    setPreviewError(false)
  }

  async function handleSave() {
    const nextTitle = title.trim()
    if (!nextTitle) return
    setSaving(true)
    setError('')
    try {
      if (coverFile) {
        const upload = await apiFetch(`/api/projects/${project.id}/cover`, {
          method: 'POST',
          headers: { 'content-type': coverFile.type },
          body: coverFile,
        })
        if (!upload.ok) {
          const data = await upload.json().catch(() => null)
          throw new Error(data?.error || t('coverUploadFailed'))
        }
      }
      await apiPatch(`/api/projects/${project.id}`, { title: nextTitle, restricted })
      onSaved()
      onOpenChange(false)
    } catch (err) {
      logError('Failed to save project settings:', err)
      setError(err instanceof Error ? err.message : t('operationFailed'))
    } finally {
      setSaving(false)
    }
  }

  const showImage = Boolean(preview) && !previewError

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader className="border-b pb-4">
          <DialogTitle>{t('projectSettings')}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 py-2 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] md:gap-8">
          <div className="min-w-0">
            <div className="relative aspect-video overflow-hidden rounded-[14px] border border-border bg-muted">
              {showImage ? (
                <img
                  src={preview as string}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-cover"
                  onError={() => setPreviewError(true)}
                />
              ) : (
                <div
                  data-project-art
                  aria-hidden="true"
                  className="absolute inset-0"
                  style={{ '--art-a': art.a, '--art-b': art.b } as CSSProperties}
                >
                  <i className="art-l1" />
                  <i className="art-l2" />
                  <i className="art-l3" />
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleCoverFile}
              />
              <button
                type="button"
                onClick={pickCover}
                disabled={saving}
                aria-label={t('changeCover')}
                title={t('changeCover')}
                className="absolute left-1/2 top-1/2 z-10 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <ImagePlus className="h-5 w-5" aria-hidden />
              </button>
              {restricted && (
                <span
                  data-project-badge="lock"
                  className="absolute right-3 top-3 z-10"
                  title={t('restrictedProject')}
                  aria-label={t('restrictedProject')}
                >
                  <Lock className="h-[14px] w-[14px]" aria-hidden />
                </span>
              )}
              <div className="absolute inset-x-3 bottom-3 z-10">
                <Label htmlFor="project-settings-title" className="sr-only">{t('titleLabel')}</Label>
                <Input
                  id="project-settings-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={200}
                  placeholder={t('titlePlaceholderShort')}
                  disabled={saving}
                  className="bg-background/95 text-foreground shadow-sm"
                />
              </div>
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">{t('coverHint')}</p>
          </div>

          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t('access')}</h3>
            <div className="mt-3 rounded-xl bg-muted/60 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <Lock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                  <div className="space-y-1">
                    <Label htmlFor="project-settings-restricted" className="text-sm font-semibold">
                      {t('restrictTitle')}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {restricted ? t('restrictOnDescription') : t('restrictOffDescription')}
                    </p>
                  </div>
                </div>
                <Switch
                  id="project-settings-restricted"
                  checked={restricted}
                  onCheckedChange={setRestricted}
                  disabled={saving}
                />
              </div>
            </div>
          </div>
        </div>

        {error && <p className="text-[12.5px] text-destructive">{error}</p>}

        <DialogFooter className="border-t pt-4">
          <DialogClose asChild>
            <Button variant="outline" disabled={saving}>{tc('cancel')}</Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={saving || !title.trim()}>
            {saving ? tc('saving') : tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}