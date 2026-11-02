import { prisma } from './db'

export type SourceQualityEventType =
  | 'SOURCE_QUALITY_TOKEN'
  | 'SOURCE_QUALITY_PLAY'
  | 'SOURCE_QUALITY_FAILURE'

/**
 * Minimal operational counters for the source-quality mode. These rows are not
 * security audit records; they answer "is the feature used, failing, or moving
 * bytes" on the platform settings page.
 */
export async function trackSourceQualityEvent(params: {
  eventType: SourceQualityEventType
  videoId: string
  projectId: string
  bytes?: number
}): Promise<void> {
  await prisma.videoAnalytics.create({
    data: {
      eventType: params.eventType,
      videoId: params.videoId,
      projectId: params.projectId,
      quality: 'source',
      bytes: BigInt(Math.max(0, Math.round(params.bytes ?? 0))),
    },
  })
}
