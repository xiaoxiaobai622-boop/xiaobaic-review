'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Download, Eye, FileText, Film, Image as ImageIcon, Loader2, Music } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { formatFileSize } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface CommentAsset {
  id: string
  fileName: string
  originalFileName: string | null
  fileSize: string
  fileType: string
  category: string | null
  createdAt: string
}

interface CommentAttachmentsProps {
  assets: CommentAsset[]
  videoId: string
  shareToken?: string | null
}

function getCategoryIcon(category: string | null, fileType: string) {
  if (category === 'image' || fileType.startsWith('image/')) return ImageIcon
  if (category === 'audio' || fileType.startsWith('audio/')) return Music
  if (category === 'video' || fileType.startsWith('video/')) return Film
  return FileText
}

function isImageAsset(asset: CommentAsset) {
  return asset.category === 'image' || asset.fileType.startsWith('image/')
}

export default function CommentAttachments({
  assets,
  videoId,
  shareToken,
}: CommentAttachmentsProps) {
  const t = useTranslations('comments')
  const tc = useTranslations('common')
  const [busy, setBusy] = useState<{ id: string; kind: 'preview' | 'download' } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ asset: CommentAsset; url: string } | null>(null)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})

  const requestAssetUrl = useCallback(async (assetId: string, mode: 'view' | 'download') => {
    const endpoint = `/api/videos/${videoId}/assets/${assetId}/download-token`
    let response: Response
    if (shareToken) {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${shareToken}` },
        body: JSON.stringify({ mode }),
      })
    } else {
      response = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error || (mode === 'view' ? '预览失败' : '下载失败'))
    }

    const { url } = await response.json()
    return url as string
  }, [videoId, shareToken])

  // Load inline view URLs for image attachments so the comment can show real
  // thumbnails. The original is only fetched when the preview is opened.
  useEffect(() => {
    let active = true
    const images = assets?.filter(isImageAsset) ?? []
    if (images.length === 0) {
      setImageUrls({})
      return
    }

    void Promise.all(images.map(async (asset) => {
      try {
        const url = await requestAssetUrl(asset.id, 'view')
        if (!active) return
        setImageUrls((current) => current[asset.id] === url ? current : { ...current, [asset.id]: url })
      } catch {
        // Leave the placeholder; opening it retries through handlePreview.
      }
    }))

    return () => { active = false }
  }, [assets, requestAssetUrl])

  if (!assets || assets.length === 0) return null

  const imageAssets = assets.filter(isImageAsset)
  const fileAssets = assets.filter((asset) => !isImageAsset(asset))

  const handlePreview = async (asset: CommentAsset) => {
    const image = isImageAsset(asset)
    // Keep the user gesture for non-image previews so popup blockers do not
    // swallow the tab after the token request resolves.
    const targetWindow = image ? null : window.open('', '_blank')
    setBusy({ id: asset.id, kind: 'preview' })
    setError(null)
    try {
      const url = await requestAssetUrl(asset.id, 'view')
      if (image) {
        setPreview({ asset, url })
      } else if (targetWindow) {
        targetWindow.opener = null
        targetWindow.location.href = url
      } else {
        window.location.href = url
      }
    } catch (reason) {
      targetWindow?.close()
      setError(reason instanceof Error ? reason.message : t('operationFailed'))
    } finally {
      setBusy(null)
    }
  }

  const openImagePreview = (asset: CommentAsset) => {
    const url = imageUrls[asset.id]
    if (url) {
      setError(null)
      setPreview({ asset, url })
      return
    }
    void handlePreview(asset)
  }

  const handleDownload = async (assetId: string) => {
    setBusy({ id: assetId, kind: 'download' })
    setError(null)
    try {
      const url = await requestAssetUrl(assetId, 'download')
      window.location.href = url
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('downloadFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-2 space-y-1.5">
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {imageAssets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {imageAssets.map((asset) => {
            const url = imageUrls[asset.id]
            const name = asset.originalFileName || asset.fileName
            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => openImagePreview(asset)}
                title="点击查看"
                aria-label={`查看 ${name}`}
                className="group relative h-24 w-36 overflow-hidden rounded-md border border-border/50 bg-muted/40 transition-colors hover:border-border"
              >
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`${url}&thumb=true`}
                    alt={name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {fileAssets.map((asset) => {
        const Icon = getCategoryIcon(asset.category, asset.fileType)
        const previewing = busy?.id === asset.id && busy.kind === 'preview'
        const downloading = busy?.id === asset.id && busy.kind === 'download'
        const name = asset.originalFileName || asset.fileName

        return (
          <div
            key={asset.id}
            className="group flex items-center rounded-md border border-border/50 bg-muted/40 text-sm"
          >
            <button
              type="button"
              onClick={() => void handlePreview(asset)}
              disabled={previewing}
              title="点击预览"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-l-md px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-60"
            >
              <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <span className="truncate flex-1 text-foreground">{name}</span>
              <span className="flex-shrink-0 text-xs text-muted-foreground">
                {formatFileSize(Number(asset.fileSize))}
              </span>
              {previewing ? (
                <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Eye className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void handleDownload(asset.id)}
              disabled={downloading}
              title={tc('download')}
              aria-label={`${tc('download')} ${name}`}
              className="m-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              {downloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        )
      })}

      <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null) }}>
        <DialogContent
          overlayProps={{ className: 'bg-black/85' }}
          className="max-w-[94vw] border-0 bg-transparent p-0 text-white shadow-none sm:max-w-[94vw]"
        >
          <DialogTitle className="sr-only">
            {preview ? preview.asset.originalFileName || preview.asset.fileName : ''}
          </DialogTitle>
          {preview && (
            <div className="flex max-h-[88vh] items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.url}
                alt={preview.asset.originalFileName || preview.asset.fileName}
                className="max-h-[82vh] max-w-full rounded-md object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}