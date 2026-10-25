import { redirect } from 'next/navigation'
import { safeReturnUrl } from '@/lib/return-url'

// 独立扫码页已并入登录页的内嵌扫码组件；保留旧地址给外部客户端和书签一个落点。
export default async function WechatMiniLoginRedirect({
  searchParams,
}: {
  searchParams: Promise<{ returnUrl?: string }>
}) {
  const { returnUrl } = await searchParams
  const safe = safeReturnUrl(returnUrl ?? null, '')
  redirect(safe ? `/login?returnUrl=${encodeURIComponent(safe)}` : '/login')
}
