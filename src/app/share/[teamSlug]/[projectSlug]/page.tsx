import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import SharePageClient from '../../[teamSlug]/SharePageClient'

interface SharePageProps {
  params: Promise<{ teamSlug: string; projectSlug: string }>
}

export default async function TeamSharePage({ params }: SharePageProps) {
  const { teamSlug, projectSlug } = await params

  const project = await prisma.project.findFirst({
    where: {
      shareSlug: projectSlug,
      team: {
        OR: [
          { shareKey: teamSlug },
          { slug: teamSlug },
        ],
      },
    },
    select: { slug: true, status: true },
  })

  if (!project || project.status === 'ARCHIVED') {
    notFound()
  }

  return <SharePageClient token={project.slug} />
}
