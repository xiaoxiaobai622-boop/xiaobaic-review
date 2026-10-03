import type { Metadata } from 'next'
import { HubPage, hubMetadata } from '@/components/marketing/HubPage'

/** 同 `/features`：显式目录，避免与根级 `[shareCode]` 抢同一段 URL。 */
export async function generateMetadata(): Promise<Metadata> {
  return hubMetadata('compare')
}

export default function CompareHubRoute() {
  return <HubPage group="compare" />
}
