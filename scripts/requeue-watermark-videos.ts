import { prisma } from '../src/lib/db'
import { getVideoQueue } from '../src/lib/queue'

const videoIds = [
  'cmscrke0b000alv4ecz1yv2ez',
  'cmscriqkg0008lv4eivz3z5mx',
]

async function main() {
  const videos = await prisma.video.findMany({
    where: {
      id: { in: videoIds },
      status: 'ERROR',
    },
  })

  if (videos.length !== videoIds.length) {
    throw new Error(`Expected ${videoIds.length} failed videos, found ${videos.length}`)
  }

  const queue = getVideoQueue()

  for (const video of videos) {
    await prisma.video.update({
      where: { id: video.id },
      data: {
        status: 'PROCESSING',
        processingProgress: 0,
        processingError: null,
        preview2160Path: null,
        preview1080Path: null,
        preview720Path: null,
        cleanPreview2160Path: null,
        cleanPreview1080Path: null,
        cleanPreview720Path: null,
      },
    })

    await queue.add('process-video', {
      videoId: video.id,
      originalStoragePath: video.originalStoragePath,
      projectId: video.projectId,
    })
  }

  console.log(`Requeued ${videos.length} videos`)
  await queue.close()
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
