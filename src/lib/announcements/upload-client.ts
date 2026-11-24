import { apiFetch } from '@/lib/api-client'
import {
  ANNOUNCEMENT_IMAGE_EXTENSIONS,
  ANNOUNCEMENT_IMAGE_MAX_BYTES,
  ANNOUNCEMENT_IMAGE_MAX_LABEL,
} from './image'

/** Shared by the cover field and inline article images; the same server route. */
export async function uploadAnnouncementImage(file: File): Promise<string> {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
  if (!(ANNOUNCEMENT_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error('只支持 JPG、PNG、WebP 或 AVIF 图片')
  }
  if (file.size === 0) throw new Error('图片文件为空，请重新选择')
  if (file.size > ANNOUNCEMENT_IMAGE_MAX_BYTES) {
    throw new Error(`图片不能超过 ${ANNOUNCEMENT_IMAGE_MAX_LABEL}`)
  }

  const form = new FormData()
  form.append('file', file)
  const response = await apiFetch('/api/platform/announcements/image', {
    method: 'POST',
    body: form,
  })
  const data = await response.json().catch(() => ({} as { url?: unknown; error?: unknown }))
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `上传失败（${response.status}）`)
  }
  if (typeof data.url !== 'string' || !data.url) {
    throw new Error('上传失败：服务端没有返回图片地址')
  }
  return data.url
}