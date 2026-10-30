type CommentWithVisibility = {
  visibility?: string | null
  replies?: CommentWithVisibility[] | null
}

/**
 * INTERNAL notes are for the owning team only. A share visitor is identified by
 * `verifyProjectAccess().isAdmin === false`; a logged-in account that is not on
 * the team is still a visitor. Keep parent and reply filtering together so the
 * two share routes cannot drift.
 */
export function filterCommentsForViewer<T extends CommentWithVisibility>(
  comments: T[],
  canViewInternal: boolean,
): T[] {
  if (canViewInternal) return comments

  return comments
    .filter((comment) => comment.visibility !== 'INTERNAL')
    .map((comment) => ({
      ...comment,
      replies: Array.isArray(comment.replies)
        ? comment.replies.filter((reply) => reply.visibility !== 'INTERNAL')
        : comment.replies,
    })) as T[]
}
