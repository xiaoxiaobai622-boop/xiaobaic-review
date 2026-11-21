/**
 * Backfill `teamId` on documents created from the project page before team
 * support existed: docs-api holds the document metadata, the main site owns the
 * authoritative `Project(id, teamId)` mapping. The docs service only fills docs
 * that carry a `projectId` and no `teamId`, so running this twice is safe.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/backfill-doc-teams.mts
 *
 * Env:
 *   DOCS_API_BASE       docs-api base URL (default https://office.vidx.cn/docs-api)
 *   DOCS_TOKEN_SECRET   docs service secret (falls back to JWT_SECRET)
 */
import { prisma } from '../src/lib/db'

const base = (process.env.DOCS_API_BASE || 'https://office.vidx.cn/docs-api').replace(/\/+$/, '')
const secret = process.env.DOCS_TOKEN_SECRET || process.env.JWT_SECRET
if (!secret) throw new Error('DOCS_TOKEN_SECRET or JWT_SECRET is required to call the docs API')

async function main() {
  const projects = await prisma.project.findMany({ select: { id: true, teamId: true } })

  const response = await fetch(`${base}/api/admin/backfill-teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ projects }),
  })

  const text = await response.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    // keep the raw text so the error below still shows what the service said
  }
  if (!response.ok) {
    throw new Error(`backfill failed: ${response.status} ${JSON.stringify(body)}`)
  }

  const updated = (body as { updated?: unknown } | null)?.updated
  if (typeof updated !== 'number') {
    throw new Error(`backfill response missing updated: ${JSON.stringify(body)}`)
  }
  console.log(`backfilled ${updated}`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
