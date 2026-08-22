interface VideoLinkedComment {
  videoId?: string | null
}

export function filterCommentsForVideo<T extends VideoLinkedComment>(
  comments: T[],
  videoId?: string | null,
): T[] {
  if (!videoId) return []
  return comments.filter((comment) => comment.videoId === videoId)
}
