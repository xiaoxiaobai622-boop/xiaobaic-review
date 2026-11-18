import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

function maskStyle(src: string): CSSProperties {
  return {
    WebkitMaskImage: `url(${src})`,
    WebkitMaskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskImage: `url(${src})`,
    maskSize: 'contain',
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
  }
}

/** 首页/通知两枚图标从对标截图里抠（public/rail/*），只取 alpha 当遮罩。 */
export function RailHomeGlyph({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block bg-current', className)} style={maskStyle('/rail/home.png')} />
}

export function RailBellGlyph({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block bg-current', className)} style={maskStyle('/rail/bell.png')} />
}
