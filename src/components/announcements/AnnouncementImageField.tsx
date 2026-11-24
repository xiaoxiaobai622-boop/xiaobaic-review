'use client'

import { useEffect, useRef, useState } from 'react'
import { ImageOff, Loader2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ANNOUNCEMENT_IMAGE_ACCEPT,
  ANNOUNCEMENT_IMAGE_ACCEPT_LABEL,
  ANNOUNCEMENT_IMAGE_MAX_LABEL,
} from '@/lib/announcements/image'
import { uploadAnnouncementImage } from '@/lib/announcements/upload-client'
import { cn } from '@/lib/utils'

const fieldClass = 'h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring'

function isUploadedImage(value: string): boolean {
  return value.startsWith('/api/announcements/images/')
}

export default function AnnouncementImageField({
  value,
  onChange,
  disabled = false,
  label = '图片（可选）',
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  label?: string
}) {
  const [mode, setMode] = useState<'upload' | 'url'>(value && !isUploadedImage(value) ? 'url' : 'upload')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setPreviewFailed(false)
  }, [value])

  const upload = async (file: File | undefined) => {
    if (!file || disabled || uploading) return
    setError(null)
    setUploading(true)
    try {
      onChange(await uploadAnnouncementImage(file))
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '图片上传失败，请稍后重试')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <div role="tablist" aria-label="图片来源" className="flex rounded-md bg-muted p-0.5">
          {([
            ['upload', '上传文件'],
            ['url', '图片链接'],
          ] as const).map(([nextMode, label]) => (
            <button
              key={nextMode}
              type="button"
              role="tab"
              aria-selected={mode === nextMode}
              onClick={() => { setMode(nextMode); setError(null) }}
              className={cn(
                'rounded px-2 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                mode === nextMode ? 'bg-background text-foreground shadow-elevation-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'upload' ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ANNOUNCEMENT_IMAGE_ACCEPT}
            aria-label="上传新增功能图片"
            className="sr-only"
            disabled={disabled || uploading}
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={disabled || uploading}
              className="h-8 px-2.5 text-xs"
            >
              {uploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
              {uploading ? '上传中…' : value ? '重新上传' : '选择图片'}
            </Button>
            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange('')}
                disabled={disabled || uploading}
                className="h-8 px-2 text-xs text-muted-foreground"
              >
                <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                移除
              </Button>
            ) : null}
            <span className="text-[10px] text-muted-foreground">{ANNOUNCEMENT_IMAGE_ACCEPT_LABEL}，最大 {ANNOUNCEMENT_IMAGE_MAX_LABEL}</span>
          </div>
        </>
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={fieldClass}
          placeholder="https://… 或 /站内路径"
          aria-label="新增功能图片链接"
        />
      )}

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive-visible px-2 py-1 text-[11px] text-destructive">
          {error}
        </p>
      ) : null}

      {value ? (
        <>
          {previewFailed ? (
            <div className="flex h-40 w-full flex-col items-center justify-center gap-1 rounded-lg border border-border bg-muted/40 text-muted-foreground">
              <ImageOff className="h-6 w-6" aria-hidden />
              <span className="text-[11px]">图片无法加载</span>
            </div>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={value}
                alt="新增功能图片预览"
                loading="lazy"
                decoding="async"
                className="h-40 w-full rounded-lg border border-border bg-muted object-cover"
                onError={() => setPreviewFailed(true)}
              />
            </>
          )}
          <p className="truncate font-mono text-[10px] text-muted-foreground" title={value}>{value}</p>
        </>
      ) : null}
    </div>
  )
}