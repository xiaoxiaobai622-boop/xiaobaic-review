'use client'

import { useEffect } from 'react'
import { BRAND } from '@/lib/marketing/brand'

// 后台页面是客户端组件，拿不到 Next 的 metadata；标签页标题在这里跟着页面/项目走。
// 离开时只在标题仍是我们写的那条时才还原，避免把下一页自己的 title 盖回去。
export function useStudioTitle(title?: string | null) {
  useEffect(() => {
    const name = title?.trim()
    // 用函数式替换：项目名里的 `$&` 之类不会被 String.replace 当成替换模式。
    const next = name ? BRAND.titleTemplate.replace('%s', () => name) : BRAND.tabTitle
    const apply = () => {
      if (document.title !== next) document.title = next
    }
    apply()
    // 后台首屏加载完后 Next 还会把根 metadata 的标题写回来（项目中心实测 200ms 内被覆盖），
    // 这里盯着 <head>，被覆盖就再写一次；值相同不写，不会自激。
    const observer = new MutationObserver(apply)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      if (document.title === next) document.title = BRAND.tabTitle
    }
  }, [title])
}
