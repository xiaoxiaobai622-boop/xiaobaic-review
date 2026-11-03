'use client'

import { useSearchParams } from 'next/navigation'
import AdminVideoManager from '@/components/AdminVideoManager'

const baseVideo = {
  id: 'lab-hls-only',
  name: 'HLS 样片',
  version: 1,
  versionLabel: 'v1',
  status: 'READY',
  approved: true,
  reviewStatus: 'APPROVED',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  originalFileName: 'sample.mp4',
  originalFileSize: 1024,
  fileSize: 1024,
  fileType: 'video/mp4',
  fps: 25,
  duration: 2,
  thumbnailPath: null,
  preview720Path: null as string | null,
  preview1080Path: null as string | null,
  preview2160Path: null as string | null,
  cleanPreview720Path: null,
  cleanPreview1080Path: null,
  cleanPreview2160Path: null,
  hlsPath: null as string | null,
  originalStoragePath: null as string | null,
}

export default function PreviewSample() {
  const params = useSearchParams()
  const testCase = params?.get('case') || 'hls'

  const video = testCase === 'progressive'
    ? { ...baseVideo, id: 'lab-progressive', name: '渐进样片', preview720Path: 'lab/720.mp4', originalStoragePath: 'lab/source.mp4' }
    : testCase === 'unavailable'
      ? { ...baseVideo, id: 'lab-unavailable', name: '不可预览样片' }
      : { ...baseVideo, hlsPath: 'lab/master.m3u8', originalStoragePath: 'lab/source.mp4' }

  return (
    <main data-preview-lab className="min-h-screen bg-background p-6 text-foreground">
      <AdminVideoManager
        projectId="lab-project"
        videos={[video]}
        projectStatus="APPROVED"
        viewMode="list"
        canUpload={false}
      />
    </main>
  )
}
