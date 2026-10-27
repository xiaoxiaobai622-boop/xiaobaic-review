'use client'

import { VideoAssetUploadQueue } from '@/components/VideoAssetUploadQueue'
import CommentAttachmentButton from '@/components/CommentAttachmentButton'

export default function UploadSamples() {
  return (
    <main data-upload-lab className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <div>
          <h1 className="text-xl font-semibold">上传反馈 · 本地样本</h1>
          <p className="mt-1 text-sm text-muted-foreground">真实上传组件，接口全部拦截；不写任何数据。</p>
        </div>
        <section aria-labelledby="asset-queue-title">
          <h2 id="asset-queue-title" className="mb-2 text-base font-semibold">素材队列</h2>
          <VideoAssetUploadQueue videoId="sample-video" />
        </section>
        <section aria-labelledby="attachments-title">
          <h2 id="attachments-title" className="mb-2 text-base font-semibold">批注附件</h2>
          <CommentAttachmentButton videoId="sample-video" shareToken={null} onAttachmentAdded={() => {}} />
        </section>
      </div>
    </main>
  )
}
