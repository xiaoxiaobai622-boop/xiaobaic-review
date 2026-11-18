'use client'

import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

// 气泡问号图标直接从对标截图里抠（public/rail/support.png），alpha 当遮罩，颜色跟当前文字走。
const ICON_MASK: CSSProperties = {
  WebkitMaskImage: 'url(/rail/support.png)',
  WebkitMaskSize: 'contain',
  WebkitMaskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskImage: 'url(/rail/support.png)',
  maskSize: 'contain',
  maskRepeat: 'no-repeat',
  maskPosition: 'center',
}

/** 左栏客服：打开现有的客服聊天窗，入口从原来悬浮在左中的边签搬到这里。 */
export default function RailSupport({ className }: { className?: string }) {
  return (
    <button
      type="button"
      aria-label="客服"
      title="客服"
      className={cn(className, 'text-muted-foreground hover:text-foreground')}
      onClick={() => window.dispatchEvent(new Event('vidx-open-support'))}
    >
      <span aria-hidden="true" className="block h-[22px] w-[22px] bg-current" style={ICON_MASK} />
    </button>
  )
}
