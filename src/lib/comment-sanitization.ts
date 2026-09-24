import { secondsToTimecode, parseTimecodeInput, isValidTimecode } from './timecode'

/**
 * `authorName` doubles as an account identifier: routes store
 * `name || phone || email` so the studio can always tell who wrote what.
 * An external viewer must never be shown another person's account identifier,
 * so anything that reads as an email address or a bare phone number is dropped
 * in favour of the generic label.
 */
function isAccountIdentifier(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return true
  return trimmed.includes('@') || /^\+?[\d\s-]{7,}$/.test(trimmed)
}

// Fallback for legacy comments that still have a numeric timestamp column
const normalizeTimecode = (comment: any): string => {
  if (comment.timecode && typeof comment.timecode === 'string') {
    const trimmed = comment.timecode.trim()

    if (isValidTimecode(trimmed)) {
      return trimmed
    }

    // Handle legacy seconds stored as a string (e.g., "36" or "36.5")
    if (!Number.isNaN(Number(trimmed)) && !trimmed.includes(':')) {
      return secondsToTimecode(parseFloat(trimmed), 24)
    }

    // Attempt to normalize other partial formats (MM:SS, HH:MM:SS)
    try {
      return parseTimecodeInput(trimmed, 24)
    } catch {
      // Fall through to default below
    }
  }

  if (typeof comment.timestamp === 'number') {
    return secondsToTimecode(comment.timestamp, 24)
  }

  return '00:00:00:00'
}

export function sanitizeComment(
  comment: any,
  isAdmin: boolean,
  isAuthenticated: boolean,
  clientName?: string,
  viewerUserId?: string | null,
  teamName?: string | null,
) {
  const normalizedTimecode = normalizeTimecode(comment)
  const accountName = comment.user?.name?.trim() || null
  // First non-empty *display* name. Account identifiers are filtered out so an email
  // or phone number stored for the studio can never surface on a client-facing page.
  const publicAuthorName = [accountName, comment.authorName]
    .find((value): value is string => typeof value === 'string' && !isAccountIdentifier(value)) || null

  const sanitized: any = {
    id: comment.id,
    projectId: comment.projectId,
    videoId: comment.videoId,
    videoVersion: comment.videoVersion,
    timecode: normalizedTimecode,
    timecodeEnd: comment.timecodeEnd || null,
    resolved: comment.resolved === true,
    category: comment.category || null,
    annotations: comment.annotations || null,
    content: comment.content,
    isInternal: comment.isInternal,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    parentId: comment.parentId,
    // This is intentionally a boolean rather than exposing another user's ID.
    canDelete: Boolean(viewerUserId && comment.userId === viewerUserId),
    // The project/team label is only shown to external viewers. Team members
    // already know the workspace context and should not see the public marker.
    teamName: isAdmin ? null : (teamName || null),
  }

  // NEVER expose real names or emails to non-admins
  // Use generic labels only
  if (isAdmin) {
    // Admins get real data for management purposes only
    sanitized.authorName = accountName || comment.user?.email || comment.authorName
    sanitized.authorEmail = comment.authorEmail
    sanitized.userId = comment.userId
    sanitized.canDelete = true
    if (comment.user) {
      const teamProfile = Array.isArray(comment.user.teamMemberships)
        ? comment.user.teamMemberships[0]
        : null
      sanitized.user = {
        id: comment.user.id,
        name: comment.user.name,
        email: comment.user.email,
        avatarUrl: comment.user.avatarUrl || null,
        teamNickname: teamProfile?.teamNickname || null,
        teamProfession: teamProfile?.teamProfession || null,
        department: teamProfile?.department || null,
        bio: teamProfile?.bio || null,
      }
    }
  } else if (isAuthenticated) {
    // Authenticated share users see author display names but never account identifiers
    sanitized.authorName = publicAuthorName || (comment.isInternal ? 'Admin' : (clientName || 'Client'))
  } else {
    // Guests/public: generic labels only, no PII
    sanitized.authorName = comment.isInternal ? 'Admin' : 'Client'
  }

  // Internal author presentation is safe to expose on share pages: only the avatar and
  // the member's own public signature (nickname + role) are returned. Department and
  // bio are internal org data and stay admin-only, same rule as the project detail route.
  if (!isAdmin && comment.isInternal && comment.user) {
    const teamProfile = Array.isArray(comment.user.teamMemberships)
      ? comment.user.teamMemberships[0]
      : null
    sanitized.user = {
      avatarUrl: comment.user.avatarUrl || null,
      teamNickname: teamProfile?.teamNickname || null,
      teamProfession: teamProfile?.teamProfession || null,
    }
  }

  // Pass through assets (safe subset already selected by Prisma query)
  if (comment.assets && Array.isArray(comment.assets)) {
    sanitized.assets = comment.assets.map((asset: any) => ({
      id: asset.id,
      fileName: asset.fileName,
      originalFileName: asset.originalFileName,
      fileSize: typeof asset.fileSize === 'bigint' ? asset.fileSize.toString() : String(asset.fileSize),
      fileType: asset.fileType,
      category: asset.category,
      createdAt: asset.createdAt,
    }))
  }

  if (comment.replies && Array.isArray(comment.replies)) {
    sanitized.replies = comment.replies.map((reply: any) =>
      sanitizeComment(reply, isAdmin, isAuthenticated, clientName, viewerUserId, teamName)
    )
  }

  return sanitized
}
