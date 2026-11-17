import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolveHandoffShare } from '@/lib/share-links'
import HandoffClient from './HandoffClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

/**
 * 手机从主链接进来的中转站：真正的内容在小程序里，这一页只负责把码交过去。
 * 它不能出现在搜索结果里，受密码/验证码保护的项目连标题也不在这里露出。
 */
export default async function OpenHandoffPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const share = await resolveHandoffShare(code)
  if (!share) notFound()

  return (
    <HandoffClient
      code={code}
      projectTitle={share.protectedShare ? null : share.projectTitle}
      protectedShare={share.protectedShare}
      ownerName={share.ownerName}
      ownerAvatarUrl={share.ownerAvatarUrl}
      shareDate={share.shareDate}
    />
  )
}
