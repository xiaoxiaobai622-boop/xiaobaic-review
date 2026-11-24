export const WHATS_NEW_CARD_SUMMARY_MAX = 55

/**
 * The article body is intentionally kept out of the rail card. The card uses a
 * short, sentence-aware digest; the full article stays in contentHtml.
 */
export function whatsNewCardSummary(content: string, max = WHATS_NEW_CARD_SUMMARY_MAX): string {
  const normalized = (content || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= max) return normalized

  const sentences = normalized.match(/[^。！？!?]+[。！？!?]?/g) ?? [normalized]
  let summary = ''
  for (const sentence of sentences) {
    if ((summary + sentence).length > max) break
    summary += sentence
  }
  if (!summary) summary = normalized.slice(0, max)

  summary = summary.trimEnd()
  if (summary.length < normalized.length) {
    summary = `${summary.replace(/[。！？!?，,、；;：:]+$/, '')}…`
  }
  return summary
}