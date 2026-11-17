import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import SharePageClient from '@/app/share/[teamSlug]/SharePageClient'
import { resolveActiveShareLink } from '@/lib/share-links'
import { isMobileHandoffUserAgent } from '@/lib/share-handoff'

export const dynamic = 'force-dynamic'

// robots metadata is replaced wholesale per level, so `follow` has to be
// restated next to `index`. A share code is a visitor's front door, not a page
// to rank, and no robots.txt prefix can cover a one-segment path.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
}

/**
 * The root of the domain is where a share code is typed, so this route is the
 * visitor's front door: `https://vidx.cn/<code>`. Static routes (`/login`,
 * `/pricing`, `/studio`…) are matched before a dynamic segment, so only unknown
 * one-segment paths land here, and an unknown code renders the 404.
 */
export default async function RootSharePage({
  params,
  searchParams,
}: {
  params: Promise<{ shareCode: string }>
  searchParams: Promise<{ mode?: string; web?: string }>
}) {
  const { shareCode } = await params
  const { mode, web } = await searchParams
  const resolved = await resolveActiveShareLink(shareCode)

  // Only a `ShareLink` row answers at the root, project master link included.
  // A project's internal API token has no row, so it cannot be replayed here as
  // a path, and an unknown or revoked code falls through to the 404.
  if (!resolved) notFound()

  // 收录链接的访客端由 ?mode=collect 决定画上传面板还是素材网格，而发出去的地址要能被
  // 人手工敲进来，所以裸短码在这里自己补上那个参数。
  if (resolved.link.type === 'COLLECT' && mode !== 'collect') {
    redirect(`/${encodeURIComponent(shareCode)}?mode=collect`)
  }

  // ?web=1 是访客自己要网页版；收录链接本来就没有小程序落点，两者都不分流。
  if (web !== '1' && resolved.link.type !== 'COLLECT') {
    const userAgent = (await headers()).get('user-agent')
    if (isMobileHandoffUserAgent(userAgent)) {
      redirect(`/open/${encodeURIComponent(shareCode)}`)
    }
  }

  return <SharePageClient token={shareCode} />
}
