interface VersionedVideo {
  id: string
  version?: number | null
  createdAt?: string | Date | null
}

interface VideoComment {
  videoId?: string | null
}

function getTimestamp(value?: string | Date | null): number {
  if (!value) return 0
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

export function getLatestVideo<T extends VersionedVideo>(videos: T[]): T | null {
  return videos.reduce<T | null>((latest, video) => {
    if (!latest) return video

    const version = video.version ?? 0
    const latestVersion = latest.version ?? 0
    if (version !== latestVersion) return version > latestVersion ? video : latest

    return getTimestamp(video.createdAt) > getTimestamp(latest.createdAt) ? video : latest
  }, null)
}

export function countCommentsByLatestVideoName<T extends VersionedVideo>(
  videosByName: Record<string, T[]>,
  comments: VideoComment[],
): Map<string, number> {
  const videoNamesByLatestId = new Map<string, string>()

  Object.entries(videosByName).forEach(([name, versions]) => {
    const latestVideo = getLatestVideo(versions)
    if (latestVideo?.id) videoNamesByLatestId.set(latestVideo.id, name)
  })

  const counts = new Map<string, number>()
  comments.forEach((comment) => {
    if (!comment.videoId) return
    const name = videoNamesByLatestId.get(comment.videoId)
    if (name) counts.set(name, (counts.get(name) || 0) + 1)
  })

  return counts
}
