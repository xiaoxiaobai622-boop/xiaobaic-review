'use client'

import { VideoUploadModal } from '@/components/VideoUploadModal'

export default function UploadModalSample() {
  return (
    <main data-upload-modal-lab className="min-h-screen bg-background p-6 text-foreground">
      <p className="text-sm text-muted-foreground">真实上传弹窗；接口由回归脚本拦截，不写任何数据。</p>
      <VideoUploadModal
        isOpen
        projectId="lab-project"
        onClose={() => {}}
        onUploadComplete={() => {}}
      />
    </main>
  )
}
