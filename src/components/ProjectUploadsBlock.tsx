'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Download, Trash2, Loader2, FileIcon, FileImage, FileVideo, FileMusic, FileArchive, FileText, FilePlay, Square, CheckSquare, Info, RefreshCw } from 'lucide-react'
import { formatFileSize } from '@/lib/utils'
import { Button } from './ui/button'
import { apiFetch } from '@/lib/api-client'
import { logError } from '@/lib/logging'
import { useAuth } from '@/components/AuthProvider'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Input } from './ui/input'
import { FILE_LIMITS } from '@/lib/file-validation'

interface ProjectUpload {
  id: string
  fileName: string
  fileSize: string
  fileType: string
  category: string | null
  hasThumbnail: boolean
  uploadedByName: string | null
  uploadedByEmail: string | null
  transcodeStatus: string
  transcodeProgress: number
  transcodeError: string | null
  sourceVideoId: string | null
  createdAt: string
}

interface ProjectUploadsBlockProps {
  projectId: string
  onCountChange?: (count: number) => void
  videoNames?: string[]
  onPromoted?: () => void
}

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(dateStr))
}

function getCategoryLabel(category: string | null, otherLabel: string): string {
  if (!category) return otherLabel
  return category.charAt(0).toUpperCase() + category.slice(1)
}

function getUploadIcon(fileType: string, fileName: string, category: string | null) {
  const ft = fileType?.toLowerCase() || ''
  const fn = fileName.toLowerCase()
  const cat = category?.toLowerCase() || ''

  if (cat === 'thumbnail' || ft.startsWith('image/')) {
    return <FileImage className="w-4 h-4 text-muted-foreground flex-shrink-0" />
  }
  if (cat === 'project') {
    return <FilePlay className="w-4 h-4 text-muted-foreground flex-shrink-0" />
  }
  if (ft.startsWith('video/')) {
    return <FileVideo className="w-4 h-4 text-muted-foreground flex-shrink-0" />
  }
  if (ft.startsWith('audio/')) {
    return <FileMusic className="w-4 h-4 text-muted-foreground flex-shrink-0" />
  }
  if (ft === 'application/zip' || ft === 'application/x-zip-compressed' || fn.endsWith('.zip') || fn.endsWith('.rar') || fn.endsWith('.7z')) {
    return <FileArchive className="w-4 h-4 text-muted-foreground flex-shrink-0" />
  }
  if (ft.startsWith('text/') || fn.endsWith('.srt') || fn.endsWith('.vtt') || fn.endsWith('.txt') || fn.endsWith('.pdf') || fn.endsWith('.doc') || fn.endsWith('.docx')) {
    return <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
  }
  return <FileIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
}

function getUploaderDisplay(upload: ProjectUpload, unknownLabel: string): string {
  return upload.uploadedByName || upload.uploadedByEmail || unknownLabel
}

function isVideoUpload(upload: ProjectUpload): boolean {
  const lowerName = upload.fileName.toLowerCase()
  const extension = lowerName.includes('.') ? lowerName.slice(lowerName.lastIndexOf('.')) : ''
  return upload.fileType?.toLowerCase().startsWith('video/') || FILE_LIMITS.ALLOWED_EXTENSIONS.includes(extension)
}

function fileNameWithoutExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.')
  return (lastDot > 0 ? fileName.slice(0, lastDot) : fileName).trim()
}

export default function ProjectUploadsBlock({ projectId, onCountChange, videoNames = [], onPromoted }: ProjectUploadsBlockProps) {
  const t = useTranslations('projects')
  const tc = useTranslations('common')
  const { user } = useAuth()
  const canManage = user?.teamRole === 'OWNER' || user?.teamRole === 'ADMIN' || user?.role === 'ADMIN'

  const [uploads, setUploads] = useState<ProjectUpload[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDownloading, setBulkDownloading] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkTranscoding, setBulkTranscoding] = useState(false)
  const [transcodingIds, setTranscodingIds] = useState<Set<string>>(new Set())
  const [promoteUpload, setPromoteUpload] = useState<ProjectUpload | null>(null)
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const [targetVideoName, setTargetVideoName] = useState('__new__')
  const [newVideoName, setNewVideoName] = useState('')
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const previewsRef = useRef<Record<string, string>>({})

  const fetchUploads = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/project-uploads`)
      if (res.ok) {
        const data = await res.json()
        setUploads(data.uploads || [])
      }
    } catch (error) {
      logError('Error fetching project uploads:', error)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchUploads()
  }, [fetchUploads])

  useEffect(() => {
    if (!uploads.some((upload) => upload.transcodeStatus === 'PROCESSING')) return
    const timer = window.setInterval(() => {
      fetchUploads()
    }, 2500)
    return () => window.clearInterval(timer)
  }, [uploads, fetchUploads])

  useEffect(() => {
    if (!loading) {
      onCountChange?.(uploads.length)
    }
  }, [uploads, loading, onCountChange])

  // Load worker-generated preview thumbnails via authenticated fetch
  useEffect(() => {
    let cancelled = false

    const loadPreviews = async () => {
      for (const upload of uploads) {
        if (cancelled) return
        if (previewsRef.current[upload.id]) continue
        if (!upload.hasThumbnail) continue

        try {
          const res = await apiFetch(`/api/projects/${projectId}/project-uploads/${upload.id}/download?inline=1&thumb=1`)
          if (!res.ok) continue
          const blob = await res.blob()
          if (cancelled) return
          const url = URL.createObjectURL(blob)
          previewsRef.current[upload.id] = url
          setPreviews(prev => ({ ...prev, [upload.id]: url }))
        } catch {
          // Preview is best-effort; row falls back to the file-type icon
        }
      }
    }

    loadPreviews()
    return () => { cancelled = true }
  }, [uploads, projectId])

  // Revoke object URLs on unmount
  useEffect(() => () => {
    Object.values(previewsRef.current).forEach(url => URL.revokeObjectURL(url))
  }, [])

  const handleDownload = async (upload: ProjectUpload) => {
    setDownloadingId(upload.id)
    try {
      // Mint a single-use download token, then navigate the browser directly.
      // This triggers the native save dialog instantly — the previous
      // fetch-into-Blob approach buffered the entire file in the tab first
      // and felt like "the browser is downloading first".
      const res = await apiFetch(
        `/api/projects/${projectId}/project-uploads/${upload.id}/download-token`,
        { method: 'POST' }
      )
      if (!res.ok) {
        logError('Download token request failed', await res.json().catch(() => ({})))
        return
      }
      const { url } = await res.json()
      const a = document.createElement('a')
      a.href = url
      a.download = ''
      a.rel = 'noopener'
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (error) {
      logError('Error downloading project upload:', error)
    } finally {
      setDownloadingId(null)
    }
  }

  const handleDelete = async (upload: ProjectUpload) => {
    if (!confirm(t('confirmDeleteUpload'))) return
    setDeletingId(upload.id)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/project-uploads?uploadId=${upload.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setUploads((prev) => prev.filter((u) => u.id !== upload.id))
      }
    } catch (error) {
      logError('Error deleting project upload:', error)
    } finally {
      setDeletingId(null)
    }
  }

  const openPromoteDialog = (upload: ProjectUpload) => {
    const suggestedName = fileNameWithoutExtension(upload.fileName)
    const matchingName = videoNames.find(name => name.toLowerCase() === suggestedName.toLowerCase())
    setPromoteUpload(upload)
    setTargetVideoName(matchingName || '__new__')
    setNewVideoName(suggestedName)
  }

  const handlePromote = async () => {
    if (!promoteUpload) return
    const videoName = targetVideoName === '__new__' ? newVideoName.trim() : targetVideoName
    if (!videoName) return

    setPromotingId(promoteUpload.id)
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/project-uploads/${promoteUpload.id}/promote`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoName }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || t('promoteUploadFailed'))
      }

      setUploads(prev => prev.map(upload => upload.id === promoteUpload.id
        ? { ...upload, transcodeStatus: 'PROCESSING', transcodeProgress: 0, transcodeError: null }
        : upload
      ))
      setSelectedIds(prev => {
        const next = new Set(prev)
        next.delete(promoteUpload.id)
        return next
      })
      setPromoteUpload(null)
      onPromoted?.()
      void fetchUploads()
    } catch (error) {
      alert(error instanceof Error ? error.message : t('promoteUploadFailed'))
      logError('Error promoting project upload:', error)
    } finally {
      setPromotingId(null)
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === uploads.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(uploads.map(u => u.id)))
    }
  }

  const transcodeUpload = async (upload: ProjectUpload) => {
    const videoName = fileNameWithoutExtension(upload.fileName)
    if (!videoName) return

    setTranscodingIds(prev => new Set(prev).add(upload.id))
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/project-uploads/${upload.id}/promote`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoName }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || t('promoteUploadFailed'))
      }

      setUploads(prev => prev.map(item => item.id === upload.id
        ? { ...item, transcodeStatus: 'PROCESSING', transcodeProgress: 0, transcodeError: null }
        : item
      ))
      setSelectedIds(prev => {
        const next = new Set(prev)
        next.delete(upload.id)
        return next
      })
      onPromoted?.()
      void fetchUploads()
    } catch (error) {
      alert(error instanceof Error ? error.message : t('promoteUploadFailed'))
      logError('Error transcoding project upload:', error)
    } finally {
      setTranscodingIds(prev => {
        const next = new Set(prev)
        next.delete(upload.id)
        return next
      })
    }
  }

  const handleBulkTranscode = async () => {
    setBulkTranscoding(true)
    const targets = uploads.filter(upload => selectedIds.has(upload.id) && isVideoUpload(upload) && upload.transcodeStatus === 'ERROR')
    for (const upload of targets) {
      await transcodeUpload(upload)
    }
    setBulkTranscoding(false)
  }

  const handleBulkDownload = async () => {
    setBulkDownloading(true)
    // Stagger native browser downloads slightly so each save dialog appears
    // separately. Using token-based URLs means each is a single round-trip
    // to mint the token, then the browser streams directly.
    for (const upload of uploads.filter(u => selectedIds.has(u.id))) {
      try {
        const res = await apiFetch(
          `/api/projects/${projectId}/project-uploads/${upload.id}/download-token`,
          { method: 'POST' }
        )
        if (!res.ok) continue
        const { url } = await res.json()
        const a = document.createElement('a')
        a.href = url
        a.download = ''
        a.rel = 'noopener'
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        // Browsers will batch simultaneous downloads otherwise; small gap helps.
        await new Promise((r) => setTimeout(r, 200))
      } catch (error) {
        logError('Error downloading project upload:', error)
      }
    }
    setBulkDownloading(false)
  }

  const handleBulkDelete = async () => {
    if (!confirm(t('confirmDeleteUpload'))) return
    setBulkDeleting(true)
    for (const id of Array.from(selectedIds)) {
      try {
        const res = await apiFetch(`/api/projects/${projectId}/project-uploads?uploadId=${id}`, { method: 'DELETE' })
        if (res.ok) {
          setUploads(prev => prev.filter(u => u.id !== id))
          setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next })
        }
      } catch (error) {
        logError('Error deleting project upload:', error)
      }
    }
    setBulkDeleting(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const allSelected = uploads.length > 0 && selectedIds.size === uploads.length
  const someSelected = selectedIds.size > 0

  return (
    <div>
      {uploads.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          {t('noClientUploads')}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Bulk action bar */}
          {someSelected && (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/60 border text-sm mb-2">
              <button type="button" onClick={toggleSelectAll} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                <span>{selectedIds.size} / {uploads.length}</span>
              </button>
              <div className="flex-1" />
              <Button type="button" variant="outline" size="sm" onClick={handleBulkDownload} disabled={bulkDownloading || bulkDeleting}>
                {bulkDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                {tc('download')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleBulkTranscode} disabled={bulkTranscoding || bulkDownloading || bulkDeleting}>
                {bulkTranscoding ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                重新转码
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleBulkDelete} disabled={bulkDeleting || bulkDownloading} className="text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60">
                {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
                {tc('delete')}
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {uploads.map((upload) => {
            const uploader = getUploaderDisplay(upload, t('unknownUploader'))
            const isSelected = selectedIds.has(upload.id)
            return (
              <div
                key={upload.id}
                className={`flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors ${isSelected ? 'ring-1 ring-primary/30 bg-primary/5' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => toggleSelect(upload.id)}
                  className="flex-shrink-0 text-muted-foreground hover:text-primary transition-colors"
                  aria-label={tc('select')}
                >
                  {isSelected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                </button>

                {previews[upload.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previews[upload.id]}
                    alt={upload.fileName}
                    className="w-20 h-12 rounded-md object-cover border border-border bg-muted flex-shrink-0"
                  />
                ) : (
                  <div className="w-20 h-12 rounded-md border border-border bg-muted flex items-center justify-center flex-shrink-0">
                    {getUploadIcon(upload.fileType, upload.fileName, upload.category)}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{upload.fileName}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(Number(upload.fileSize))}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(upload.createdAt)}
                  </p>
                  {upload.transcodeStatus === 'NONE' && isVideoUpload(upload) && (
                    <p className="mt-1 text-xs text-muted-foreground">等待自动转码</p>
                  )}
                  {upload.transcodeStatus === 'READY' && (
                    <p className="mt-1 text-xs font-medium text-success">转码完成，待覆盖</p>
                  )}
                  {upload.transcodeStatus === 'PROCESSING' && (
                    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-primary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      正在转码中...
                    </p>
                  )}
                  {upload.transcodeStatus === 'ERROR' && (
                    <p className="mt-1 text-xs text-destructive">{upload.transcodeError || '转码失败，请重试'}</p>
                  )}
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {isVideoUpload(upload) && canManage && (
                    <button
                      type="button"
                      onClick={() => upload.transcodeStatus === 'READY' ? openPromoteDialog(upload) : transcodeUpload(upload)}
                      disabled={transcodingIds.has(upload.id) || upload.transcodeStatus === 'PROCESSING'}
                      className="p-1.5 rounded hover:bg-primary-visible text-primary transition-colors disabled:opacity-50"
                      title={upload.transcodeStatus === 'READY' ? '覆盖到视频' : upload.transcodeStatus === 'ERROR' ? '重新转码' : '正在转码中'}
                      aria-label={upload.transcodeStatus === 'READY' ? '覆盖到视频' : upload.transcodeStatus === 'ERROR' ? '重新转码' : '正在转码中'}
                    >
                      {transcodingIds.has(upload.id) || upload.transcodeStatus === 'PROCESSING'
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <RefreshCw className="w-4 h-4" />}
                    </button>
                  )}
                  <Dialog>
                    <DialogTrigger asChild>
                      <button
                        type="button"
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title={tc('details')}
                        aria-label={tc('details')}
                      >
                        <Info className="w-4 h-4" />
                      </button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>{tc('details')}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">{tc('name')}</p>
                          <p className="break-all">{upload.fileName}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{tc('type')}</p>
                          <p>{upload.fileType || getCategoryLabel(upload.category, t('otherCategory'))}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{tc('details')}</p>
                          <p>{formatFileSize(Number(upload.fileSize))} • {getCategoryLabel(upload.category, t('otherCategory'))}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t('uploadedBy')}</p>
                          <p className="break-all">{uploader}</p>
                          {upload.uploadedByEmail && upload.uploadedByName && (
                            <>
                              <p className="text-xs text-muted-foreground mt-2">{tc('email')}</p>
                              <p className="text-xs text-muted-foreground break-all">{upload.uploadedByEmail}</p>
                            </>
                          )}
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t('uploadedAt')}</p>
                          <p>{formatDate(upload.createdAt)}</p>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                  <button
                    type="button"
                    onClick={() => handleDownload(upload)}
                    disabled={downloadingId === upload.id}
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    title={tc('download')}
                  >
                    {downloadingId === upload.id
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Download className="w-4 h-4" />
                    }
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(upload)}
                    disabled={deletingId === upload.id}
                    className="p-1.5 rounded hover:bg-destructive-visible text-destructive transition-colors disabled:opacity-50"
                    title={tc('delete')}
                  >
                    {deletingId === upload.id
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Trash2 className="w-4 h-4" />
                    }
                  </button>
                </div>
              </div>
            )
          })}
          </div>
        </div>
      )}

      <Dialog open={!!promoteUpload} onOpenChange={(open) => !open && !promotingId && setPromoteUpload(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('promoteUploadTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('promoteUploadDescription')}</p>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm break-all">
              {promoteUpload?.fileName}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="promote-target">{t('targetVideo')}</label>
              <select
                id="promote-target"
                value={targetVideoName}
                onChange={(event) => setTargetVideoName(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="__new__">{t('createNewVideo')}</option>
                {videoNames.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
            {targetVideoName === '__new__' && (
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="promote-name">{t('newVideoName')}</label>
                <Input
                  id="promote-name"
                  value={newVideoName}
                  onChange={(event) => setNewVideoName(event.target.value)}
                  maxLength={255}
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setPromoteUpload(null)} disabled={!!promotingId}>{tc('cancel')}</Button>
              <Button onClick={handlePromote} disabled={!!promotingId || (targetVideoName === '__new__' && !newVideoName.trim())}>
                {promotingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {promotingId ? t('promotingUpload') : t('promoteUpload')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
