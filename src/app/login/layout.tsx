import type { Metadata } from 'next'

// 登录后应用页不对搜索引擎开放。`index` 与 `follow` 必须同时写：
// Next 的 robots 字段在子级是整字段替换、没有深合并，只写 `{ index: false }`
// 会把根 layout 的 `follow: true` 一起丢掉。
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
