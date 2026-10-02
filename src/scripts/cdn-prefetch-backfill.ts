import { prisma } from '../lib/db'
import { isCdnPrefetchEnabled, prefetchRenditions } from '../lib/tencent-cdn'

/**
 * Bulk CDN prewarm for renditions that already exist, so a reviewer's first play
 * of an older clip does not pay for a cold shard. Counts only are printed.
 *
 *   npx tsx src/scripts/cdn-prefetch-backfill.ts --dry
 *   npx tsx src/scripts/cdn-prefetch-backfill.ts --project <projectId> --limit 200
 *
 * In production run it inside the app container so it shares that container's
 * Redis budget and Tencent credentials:
 *
 *   docker exec -w /app vitransfer-app npx tsx src/scripts/cdn-prefetch-backfill.ts --limit 200
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const dry = process.argv.includes('--dry')
  const projectId = arg('project')
  const limit = Number(arg('limit') || 0)

  if (process.argv.includes('--help')) {
    console.log('usage: cdn-prefetch-backfill.ts [--dry] [--project <id>] [--limit <n>]')
    return
  }
  if (!dry && !projectId && !(limit > 0)) {
    throw new Error('Refusing to warm the whole library without --dry, --project <id> or --limit <n>.')
  }

  if (!isCdnPrefetchEnabled()) {
    throw new Error('CDN prefetch is disabled by configuration (MEDIA_CDN_ENABLED / MEDIA_CDN_BASE_URL / MEDIA_CDN_PREFETCH)')
  }

  const videos = await prisma.video.findMany({
    where: {
      status: 'READY',
      hlsPath: { not: null },
      ...(projectId ? { projectId } : {}),
    },
    select: { id: true, hlsPath: true },
    orderBy: { createdAt: 'desc' },
    ...(limit > 0 ? { take: limit } : {}),
  })

  const paths = videos.map((video) => video.hlsPath as string)
  const unique = Array.from(new Set(paths))
  console.log(`renditions matched=${paths.length} unique=${unique.length}${projectId ? ` project=${projectId}` : ' project=ALL'}${dry ? ' [dry run]' : ''}`)
  if (dry || unique.length === 0) return

  const result = await prefetchRenditions(unique)
  console.log(`urls submitted=${result.submitted} renditions warmed=${result.attempted} left for another day=${unique.length - result.attempted}`)
  if (result.attempted < unique.length) {
    console.log('The daily budget ran out; re-run tomorrow to continue where this stopped.')
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
