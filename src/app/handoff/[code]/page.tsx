import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { resolveHandoffShare } from '@/lib/share-links'
import {
  buildMiniShareQuery,
  isWechatMobileUserAgent,
  toAbsoluteHttpUrl,
} from '@/lib/share-handoff'
import { getAppUrl } from '@/lib/url'
import HandoffLaunchClient from './HandoffLaunchClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

/**
 * WeChat-only shortcut: the public account signs the page and the open tag
 * starts the published mini program directly, so a share never leaves vidx.cn.
 */
export default async function HandoffPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ web?: string }>
}) {
  const { code } = await params
  const { web } = await searchParams
  const requestHeaders = await headers()

  // Everyone outside mobile WeChat goes back to the ordinary web share page.
  if (web === '1' || !isWechatMobileUserAgent(requestHeaders.get('user-agent'))) {
    redirect(`/${encodeURIComponent(code)}?web=1`)
  }

  const share = await resolveHandoffShare(code)
  if (!share) notFound()

  const baseUrl = await getAppUrl().catch(() => '')
  const avatarUrl = toAbsoluteHttpUrl(share.ownerAvatarUrl, baseUrl)
  const miniPath = `pages/share/index?${buildMiniShareQuery(
    share.token,
    share.ownerName,
    avatarUrl,
    share.shareDate,
  )}`

  return (
    <HandoffLaunchClient
      code={code}
      projectTitle={share.protectedShare ? null : share.projectTitle}
      protectedShare={share.protectedShare}
      ownerName={share.ownerName}
      ownerAvatarUrl={share.ownerAvatarUrl}
      miniPath={miniPath}
      nonce={requestHeaders.get('x-nonce') || undefined}
    />
  )
}
