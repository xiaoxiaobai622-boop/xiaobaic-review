import type { Metadata } from 'next'
import { DocPage, docMetadata } from '@/components/marketing/DocPage'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  return docMetadata('compare', slug)
}

export default function CompareDocRoute({ params }: Props) {
  return <DocPage group="compare" params={params} />
}
