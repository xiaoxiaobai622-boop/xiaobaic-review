import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { ensureProjectMasterLink, isShareLinkActive, resolveHandoffShare } from '@/lib/share-links'
import {
  buildMiniShareCloudUrl,
  isMobileHandoffUserAgent,
  isWechatMobileUserAgent,
  toAbsoluteHttpUrl,
} from '@/lib/share-handoff'
import { getAppUrl } from '@/lib/url'
import SharePageClient from '../../[teamSlug]/SharePageClient'

export const dynamic = 'force-dynamic'

interface SharePageProps {
  params: Promise<{ teamSlug: string; projectSlug: string }>
  searchParams: Promise<{ web?: string }>
}

export default async function TeamSharePage({ params, searchParams }: SharePageProps) {
  const { teamSlug, projectSlug } = await params
  const { web } = await searchParams

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
    select: { id: true, slug: true, status: true },
  })

  if (!project || project.status === 'ARCHIVED') {
    notFound()
  }

  if (web !== '1') {
    const userAgent = (await headers()).get('user-agent')
    if (isMobileHandoffUserAgent(userAgent)) {
      const master = await ensureProjectMasterLink(project.id)
      if (master && isShareLinkActive(master)) {
        if (isWechatMobileUserAgent(userAgent)) {
          const share = await resolveHandoffShare(master.token)
          if (share) {
            const baseUrl = await getAppUrl().catch(() => '')
            redirect(buildMiniShareCloudUrl(
              share.token,
              share.ownerName,
              toAbsoluteHttpUrl(share.ownerAvatarUrl, baseUrl),
              share.shareDate,
            ))
          }
        } else {
          redirect(`/open/${encodeURIComponent(master.token)}`)
        }
      }
    }
  }

  return <SharePageClient token={project.slug} />
}
