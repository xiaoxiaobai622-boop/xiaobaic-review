import { prisma } from '@/lib/db'
import { logError, logMessage } from '@/lib/logging'

/**
 * Hard-delete support conversations whose retention window has expired. Message,
 * participant and notification rows cascade; audit events keep their type/time
 * with conversationId set to null so the operator still has a record of the purge.
 */
export async function purgeExpiredSupportConversations() {
  const now = new Date()
  try {
    const result = await prisma.supportConversation.deleteMany({
      where: {
        retentionUntil: { lte: now },
      },
    })
    if (result.count > 0) logMessage(`[SUPPORT] purged ${result.count} expired conversations`)
    return result.count
  } catch (error) {
    logError('[SUPPORT] retention purge failed:', error)
    return 0
  }
}
