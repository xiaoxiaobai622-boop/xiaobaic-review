import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/** The open-tag page lives at /open/<code>; old /handoff links are forwarded. */
export default async function HandoffRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ debug?: string; web?: string }>
}) {
  const { code } = await params
  const { debug, web } = await searchParams
  const query = new URLSearchParams()
  if (debug === '1') query.set('debug', '1')
  if (web === '1') query.set('web', '1')
  const suffix = query.toString() ? `?${query.toString()}` : ''
  redirect(`/open/${encodeURIComponent(code)}${suffix}`)
}
