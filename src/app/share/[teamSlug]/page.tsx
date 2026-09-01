import { notFound } from 'next/navigation'
import SharePageClient from './SharePageClient'
import { resolveShareMetadata, isShareLinkActive } from '@/lib/share-links'

interface SharePageProps {
  params: Promise<{ teamSlug: string }>
}

export default async function SharePage({ params }: SharePageProps) {
  const { teamSlug } = await params

  // Server-side validation: check if slug exists and is not archived
  const resolved = await resolveShareMetadata(teamSlug)
  const project = resolved.project

  // Show not-found for non-existent or archived projects
  // Archived projects appear as if they don't exist (security)
  if (!project || project.status === 'ARCHIVED' || (resolved.link && !isShareLinkActive(resolved.link))) {
    notFound()
  }

  return <SharePageClient token={teamSlug} />
}
