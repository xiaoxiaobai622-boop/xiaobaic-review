import type { Metadata } from 'next'
import { DocPage, docMetadata } from '@/components/marketing/DocPage'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  return docMetadata('features', slug)
}

export default function FeaturesDocRoute({ params }: Props) {
  return <DocPage group="features" params={params} />
}
