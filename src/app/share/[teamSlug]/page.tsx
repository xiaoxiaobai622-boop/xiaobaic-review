import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import SharePageClient from './SharePageClient'
import { resolveActiveShareLink } from '@/lib/share-links'
import { isMobileHandoffUserAgent } from '@/lib/share-handoff'

export const dynamic = 'force-dynamic'

interface SharePageProps {
  params: Promise<{ teamSlug: string }>
  searchParams: Promise<{ web?: string; debug?: string }>
}

/**
 * Legacy single-segment entry: `/share/<code>` keeps working only for a real
 * `ShareLink` token. Project slugs and retired master rows have no row and 404;
 * `/share/<team>/<projectSlug>` was removed with 1A.
 */
export default async function SharePage({ params, searchParams }: SharePageProps) {
  const { teamSlug } = await params
  const { web, debug } = await searchParams

  const resolved = await resolveActiveShareLink(teamSlug)
  if (!resolved) notFound()

  if (web !== '1') {
    const userAgent = (await headers()).get('user-agent')
    if (isMobileHandoffUserAgent(userAgent)) {
      const debugQuery = debug === '1' ? '?debug=1' : ''
      redirect(`/open/${encodeURIComponent(resolved.link.token)}${debugQuery}`)
    }
  }

  return <SharePageClient token={teamSlug} />
}
