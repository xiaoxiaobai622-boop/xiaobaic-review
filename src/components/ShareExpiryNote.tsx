'use client'

/**
 * A share link's own deadline, stated where the visitor is already looking.
 * A link with neither an expiry nor a view cap renders nothing — an unbounded
 * link does not need a disclaimer.
 */
export default function ShareExpiryNote({ expiresAt, viewsRemaining, className }: {
  expiresAt: string | null
  viewsRemaining: number | null
  className?: string
}) {
  const parts: string[] = []
  if (expiresAt) {
    const expiry = new Date(expiresAt)
    parts.push(`${expiry.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 失效`)
  }
  if (viewsRemaining !== null) parts.push(`还能查看 ${viewsRemaining} 次`)
  if (parts.length === 0) return null
  return <p className={`whitespace-nowrap text-xs tabular-nums text-muted-foreground ${className ?? ''}`}>{parts.join(' · ')}</p>
}
