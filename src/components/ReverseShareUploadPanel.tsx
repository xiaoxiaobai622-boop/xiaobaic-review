'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Upload, Loader2, CheckCircle2, AlertCircle, FileIcon, X, RotateCcw, FolderUp } from 'lucide-react'
import { formatFileSize } from '@/lib/utils'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog'
import * as tus from 'tus-js-client'
import { createTusAfterResponseHandler, createTusShouldRetryHandler, getTusUploadErrorMessage, resetTusAuthRetry } from '@/lib/tus-error'
import { getTusChunkSizeBytes, TUS_RETRY_DELAYS_MS } from '@/lib/transfer-tuning'
import {
  ensureFreshUploadOnContextChange,
  clearFileContext,
  clearUploadMetadata,
  clearTUSFingerprint,
} from '@/lib/tus-context'
import { useS3MultipartUpload } from '@/hooks/useS3MultipartUpload'
import { useStorageProvider } from '@/components/StorageConfigProvider'
import { ALL_ALLOWED_EXTENSIONS, ACCEPTED_FILE_INPUT } from '@/lib/asset-validation'

const ALLOWED_EXTENSIONS = new Set(ALL_ALLOWED_EXTENSIONS)

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  return lastDot === -1 ? '' : filename.slice(lastDot).toLowerCase()
}

interface FileItem {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'completed' | 'error'
  progress: number
  error?: string
  uploadId?: string
}

interface ReverseShareUploadPanelProps {
  shareToken: string
  shareSlug: string
  projectName?: string
  maxFiles?: number
  autoOpen?: boolean
  variant?: 'dialog' | 'embedded'
}

const DEFAULT_MAX_FILES = 10

export default function ReverseShareUploadPanel({
  shareToken,
  shareSlug,
  projectName,
  maxFiles: maxFilesProp,
  autoOpen = false,
  variant = 'dialog',
}: ReverseShareUploadPanelProps) {
  const t = useTranslations('share')
  const tc = useTranslations('common')
  const MAX_FILES = maxFilesProp ?? DEFAULT_MAX_FILES

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<FileItem[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [allDone, setAllDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const tusUploadsRef = useRef<Map<string, tus.Upload>>(new Map())
  const s3AbortKeysRef = useRef<Map<string, string>>(new Map())
  const { startUpload: startS3Upload, abortUpload: abortS3Upload } = useS3MultipartUpload()
  const storageProvider = useStorageProvider()

  const atLimit = items.length >= MAX_FILES
  const hasFiles = items.length > 0
  const hasPending = items.some((i) => i.status === 'pending')

  useEffect(() => {
    if (autoOpen) setOpen(true)
  }, [autoOpen])

  const addFiles = useCallback((files: FileList | File[]) => {
    setAllDone(false)
    setItems((prev) => {
      const currentItems = allDone ? [] : prev
      const remaining = MAX_FILES - currentItems.length
      if (remaining <= 0) return currentItems
      return [
        ...currentItems,
        ...Array.from(files).slice(0, remaining).map((file) => {
          const ext = getFileExtension(file.name)
          const error = !ext || !ALLOWED_EXTENSIONS.has(ext) ? `${t('unsupportedFileType')} (${ext || '-'})` : null
          return {
            id: crypto.randomUUID?.() ?? `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            file,
            status: error ? 'error' as const : 'pending' as const,
            progress: 0,
            error: error || undefined,
          }
        }),
      ]
    })
  }, [MAX_FILES, allDone, t])

  const removeFile = useCallback((id: string) => {
    if (storageProvider === 's3') {
      const s3Key = s3AbortKeysRef.current.get(id)
      if (s3Key) {
        abortS3Upload(s3Key).catch(() => {})
        s3AbortKeysRef.current.delete(id)
      }
    } else {
      const tusUpload = tusUploadsRef.current.get(id)
      if (tusUpload) {
        tusUpload.abort(true)
        tusUploadsRef.current.delete(id)
      }
    }
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [abortS3Upload, storageProvider])

  const retryFile = useCallback((id: string) => {
    setAllDone(false)
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: 'pending', error: undefined, progress: 0, uploadId: undefined } : i))
    )
  }, [])

  const uploadFile = async (item: FileItem): Promise<boolean> => {
    let uploadId: string

    try {
      const response = await fetch(`/api/share/${shareSlug}/project-uploads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${shareToken}`,
        },
        body: JSON.stringify({ fileName: item.file.name, fileSize: item.file.size }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || t('failedToCreateUpload'))
      }

      const data = await response.json()
      uploadId = data.uploadId
    } catch (error) {
      const message = error instanceof Error ? error.message : t('failedToCreateUpload')
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'error', error: message } : i)))
      return false
    }

    return new Promise<boolean>((resolve) => {
      if (storageProvider === 's3') {
        // ── S3 direct multipart upload ──────────────────────────────────────
        const s3Key = `s3-rev-share-${item.id}`
        s3AbortKeysRef.current.set(item.id, s3Key)
        startS3Upload(
          item.file,
          { projectUploadId: uploadId, bearerToken: shareToken },
          {
            onProgress: (bytesUploaded, bytesTotal) => {
              const pct = Math.round((bytesUploaded / bytesTotal) * 100)
              setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, progress: pct } : i)))
            },
            onSuccess: () => {
              setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'completed', progress: 100, uploadId } : i)))
              s3AbortKeysRef.current.delete(item.id)
              clearFileContext(item.file)
              clearUploadMetadata(item.file)
              resolve(true)
            },
            onError: (err) => {
              setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'error', error: err.message, uploadId } : i)))
              s3AbortKeysRef.current.delete(item.id)
              clearUploadMetadata(item.file)
              fetch(`/api/share/${shareSlug}/project-uploads?uploadId=${uploadId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${shareToken}` },
              }).catch(() => {})
              resolve(false)
            },
          },
          s3Key
        )
      } else {
        // ── TUS resumable upload ─────────────────────────────────────────────
        ensureFreshUploadOnContextChange(item.file, `reverse-share:${shareSlug}:${uploadId}`)

      const uploadRef = { current: null as tus.Upload | null }

      const tusUpload = new tus.Upload(item.file, {
        endpoint: `${window.location.origin}/api/uploads`,
        retryDelays: TUS_RETRY_DELAYS_MS,
        metadata: {
          filename: item.file.name,
          filetype: item.file.type || 'application/octet-stream',
          projectUploadId: uploadId,
        },
        chunkSize: getTusChunkSizeBytes(item.file.size),
        storeFingerprintForResuming: true,
        removeFingerprintOnSuccess: true,
        onAfterResponse: createTusAfterResponseHandler(uploadRef),
        onShouldRetry: createTusShouldRetryHandler(uploadRef),

        onProgress: (bytesUploaded, bytesTotal) => {
          const percentage = Math.round((bytesUploaded / bytesTotal) * 100)
          setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, progress: percentage } : i)))
        },

        onSuccess: () => {
          setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'completed', progress: 100, uploadId } : i)))
          tusUploadsRef.current.delete(item.id)
          resetTusAuthRetry(uploadRef.current)
          clearFileContext(item.file)
          clearUploadMetadata(item.file)
          clearTUSFingerprint(item.file)
          resolve(true)
        },

        onError: (error) => {
          const errorMessage = getTusUploadErrorMessage(error)
          setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'error', error: errorMessage, uploadId } : i)))
          tusUploadsRef.current.delete(item.id)
          resetTusAuthRetry(uploadRef.current)
          clearUploadMetadata(item.file)
          clearTUSFingerprint(item.file)
          fetch(`/api/share/${shareSlug}/project-uploads?uploadId=${uploadId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${shareToken}` },
          }).catch(() => {})
          resolve(false)
        },

        onBeforeRequest: (req) => {
          const xhr = req.getUnderlyingObject()
          xhr.withCredentials = true
          xhr.setRequestHeader('Authorization', `Bearer ${shareToken}`)
        },
      })

      uploadRef.current = tusUpload
      tusUploadsRef.current.set(item.id, tusUpload)
      tusUpload.findPreviousUploads().then((previousUploads) => {
        if (previousUploads.length > 0) tusUpload.resumeFromPreviousUpload(previousUploads[0])
        tusUpload.start()
      })
      } // end TUS else block
    })
  }

  const startUpload = async () => {
    const pending = items.filter((i) => i.status === 'pending')
    if (pending.length === 0) return
    setIsUploading(true)
    for (const item of pending) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'uploading' } : i)))
      await uploadFile(item)
    }
    setIsUploading(false)
    // Only show success banner when no files ended in error
    setItems((prev) => {
      const hasErrors = prev.some((i) => i.status === 'error')
      setAllDone(!hasErrors)
      return prev
    })
  }

  const handleDone = () => {
    setOpen(false)
    setItems([])
    setAllDone(false)
  }

  const handleUploadMore = () => {
    setItems([])
    setAllDone(false)
    window.setTimeout(() => fileInputRef.current?.click(), 0)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next && isUploading) return
    setOpen(next)
    if (!next && !isUploading) {
      if (storageProvider === 's3') {
        s3AbortKeysRef.current.forEach((key) => abortS3Upload(key).catch(() => {}))
        s3AbortKeysRef.current.clear()
      } else {
        tusUploadsRef.current.forEach((u) => u.abort(true))
        tusUploadsRef.current.clear()
      }
      setItems([])
      setAllDone(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!atLimit && !isUploading) setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const droppedFiles = Array.from(e.dataTransfer.files)
    if (!atLimit && !isUploading && droppedFiles.length > 0) addFiles(droppedFiles)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (selectedFiles.length > 0) addFiles(selectedFiles)
  }

  const dropZone = (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={atLimit || isUploading ? undefined : () => fileInputRef.current?.click()}
      onKeyDown={(event) => {
        if (!atLimit && !isUploading && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          fileInputRef.current?.click()
        }
      }}
      role="button"
      tabIndex={atLimit || isUploading ? -1 : 0}
      aria-disabled={atLimit || isUploading}
      className={`flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-5 py-7 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-44 ${
        atLimit || isUploading
          ? 'cursor-not-allowed border-muted bg-muted/30 opacity-60'
          : isDragging
            ? 'cursor-copy border-primary bg-primary/5'
            : 'cursor-pointer border-muted-foreground/25 bg-background hover:border-primary/50 hover:bg-muted/20'
      }`}
    >
      <Upload className="h-9 w-9 text-muted-foreground" strokeWidth={1.8} />
      <p className="text-center text-sm text-muted-foreground">
        {atLimit ? t('maxFilesReached') : t('dragDropFiles')}
      </p>
      <p className="max-w-xl text-center text-xs leading-5 text-muted-foreground/70">{t('supportedFileTypes')}</p>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={ACCEPTED_FILE_INPUT}
        multiple
        onChange={handleFileChange}
      />
    </div>
  )

  const fileList = hasFiles ? (
    <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
      {items.map((item) => (
        <div key={item.id} className="rounded-lg bg-muted/55 px-3 py-2.5 text-sm">
          <div className="flex items-center gap-2.5">
            {item.status === 'pending' && <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />}
            {item.status === 'uploading' && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
            {item.status === 'completed' && <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />}
            {item.status === 'error' && <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />}

            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{item.file.name}</p>
              {item.status === 'error' && item.error && (
                <p className="mt-0.5 truncate text-xs text-destructive">{item.error}</p>
              )}
            </div>

            {item.status === 'uploading' ? (
              <span className="shrink-0 text-xs font-medium text-primary">{item.progress}%</span>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(item.file.size)}</span>
            )}

            {item.status === 'error' && (
              <button
                type="button"
                onClick={() => retryFile(item.id)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title={tc('retry')}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
            {(item.status === 'pending' || item.status === 'error') && (
              <button
                type="button"
                onClick={() => removeFile(item.id)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={tc('remove')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {item.status === 'uploading' && (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${item.progress}%` }} />
            </div>
          )}
        </div>
      ))}
    </div>
  ) : null

  if (variant === 'embedded') {
    return (
      <main className="fixed inset-0 overflow-y-auto bg-muted/35 px-4 py-8 sm:px-6 sm:py-12">
        <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl items-center sm:min-h-[calc(100vh-6rem)]">
          <div className="w-full rounded-lg border border-border bg-card p-5 shadow-lg sm:p-7">
            <h1 className="text-xl font-semibold text-foreground sm:text-2xl">{t('submitFilesTitle')}</h1>
            {projectName && (
              <p className="mt-1.5 truncate text-sm font-medium text-muted-foreground" title={projectName}>
                {t('uploadProjectName', { name: projectName })}
              </p>
            )}
            <p className="sr-only">{t('submitFilesDesc')}</p>

            <div className="mt-5 space-y-3">
              {dropZone}

              {isUploading && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {tc('uploading')}
                </p>
              )}

              {allDone && (
                <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2.5 text-green-700 dark:bg-green-950/30 dark:text-green-400" aria-live="polite">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <p className="text-sm font-medium">{t('allFilesUploaded')}</p>
                </div>
              )}

              {fileList}
            </div>

            <div className="mt-5 flex items-center justify-between gap-4">
              <span className="text-sm tabular-nums text-muted-foreground">{items.length}/{MAX_FILES}</span>
              {allDone ? (
                <Button onClick={handleUploadMore}>{t('uploadMore')}</Button>
              ) : (
                <Button onClick={startUpload} disabled={!hasFiles || isUploading || !hasPending} className="min-w-24">
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {tc('uploading')}
                    </>
                  ) : (
                    t('submitFiles')
                  )}
                </Button>
              )}
            </div>
          </div>
        </section>
      </main>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="p-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors shadow-sm flex items-center gap-1.5"
      >
        <FolderUp className="h-5 w-5 text-foreground" />
        <span className="hidden sm:inline text-sm font-medium text-foreground">{t('submitFiles')}</span>
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('submitFilesTitle')}</DialogTitle>
            <DialogDescription className="sr-only">{t('submitFilesDesc')}</DialogDescription>
          </DialogHeader>

          {/* Drop zone */}
          {!isUploading && !allDone && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={atLimit ? undefined : () => fileInputRef.current?.click()}
              className={`
                flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-all cursor-pointer
                ${atLimit
                  ? 'border-muted bg-muted/30 cursor-not-allowed opacity-50'
                  : isDragging
                    ? 'border-primary bg-primary/5 scale-[1.01]'
                    : 'border-muted-foreground/25 hover:border-primary/50'
                }
              `}
            >
              <Upload className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center">
                {atLimit ? t('maxFilesReached') : t('dragDropFiles')}
              </p>
              <p className="text-xs text-muted-foreground/60 text-center">{t('supportedFileTypes')}</p>
              <input ref={fileInputRef} type="file" className="hidden" accept={ACCEPTED_FILE_INPUT} multiple onChange={handleFileChange} />
            </div>
          )}

          {isUploading && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {tc('uploading')}
            </p>
          )}

          {allDone && (
            <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              {t('allFilesUploaded')}
            </p>
          )}

          {/* File list */}
          {hasFiles && (
            <div className="max-h-60 overflow-y-auto space-y-1">
              {items.map((item) => (
                <div key={item.id} className="flex flex-col rounded-md px-2 py-1.5 text-sm bg-muted/50">
                  <div className="flex items-center gap-2">
                    {item.status === 'pending' && <FileIcon className="w-4 h-4 shrink-0 text-muted-foreground" />}
                    {item.status === 'uploading' && <Loader2 className="w-4 h-4 shrink-0 animate-spin text-primary" />}
                    {item.status === 'completed' && <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600 dark:text-green-400" />}
                    {item.status === 'error' && <AlertCircle className="w-4 h-4 shrink-0 text-destructive" />}

                    <div className="flex-1 min-w-0">
                      <p className="truncate">{item.file.name}</p>
                      {item.status === 'error' && item.error && (
                        <p className="text-xs text-destructive truncate">{item.error}</p>
                      )}
                    </div>

                    {item.status === 'uploading' && (
                      <span className="text-xs text-primary shrink-0 font-medium">{item.progress}%</span>
                    )}
                    {item.status !== 'uploading' && (
                      <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(item.file.size)}</span>
                    )}

                    {item.status === 'error' && (
                      <button type="button" onClick={() => retryFile(item.id)} className="shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title={tc('retry')}>
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {(item.status === 'pending' || item.status === 'error') && (
                      <button type="button" onClick={() => removeFile(item.id)} className="shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {item.status === 'uploading' && (
                    <div className="mt-1.5 h-1 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${item.progress}%` }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
            <span className="text-sm text-muted-foreground">{items.length}/{MAX_FILES}</span>
            {allDone ? (
              <Button onClick={handleDone}>{tc('done')}</Button>
            ) : (
              <Button
                onClick={startUpload}
                disabled={!hasFiles || isUploading || !hasPending}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {tc('uploading')}
                  </>
                ) : (
                  t('submitFiles')
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
