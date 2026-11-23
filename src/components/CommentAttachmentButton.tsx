'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { AttachmentSparkleIcon } from './comment-composer-icons'
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
import { COMMENT_ATTACHMENT_ACCEPT, COMMENT_ATTACHMENT_EXTENSIONS, isVideoAssetExtension } from '@/lib/asset-validation'
import { apiFetch } from '@/lib/api-client'
import { getAccessToken } from '@/lib/token-store'
import { shareApiPost, shareFetch, readShareTokenRaw, renewShareToken, shareSlugFromToken } from '@/lib/share-token-store'
import { SHARE_RENEWABLE_CODES } from '@/lib/share-error-codes'
import { MAX_COMMENT_ATTACHMENT_BYTES, MAX_COMMENT_ATTACHMENT_LABEL } from '@/lib/comment-attachment-limits'

interface PendingAttachment {
  assetId: string
  videoId: string
  fileName: string
  fileSize: string
  fileType: string
  category: string
}

interface CommentAttachmentButtonProps {
  videoId: string
  shareToken: string | null
  shareSlug?: string | null
  onAttachmentAdded: (attachment: PendingAttachment) => void
  onUploadError?: (message: string | null) => void
  onUploadingChange?: (uploading: boolean) => void
  disabled?: boolean
  maxFiles?: number
}

const DEFAULT_MAX_FILES = 10

const ALLOWED_EXTENSIONS = new Set(COMMENT_ATTACHMENT_EXTENSIONS)

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot === -1) return ''
  return filename.slice(lastDot).toLowerCase()
}

type UploadResult = { ok: true; attachment: PendingAttachment } | { ok: false; error: string }

export interface CommentAttachmentHandle {
  addFiles: (files: File[]) => void
}

const CommentAttachmentButton = forwardRef<CommentAttachmentHandle, CommentAttachmentButtonProps>(function CommentAttachmentButton({
  videoId,
  shareToken,
  shareSlug = null,
  onAttachmentAdded,
  onUploadError,
  onUploadingChange,
  disabled = false,
  maxFiles: maxFilesProp,
}, ref) {
  const t = useTranslations('comments')
  const tShare = useTranslations('share')
  const tc = useTranslations('common')
  const MAX_FILES = maxFilesProp ?? DEFAULT_MAX_FILES
  const [uploading, setUploading] = useState(false)
  const [queue, setQueue] = useState<{ index: number; total: number; percent: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadingRef = useRef(false)
  const tusUploadsRef = useRef<Map<string, tus.Upload>>(new Map())
  const s3AbortKeysRef = useRef<Map<string, string>>(new Map())
  const { startUpload: startS3Upload, abortUpload: abortS3Upload } = useS3MultipartUpload()
  const storageProvider = useStorageProvider()
  const abortS3Ref = useRef(abortS3Upload)
  useEffect(() => {
    abortS3Ref.current = abortS3Upload
  }, [abortS3Upload])
  const effectiveShareSlug = shareSlug || shareSlugFromToken(shareToken)

  useEffect(() => () => {
    tusUploadsRef.current.forEach((upload) => upload.abort(true))
    tusUploadsRef.current.clear()
    s3AbortKeysRef.current.forEach((key) => abortS3Ref.current(key).catch(() => {}))
    s3AbortKeysRef.current.clear()
  }, [])

  const fileError = (file: File): string | null => {
    const ext = getFileExtension(file.name)
    // A video belongs in the project's version list, not in a comment.
    if (isVideoAssetExtension(ext)) return t('videoAttachmentsNotAllowed')
    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) return t('unsupportedFileType')
    if (file.size > MAX_COMMENT_ATTACHMENT_BYTES) {
      return t('attachmentTooLarge', { size: MAX_COMMENT_ATTACHMENT_LABEL })
    }
    return null
  }

  const deleteAssetRecord = (assetId: string) => {
    if (shareToken && effectiveShareSlug) {
      shareFetch(effectiveShareSlug, `/api/videos/${videoId}/client-assets?assetId=${assetId}`, { method: 'DELETE' }).catch(() => {})
      return
    }
    apiFetch(`/api/videos/${videoId}/client-assets?assetId=${assetId}`, { method: 'DELETE' }).catch(() => {})
  }

  const uploadFile = async (file: File, onProgress: (percent: number) => void): Promise<UploadResult> => {
    const localId = crypto.randomUUID()

    let assetId: string
    let fileName: string
    let category: string

    try {
      const body = { fileName: file.name, fileSize: file.size, category: undefined }
      const data = shareToken && effectiveShareSlug
        ? await shareApiPost<any>(effectiveShareSlug, `/api/videos/${videoId}/client-assets`, body)
        : await apiFetch(`/api/videos/${videoId}/client-assets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }).then(async (response) => {
            if (!response.ok) {
              const err = await response.json().catch(() => ({}))
              throw Object.assign(new Error(err.error || t('failedToCreateAsset')), { code: err.code })
            }
            return response.json()
          })

      assetId = data.assetId
      fileName = data.fileName
      category = data.category
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      const message = code && SHARE_RENEWABLE_CODES.has(code)
        ? tShare('sessionExpiredRefresh')
        : error instanceof Error ? error.message : t('failedToCreateAsset')
      return { ok: false, error: message }
    }

    if (storageProvider === 's3') {
      return new Promise<UploadResult>((resolve) => {
        const s3Key = `s3-comment-${localId}`
        s3AbortKeysRef.current.set(localId, s3Key)
        startS3Upload(
          file,
          { assetId, shareToken: shareToken || undefined, shareSlug: effectiveShareSlug || undefined },
          {
            onProgress: (bytesUploaded, bytesTotal) => {
              onProgress(Math.round((bytesUploaded / bytesTotal) * 100))
            },
            onSuccess: () => {
              s3AbortKeysRef.current.delete(localId)
              clearFileContext(file)
              clearUploadMetadata(file)
              resolve({
                ok: true,
                attachment: {
                  assetId,
                  videoId,
                  fileName,
                  fileSize: file.size.toString(),
                  fileType: file.type || 'application/octet-stream',
                  category,
                },
              })
            },
            onError: (err) => {
              s3AbortKeysRef.current.delete(localId)
              clearUploadMetadata(file)
              deleteAssetRecord(assetId)
              resolve({ ok: false, error: err.message || t('operationFailed') })
            },
          },
          s3Key
        )
      })
    }

    return new Promise<UploadResult>((resolve) => {
      ensureFreshUploadOnContextChange(file, `client:${videoId}:${assetId}`)

      const uploadRef = { current: null as tus.Upload | null }

      const tusUpload = new tus.Upload(file, {
        endpoint: `${window.location.origin}/api/uploads`,
        retryDelays: TUS_RETRY_DELAYS_MS,
        metadata: {
          filename: file.name,
          filetype: file.type || 'application/octet-stream',
          assetId,
        },
        chunkSize: getTusChunkSizeBytes(file.size),
        storeFingerprintForResuming: true,
        removeFingerprintOnSuccess: true,
        onAfterResponse: createTusAfterResponseHandler(
          uploadRef,
          effectiveShareSlug
            ? async () => { await renewShareToken(effectiveShareSlug, readShareTokenRaw(effectiveShareSlug) || shareToken) }
            : undefined,
        ),
        onShouldRetry: createTusShouldRetryHandler(uploadRef),

        onProgress: (bytesUploaded, bytesTotal) => {
          onProgress(Math.round((bytesUploaded / bytesTotal) * 100))
        },

        onSuccess: () => {
          tusUploadsRef.current.delete(localId)
          resetTusAuthRetry(uploadRef.current)
          clearFileContext(file)
          clearUploadMetadata(file)
          clearTUSFingerprint(file)
          resolve({
            ok: true,
            attachment: {
              assetId,
              videoId,
              fileName,
              fileSize: file.size.toString(),
              fileType: file.type || 'application/octet-stream',
              category,
            },
          })
        },

        onError: (error) => {
          tusUploadsRef.current.delete(localId)
          resetTusAuthRetry(uploadRef.current)
          clearUploadMetadata(file)
          clearTUSFingerprint(file)
          deleteAssetRecord(assetId)
          resolve({ ok: false, error: getTusUploadErrorMessage(error) || t('operationFailed') })
        },

        onBeforeRequest: (req) => {
          const xhr = req.getUnderlyingObject()
          xhr.withCredentials = true
          const currentToken = (effectiveShareSlug && readShareTokenRaw(effectiveShareSlug)) || shareToken
          const accountToken = currentToken ? null : getAccessToken()
          if (currentToken) xhr.setRequestHeader('Authorization', `Bearer ${currentToken}`)
          else if (accountToken) xhr.setRequestHeader('Authorization', `Bearer ${accountToken}`)
        },
      })

      uploadRef.current = tusUpload
      tusUploadsRef.current.set(localId, tusUpload)

      tusUpload.findPreviousUploads().then((previousUploads) => {
        if (previousUploads.length > 0) tusUpload.resumeFromPreviousUpload(previousUploads[0])
        tusUpload.start()
      })
    })
  }

  const handleFiles = async (files: File[]) => {
    if (uploadingRef.current) return
    const selected = files.slice(0, MAX_FILES)
    if (selected.length === 0) return

    const accepted: File[] = []
    let firstError: string | null = null
    for (const file of selected) {
      const error = fileError(file)
      if (error) {
        if (!firstError) firstError = `${file.name}：${error}`
      } else {
        accepted.push(file)
      }
    }
    onUploadError?.(firstError)
    if (accepted.length === 0) return

    uploadingRef.current = true
    setUploading(true)
    onUploadingChange?.(true)
    try {
      for (let index = 0; index < accepted.length; index++) {
        setQueue({ index: index + 1, total: accepted.length, percent: 0 })
        const result = await uploadFile(accepted[index], (percent) => {
          setQueue((current) => current ? { ...current, percent } : current)
        })
        if (result.ok) {
          onAttachmentAdded(result.attachment)
        } else {
          onUploadError?.(result.error)
        }
      }
    } finally {
      uploadingRef.current = false
      setUploading(false)
      setQueue(null)
      onUploadingChange?.(false)
    }
  }

  useImperativeHandle(ref, () => ({
    addFiles: (files: File[]) => { void handleFiles(files) },
  }))

  const uploadingLabel = queue ? `${tc('uploading')} ${queue.index}/${queue.total} · ${queue.percent}%` : tc('uploading')

  return (
    <>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || uploading}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        title={uploading ? uploadingLabel : t('attachFiles')}
        aria-label={uploading ? uploadingLabel : t('attachFiles')}
        aria-busy={uploading}
      >
        {uploading ? <Loader2 className="h-[24px] w-[24px] animate-spin" /> : <AttachmentSparkleIcon className="h-[24px] w-[24px]" />}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={COMMENT_ATTACHMENT_ACCEPT}
        multiple
        onChange={(event) => {
          // Keep the File objects before clearing the input: clearing `value`
          // empties the live FileList in some browsers.
          const files = event.target.files ? Array.from(event.target.files) : []
          event.target.value = ''
          if (files.length > 0) void handleFiles(files)
        }}
      />
    </>
  )
})

export default CommentAttachmentButton
