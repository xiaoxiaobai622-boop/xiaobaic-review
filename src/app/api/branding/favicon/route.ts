import { NextResponse } from 'next/server'
import { downloadFile, fileExists } from '@/lib/storage'
import { SVG_RESPONSE_HEADERS } from '@/lib/brand'
import type { Readable } from 'node:stream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Same paths the upload endpoint writes to. We probe in this order; the first
// one that exists is served. Only one is ever populated at a time because the
// upload endpoint clears the others when writing.
const FORMATS = [
  { path: 'branding/favicon.svg', contentType: 'image/svg+xml' },
  { path: 'branding/favicon.png', contentType: 'image/png' },
  { path: 'branding/favicon.ico', contentType: 'image/x-icon' },
] as const

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/**
 * Public favicon endpoint. Browsers request this with no auth — the response
 * is cacheable for 5 minutes so we don't probe storage on every page load.
 *
 * 字节从这条路由自己回，不再 302 到预签名地址：那条链接带 `X-Amz-Expires=3600`，
 * 一小时后就自己 403，而 `<head>` 里声明的 `/api/branding/favicon` 是唯一长期有效的
 * 图标地址——搜索引擎抓的正是声明的那条，跟一次跳转拿不到过期后的图。
 */
export async function GET() {
  for (const format of FORMATS) {
    try {
      // Both modes go through the storage abstraction, the same way the logo
      // route does: probing the container's own disk makes an uploaded icon
      // invisible while the bucket is the real store.
      if (!(await fileExists(format.path))) continue
      const data = await readAll(await downloadFile(format.path))
      return new NextResponse(new Uint8Array(data), {
        status: 200,
        headers: {
          'Content-Type': format.contentType,
          'Cache-Control': 'public, max-age=300, must-revalidate',
          ...(format.contentType === 'image/svg+xml' ? SVG_RESPONSE_HEADERS : {}),
        },
      })
    } catch {
      // Try next format
    }
  }

  return NextResponse.json({ error: 'Favicon not found' }, { status: 404 })
}
