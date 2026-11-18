import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import SharePageClient from './SharePageClient'
import { ensureProjectMasterLink, isShareLinkActive, resolveShareMetadata } from '@/lib/share-links'
import { isMobileHandoffUserAgent, isWechatMobileUserAgent } from '@/lib/share-handoff'

export const dynamic = 'force-dynamic'

interface SharePageProps {
  params: Promise<{ teamSlug: string }>
  searchParams: Promise<{ web?: string; debug?: string }>
}

export default async function SharePage({ params, searchParams }: SharePageProps) {
  const { teamSlug } = await params
  const { web, debug } = await searchParams

  // Server-side validation: check if slug exists and is not archived
  const resolved = await resolveShareMetadata(teamSlug)
  const project = resolved.project

  // Show not-found for non-existent or archived projects
  // Archived projects appear as if they don't exist (security)
  if (!project || project.status === 'ARCHIVED' || !isShareLinkActive(resolved.policy)) {
    notFound()
  }

  if (web !== '1') {
    const userAgent = (await headers()).get('user-agent')
    if (isMobileHandoffUserAgent(userAgent)) {
      // A real link row keeps its own scope and permissions; only the legacy
      // project-only address needs the project's master code.
      let handoffToken = resolved.link?.token ?? null
      if (!handoffToken) {
        const master = await ensureProjectMasterLink(project.id)
        if (master && isShareLinkActive(master)) handoffToken = master.token
      }
      if (handoffToken) {
        const target = isWechatMobileUserAgent(userAgent) ? 'handoff' : 'open'
        const debugQuery = target === 'handoff' && debug === '1' ? '?debug=1' : ''
        redirect(`/${target}/${encodeURIComponent(handoffToken)}${debugQuery}`)
      }
    }
  }

  return <SharePageClient token={teamSlug} />
}
