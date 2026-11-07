import type { Metadata } from 'next'
import { DocPage, docMetadata } from '@/components/marketing/DocPage'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  return docMetadata('guides', slug)
}

export default function GuidesDocRoute({ params }: Props) {
  return <DocPage group="guides" params={params} />
}
