import { notFound, redirect } from 'next/navigation'
import SharePageClient from '@/app/share/[teamSlug]/SharePageClient'
import { resolveShareMetadata, isShareLinkActive } from '@/lib/share-links'

export const dynamic = 'force-dynamic'

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
  searchParams: Promise<{ mode?: string }>
}) {
  const { shareCode } = await params
  const { mode } = await searchParams
  const resolved = await resolveShareMetadata(shareCode)

  // Only a `ShareLink` row answers at the root, project master link included.
  // A project's internal API token has no row, so it cannot be replayed here as
  // a path, and an unknown or revoked code falls through to the 404.
  if (
    !resolved.link ||
    !resolved.project ||
    resolved.project.status === 'ARCHIVED' ||
    !isShareLinkActive(resolved.policy)
  ) {
    notFound()
  }

  // 收录链接的访客端由 ?mode=collect 决定画上传面板还是素材网格，而发出去的地址要能被
  // 人手工敲进来，所以裸短码在这里自己补上那个参数。
  if (resolved.link.type === 'COLLECT' && mode !== 'collect') {
    redirect(`/${encodeURIComponent(shareCode)}?mode=collect`)
  }

  return <SharePageClient token={shareCode} />
}
