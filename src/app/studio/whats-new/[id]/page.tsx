import { redirect } from 'next/navigation'

export default async function LegacyWhatsNewArticlePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/whats-new/${encodeURIComponent(id)}`)
}